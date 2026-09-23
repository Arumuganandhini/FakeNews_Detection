// What the report may say when it never saw the article.
//
// The news feed hands over roughly two hundred characters and a "[+8026
// chars]" marker. When the publisher's page cannot be fetched, that stub is
// all the pipeline has. No article names its sources inside two hundred
// characters, so the sourcing check scored an Associated Press report 0 out of
// 10 and the summary told the reader "The article names no sources you could
// go and verify" — a fact about our reach, printed as a fact about the
// reporting. It also dragged the writing score from 9.3 to 7.0.
process.env.NIM_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.NEWS_API_KEY = '';

const test = require('node:test');
const assert = require('node:assert');
const { analyzeTrust } = require('../agents/trustAnalysisAgent');

// The feed snippet of a real, well-sourced wire report: the first two
// sentences, ending mid-word, exactly as it arrives.
const EXCERPT = {
  title: 'Mississippi grand jury finds no cause for charges in the July death of Nolan Wells',
  source: 'Associated Press',
  url: 'https://apnews.com/article/nolan-wells-grand-jury',
  content: "A grand jury has found there wasn't evidence to bring charges in the death of Nolan Wells, a Black 18-year-old who was found dead after a July 4 boating trip off the Mississippi Gulf Coast. The decision was announced late Monday by Angel Myers McIlrath, the d",
  textCoverage: 'snippet'
};

const FULL = { ...EXCERPT, textCoverage: 'full' };

test('an excerpt is not reported as an article that names no sources', async () => {
  const report = await analyzeTrust(EXCERPT);
  assert.ok(
    !report.concernPoints.some(p => /names no sources/i.test(p)),
    'the excerpt must not produce a finding about the article’s sourcing'
  );
  assert.ok(
    report.concernPoints.some(p => /only the publisher/i.test(p)),
    'the reader should be told what was actually available'
  );
});

test('the sourcing check is left out of the writing score when it could not run', async () => {
  const report = await analyzeTrust(EXCERPT);
  const ids = report.quality.checks.map(c => c.id);
  assert.ok(!ids.includes('transparency'), 'a check that could not run cannot count toward craft');
  assert.ok(ids.includes('clickbait'), 'the checks that can read a headline still run');
});

test('the sourcing factor says why it was not counted', async () => {
  const report = await analyzeTrust(EXCERPT);
  const transparency = report.factors.find(f => f.id === 'transparency');
  assert.equal(transparency.counted, false);
  assert.equal(transparency.score, null);
  assert.match(transparency.standDownReason, /only the publisher/i);
});

// The guard must not fire when the article text really was read.
test('with the full article, the sourcing check counts as it always did', async () => {
  const report = await analyzeTrust(FULL);
  const transparency = report.factors.find(f => f.id === 'transparency');
  assert.notEqual(transparency.counted, false);
  assert.equal(typeof transparency.score, 'number');
  assert.ok(report.quality.checks.some(c => c.id === 'transparency'));
});
