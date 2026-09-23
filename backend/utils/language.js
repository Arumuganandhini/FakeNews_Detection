// backend/utils/language.js
//
// Which language is this article in?
//
// Every downstream decision depends on the answer: which language to prompt the
// model in, which language to quote flagged sentences back in, and — the one
// that matters most for verification — which language to search for
// corroborating coverage in. A Tamil report about a Chennai flood will not be
// corroborated by an English-only search, and the system would wrongly conclude
// that nobody else is reporting it.
//
// Detection is deterministic and local: no API call, no model, no dependency.
// For most of the world's news that is enough, because script alone identifies
// the language. Latin-script languages share an alphabet, so those are
// separated by function-word frequency, which is the classical method and is
// entirely adequate on a paragraph of news text.

// Script blocks that identify a language outright, or narrow it to a small set.
const SCRIPTS = [
  { script: 'Tamil', range: /[஀-௿]/g, languages: ['ta'] },
  { script: 'Telugu', range: /[ఀ-౿]/g, languages: ['te'] },
  { script: 'Kannada', range: /[ಀ-೿]/g, languages: ['kn'] },
  { script: 'Malayalam', range: /[ഀ-ൿ]/g, languages: ['ml'] },
  { script: 'Bengali', range: /[ঀ-৿]/g, languages: ['bn'] },
  { script: 'Gujarati', range: /[઀-૿]/g, languages: ['gu'] },
  { script: 'Gurmukhi', range: /[਀-੿]/g, languages: ['pa'] },
  { script: 'Odia', range: /[଀-୿]/g, languages: ['or'] },
  { script: 'Sinhala', range: /[඀-෿]/g, languages: ['si'] },
  { script: 'Devanagari', range: /[ऀ-ॿ]/g, languages: ['hi', 'mr', 'ne'] },
  { script: 'Arabic', range: /[؀-ۿݐ-ݿ]/g, languages: ['ur', 'ar', 'fa'] },
  { script: 'Hebrew', range: /[֐-׿]/g, languages: ['he'] },
  { script: 'Greek', range: /[Ͱ-Ͽ]/g, languages: ['el'] },
  { script: 'Cyrillic', range: /[Ѐ-ӿ]/g, languages: ['ru', 'uk'] },
  { script: 'Thai', range: /[฀-๿]/g, languages: ['th'] },
  { script: 'Hangul', range: /[가-힯ᄀ-ᇿ]/g, languages: ['ko'] },
  { script: 'Kana', range: /[぀-ゟ゠-ヿ]/g, languages: ['ja'] },
  { script: 'Han', range: /[一-鿿]/g, languages: ['zh', 'ja'] }
];

// Function words that separate languages sharing a script. These are the most
// frequent words in each language and are rare in the others, so a short count
// over a paragraph is decisive.
const MARKERS = {
  // Devanagari
  hi: ['है', 'और', 'के', 'में', 'से', 'को', 'पर', 'नहीं', 'किया', 'गया', 'कहा'],
  mr: ['आहे', 'आणि', 'यांनी', 'मध्ये', 'केली', 'होते', 'नाही', 'त्या'],
  ne: ['छ', 'भएको', 'गरेको', 'तथा', 'हुन्'],
  // Arabic script
  ur: ['ہے', 'کے', 'اور', 'کی', 'میں', 'سے', 'کیا', 'نہیں', 'کہا'],
  ar: ['في', 'من', 'على', 'أن', 'التي', 'هذا', 'مع', 'عن'],
  fa: ['است', 'که', 'این', 'برای', 'شد', 'های'],
  // Cyrillic
  ru: ['что', 'это', 'как', 'для', 'при', 'году', 'после', 'сообщил'],
  uk: ['що', 'це', 'для', 'після', 'року', 'повідомив', 'та'],
  // CJK disambiguation handled by script mix, not markers
  // Latin script
  en: ['the', 'and', 'of', 'to', 'in', 'that', 'was', 'said', 'has', 'with', 'for'],
  es: ['que', 'de', 'la', 'el', 'en', 'los', 'del', 'con', 'por', 'una', 'para'],
  fr: ['que', 'de', 'le', 'la', 'les', 'des', 'est', 'une', 'pour', 'dans', 'sur'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'den', 'von', 'für', 'auch'],
  pt: ['que', 'de', 'do', 'da', 'em', 'para', 'com', 'uma', 'não', 'os'],
  it: ['che', 'di', 'il', 'la', 'per', 'con', 'non', 'una', 'sono', 'del'],
  nl: ['de', 'het', 'een', 'van', 'is', 'niet', 'dat', 'voor', 'met'],
  id: ['yang', 'dan', 'di', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'ini'],
  tr: ['bir', 'bu', 've', 'için', 'olarak', 'daha', 'ile', 'olan']
};

const LANGUAGE_NAMES = {
  en: 'English', ta: 'Tamil', hi: 'Hindi', te: 'Telugu', kn: 'Kannada',
  ml: 'Malayalam', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', or: 'Odia',
  mr: 'Marathi', ne: 'Nepali', si: 'Sinhala', ur: 'Urdu', ar: 'Arabic',
  fa: 'Persian', he: 'Hebrew', el: 'Greek', ru: 'Russian', uk: 'Ukrainian',
  th: 'Thai', ko: 'Korean', ja: 'Japanese', zh: 'Chinese', es: 'Spanish',
  fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian', nl: 'Dutch',
  id: 'Indonesian', tr: 'Turkish'
};

const LATIN_CANDIDATES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'id', 'tr'];

/** How many characters of the sample fall inside a script block. */
const countMatches = (text, range) => (text.match(range) || []).length;

/** How many of a language's marker words appear, as a share of all words. */
const markerScore = (words, code) => {
  const markers = MARKERS[code];
  if (!markers) return 0;
  const set = new Set(markers);
  let hits = 0;
  for (const word of words) if (set.has(word)) hits++;
  return words.length ? hits / words.length : 0;
};

/**
 * Identify the language of a piece of text.
 *
 * @param {string} text
 * @returns {{code: string, name: string, script: string, confidence: number, method: string, reliable: boolean}}
 */
const detectLanguage = (text) => {
  const sample = String(text || '').slice(0, 2000);
  const letters = (sample.match(/\p{L}/gu) || []).length;

  if (letters < 12) {
    return { code: 'en', name: 'English', script: 'Latin', confidence: 0, method: 'default', reliable: false };
  }

  // 1. Script. A non-Latin script is close to proof on its own.
  let bestScript = null;
  for (const entry of SCRIPTS) {
    const share = countMatches(sample, entry.range) / letters;
    if (share > 0.15 && (!bestScript || share > bestScript.share)) {
      bestScript = { ...entry, share };
    }
  }

  // \p{M} matters: Indic vowel signs are combining marks, not letters, so
  // splitting on letters alone tears "आहे" into "आह" + "े" and every Devanagari
  // marker word silently fails to match.
  const words = sample.toLowerCase().split(/[^\p{L}\p{N}\p{M}']+/u).filter(Boolean);

  if (bestScript) {
    const { languages, script, share } = bestScript;

    // Japanese mixes kana with Han; Han alone is Chinese.
    if (script === 'Han') {
      const kana = countMatches(sample, /[぀-ゟ゠-ヿ]/g);
      const code = kana > 0 ? 'ja' : 'zh';
      return { code, name: LANGUAGE_NAMES[code], script, confidence: round(share), method: 'script', reliable: true };
    }

    if (languages.length === 1) {
      return {
        code: languages[0], name: LANGUAGE_NAMES[languages[0]], script,
        confidence: round(Math.min(0.99, share + 0.3)), method: 'script', reliable: true
      };
    }

    // Several languages share this script — separate them on function words.
    const ranked = languages
      .map(code => ({ code, score: markerScore(words, code) }))
      .sort((a, b) => b.score - a.score);

    const winner = ranked[0].score > 0 ? ranked[0].code : languages[0];
    return {
      code: winner,
      name: LANGUAGE_NAMES[winner],
      script,
      confidence: round(ranked[0].score > 0 ? Math.min(0.95, 0.55 + ranked[0].score * 4) : 0.4),
      method: ranked[0].score > 0 ? 'script+markers' : 'script',
      reliable: true
    };
  }

  // 2. Latin script — decide on function-word frequency.
  const ranked = LATIN_CANDIDATES
    .map(code => ({ code, score: markerScore(words, code) }))
    .sort((a, b) => b.score - a.score);

  const [first, second] = ranked;
  if (first.score === 0) {
    return { code: 'en', name: 'English', script: 'Latin', confidence: 0.2, method: 'fallback', reliable: false };
  }

  // A clear margin over the runner-up is what makes the answer trustworthy;
  // "the" appearing in a Dutch article should not decide it.
  const margin = first.score - second.score;
  return {
    code: first.code,
    name: LANGUAGE_NAMES[first.code],
    script: 'Latin',
    confidence: round(Math.min(0.95, 0.4 + first.score * 5 + margin * 3)),
    method: 'markers',
    reliable: margin > 0.005 || first.score > 0.06
  };
};

const round = (value) => Math.round(value * 100) / 100;

/**
 * Instruction appended to every model prompt so the analysis happens in the
 * article's own language.
 *
 * Quoting matters more than it looks. Each factor must quote the span it acted
 * on, and the frontend highlights that span in the article. A quote translated
 * into English would not be found in a Tamil article, so the highlight would
 * fail and — worse — the reader would be shown a sentence the article does not
 * contain. Explanations are asked for in English because that is the interface
 * language; the evidence stays in the original.
 *
 * @param {{code: string, name: string}} language
 * @returns {string} empty for English, so English prompts are unchanged
 */
const languageDirective = (language) => {
  if (!language || !language.code || language.code === 'en') return '';
  return `

IMPORTANT — this text is written in ${language.name}. Analyse it in ${language.name}. Any sentence or phrase you quote MUST be copied exactly from the ${language.name} text, character for character, and must NOT be translated. Write the "reason" and "explanation" fields in English.`;
};

/** NewsAPI accepts this subset; anything else must be searched in English. */
const NEWSAPI_LANGUAGES = new Set(['ar', 'de', 'en', 'es', 'fr', 'he', 'it', 'nl', 'no', 'pt', 'ru', 'sv', 'ud', 'zh']);

/** Can coverage be searched natively in this language? */
const isSearchable = (code) => NEWSAPI_LANGUAGES.has(String(code || '').toLowerCase());

module.exports = {
  detectLanguage,
  languageDirective,
  isSearchable,
  LANGUAGE_NAMES,
  NEWSAPI_LANGUAGES
};
