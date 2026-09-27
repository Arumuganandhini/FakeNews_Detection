/**
 * Every key function of the system, exercised end to end, with the numbers
 * written down.
 *
 *     node eval/functionalCheck.js
 *     node eval/functionalCheck.js --out eval/results/functional.json
 *
 * This is not a unit-test suite — those live in test/ and run without a
 * network or a model. This drives the real pipeline against real inputs and
 * records what actually happened: which verdict each case produced, how long
 * it took, which provider answered, and whether any check fell back. The
 * output is the table that goes in the documentation, so every figure quoted
 * there can be traced to a run of this file.
 *
 * Cases are chosen so that the correct answer is known in advance:
 *
 *   a corroborated event      a real story several outlets carried   -> REAL
 *   a fabricated event        an invented announcement nobody reports -> not REAL
 *   a false premise           a real person, an office they never held
 *   an unverifiable opinion   asserts nothing checkable               -> refused
 *   a question                asserts nothing at all                  -> refused
 *   a well-written fabrication passes every presentation check         -> not REAL
 *
 * The last is the case the whole design exists for, so it is reported
 * separately rather than folded into an average.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const { analyzeTrust } = require('../agents/trustAnalysisAgent');
const { assessCheckability } = require('../agents/checkability');
const { detectLanguage } = require('../utils/language');
const { searchCoverageBroadening } = require('../utils/newsFetcher');
const { getSourceReputation } = require('../agents/sourceReputationAgent');
const summarize = require('../agents/summarizeAgent');

const args = process.argv.slice(2);
const OUT = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : path.join(__dirname, 'results', 'functional.json');

// ---------------------------------------------------------------------------

const ARTICLES = [
  {
    id: 'corroborated-event',
    expect: 'REAL',
    why: 'A real decision several outlets reported. The corroboration channel should find them.',
    article: {
      title: 'Mississippi grand jury finds no cause for charges in the July death of Nolan Wells',
      source: 'Associated Press',
      url: 'https://apnews.com/article/functional-check-corroborated',
      content: "A grand jury has found there wasn't evidence to bring charges in the death of Nolan "
        + 'Wells, a Black 18-year-old who was found dead after a July 4 boating trip off the '
        + 'Mississippi Gulf Coast. The decision was announced late Monday by district attorney '
        + 'Angel Myers McIlrath.',
      textCoverage: 'full'
    }
  },
  {
    id: 'fabricated-event',
    expect: 'NOT_REAL',
    why: 'An invented national announcement. No outlet reports it, so it cannot be confirmed.',
    article: {
      title: 'India to abolish all income tax from 1 January 2027, finance ministry confirms',
      source: 'Daily National Telegraph',
      url: 'https://example.invalid/functional-check-fabricated',
      content: 'The Government of India announced on Monday that all income tax will be abolished '
        + 'from 1 January 2027, calling it the largest relief in the country’s history. The '
        + 'Ministry of Finance said the measure would be funded by efficiency savings.',
      textCoverage: 'full'
    }
  },
  {
    id: 'false-premise',
    expect: 'NOT_REAL',
    why: 'A real person placed in an office they have never held. A news search finds nothing; '
      + 'the reference check is the channel that can settle it.',
    article: {
      title: 'Prime Minister Rahul Gandhi announces nationwide fuel subsidy',
      source: 'Evening Herald Online',
      url: 'https://example.invalid/functional-check-premise',
      content: 'Prime Minister Rahul Gandhi announced a nationwide fuel subsidy on Tuesday, '
        + 'saying the measure would take effect within the month. The announcement was made at a '
        + 'press conference in New Delhi.',
      textCoverage: 'full'
    }
  },
  {
    id: 'well-written-fabrication',
    expect: 'NOT_REAL',
    why: 'The case the design exists for: calm, sourced, no clickbait, and describing an event '
      + 'that never happened. Presentation must not carry it to a positive verdict.',
    article: {
      title: 'Indian researchers report reversal of type 1 diabetes in two-year trial',
      source: 'Health Science Daily',
      url: 'https://example.invalid/functional-check-polished',
      content: 'Researchers at the National Institute of Metabolic Studies have reported that an '
        + 'experimental therapy reversed type 1 diabetes in 94 per cent of participants during a '
        + 'two-year trial. Dr. Anjali Raghunathan, who led the study, said the results were '
        + 'consistent across all three centres. "We saw restoration of insulin production in '
        + 'almost every participant," she said. The trial enrolled 312 patients across Chennai, '
        + 'Pune and Hyderabad between March 2023 and February 2025. The institute said the '
        + 'findings have been submitted for peer review.',
      textCoverage: 'full'
    }
  }
];

const GATE_CASES = [
  { id: 'opinion', text: 'They are hiding the truth from you. Wake up before it is too late and share this with everyone you know.', expectCheckable: false },
  { id: 'question', text: 'Is the government planning to change the tax rules next year?', expectCheckable: false },
  { id: 'too-short', text: 'Big news today!', expectCheckable: false },
  { id: 'checkable-claim', text: 'The Reserve Bank of India raised the repo rate to 6.75 per cent on Tuesday.', expectCheckable: true }
];

// ---------------------------------------------------------------------------

const seconds = (ms) => Number((ms / 1000).toFixed(1));

const runArticle = async (spec) => {
  const started = Date.now();
  try {
    const report = await analyzeTrust(spec.article);
    const ms = Date.now() - started;
    const call = report.call || report.verdict;
    const pass = spec.expect === 'REAL' ? call === 'REAL' : call !== 'REAL';

    return {
      id: spec.id,
      expected: spec.expect,
      call,
      rule: report.decision?.rule || null,
      oneLine: report.oneLine || null,
      independentSupport: report.evidence?.independentSupport ?? null,
      probabilityPercent: report.probabilityPercent ?? null,
      writingScore: report.quality?.score ?? null,
      degradedFactors: report.degradedFactors || [],
      seconds: seconds(ms),
      pass,
      why: spec.why
    };
  } catch (err) {
    return { id: spec.id, expected: spec.expect, error: err.message, pass: false, seconds: seconds(Date.now() - started) };
  }
};

const main = async () => {
  const results = { generatedAt: new Date().toISOString(), provider: {}, articles: [], gate: [], units: {} };

  results.provider = {
    chain: String(process.env.LLM_PROVIDER || 'nim'),
    ollamaHost: process.env.OLLAMA_HOST || null,
    ollamaModel: process.env.OLLAMA_MODEL || null,
    routingTable: (() => {
      try { return require('../data/taskRouting.json').generatedAt; } catch (_) { return null; }
    })()
  };

  // ---------------------------------------------------- deterministic units
  // These need neither network nor model, so they establish that the parts
  // under our own control work before anything external is involved.
  console.log('Deterministic checks (no network, no model):');

  const gateStart = Date.now();
  for (const c of GATE_CASES) {
    const verdict = assessCheckability(c.text);
    const ok = verdict.checkable === c.expectCheckable;
    results.gate.push({ id: c.id, checkable: verdict.checkable, kind: verdict.kind,
      expected: c.expectCheckable, pass: ok, reason: verdict.reason || null });
    console.log(`  admissibility gate · ${c.id.padEnd(17)} ${ok ? 'pass' : 'FAIL'} (${verdict.kind})`);
  }
  results.units.gateMs = Date.now() - gateStart;

  // One clean sample per script: a mixed-script string is genuinely ambiguous
  // and would be testing the sample rather than the detector.
  const langCases = [
    ['The council approved the riverfront plan on Tuesday in Chennai.', 'en'],
    ['கௌன்சில் செவ்வாய்க்கிழமை திட்டத்திற்கு ஒப்புதல் அளித்தது.', 'ta'],
    ['ಅವರು ಮಂಗಳವಾರ ಯೋಜನೆಯನ್ನು ಘೋಷಿಸಿದರು.', 'kn'],
    ['सरकार ने मंगलवार को नई योजना की घोषणा की।', 'hi']
  ];
  let langPass = 0;
  for (const [text, expected] of langCases) {
    const got = detectLanguage(text);
    if (got.code === expected) langPass++;
  }
  results.units.languageDetection = { cases: langCases.length, correct: langPass };
  console.log(`  language detection      ${langPass}/${langCases.length} correct`);

  const rep = getSourceReputation('Associated Press', 'https://apnews.com/x');
  const unknown = getSourceReputation('Evening Herald Online', 'https://example.invalid/x');
  results.units.sourceReputation = { known: rep.score, knownMatched: rep.matched, unknownMatched: unknown.matched };
  console.log(`  source reputation       AP ${rep.score}/10 matched=${rep.matched}, unknown matched=${unknown.matched}`);

  // ------------------------------------------------------------- network
  console.log('\nNetwork operations (external services, not the model):');
  const searchStart = Date.now();
  let coverage = { articles: [] };
  try {
    coverage = await searchCoverageBroadening('grand jury Nolan Wells', 'Associated Press', 8, 2, 'en');
    console.log(`  news index              ${coverage.articles.length} articles, `
      + `${new Set(coverage.articles.map(a => a.source)).size} distinct outlets, `
      + `${seconds(Date.now() - searchStart)}s`);
  } catch (err) {
    console.log(`  news index              FAILED: ${err.message}`);
  }
  results.units.newsIndex = {
    articles: coverage.articles.length,
    outlets: new Set(coverage.articles.map(a => a.source)).size,
    seconds: seconds(Date.now() - searchStart)
  };

  // --------------------------------------------------------------- summary
  const sumStart = Date.now();
  try {
    const text = await summarize(ARTICLES[0].article.content);
    results.units.summary = { chars: text.length, seconds: seconds(Date.now() - sumStart), ok: text.length > 20 };
    console.log(`  summary                 ${text.length} chars, ${seconds(Date.now() - sumStart)}s`);
  } catch (err) {
    results.units.summary = { ok: false, error: err.message };
    console.log(`  summary                 FAILED: ${err.message}`);
  }

  // -------------------------------------------------------- full pipeline
  console.log('\nFull pipeline, one article at a time:');
  for (const spec of ARTICLES) {
    process.stdout.write(`  ${spec.id.padEnd(26)} … `);
    const outcome = await runArticle(spec);
    results.articles.push(outcome);
    console.log(outcome.error
      ? `ERROR ${outcome.error}`
      : `${outcome.call} (${outcome.rule}) ${outcome.seconds}s ${outcome.pass ? 'pass' : 'FAIL'}`);
  }

  // ------------------------------------------------------------- summary
  const artPass = results.articles.filter(a => a.pass).length;
  const gatePass = results.gate.filter(g => g.pass).length;
  const times = results.articles.filter(a => !a.error).map(a => a.seconds);
  results.summary = {
    articlesPassed: `${artPass}/${results.articles.length}`,
    gatePassed: `${gatePass}/${results.gate.length}`,
    medianArticleSeconds: times.length
      ? Number([...times].sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(1))
      : null,
    anyDegraded: results.articles.some(a => (a.degradedFactors || []).length > 0)
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));

  console.log('\n----------------------------------------------------------');
  console.log(`  pipeline cases   ${results.summary.articlesPassed}`);
  console.log(`  gate cases       ${results.summary.gatePassed}`);
  console.log(`  median analysis  ${results.summary.medianArticleSeconds}s`);
  console.log(`  any check degraded: ${results.summary.anyDegraded ? 'yes' : 'no'}`);
  console.log(`\nWritten to ${path.relative(process.cwd(), OUT)}`);

  const failed = results.articles.filter(a => !a.pass).concat(results.gate.filter(g => !g.pass));
  process.exit(failed.length ? 1 : 0);
};

main().catch(err => { console.error(err); process.exit(1); });
