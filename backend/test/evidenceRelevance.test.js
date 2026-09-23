const test = require('node:test');
const assert = require('node:assert');
const { isRelevant, filterRelevant } = require('../agents/evidenceRelevance');

// The case that made this module necessary: measured on the adversarial set, an
// invented "secret chemical leak" story was reported as supported by real
// coverage of an unrelated evacuation, and the verdict came back "likely true".
test('coverage of a different event does not support the claim', () => {
  const claim = 'A secret chemical leak forced the overnight evacuation of three districts near Visakhapatnam.';
  const unrelated = {
    source: 'Reuters',
    title: 'Wildfire prompts evacuation orders in northern California',
    description: 'Residents were told to leave as the fire spread overnight.'
  };
  assert.strictEqual(isRelevant(claim, unrelated).relevant, false);
});

test('coverage of the same event does support the claim', () => {
  const claim = 'A chemical leak forced the evacuation of three districts near Visakhapatnam.';
  const related = {
    source: 'The Hindu',
    title: 'Chemical leak at Visakhapatnam plant forces evacuation',
    description: 'Districts around the plant were cleared as a precaution.'
  };
  const verdict = isRelevant(claim, related);
  assert.strictEqual(verdict.relevant, true);
  assert.ok(verdict.shared.includes('visakhapatnam'));
});

test('numbers count as distinctive', () => {
  const claim = 'The trial enrolled 312 patients across three centres.';
  const related = { title: 'Trial of 312 patients reports results', description: '' };
  assert.strictEqual(isRelevant(claim, related).relevant, true);
});

test('a claim with no distinctive vocabulary is not rejected by default', () => {
  const verdict = isRelevant('It was said to be so.', { title: 'Something else entirely', description: '' });
  assert.strictEqual(verdict.relevant, true);
  assert.strictEqual(verdict.unchecked, true, 'unable to check is not the same as irrelevant');
});

test('filtering keeps the relevant and reports the discarded', () => {
  const claim = 'The Reserve Bank held the repo rate unchanged at its December meeting.';
  const result = filterRelevant(claim, [
    { source: 'Reuters', title: 'Reserve Bank holds repo rate steady in December', description: '' },
    { source: 'Some Site', title: 'Cricket team announces squad for tour', description: '' }
  ]);
  assert.strictEqual(result.kept.length, 1);
  assert.strictEqual(result.dropped.length, 1);
  assert.match(result.note, /discarded for not being about this claim/);
  assert.ok(result.kept[0].sharedTerms.length >= 2);
});

test('shared stopwords alone are not relevance', () => {
  const claim = 'The government said that the new policy will be introduced after the year ends.';
  const evidence = { title: 'The government said that there will be more people after the year', description: '' };
  assert.strictEqual(isRelevant(claim, evidence).relevant, false, 'common words carry no evidential weight');
});
