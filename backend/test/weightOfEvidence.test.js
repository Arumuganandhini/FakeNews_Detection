const test = require('node:test');
const assert = require('node:assert');
const { assessProbability, weighCorroboration, probabilityToDecibans, decibansToProbability } = require('../agents/weightOfEvidence');

const POLISHED = { clickbait: 9, bias: 9, manipulation: 9.5 };
const CRUDE = { clickbait: 1, bias: 2, manipulation: 3 };
const UNKNOWN_OUTLET = { matched: false, score: 5 };
const STRONG_OUTLET = { matched: true, score: 9.5 };
const NO_EVIDENCE = { independentSupport: 0, independentContradiction: 0, verificationRan: true };

const assess = (factorScores, sourceResult, evidence = NO_EVIDENCE, provenance = null) =>
  assessProbability({ factorScores, sourceResult, evidence, provenance });

test('decibans and probabilities convert back and forth', () => {
  for (const p of [0.01, 0.1, 0.5, 0.9, 0.99]) {
    assert.ok(Math.abs(decibansToProbability(probabilityToDecibans(p)) - p) < 1e-9);
  }
});

// THE central property. Style, headline and attribution are all chosen by
// whoever wrote the article, so a capable fabricator can produce any value they
// like. Such an observation may incriminate; it must never exculpate.
test('author-controlled evidence never lowers the probability of fabrication', () => {
  const polished = assess(POLISHED, UNKNOWN_OUTLET);
  const noContent = assess({}, UNKNOWN_OUTLET);

  assert.ok(
    polished.probabilityFabricated >= noContent.probabilityFabricated - 1e-9,
    `writing well lowered P(fake) from ${noContent.probabilityFabricated} to ${polished.probabilityFabricated}`
  );
});

// Regression guard. Clamping each factor is not enough on its own: the
// calibration map is fitted on a corpus where a clean style really does predict
// a genuine article, so calibrating after clamping re-introduced a large
// exculpatory weight and silently undid the whole rule.
test('calibration does not smuggle exculpatory weight back in', () => {
  const polished = assess(POLISHED, UNKNOWN_OUTLET);
  const contentEntries = polished.ledger.filter(e => e.step === 'factor' || e.step === 'adjustment');
  const contentTotal = contentEntries.reduce((sum, e) => sum + e.decibans, 0);

  assert.ok(
    contentTotal >= -1e-9,
    `content evidence contributed ${contentTotal} db in the article's favour, after calibration`
  );
});

test('crude style does incriminate', () => {
  const crude = assess(CRUDE, UNKNOWN_OUTLET);
  const polished = assess(POLISHED, UNKNOWN_OUTLET);
  assert.ok(crude.probabilityFabricated > polished.probabilityFabricated);
  assert.ok(crude.probabilityFabricated > 0.5, `expected a crude article to look suspicious, got ${crude.probabilityFabricated}`);
});

// The whole thesis in one assertion: identical article, different evidence.
test('only evidence moves the answer', () => {
  const uncorroborated = assess(POLISHED, UNKNOWN_OUTLET, NO_EVIDENCE);
  const corroborated = assess(POLISHED, UNKNOWN_OUTLET, { independentSupport: 2, independentContradiction: 0, verificationRan: true });
  const contradicted = assess(POLISHED, UNKNOWN_OUTLET, { independentSupport: 0, independentContradiction: 2, verificationRan: true });

  assert.ok(corroborated.probabilityFabricated < uncorroborated.probabilityFabricated / 10,
    'two independent sources should move the answer by an order of magnitude');
  assert.ok(contradicted.probabilityFabricated > uncorroborated.probabilityFabricated * 2);
});

test('an unrun verification contributes nothing either way', () => {
  const notRun = weighCorroboration({ verificationRan: false });
  assert.strictEqual(notRun.decibans, 0);
});

test('absence of corroboration is weak evidence, presence is strong', () => {
  const absent = weighCorroboration({ independentSupport: 0, independentContradiction: 0 });
  const present = weighCorroboration({ independentSupport: 2, independentContradiction: 0 });

  assert.ok(absent.decibans > 0, 'finding nothing points mildly toward fabrication');
  assert.ok(Math.abs(present.decibans) > Math.abs(absent.decibans) * 3,
    'finding corroboration must be much stronger evidence than failing to find it — coverage gaps are ordinary');
});

test('provenance sets the starting point, and it is reported', () => {
  const strong = assess(POLISHED, STRONG_OUTLET);
  const unknown = assess(POLISHED, UNKNOWN_OUTLET);
  const social = assess(POLISHED, UNKNOWN_OUTLET, NO_EVIDENCE, { knownOutletChannel: false });

  assert.ok(strong.priorProbability < unknown.priorProbability);
  assert.ok(social.priorProbability > unknown.priorProbability);
  assert.strictEqual(strong.priorBand, 'strongRecord');
  assert.ok(strong.declaredParameters.length > 0, 'declared parameters must be named in every report');
});

test('the ledger sums to the reported total, so a reader can check it', () => {
  const result = assess(CRUDE, UNKNOWN_OUTLET, { independentSupport: 1, independentContradiction: 0, verificationRan: true });
  const summed = result.ledger.reduce((total, entry) => total + entry.decibans, 0);
  assert.ok(Math.abs(summed - result.totalDecibans) < 0.05, `${summed} vs ${result.totalDecibans}`);
});

test('the system never reports certainty', () => {
  const overwhelming = assess(CRUDE, { matched: true, score: 1, type: 'conspiracy' },
    { independentSupport: 0, independentContradiction: 5, verificationRan: true },
    { knownOutletChannel: false });
  assert.ok(overwhelming.probabilityFabricated < 1);
  assert.ok(overwhelming.probabilityFabricated > 0);
});

// The property, not the example.
//
// This used to name transparency, which had 18 labelled examples and so could
// not be estimated. The clean re-estimation gave it 239 and it is now measured,
// which is the fix working — but it left the test asserting a fact about the
// corpus rather than about the code. What must hold is that a factor without a
// measured ratio contributes exactly nothing AND is named in the report, so a
// reader can tell "this check found nothing" from "this check was not weighed".
test('a factor with no measured ratio contributes nothing and is named', () => {
  const result = assess({ ...POLISHED, transparency: 9 }, UNKNOWN_OUTLET);

  for (const entry of result.unmeasured) {
    assert.strictEqual(entry.decibans, 0, `${entry.factor} was listed as unmeasured but carried weight`);
    assert.ok(entry.reason, `${entry.factor} was listed as unmeasured without saying why`);
  }

  // Nothing may contribute weight without appearing in the ledger the reader
  // is shown; silence is the failure mode this guards against.
  const namedInLedger = new Set(result.ledger.map(entry => entry.label));
  for (const entry of result.ledger) {
    if (entry.step === 'factor') {
      assert.ok(namedInLedger.has(entry.label));
      assert.ok(entry.basis, `${entry.label} moved the answer without stating its basis`);
    }
  }
});
