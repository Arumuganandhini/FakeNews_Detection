// backend/utils/ocr.js
//
// Reading the text out of a screenshot.
//
// This is the only route into Instagram, WhatsApp and most of Facebook. Those
// platforms serve nothing useful to an unauthenticated reader, but the thing
// people actually forward is a screenshot, and a screenshot is readable. The
// claim in a viral post is usually typed over the image rather than in the
// caption, so OCR is not a convenience here — it is where the claim lives.
//
// tesseract.js is loaded lazily and the whole feature is optional: if the
// package is not installed the rest of the system runs exactly as before and
// this path returns a clear message. No analysis silently degrades because an
// optional dependency is missing.
let worker = null;
let loadFailed = false;

const LANGUAGE_PACKS = {
  eng: 'English', tam: 'Tamil', hin: 'Hindi', tel: 'Telugu', kan: 'Kannada',
  mal: 'Malayalam', ben: 'Bengali', guj: 'Gujarati', pan: 'Punjabi',
  mar: 'Marathi', urd: 'Urdu', ara: 'Arabic'
};

/** Is screenshot reading available in this deployment? */
const isAvailable = () => {
  if (loadFailed) return false;
  try {
    require.resolve('tesseract.js');
    return true;
  } catch (_) {
    return false;
  }
};

/**
 * Read text from an image.
 *
 * @param {Buffer} buffer - the image bytes
 * @param {string[]} [languages] - tesseract language packs to load, e.g. ['eng','tam'].
 *        Loading several costs a one-off download each; English plus the
 *        expected script is the sensible default for a screenshot.
 * @returns {Promise<{text: string, confidence: number, languages: string[]}>}
 */
const readImageText = async (buffer, languages = ['eng']) => {
  if (!isAvailable()) {
    const error = new Error(
      'Screenshot reading is not installed on this server. Run "npm install tesseract.js" in the backend, or paste the text of the post instead.'
    );
    error.code = 'OCR_UNAVAILABLE';
    throw error;
  }

  const packs = languages.filter(code => LANGUAGE_PACKS[code]);
  const langString = (packs.length ? packs : ['eng']).join('+');

  try {
    const { createWorker } = require('tesseract.js');
    // One worker per language combination, reused across requests: creating a
    // worker re-downloads and re-initialises the model, which dominates the
    // cost of a small image.
    if (!worker || worker.langString !== langString) {
      if (worker?.instance) await worker.instance.terminate().catch(() => {});
      const instance = await createWorker(langString);
      worker = { instance, langString };
    }

    const { data } = await worker.instance.recognize(buffer);
    const text = String(data.text || '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();

    return {
      text,
      // Tesseract reports 0-100; a low value on a screenshot usually means the
      // image is a photo of a screen rather than a screenshot of one.
      confidence: Math.round(Number(data.confidence) || 0),
      languages: packs.length ? packs : ['eng']
    };
  } catch (err) {
    if (err.code === 'OCR_UNAVAILABLE') throw err;
    loadFailed = true;
    const error = new Error('We could not read text from that image. Try a clearer screenshot, or paste the text instead.');
    error.code = 'OCR_FAILED';
    error.cause = err;
    throw error;
  }
};

/** Tesseract pack for a detected language code, so a Tamil screenshot is read in Tamil. */
const packForLanguage = (code) => ({
  ta: 'tam', hi: 'hin', te: 'tel', kn: 'kan', ml: 'mal', bn: 'ben',
  gu: 'guj', pa: 'pan', mr: 'mar', ur: 'urd', ar: 'ara', en: 'eng'
}[String(code || '').toLowerCase()] || null);

const shutdown = async () => {
  if (worker?.instance) await worker.instance.terminate().catch(() => {});
  worker = null;
};

module.exports = { readImageText, isAvailable, packForLanguage, shutdown, LANGUAGE_PACKS };
