// backend/eval/runEval.js
// Runs the trust-analysis pipeline over a labeled dataset and records one
// JSON line per article, so results survive interruptions and can be
// aggregated later by report.js.
//
// Usage:
//   node eval/runEval.js --data eval/data/dataset.csv --config full --sample 100
//
// Dataset CSV columns (header required): title,text,label
//   label: 1 = real, 0 = fake
//
// Configs (for the ablation study):
//   full            source + clickbait + bias (verification off: dataset
//                   articles are historical, so live news search cannot
//                   corroborate them — stated explicitly in the paper)
//   full+verify     all four factors, including live cross-source search
//   no-bias         drop the bias factor
//   no-clickbait    drop the clickbait factor
//   no-source       drop source reputation (recommended for ISOT: avoids
//                   the Reuters source-leak problem)
//   content-only    clickbait + bias only (fully source-blind)
//   baseline        the original single-prompt credibility agent
//
// Notes:
// - Requires NIM_API_KEY in backend/.env.
// - Rate-limited to stay under free-tier request limits (RPM below).
// - Safe to re-run: articles already in the output file are skipped.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const { getSourceReputation } = require('../agents/sourceReputationAgent');
const { analyzeClickbait } = require('../agents/clickbaitAgent');
const { analyzeBias } = require('../agents/biasAgent');
const { verifyClaims } = require('../agents/claimVerificationAgent');
const checkCredibility = require('../agents/credibilityAgent');
const { WEIGHTS } = require('../agents/trustAnalysisAgent');

const RPM = 30; // LLM requests per minute budget
const MIN_GAP_MS = Math.ceil(60000 / RPM);

const CONFIGS = {
  'full':         { source: true,  clickbait: true,  bias: true,  verification: false },
  'full+verify':  { source: true,  clickbait: true,  bias: true,  verification: true },
  'no-bias':      { source: true,  clickbait: true,  bias: false, verification: false },
  'no-clickbait': { source: true,  clickbait: false, bias: true,  verification: false },
  'no-source':    { source: false, clickbait: true,  bias: true,  verification: false },
  'content-only': { source: false, clickbait: true,  bias: true,  verification: false },
  'baseline':     { baseline: true }
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { config: 'full', sample: 100, seed: 42, hideSource: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data') out.data = args[++i];
    else if (args[i] === '--config') out.config = args[++i];
    else if (args[i] === '--sample') out.sample = parseInt(args[++i]);
    else if (args[i] === '--seed') out.seed = parseInt(args[++i]);
    else if (args[i] === '--show-source') out.hideSource = false;
    else if (args[i] === '--out') out.out = args[++i];
  }
  if (!out.data) { console.error('Missing --data <csv>'); process.exit(1); }
  if (!CONFIGS[out.config]) {
    console.error(`Unknown config "${out.config}". Options: ${Object.keys(CONFIGS).join(', ')}`);
    process.exit(1);
  }
  return out;
}

const { parseCsv } = require('./csv');

// Deterministic PRNG so the same --seed always evaluates the same sample.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ISOT hygiene: real articles start with "CITY (Reuters) -" which leaks the
// label. Strip agency prefixes from the text the models see.
function stripAgencyPrefix(text) {
  return (text || '')
    .replace(/^[A-Z][A-Za-z .,/-]{0,40}\((Reuters|AP|AFP|Xinhua|ANI|PTI|IANS)\)\s*[--—:]*\s*/i, '')
    .replace(/\b(Reuters|Associated Press)\b/g, 'the news agency');
}

function loadDataset(file, sample, seed) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows[0].map(h => h.trim().toLowerCase());
  const ti = header.indexOf('title'), xi = header.indexOf('text'), li = header.indexOf('label');
  if (ti === -1 || xi === -1 || li === -1) {
    console.error(`CSV must have title,text,label columns. Found: ${header.join(', ')}`);
    process.exit(1);
  }
  const items = rows.slice(1)
    .map((r, i) => ({ id: i, title: r[ti], text: r[xi], label: parseInt(r[li]) }))
    .filter(it => it.title && it.text && (it.label === 0 || it.label === 1));

  // Stratified sample: equal halves of real and fake, deterministic order.
  const rng = mulberry32(seed);
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const real = shuffle(items.filter(i => i.label === 1)).slice(0, Math.ceil(sample / 2));
  const fake = shuffle(items.filter(i => i.label === 0)).slice(0, Math.floor(sample / 2));
  return shuffle([...real, ...fake]);
}

// Same aggregation logic as the production orchestrator, generalized to any
// subset of factors (weights of disabled factors are redistributed).
function aggregate(scores, enabled) {
  let weights = { ...WEIGHTS };
  let totalDisabled = 0;
  for (const k of Object.keys(weights)) {
    if (!enabled[k]) { totalDisabled += weights[k]; weights[k] = 0; }
  }
  const remaining = 1 - totalDisabled;
  let overall = 0;
  for (const k of Object.keys(weights)) {
    if (weights[k] > 0) overall += scores[k] * (weights[k] / remaining);
  }
  return Math.round(overall * 10) / 10;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evalOne(item, cfg, hideSource) {
  const title = item.title;
  const text = stripAgencyPrefix(item.text).slice(0, 2500);
  const source = hideSource ? 'Unknown' : (item.source || 'Unknown');

  if (cfg.baseline) {
    const { score, reasoning } = await checkCredibility(title, text, source);
    return { score, factors: { baseline: score }, note: reasoning?.slice(0, 200) };
  }

  // A factor that failed (network / parse error) must abort the article so it
  // is retried on resume — recording its neutral fallback would pollute results.
  const requireOk = (result, factor) => {
    if (result.failed) throw new Error(`${factor} factor failed — will retry on resume`);
    return result;
  };

  const scores = {};
  if (cfg.source) scores.sourceReputation = getSourceReputation(source, null).score;
  if (cfg.clickbait) { scores.clickbait = requireOk(await analyzeClickbait(title), 'clickbait').score; await sleep(MIN_GAP_MS); }
  if (cfg.bias) { scores.bias = requireOk(await analyzeBias(title, text), 'bias').score; await sleep(MIN_GAP_MS); }
  if (cfg.verification) {
    const v = await verifyClaims(title, text, source);
    // Match production behavior: only count verification when it found evidence.
    if (['corroborated', 'contradicted'].includes(v.status)) scores.verification = v.score;
    await sleep(MIN_GAP_MS);
  }

  const enabled = {
    sourceReputation: 'sourceReputation' in scores,
    clickbait: 'clickbait' in scores,
    bias: 'bias' in scores,
    verification: 'verification' in scores
  };
  return { score: aggregate(scores, enabled), factors: scores };
}

async function main() {
  const opts = parseArgs();
  const items = loadDataset(opts.data, opts.sample, opts.seed);
  const outFile = opts.out || path.join(__dirname, 'results',
    `${path.basename(opts.data).replace(/\.csv$/, '')}_${opts.config}_seed${opts.seed}.jsonl`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  // Resume support: skip ids already evaluated.
  const done = new Set();
  if (fs.existsSync(outFile)) {
    for (const line of fs.readFileSync(outFile, 'utf8').split('\n')) {
      if (line.trim()) done.add(JSON.parse(line).id);
    }
  }

  console.log(`Config: ${opts.config} | items: ${items.length} | already done: ${done.size}`);
  console.log(`Output: ${outFile}`);

  let processed = 0, errors = 0;
  for (const item of items) {
    if (done.has(item.id)) continue;
    try {
      const started = Date.now();
      const result = await evalOne(item, CONFIGS[opts.config], opts.hideSource);
      fs.appendFileSync(outFile, JSON.stringify({
        id: item.id, label: item.label, score: result.score,
        factors: result.factors, ms: Date.now() - started,
        title: item.title.slice(0, 120)
      }) + '\n');
      processed++;
      if (processed % 10 === 0) console.log(`  ${processed} evaluated (${errors} errors)...`);
    } catch (err) {
      errors++;
      console.error(`  [id ${item.id}] ${err.message}`);
      if (errors >= 5 && errors > processed) {
        console.error('Too many consecutive failures — check NIM_API_KEY / rate limits. Stopping.');
        process.exit(1);
      }
      await sleep(5000);
    }
  }
  console.log(`Done. ${processed} newly evaluated, ${errors} errors. Run report.js for metrics.`);
}

main();
