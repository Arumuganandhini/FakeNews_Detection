// End-to-end, with no language model and no news API reachable.
//
// This is the test that answers "what is this project, once you take away the
// borrowed model and the borrowed news feed?" Everything here runs on the
// project's own code: the deterministic analysers, the ownership model, the
// independence count, the verdict rules and the ceiling. If it passes with the
// keys removed, the contribution is not the API.
process.env.NIM_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.NEWS_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert');
const { analyzeTrust } = require('../agents/trustAnalysisAgent');

// Written to pass every presentation check: calm, specific, named sources,
// no clickbait, no persuasion techniques. It describes an event that never
// happened, which is the one thing presentation cannot reveal.
const FABRICATION = {
  title: 'Indian researchers report cure for type 1 diabetes in secret trial',
  source: 'Health Science Daily',
  url: 'https://healthsciencedaily.example/cure-diabetes',
  content: `Researchers at the National Institute of Metabolic Studies have reported that an experimental therapy reversed type 1 diabetes in 94 per cent of participants during a two-year trial.

Dr. Anjali Raghunathan, who led the study, said the results were consistent across all three centres. "We saw restoration of insulin production in almost every participant," she said. The trial enrolled 312 patients across Chennai, Pune and Hyderabad between March 2023 and February 2025.

The institute said the findings have been submitted for peer review. A spokesperson for the Ministry of Health confirmed that the ministry had been briefed on the results and that a wider trial is under consideration.`
};

const ORDINARY_REPORT = {
  title: 'City council approves budget for cycle lane extension',
  source: 'Reuters',
  url: 'https://www.reuters.com/world/india/cycle-lane',
  content: `The city council voted 34 to 11 on Tuesday to approve 42 crore rupees for an extension of the cycle lane network, according to minutes published on the council's website.

Council transport secretary Meera Krishnan said construction would begin in January. The opposition group leader, Rakesh Menon, said he had voted against the measure because of concerns about parking. The council said the work would be completed by the end of 2027.`
};

test('a fabricated article cannot be reported as trustworthy', async () => {
  const report = await analyzeTrust(FABRICATION);

  assert.ok(
    report.overallScore < 5.5,
    `a story nothing corroborates must not reach "mostly fine": got ${report.overallScore}`
  );
  assert.ok(
    ['unverified', 'likely-false'].includes(report.verdictClass),
    `expected an unverified or likely-false verdict, got ${report.verdictClass}`
  );
  assert.ok(report.decision.grounds.length > 0, 'the verdict must state its grounds');
  assert.ok(report.decision.rule, 'the verdict must name the rule that fired');
});

// The property the whole scoring model exists to guarantee: an observation the
// author controls may incriminate an article but can never speak in its favour.
test('writing well earns an article nothing', async () => {
  const report = await analyzeTrust(FABRICATION);

  const authorControlled = report.evidenceLedger.filter(entry =>
    entry.step === 'factor' && ['clickbait', 'bias', 'manipulation', 'transparency'].includes(entry.label));

  assert.ok(authorControlled.length > 0, 'the content checks should appear in the ledger');
  for (const entry of authorControlled) {
    assert.ok(
      entry.decibans >= 0,
      `${entry.label} contributed ${entry.decibans} db in the article's favour — author-controlled evidence must be clamped at 0`
    );
  }
});

test('the probability is a real probability, and the ledger adds up to it', async () => {
  const report = await analyzeTrust(FABRICATION);

  assert.ok(report.probabilityFake > 0 && report.probabilityFake < 1, 'must be a probability, never 0 or 1');

  // Decibans add. A reader must be able to check the arithmetic by hand.
  const summed = report.evidenceLedger.reduce((total, entry) => total + entry.decibans, 0);
  assert.ok(
    Math.abs(summed - report.totalDecibans) < 0.05,
    `the ledger should sum to the total: ${summed} vs ${report.totalDecibans}`
  );
});

test('a check with no measured likelihood ratio contributes nothing, and says so', async () => {
  const report = await analyzeTrust(FABRICATION);
  for (const entry of report.unmeasuredFactors) {
    assert.strictEqual(entry.decibans, 0);
    assert.ok(entry.reason, `${entry.factor} must explain why it contributed nothing`);
  }
});

test('ordinary reporting is not destroyed by the same rules', async () => {
  const report = await analyzeTrust(ORDINARY_REPORT);
  // With no news API there is no corroboration to find, so this cannot be
  // "corroborated" — but an established publisher must not be treated as a
  // fabrication either.
  assert.notStrictEqual(report.verdictClass, 'likely-false');
  assert.ok(report.overallScore >= 4, `ordinary reporting should not be condemned: got ${report.overallScore}`);
});

test('the report says the analysis was degraded rather than hiding it', async () => {
  const report = await analyzeTrust(FABRICATION);
  assert.ok(report.degradedFactors.length > 0, 'with no model, content factors must declare themselves degraded');
  assert.match(report.degradedNote, /without the language model/);
});

test('an unrun verification is not mistaken for "nothing to verify"', async () => {
  const report = await analyzeTrust(FABRICATION);
  assert.notStrictEqual(report.verdictClass, 'opinion', 'a failed check must never read as commentary');
});
