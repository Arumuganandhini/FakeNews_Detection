// backend/eval/measureCorroborationRates.js
//
// Replacing the last declared parameters with measured ones.
//
// data/evidenceWeights.json names this script under `measurableBy` for the
// corroboration distribution, and until now the script did not exist — the
// weights file pointed at a promise. This is that script.
//
// The corroboration term is the single most influential quantity in the whole
// system: it is the only evidence permitted to speak in an article's favour, and
// every verdict turns on it. It is also, at present, entirely assumed. The
// declared distribution says that independent coverage is found for 55% of
// genuine articles and 3% of fabricated ones; both numbers were reasoned rather
// than counted, and a reviewer is entitled to ask where they came from.
//
// What is measured here
// ---------------------
//   P(outcome | genuine)     from live articles by outlets with a strong
//                            factual record — real events, really reported
//   P(outcome | fabricated)  from the adversarial set — invented events that
//                            no outlet can be reporting
//
// The outcome is the same five-way categorical the runtime uses:
// contradictedByTwo, contradictedByOne, none, supportedByOne, supportedByTwoPlus.
//
// Cost, stated plainly
// --------------------
// Each article costs one claim extraction and up to four news searches. The free
// news tier allows 100 requests per 24 hours in total, shared with the feed, so
// the default sample is deliberately small and the script refuses to start if
// the quota is already gone. Run it when the quota has reset and nothing else
// needs it.
//
// Usage:
//   node eval/measureCorroborationRates.js                 # 8 genuine + the adversarial set
//   node eval/measureCorroborationRates.js --genuine 15
//   node eval/measureCorroborationRates.js --dry-run       # show the plan, spend nothing
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { fetchTopNews } = require('../utils/newsFetcher');
const { extractClaims, verifyClaims } = require('../agents/claimVerificationAgent');
const { buildEvidenceLedger } = require('../agents/verdictEngine');
const { getSourceReputation } = require('../agents/sourceReputationAgent');

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
};
const GENUINE_SAMPLE = argValue('--genuine', 8);
const DRY_RUN = args.includes('--dry-run');

const OUTCOMES = ['contradictedByTwo', 'contradictedByOne', 'none', 'supportedByOne', 'supportedByTwoPlus'];

/** The same five-way classification the runtime applies. */
const outcomeOf = (ledger) => {
  if (ledger.independentContradiction >= 2) return 'contradictedByTwo';
  if (ledger.independentContradiction === 1) return 'contradictedByOne';
  if (ledger.independentSupport >= 2) return 'supportedByTwoPlus';
  if (ledger.independentSupport === 1) return 'supportedByOne';
  return 'none';
};

/**
 * Run one article through claim extraction and cross-source verification, then
 * classify what came back. This is the runtime path, not a reimplementation of
 * it, so the rates measured are the rates the system will actually see.
 */
const observe = async ({ title, content, source, url }) => {
  const claims = await extractClaims(title, content, 2, null).catch(() => null);
  if (!claims) return { outcome: null, reason: 'claim extraction failed' };

  const verification = await verifyClaims(title, content, source, claims, false, null);
  if (verification.status === 'error') return { outcome: null, reason: 'verification failed' };

  const ledger = buildEvidenceLedger({
    claims: verification.claims || [],
    verificationStatus: verification.status,
    sourceResult: getSourceReputation(source, url),
    title
  });

  return {
    outcome: outcomeOf(ledger),
    independentSupport: ledger.independentSupport,
    independentContradiction: ledger.independentContradiction,
    articlesRetrieved: ledger.rawSupportingArticles
  };
};

/** Laplace-smoothed distribution over the five outcomes. */
const distribution = (counts, total) => {
  const smoothed = {};
  for (const outcome of OUTCOMES) {
    smoothed[outcome] = Math.round(((counts[outcome] || 0) + 0.5) / (total + 0.5 * OUTCOMES.length) * 10000) / 10000;
  }
  return smoothed;
};

const tally = (rows) => {
  const counts = {};
  for (const row of rows) if (row.outcome) counts[row.outcome] = (counts[row.outcome] || 0) + 1;
  return counts;
};

const main = async () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/adversarial.json'), 'utf8'));
  const fabricated = corpus.items.filter(i => i.label.startsWith('fabrication'));

  console.log(`Plan: ${GENUINE_SAMPLE} live articles (genuine) + ${fabricated.length} invented articles (fabricated).`);
  console.log(`Roughly ${(GENUINE_SAMPLE + fabricated.length) * 4} news-API requests against a 100/day budget.\n`);
  if (DRY_RUN) return;

  // Genuine side: live articles from outlets with a record. These describe
  // events that really happened, so whatever the search returns for them is the
  // genuine-side rate.
  let feed;
  try {
    feed = await fetchTopNews('general');
  } catch (err) {
    console.error(`Could not read the feed: ${err.message}`);
    console.error('If the daily quota is exhausted, run this after it resets.');
    process.exit(1);
  }

  const genuineItems = feed
    .filter(a => a.content && a.title && getSourceReputation(a.source.name, a.url).score >= 7)
    .slice(0, GENUINE_SAMPLE);

  if (genuineItems.length < 3) {
    console.error(`Only ${genuineItems.length} feed articles from well-rated outlets — too few to measure anything.`);
    process.exit(1);
  }

  const genuineRows = [];
  for (const article of genuineItems) {
    process.stdout.write(`  genuine  ${article.source.name.slice(0, 22).padEnd(24)}`);
    const row = await observe({
      title: article.title,
      content: String(article.content).replace(/\[\+\d+\s*chars\]/gi, ''),
      source: article.source.name,
      url: article.url
    });
    genuineRows.push(row);
    console.log(row.outcome || `skipped (${row.reason})`);
  }

  const fabricatedRows = [];
  for (const item of fabricated) {
    process.stdout.write(`  invented ${item.id.padEnd(24)}`);
    const row = await observe(item);
    fabricatedRows.push(row);
    console.log(row.outcome || `skipped (${row.reason})`);
  }

  const genuineUsable = genuineRows.filter(r => r.outcome).length;
  const fabricatedUsable = fabricatedRows.filter(r => r.outcome).length;

  const result = {
    generatedAt: new Date().toISOString(),
    method: 'observed outcome of the live verification path, Laplace-smoothed over five outcomes',
    genuine: { n: genuineUsable, counts: tally(genuineRows), distribution: distribution(tally(genuineRows), genuineUsable) },
    fabricated: { n: fabricatedUsable, counts: tally(fabricatedRows), distribution: distribution(tally(fabricatedRows), fabricatedUsable) },
    caveats: [
      'The genuine sample is drawn from one day of one feed and is small; it is a measurement, not a census.',
      'The fabricated sample is written by us. That is unavoidable — a fabrication has to be fabricated — but it means the fabricated-side rate reflects our inventions, not the wild.',
      'Nothing here is written into data/evidenceWeights.json automatically. Replacing a declared parameter with a measured one is a deliberate act, and the sample size should be judged first.'
    ]
  };

  const outputPath = path.join(__dirname, 'results/corroboration-rates.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log('\n' + '='.repeat(70));
  console.log('MEASURED CORROBORATION RATES');
  console.log('='.repeat(70));
  console.log('outcome'.padEnd(22) + 'P|genuine'.padEnd(13) + 'P|fabricated'.padEnd(15) + 'declared now');
  const declared = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/evidenceWeights.json'), 'utf8')).declared.corroboration;
  for (const outcome of OUTCOMES) {
    console.log(
      outcome.padEnd(22) +
      String(result.genuine.distribution[outcome]).padEnd(13) +
      String(result.fabricated.distribution[outcome]).padEnd(15) +
      `${declared.givenGenuine[outcome]} / ${declared.givenFabricated[outcome]}`
    );
  }
  console.log(`\nUsable observations: ${genuineUsable} genuine, ${fabricatedUsable} fabricated.`);
  console.log('Declared values are NOT overwritten. Compare, judge the sample, then edit');
  console.log('data/evidenceWeights.json by hand and set basis to "measured".');
  console.log(`\nWritten to ${path.relative(process.cwd(), outputPath)}`);
};

main().catch(err => {
  console.error('Measurement failed:', err.message);
  process.exit(1);
});
