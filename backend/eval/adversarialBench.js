// backend/eval/adversarialBench.js
//
// Does the pipeline survive a fabrication that is written well?
//
// ISOT cannot answer this. Its fake articles are mostly badly written, so any
// system that scores style does well on it — which is why the pipeline reported
// 94.7% while being wide open to the case that actually matters. This benchmark
// supplies that case: invented stories in plain newsroom register, with named
// sources, no clickbait and no persuasion techniques.
//
// Each item is scored twice from the SAME factor outputs:
//
//   legacy  - the weighted sum with abstention redistribution, as the pipeline
//             worked before. Reimplemented here rather than kept in the running
//             code, so the comparison is exact and the old path cannot be
//             reached by a reader.
//   current - presentation capped by the evidence verdict.
//
// A note on the corpus, because it bears on what the numbers mean. The
// fabricated items are written by us, which is correct — a fabrication has to be
// fabricated. The *genuine* items are also written by us, which is a weakness:
// an invented "real" article describes events that did not happen, so live
// retrieval can legitimately contradict it, and a false-positive count taken
// from those items overstates the error rate. Pass --live-genuine to measure
// false positives against actual current articles from the feed instead.
//
// Usage:
//   node eval/adversarialBench.js                 # uses whatever provider is configured
//   node eval/adversarialBench.js --no-model      # deterministic analysers only
//   node eval/adversarialBench.js --live-genuine  # real current articles as the genuine set
//                                                 # (costs roughly 4 news-API calls per article)
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { analyzeTrust, WEIGHTS } = require('../agents/trustAnalysisAgent');
const { fetchTopNews } = require('../utils/newsFetcher');

const args = process.argv.slice(2);
if (args.includes('--no-model')) {
  process.env.NIM_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
}

/**
 * The scoring rule as it was before the verdict layer: every factor weighted,
 * and an uninformative verification factor handing its weight to the others.
 */
const legacyScore = (report) => {
  const byId = Object.fromEntries(report.factors.map(f => [f.id, f.score]));
  const verification = report.factors.find(f => f.id === 'verification');
  const informative = verification.counted;

  const weights = { ...WEIGHTS };
  if (!informative) {
    const released = weights.verification;
    weights.verification = 0;
    for (const key of Object.keys(weights)) {
      if (weights[key] > 0) weights[key] /= (1 - released);
    }
  }

  const score = Object.keys(weights).reduce((sum, key) => sum + (byId[key] ?? 5) * weights[key], 0);
  return Math.round(score * 10) / 10;
};

const band = (score) => score >= 7.5 ? 'Looks trustworthy'
  : score >= 5.5 ? 'Mostly fine'
  : score >= 4 ? 'Read carefully'
  : 'Be skeptical';

/** A reader is misled when a fabrication is presented as fine or better. */
const readsAsCredible = (score) => score >= 5.5;

/**
 * Real, current articles from outlets with a strong record. These are the only
 * honest way to measure how often the pipeline condemns something true: unlike
 * our written "genuine" items, these describe events that actually happened, so
 * a contradiction found against them is a real false positive.
 */
const fetchLiveGenuine = async (count = 3) => {
  const articles = await fetchTopNews('general');
  return articles
    .filter(a => a.content && a.title && a.source?.name)
    .slice(0, count)
    .map((a, i) => ({
      id: `live-${String(i + 1).padStart(2, '0')}`,
      label: 'genuine',
      expectedVerdict: ['corroborated', 'likely-true', 'unverified', 'opinion'],
      title: a.title,
      source: a.source.name,
      url: a.url,
      content: String(a.content).replace(/\[\+\d+\s*chars\]/gi, '').trim()
    }));
};

const main = async () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/adversarial.json'), 'utf8'));
  let items = corpus.items;

  if (args.includes('--live-genuine')) {
    const live = await fetchLiveGenuine(3);
    console.log(`Fetched ${live.length} live articles for the genuine set.`);
    // Replace the written genuine items rather than adding to them, so the
    // false-positive figure comes only from articles about real events.
    items = [...corpus.items.filter(item => item.label !== 'genuine'), ...live];
  }

  const rows = [];

  for (const item of items) {
    process.stdout.write(`  ${item.id} ... `);
    const report = await analyzeTrust({
      title: item.title,
      content: item.content,
      source: item.source,
      url: item.url
    });

    const legacy = legacyScore(report);
    rows.push({
      id: item.id,
      label: item.label,
      expected: item.expectedVerdict,
      probabilityFake: report.probabilityFake,
      scoreBeforeCeiling: report.scoreBeforeCeiling,
      legacyScore: legacy,
      legacyBand: band(legacy),
      currentScore: report.overallScore,
      verdict: report.verdictClass,
      verdictLabel: report.verdict,
      rule: report.decision.rule,
      confidence: report.decision.confidence,
      verdictAsExpected: item.expectedVerdict.includes(report.verdictClass),
      legacyMisleading: readsAsCredible(legacy),
      currentMisleading: readsAsCredible(report.overallScore),
      degraded: report.degradedFactors.length
    });
    console.log(`${report.verdict} (${report.overallScore}) — was ${legacy}`);
  }

  const deceptive = rows.filter(r => r.label.startsWith('fabrication') || r.label === 'low-quality');
  const genuine = rows.filter(r => r.label === 'genuine');

  const summary = {
    generatedAt: new Date().toISOString(),
    model: args.includes('--no-model') ? 'none (deterministic analysers)' : (process.env.LLM_PROVIDER || 'nim'),
    genuineSet: args.includes('--live-genuine') ? 'live articles from the news feed' : 'written items (see corpus note)',
    items: rows.length,
    deceptive: {
      count: deceptive.length,
      misleadingUnderLegacy: deceptive.filter(r => r.legacyMisleading).length,
      misleadingUnderCurrent: deceptive.filter(r => r.currentMisleading).length,
      verdictCorrect: deceptive.filter(r => r.verdictAsExpected).length
    },
    genuine: {
      count: genuine.length,
      condemned: genuine.filter(r => r.verdict === 'likely-false' || r.verdict === 'false').length,
      verdictAcceptable: genuine.filter(r => r.verdictAsExpected).length
    },
    // What the OLD rule made of the fabrications. The point of the set is
    // that they read well, and this is the number that shows it.
    meanLegacyScoreOfFabrications: round(mean(deceptive.filter(r => r.label !== 'low-quality').map(r => r.legacyScore))),
    rows
  };

  const outputPath = path.join(__dirname, 'results/adversarial.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  console.log('\n' + '='.repeat(78));
  console.log('ADVERSARIAL BENCHMARK — well-written fabrications');
  console.log('='.repeat(78));
  console.log(pad('item', 12) + pad('old rule', 20) + pad('P(fake)', 11) + pad('score', 8) + 'verdict');
  console.log('-'.repeat(78));
  for (const row of rows) {
    console.log(
      pad(row.id, 12) +
      pad(`${row.legacyScore}${row.legacyMisleading ? ' (reads fine)' : ''}`, 20) +
      pad(`${Math.round(row.probabilityFake * 100)}%`, 11) +
      pad(String(row.currentScore), 8) +
      row.verdictLabel
    );
  }
  console.log('-'.repeat(78));
  console.log(`Deceptive items presented as credible — before: ${summary.deceptive.misleadingUnderLegacy}/${summary.deceptive.count}   now: ${summary.deceptive.misleadingUnderCurrent}/${summary.deceptive.count}`);
  console.log(`Verdict matched expectation on deceptive items: ${summary.deceptive.verdictCorrect}/${summary.deceptive.count}`);
  console.log(`Genuine articles wrongly condemned: ${summary.genuine.condemned}/${summary.genuine.count}`);
  console.log(`The old rule scored these fabrications ${summary.meanLegacyScoreOfFabrications}/10 on average — they read well, and always will.`);
  console.log(`\nWritten to ${path.relative(process.cwd(), outputPath)}`);
};

const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const round = (value) => Math.round(value * 10) / 10;
const pad = (text, width) => String(text).padEnd(width);

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
