// Who published this is decided by the web address, never by the page.
//
// Measured before this was fixed: bbc-breaking-news.xyz, bbc-world.com and
// bbc.news-today.com were all accepted as the BBC at 9/10, and
// reuters-updates.info as Reuters at 9.5/10, because the lookup trusted the
// name a page gives itself. A fabricated story on any of them was described as
// "an exclusive that others have not yet matched". No network and no model.
const test = require('node:test');
const assert = require('node:assert');

const { getSourceReputation, claimedOutlet } = require('../agents/sourceReputationAgent');
const { buildEvidenceLedger, decideVerdict } = require('../agents/verdictEngine');

const outlet = (name, url, opts) => getSourceReputation(name, url, opts);

// ------------------------------------------------------------ the real outlet

test('an outlet is recognised on its own domain and its subdomains', () => {
  assert.equal(outlet('BBC News', 'https://www.bbc.com/news/articles/x').matchedName, 'BBC News');
  assert.equal(outlet('BBC News', 'https://news.bbc.co.uk/1/hi/x.stm').matchedName, 'BBC News');
  assert.equal(outlet('CNN', 'https://edition.cnn.com/2026/09/28/x').matchedName, 'CNN');
  assert.equal(outlet('BBC News', 'https://www.bbc.com/news/x').verifiedBy, 'domain');
});

test('the most specific address wins', () => {
  assert.equal(outlet('BBC Sport', 'https://www.bbc.co.uk/sport/football/1').matchedName, 'BBC Sport');
  assert.equal(outlet('BBC', 'https://www.bbc.co.uk/news/world-1').matchedName, 'BBC News');
});

test('the address decides even when the page gives a different name', () => {
  // A genuine BBC page with an odd site name is still the BBC.
  assert.equal(outlet('Homepage', 'https://www.bbc.com/news/x').matchedName, 'BBC News');
});

// ------------------------------------------------------------------ copycats

test('a lookalike domain claiming a newsroom gets no record and is flagged', () => {
  for (const [name, url, claimed] of [
    ['BBC News', 'https://bbc-breaking-news.xyz/story/1', 'BBC News'],
    ['Reuters', 'https://reuters-updates.info/a', 'Reuters']
  ]) {
    const r = outlet(name, url);
    assert.equal(r.matched, false, `${url} must not inherit ${claimed}'s record`);
    assert.equal(r.impersonates, claimed);
  }
});

test('lookalike addresses without a claimed name get no record', () => {
  for (const url of ['https://bbc-world.com/story/1', 'https://bbc.news-today.com/1']) {
    const r = outlet(new URL(url).hostname, url);
    assert.equal(r.matched, false, url);
  }
});

test('common names are not treated as impersonation', () => {
  // Many genuine papers are called The Guardian; a licensed brand like
  // CNN-News18 is not an impersonation of CNN.
  assert.equal(outlet('The Guardian', 'https://theguardian.pe.ca/news/1').impersonates, undefined);
  assert.equal(outlet('CNN-News18', 'https://www.news18.com/a').impersonates, undefined);
  assert.equal(claimedOutlet('The Sun'), null);
});

test('an archive copy is not accused of impersonation', () => {
  const r = outlet('BBC News', 'https://web.archive.org/web/2024/https://www.bbc.com/news/x');
  assert.equal(r.matched, false);
  assert.equal(r.impersonates, undefined);
});

// ---------------------------------------------------------- names without proof

test('a platform channel earns a record only through a listed address', () => {
  assert.equal(outlet('Associated Press', 'https://www.youtube.com/@AssociatedPress').matchedName, 'Associated Press');
  assert.equal(outlet('Associated Press', 'https://www.youtube.com/@AssociatedPress').verifiedBy, 'channel');
  assert.equal(outlet('Associated Press', 'https://www.youtube.com/@ap-news-live').matched, false,
    'anyone can name a channel "Associated Press"');
});

test('a name typed beside a screenshot does not bring a record with it', () => {
  assert.equal(outlet('BBC News', null).matched, false);
});

test('a curated dataset label may still be matched by name', () => {
  assert.equal(outlet('BBC News', null, { trustedName: true }).matchedName, 'BBC News');
});

// -------------------------------------------------------------- the verdict

const uncorroborated = [{ claim: 'India will abolish all income tax from 1 January 2027.', verdict: 'unverified', supportingEvidence: [], contradictingEvidence: [] }];
const ledgerFor = (sourceResult, claims = uncorroborated) => buildEvidenceLedger({
  claims, verificationStatus: 'checked', sourceResult,
  transparencyResult: { score: 7 }, manipulationResult: { techniques: [] },
  title: 'India to abolish all income tax'
});

test('a copycat BBC no longer earns the "established publisher" reading', () => {
  const spoof = outlet('BBC News', 'https://bbc-breaking-news.xyz/story/1');
  const decision = decideVerdict(ledgerFor(spoof));
  assert.notEqual(decision.rule, 'no-independent-coverage-established-publisher');
  assert.ok(!decision.grounds.some(g => /exclusive/i.test(g)));
  assert.ok(decision.grounds.some(g => /presents itself as BBC News/.test(g)),
    'the reader is told the page is posing as the BBC');
});

test('the genuine BBC still earns it', () => {
  const real = outlet('BBC News', 'https://www.bbc.com/news/articles/x');
  assert.equal(decideVerdict(ledgerFor(real)).rule, 'no-independent-coverage-established-publisher');
});

test('an impersonating page starts from the poor-record prior', () => {
  const { priorFor } = require('../agents/weightOfEvidence');
  const spoof = outlet('BBC News', 'https://bbc-breaking-news.xyz/story/1');
  const real = outlet('BBC News', 'https://www.bbc.com/news/x');
  assert.equal(priorFor({ sourceResult: spoof }).band, 'poorRecord');
  assert.equal(priorFor({ sourceResult: real }).band, 'strongRecord');
});

// ------------------------------------------------- the published rating set

test('an outlet outside the curated list is rated from Lin et al. (2023)', () => {
  const r = outlet('Roll Call', 'https://www.rollcall.com/2026/x');
  assert.equal(r.matched, true);
  assert.equal(r.ratingSource, 'Lin et al. (2023)');
  assert.ok(r.score >= 8.5, `rollcall.com is rated 0.98 of 1; got ${r.score}/10`);
});

test('a low-quality domain in the published set is rated low', () => {
  assert.ok(outlet('x', 'https://nvic.org/a').score < 3);
});

test('the curated list is consulted first', () => {
  const r = outlet('Reuters', 'https://www.reuters.com/world/x');
  assert.equal(r.ratingSource, undefined);
  assert.equal(r.type, 'news agency', 'curated types (agency, satire, state) are kept');
});

test('a rated parent domain covers its subdomains, but never a bare suffix', () => {
  assert.equal(outlet('x', 'https://news.rollcall.com/x').matchedName, 'rollcall.com');
  assert.equal(outlet('x', 'https://unrated-example-site.co.uk/x').matched, false);
});

// ------------------------------------------------------------- domain age

test('the registrable domain is found under two-level suffixes', () => {
  const { registrable } = require('../utils/domainAge');
  assert.equal(registrable('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrable('www.bbc-breaking-news.xyz'), 'bbc-breaking-news.xyz');
  assert.equal(registrable('edition.cnn.com'), 'cnn.com');
});

test('a very young domain is a warning sign, and only that', () => {
  const young = { domain: 'bbc-breaking-news.xyz', registered: '2026-09-20', ageDays: 8, young: true };
  const risky = buildEvidenceLedger({
    claims: uncorroborated, verificationStatus: 'checked', sourceResult: outlet('x', 'https://bbc-breaking-news.xyz/1'),
    transparencyResult: { score: 7 }, manipulationResult: { techniques: [] }, title: 'India to abolish all income tax',
    domainAge: young
  });
  assert.ok(decideVerdict(risky).grounds.some(g => /registered only 8 days ago/.test(g)));

  // An unanswered registry is not an old domain: nothing is said either way.
  const unknownAge = ledgerFor(outlet('x', 'https://bbc-breaking-news.xyz/1'));
  assert.equal(unknownAge.domainAge, null);
  assert.ok(!decideVerdict(unknownAge).grounds.some(g => /registered/.test(g)));
});
