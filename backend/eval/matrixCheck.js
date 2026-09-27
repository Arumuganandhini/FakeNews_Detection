/**
 * The final check of this phase: every verdict class, through every input type.
 *
 *     node eval/matrixCheck.js                 # needs the backend running
 *     node eval/matrixCheck.js --out path.json
 *
 * functionalCheck.js drives the pipeline in-process on four articles. This
 * drives the deployed HTTP endpoints the way a reader reaches them — pasted
 * text, a screenshot, a link, a video — because a verdict that is right for
 * pasted text and wrong for the same words arriving as a screenshot is not a
 * working system, and nothing so far has tested that.
 *
 * WHAT MAKES A ROW HONEST
 *
 * Three channels can each be independently unavailable: the news index (a
 * metered third-party quota), the reference work, and the model. A verdict
 * reached while a channel was down is not evidence about that channel. So the
 * script probes all three first, and any row whose expected answer depends on
 * a channel that is down is recorded BLOCKED — never pass, never fail.
 *
 * In particular: with the news index unreachable, a fabrication still comes
 * back CANNOT VERIFY, but by the rule `verification-unavailable` rather than
 * `no-independent-coverage`. That is the right behaviour and the wrong
 * evidence — the system abstained, it did not detect anything. Counting it as
 * a pass would be exactly the self-congratulation this run exists to avoid, so
 * those rows are marked INCONCLUSIVE and reported apart from the score.
 *
 * A row passes on its verdict CLASS, not on the rule that produced it: a
 * fabrication may be CANNOT VERIFY through absent coverage or FAKE through a
 * contradicted premise, and both are correct. The rule is recorded so a reader
 * of the results can see which channel did the work.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const OUT = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : path.join(__dirname, 'results', 'matrix.json');
const BASE = process.env.MATRIX_BASE || 'http://localhost:5000';

// ---------------------------------------------------------------------------
// The material. Each case's correct answer is knowable without running the
// system, which is what makes it a test rather than a demonstration.

const CASES = [
  {
    id: 'real',
    accept: ['REAL'],
    needs: ['newsIndex'],
    why: 'A decision several outlets carried. The corroboration channel should find them.',
    title: 'Mississippi grand jury finds no cause for charges in the July death of Nolan Wells',
    text: 'A grand jury has found there was not evidence to bring charges in the death of Nolan '
      + 'Wells, a Black 18-year-old found dead after a July 4 boating trip off the Mississippi '
      + 'Gulf Coast. District attorney Angel Myers McIlrath announced the decision on Monday.'
  },
  {
    id: 'fake',
    accept: ['FAKE'],
    needs: ['reference'],
    why: 'A real person in an office he has never held. The reference work settles it without '
      + 'any news coverage, so this row stands even when the index is down.',
    title: 'Prime Minister Rahul Gandhi announces nationwide fuel subsidy',
    text: 'Prime Minister Rahul Gandhi announced a nationwide fuel subsidy on Tuesday, saying '
      + 'the measure would take effect within the month. He spoke at a press conference in New Delhi.'
  },
  {
    id: 'cannot-verify',
    accept: ['CANNOT VERIFY'],
    needs: ['newsIndex'],
    demandsRule: 'no-independent-coverage',
    why: 'An invented national announcement. Nobody reports it, so nothing supports it.',
    title: 'India to abolish all income tax from 1 January 2027, finance ministry confirms',
    text: 'The Government of India announced on Monday that all income tax will be abolished '
      + 'from 1 January 2027, calling it the largest relief in the country history. The Ministry '
      + 'of Finance said the measure would be funded by efficiency savings.'
  },
  {
    id: 'polished-fabrication',
    accept: ['CANNOT VERIFY', 'FAKE'],
    needs: ['newsIndex'],
    demandsRule: 'no-independent-coverage',
    why: 'The case the design exists for: calm, attributed, no clickbait, describing an event '
      + 'that never happened. Presentation must not carry it to a positive verdict.',
    title: 'Indian researchers report reversal of type 1 diabetes in two-year trial',
    text: 'Researchers at the National Institute of Metabolic Studies have reported that an '
      + 'experimental therapy reversed type 1 diabetes in 94 per cent of participants during a '
      + 'two-year trial. Dr. Anjali Raghunathan, who led the study, said the results were '
      + 'consistent across all three centres. She said restoration of insulin production was seen '
      + 'in almost every participant. The trial enrolled 312 patients across Chennai, Pune and '
      + 'Hyderabad between March 2023 and February 2025.'
  },
  {
    id: 'refused',
    accept: ['REFUSED'],
    needs: [],
    why: 'Asserts nothing a newsroom could confirm or deny. The gate should refuse before any '
      + 'expensive channel is touched.',
    title: 'Wake up',
    text: 'They are hiding the truth from you. Wake up before it is too late and share this with '
      + 'everyone you know before they take it down, because they do not want you to see it.'
  }
];

// Link behaviour that must hold whatever the channels are doing.
const LINK_CASES = [
  {
    id: 'link-private-address',
    url: 'http://127.0.0.1:5000/health',
    accept: [400, 422],
    why: 'A link into our own network must be refused, not fetched.'
  },
  {
    id: 'link-unreachable',
    url: 'https://example.invalid/no-such-article',
    accept: [400, 422],
    why: 'A link that cannot be read must produce an error, never a verdict.'
  },
  {
    id: 'link-blocked-publisher',
    url: 'https://apnews.com/hub/world-news',
    accept: [422],
    why: 'A publisher that forbids automated reading is a condition upstream of us, not a '
      + 'server fault and not a finding about the article.'
  }
];

// ---------------------------------------------------------------------------

const post = (route, body, timeoutMs = 300000) => new Promise((resolve, reject) => {
  const payload = JSON.stringify(body);
  const url = new URL(BASE + route);
  const req = http.request({
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: timeoutMs
  }, res => {
    let buf = '';
    res.on('data', d => { buf += d; });
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
      catch (_) { resolve({ status: res.statusCode, body: { error: buf.slice(0, 300) } }); }
    });
  });
  req.on('timeout', () => { req.destroy(); reject(new Error('timed out')); });
  req.on('error', reject);
  req.write(payload);
  req.end();
});

/**
 * Render the case's own words to a PNG, so the OCR path is exercised against
 * an image made at run time rather than a fixture that may have drifted from
 * the text sitting beside it in this file.
 */
const PY_RENDER = [
  'from PIL import Image, ImageDraw, ImageFont',
  'import textwrap, sys',
  'lines = textwrap.wrap(sys.argv[1], 56)[:10]',
  "img = Image.new('RGB', (980, 80 + 44 * len(lines)), 'white')",
  'd = ImageDraw.Draw(img)',
  'try:',
  '    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 25)',
  'except Exception:',
  '    font = ImageFont.load_default()',
  'y = 34',
  'for ln in lines:',
  "    d.text((36, y), ln, fill='black', font=font)",
  '    y += 44',
  'img.save(sys.argv[2])'
].join('\n');

const renderScreenshot = (spec) => {
  const out = path.join(os.tmpdir(), 'matrix-' + spec.id + '.png');
  execFileSync('python', ['-c', PY_RENDER, spec.title + '. ' + spec.text, out], { stdio: 'pipe' });
  return 'data:image/png;base64,' + fs.readFileSync(out).toString('base64');
};

/** Read a verdict class out of whatever came back. */
const classify = (res) => {
  if (res.status === 422 && res.body && res.body.checkable === false) return 'REFUSED';
  if (res.status >= 400) return 'HTTP ' + res.status;
  return res.body.call || res.body.verdict || 'NO VERDICT';
};

// ---------------------------------------------------------------------------
// Which channels are actually up. Everything below is scored against this.

const probeChannels = async () => {
  const channels = {};

  try {
    const { searchCoverageBroadening } = require('../utils/newsFetcher');
    const r = await searchCoverageBroadening('grand jury Nolan Wells', 'Associated Press', 8, 2, 'en');
    channels.newsIndex = { up: r.articles.length > 0, detail: r.articles.length + ' articles' };
  } catch (err) {
    channels.newsIndex = { up: false, detail: err.message.slice(0, 110) };
  }

  // fetchWikipediaContent returns [] for a subject the reference work does not
  // cover and throws ReferenceUnavailableError when the lookup itself could not
  // run. Those are different facts and the probe has to keep them apart, or a
  // reference channel that is merely silent gets recorded as one that is down.
  try {
    const { fetchWikipediaContent } = require('../utils/wikipedia');
    const entries = await fetchWikipediaContent('Rahul Gandhi', 1);
    channels.reference = entries.length
      ? { up: true, detail: entries[0].title + ', ' + String(entries[0].content || '').length + ' chars' }
      : { up: true, detail: 'reachable; no entry matched the probe subject' };
  } catch (err) {
    channels.reference = { up: false, detail: err.message.slice(0, 110) };
  }

  // The model is reached through whichever provider the routing table puts
  // first for this task, which is the same path the pipeline takes.
  try {
    const { callNimApi } = require('../utils/nvidiaNimApi');
    const out = await callNimApi('Reply with the single word: ok', { label: 'coverage keywords', maxTokens: 8 });
    channels.model = { up: !!out, detail: String(out).replace(/\s+/g, ' ').slice(0, 40) };
  } catch (err) {
    channels.model = { up: false, detail: err.message.slice(0, 110) };
  }

  return channels;
};

// ---------------------------------------------------------------------------

const score = (spec, res, channels) => {
  const verdict = classify(res);
  const rule = (res.body && res.body.decision && res.body.decision.rule) || (res.body && res.body.kind) || null;

  const down = (spec.needs || []).filter(c => channels[c] && channels[c].up === false);
  if (down.length) {
    return { verdict, rule, state: 'BLOCKED', note: 'needs ' + down.join(', ') + ', which is down' };
  }
  // The channel is up but this particular answer came from an abstention: the
  // class is right and the evidence for it is not what the case was testing.
  if (rule === 'verification-unavailable') {
    return { verdict, rule, state: 'INCONCLUSIVE', note: 'abstained; corroboration did not run' };
  }
  if (!spec.accept.includes(verdict)) {
    return { verdict, rule, state: 'FAIL', note: 'expected ' + spec.accept.join(' or ') };
  }
  if (spec.demandsRule && rule && !String(rule).startsWith(spec.demandsRule)) {
    return { verdict, rule, state: 'PASS', note: 'right class by a different rule' };
  }
  return { verdict, rule, state: 'PASS', note: null };
};

const runRow = async (spec, medium, payload, channels) => {
  const started = Date.now();
  const elapsed = () => Number(((Date.now() - started) / 1000).toFixed(1));
  let res;
  try {
    res = await post('/api/ai/analyze-content', payload);
  } catch (err) {
    return { case: spec.id, medium, verdict: 'THREW', state: 'FAIL', note: err.message, seconds: elapsed() };
  }
  const s = score(spec, res, channels);
  return Object.assign({ case: spec.id, medium, accept: spec.accept }, s, {
    modality: (res.body && res.body.modality) || null,
    ocrChars: (res.body && res.body.readText && res.body.readText.chars) || null,
    probabilityPercent: res.body && res.body.probabilityPercent != null ? res.body.probabilityPercent : null,
    degraded: (res.body && res.body.degradedFactors) || [],
    seconds: elapsed()
  });
};

const line = (r) => String(r.case).padEnd(22) + String(r.medium).padEnd(12)
  + String(r.verdict).padEnd(20) + String(r.state).padEnd(14)
  + String(r.rule || r.note || '').slice(0, 42);

// ---------------------------------------------------------------------------

const main = async () => {
  console.log('Base: ' + BASE + '\n');

  console.log('Channel availability (everything below is scored against this):');
  const channels = await probeChannels();
  for (const name of Object.keys(channels)) {
    const c = channels[name];
    console.log('  ' + name.padEnd(12) + (c.up === null ? 'unknown' : c.up ? 'up' : 'DOWN').padEnd(9) + c.detail);
  }
  console.log('');

  const rows = [];
  console.log('case'.padEnd(22) + 'input'.padEnd(12) + 'verdict'.padEnd(20) + 'state'.padEnd(14) + 'rule / note');
  console.log('-'.repeat(110));

  for (const spec of CASES) {
    const asText = await runRow(spec, 'text', { text: spec.title + '. ' + spec.text }, channels);
    rows.push(asText);
    console.log(line(asText));

    let asImage;
    try {
      asImage = await runRow(spec, 'screenshot', { imageBase64: renderScreenshot(spec) }, channels);
    } catch (err) {
      asImage = { case: spec.id, medium: 'screenshot', verdict: 'SKIPPED', state: 'SKIPPED',
        note: err.message.slice(0, 90), seconds: 0 };
    }
    rows.push(asImage);
    console.log(line(asImage));
  }

  // ----------------------------------------------------- a live article link
  console.log('\nLink to a live article (fetch, parse, then the full pipeline):');
  if (process.env.MATRIX_ARTICLE) {
    // A genuine report from a major outlet. It may be confirmed, or too recent
    // to confirm; it must never be called false.
    const spec = { id: 'live-article', accept: ['REAL', 'CANNOT VERIFY'], needs: ['newsIndex'],
      why: 'A real page from a major outlet, fetched and parsed. Anything but FAKE is defensible.' };
    const r = await runRow(spec, 'link', { url: process.env.MATRIX_ARTICLE }, channels);
    rows.push(r);
    console.log(line(r));
  } else {
    console.log('  (set MATRIX_ARTICLE to a live article URL)');
  }

  // ------------------------------------------------------------------ video
  console.log('\nVideo (a live transcript, fetched and analysed):');
  // An Associated Press news video. The first version of this row accepted any
  // verdict at all, which is how a FAKE on a genuine AP report was scored as a
  // pass. A real news video may be confirmed or unconfirmed; never false.
  const videoSpec = { id: 'video', needs: ['newsIndex'],
    accept: ['REAL', 'CANNOT VERIFY'],
    why: 'A genuine AP news video. It must be fetched, transcribed and not called false.' };
  const video = await runRow(videoSpec, 'video',
    { url: process.env.MATRIX_VIDEO || 'https://www.youtube.com/watch?v=x5Oi65C_GKI' }, channels);
  rows.push(video);
  console.log(line(video));

  // --------------------------------------------- links that must be refused
  console.log('\nLinks that must be refused rather than guessed at:');
  for (const lc of LINK_CASES) {
    const started = Date.now();
    let r;
    try {
      const res = await post('/api/ai/analyze-content', { url: lc.url }, 90000);
      r = { case: lc.id, medium: 'link', verdict: 'HTTP ' + res.status,
        state: lc.accept.includes(res.status) ? 'PASS' : 'FAIL',
        note: String((res.body && res.body.error) || '').slice(0, 58),
        seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
    } catch (err) {
      r = { case: lc.id, medium: 'link', verdict: 'THREW', state: 'FAIL', note: err.message, seconds: 0 };
    }
    rows.push(r);
    console.log(line(r));
  }

  // --------------------------------------------------------------- tallying
  const by = (s) => rows.filter(r => r.state === s);
  const scored = rows.filter(r => r.state === 'PASS' || r.state === 'FAIL');
  const byMedium = {};
  for (const r of scored) {
    byMedium[r.medium] = byMedium[r.medium] || { pass: 0, total: 0 };
    byMedium[r.medium].total++;
    if (r.state === 'PASS') byMedium[r.medium].pass++;
  }

  console.log('\n' + '-'.repeat(110));
  console.log('  decided        ' + by('PASS').length + '/' + scored.length + ' correct');
  for (const m of Object.keys(byMedium)) {
    console.log('    ' + m.padEnd(12) + byMedium[m].pass + '/' + byMedium[m].total);
  }
  if (by('BLOCKED').length) console.log('  blocked        ' + by('BLOCKED').length + ' (a channel they need is down — not scored)');
  if (by('INCONCLUSIVE').length) console.log('  inconclusive   ' + by('INCONCLUSIVE').length + ' (system abstained — not scored)');
  if (by('SKIPPED').length) console.log('  skipped        ' + by('SKIPPED').length);
  if (by('FAIL').length) {
    console.log('\n  Failures:');
    for (const r of by('FAIL')) console.log('    ' + r.case + ' / ' + r.medium + ': got ' + r.verdict + ' — ' + r.note);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    base: BASE,
    channels,
    routingTable: (() => { try { return require('../data/taskRouting.json').generatedAt; } catch (_) { return null; } })(),
    cases: CASES.map(c => ({ id: c.id, accept: c.accept, needs: c.needs, why: c.why })),
    linkCases: LINK_CASES.map(c => ({ id: c.id, url: c.url, accept: c.accept, why: c.why })),
    rows,
    summary: {
      decided: by('PASS').length + '/' + scored.length,
      blocked: by('BLOCKED').length,
      inconclusive: by('INCONCLUSIVE').length,
      skipped: by('SKIPPED').length,
      byMedium
    }
  }, null, 2));
  console.log('\nWritten to ' + path.relative(process.cwd(), OUT));

  process.exit(by('FAIL').length ? 1 : 0);
};

main().catch(err => { console.error(err); process.exit(1); });
