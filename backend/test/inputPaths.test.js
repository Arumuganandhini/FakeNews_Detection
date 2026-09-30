// Defects the verdict-by-input matrix (eval/matrixCheck.js) found, each held
// down by the case that exposed it. All four had the same shape: something
// broke quietly, and the break was then presented to the reader as a finding.
//
// No network and no model — these are the deterministic halves of the fixes.
const test = require('node:test');
const assert = require('node:assert');

const { assessCheckability } = require('../agents/checkability');
const { deriveKeywords } = require('../agents/claimVerificationAgent').__test;

// ---------------------------------------------------------------------------
// 1. A headline joined to the body must not manufacture a proper noun.

// The forwarded message "Wake up. They are hiding the truth from you. Wake up
// before it is too late…" ingests with the title "Wake up". Joined with a bare
// space, the body's first word stopped being sentence-initial, its grammatical
// capital was read as a name, and that one phantom anchor carried pure
// exhortation past the gate into a CANNOT VERIFY verdict — a verdict on
// content that asserts nothing, which is the exact thing the gate exists to
// prevent.
test('a headline does not turn the body first word into an anchor', () => {
  const body = 'They are hiding the truth from you. Wake up before it is too late and share '
    + 'this with everyone you know before they take it down, because they do not want you to see it.';

  const withTitle = assessCheckability(body, 'Wake up');
  const withoutTitle = assessCheckability(body);

  assert.strictEqual(withTitle.checkable, false);
  assert.strictEqual(withTitle.kind, 'unfalsifiable');
  // The headline may add anchors of its own; it may not change the reading of
  // the body's own words.
  assert.strictEqual(withTitle.anchorCount, withoutTitle.anchorCount,
    'the join must not invent an anchor that neither part contains');
});

test('a headline that already ends in a stop is not given a second one', () => {
  const a = assessCheckability('The rate was held at 6.5 per cent on Tuesday by the committee.', 'Reserve Bank holds rate.');
  const b = assessCheckability('The rate was held at 6.5 per cent on Tuesday by the committee.', 'Reserve Bank holds rate');
  assert.deepStrictEqual(a.anchors, b.anchors);
});

test('a real report is still checkable once the join is fixed', () => {
  const verdict = assessCheckability(
    'A grand jury found there was not evidence to bring charges in the death of Nolan Wells '
      + 'after a July 4 boating trip off the Mississippi Gulf Coast.',
    'Mississippi grand jury finds no cause for charges');
  assert.strictEqual(verdict.checkable, true);
  assert.ok(verdict.anchors.names.includes('Nolan'));
});

// ---------------------------------------------------------------------------
// 2. A claim whose keywords went missing is still a claim.

// Measured against a live BBC report of five terrorism arrests: the model
// returned four correct, checkable claims and omitted search_keywords from
// every one. Requiring that field discarded all four, the ledger counted zero
// checkable claims, and the verdict engine called a hard news story "NOT A
// FACTUAL CLAIM — argument or analysis, nothing here to verify".
test('search terms can be rebuilt from the claim itself', () => {
  const keywords = deriveKeywords(
    'Five men have been arrested near RAF Fairford in Gloucestershire on suspicion of preparing a terrorist act.');
  const terms = keywords.split(/\s+/).filter(Boolean);

  assert.ok(terms.length >= 2 && terms.length <= 4, `expected 2-4 terms, got ${terms.length}`);
  assert.ok(terms.includes('fairford') || terms.includes('gloucestershire'),
    'the terms that pin the claim to one event are the ones worth searching for');
});

test('a claim carrying no names still yields something searchable', () => {
  // Without anchors there is nothing to pin the claim to an event, and
  // evidenceRelevance will refuse to corroborate it — but the search must
  // still be attempted rather than the claim being dropped on the floor.
  const keywords = deriveKeywords('An unnamed official confirmed the overnight evacuation of three districts.');
  assert.ok(keywords.length > 0);
  assert.ok(!keywords.split(/\s+/).some(t => ['the', 'of', 'an'].includes(t)),
    'connective words are not search terms');
});

test('numbers survive into the search terms', () => {
  const keywords = deriveKeywords('The trial enrolled 312 patients across three centres in Chennai.');
  assert.ok(/\b312\b/.test(keywords), 'a figure is often the most identifying thing in a claim');
});

// ---------------------------------------------------------------------------
// 3. A link we refuse is not a server fault.

// Each of these already had a message written for the reader, and each was
// thrown as a bare Error — so the route fell through to its catch-all and
// answered 500. That tells the reader the system broke, tells monitoring the
// same untruth, and buries the sentence that would have helped them.
const { extractArticle } = require('../utils/articleExtractor');

const refusalCode = async (url) => {
  try {
    await extractArticle(url);
    return null;
  } catch (err) {
    return err.code || '(none)';
  }
};

test('a malformed link is a bad request', async () => {
  assert.strictEqual(await refusalCode('not a link at all'), 'BAD_URL');
});

test('a non-web scheme is a bad request', async () => {
  assert.strictEqual(await refusalCode('ftp://example.com/article'), 'BAD_URL');
});

test('a link into our own network is refused by code, not by crash', async () => {
  assert.strictEqual(await refusalCode('http://127.0.0.1:5000/health'), 'BAD_URL');
});

test('a host that does not resolve is reported as a failed fetch', async () => {
  // .invalid is reserved and never resolves, on or off the network, so this
  // reaches the same branch either way.
  assert.strictEqual(await refusalCode('https://example.invalid/no-such-article'), 'FETCH_FAILED');
});

// ---------------------------------------------------------------------------
// 4. An index that cannot have seen the story yet is not a witness to silence.

// Measured on 2026-09-28: the freshest article the news index would return for
// any query was 30.5 hours old. A BBC report of five terrorism arrests, two
// hours old and carried nationwide, therefore drew no corroboration at all —
// and the verdict engine read that absence as evidence, telling the reader
// "No other outlet is reporting this, and a story this big would normally be
// everywhere", at 3% likely true. Every part of that was false.
const { buildEvidenceLedger, decideVerdict } = require('../agents/verdictEngine');

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

const ledgerFor = ({ publishedAt, claims }) => buildEvidenceLedger({
  claims,
  verificationStatus: 'checked',
  sourceResult: { score: 9, matched: true, name: 'BBC News' },
  transparencyResult: { score: 8 },
  manipulationResult: { techniques: [] },
  title: 'Five arrested as counter-terror police investigate incident near RAF Fairford',
  publishedAt,
  indexLagHours: 24
});

const uncorroborated = [{ claim: 'Five men have been arrested near RAF Fairford.', verdict: 'unverified', supportingEvidence: [], contradictingEvidence: [] }];

test('a story the index cannot have seen yet abstains instead of accusing', () => {
  const ledger = ledgerFor({ publishedAt: hoursAgo(2), claims: uncorroborated });
  assert.strictEqual(ledger.tooRecentToCorroborate, true);
  assert.strictEqual(ledger.verificationRan, false,
    'a search that could not have succeeded has not run, for scoring purposes');

  const decision = decideVerdict(ledger);
  assert.strictEqual(decision.rule, 'too-recent-to-corroborate');
  assert.ok(decision.grounds.some(g => /limit of what we can see/i.test(g)),
    'the reader is told the absence is ours, not the story\'s');
  assert.ok(!decision.grounds.some(g => /would normally be everywhere/i.test(g)));
  assert.match(decision.oneLine, /too recent/i,
    'the headline sentence must not claim the search failed when it ran');
});

test('an older story with no coverage is still reported as uncorroborated', () => {
  const ledger = ledgerFor({ publishedAt: hoursAgo(72), claims: uncorroborated });
  assert.strictEqual(ledger.tooRecentToCorroborate, false);
  assert.strictEqual(ledger.verificationRan, true);
  assert.match(decideVerdict(ledger).rule, /no-independent-coverage/);
});

test('an undated article is not treated as recent', () => {
  // Guessing "now" for a page that carries no date would silently switch the
  // whole corpus over to abstention, which is a worse error than the one this
  // rule fixes.
  const ledger = ledgerFor({ publishedAt: null, claims: uncorroborated });
  assert.strictEqual(ledger.articleAgeHours, null);
  assert.strictEqual(ledger.tooRecentToCorroborate, false);
});

test('corroboration that was found still counts, however recent the story', () => {
  const supported = [{
    claim: 'Five men have been arrested near RAF Fairford.',
    verdict: 'supported',
    supportingEvidence: [
      { source: 'Reuters', title: 'Five arrested near RAF Fairford', url: 'https://reuters.com/a' },
      { source: 'The Guardian', title: 'Counter-terror arrests near Fairford', url: 'https://theguardian.com/b' }
    ],
    contradictingEvidence: []
  }];
  const ledger = ledgerFor({ publishedAt: hoursAgo(2), claims: supported });
  assert.strictEqual(ledger.tooRecentToCorroborate, false,
    'the rule abstains from an empty search, not from a successful one');
  assert.strictEqual(ledger.verificationRan, true);
  assert.strictEqual(decideVerdict(ledger).call, 'REAL');
});

// ---------------------------------------------------------------------------
// 5. An apostrophe is an apostrophe.

// The BBC encodes apostrophes as hex references. The decoder handled &#39; but
// not &#x27;, so "Bangkok's" reached the page, the claim extractor and the
// style checks as "Bangkok&#x27;s".
test('hex character references are decoded in extracted text', () => {
  const { __test } = require('../utils/articleExtractor');
  assert.strictEqual(__test.decodeEntities('Bangkok&#x27;s governor'), "Bangkok's governor");
  assert.strictEqual(__test.decodeEntities('it&#39;s &amp; that'), "it's & that");
  assert.strictEqual(__test.decodeEntities('&amp;#x27;'), '&#x27;', 'decoded once, not twice');
});

// Pasted text has no headline of its own; the ingester uses its first line
// without the closing "?". Prepending that again turned a question into a
// statement followed by a question, and it was refused as "too vague" rather
// than as a question — the right refusal for the wrong reason.
test('a pasted question is refused as a question', async () => {
  const { ingestSocialContent } = require('../utils/socialIngest');
  const ingested = await ingestSocialContent({ text: 'Is the government planning to change the tax rules next year?' });
  const verdict = assessCheckability(ingested.content, ingested.title);
  assert.strictEqual(verdict.checkable, false);
  assert.strictEqual(verdict.kind, 'question');
});
