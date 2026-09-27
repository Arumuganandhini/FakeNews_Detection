const test = require('node:test');
const assert = require('node:assert');
const { groupNames, rankEntities, MAX_ENTITIES } = require('../agents/referenceCheck');

test('adjacent capitalised words are read as one name', () => {
  const names = groupNames('The minister said Rahul Gandhi met Narendra Modi in New Delhi on Tuesday.');
  assert.ok(names.includes('Rahul Gandhi'), `got ${names.join(', ')}`);
  assert.ok(names.includes('Narendra Modi'));
  assert.ok(names.includes('New Delhi'));
  // Splitting these would look up "Rahul" and "Gandhi" as separate subjects and
  // retrieve the wrong entries for both.
  assert.ok(!names.includes('Rahul'));
});

test('a sentence-opening capital is not taken for a name', () => {
  const names = groupNames('Everyone agrees the policy failed. Nobody wants to say so.');
  assert.ok(!names.includes('Everyone'));
  assert.ok(!names.includes('Nobody'));
});

test('organisations spanning several words stay together', () => {
  const names = groupNames('A report by the World Health Organization was published on Monday.');
  assert.ok(names.some(n => n.includes('World Health Organization')), `got ${names.join(', ')}`);
});

test('lookups are capped so cost stays bounded', () => {
  const many = ['Alpha Beta', 'Gamma Delta', 'Epsilon Zeta', 'Eta Theta'];
  assert.strictEqual(rankEntities(many).length, MAX_ENTITIES);
});

// Ranking by name length picked the longest name, which is routinely an
// incidental one, and dropped the subject of the article entirely.
test('the subject of the headline is checked, not an incidental name', () => {
  const title = 'Prime Minister Rahul Gandhi announces nationwide fuel subsidy';
  const body = `${title}. Minister Meera Krishnan and President Droupadi Murmu also attended the event.`;
  const ranked = rankEntities(groupNames(body), title);
  assert.strictEqual(ranked[0], 'Rahul Gandhi', `got ${ranked.join(', ')}`);
});

test('a title is stripped so the person is looked up, not the office', () => {
  const ranked = rankEntities(groupNames('A statement from Prime Minister Rahul Gandhi followed.'), '');
  assert.ok(ranked.includes('Rahul Gandhi'), `got ${ranked.join(', ')}`);
  assert.ok(!ranked.some(n => /prime minister/i.test(n)),
    'looking up "Prime Minister" retrieves the article on the office, which says nothing about the person');
});

test('a phrase that is only a title has nothing to look up', () => {
  assert.strictEqual(rankEntities(['Prime Minister', 'President', 'Chief Justice']).length, 0);
});

test('weekdays and months are not treated as subjects', () => {
  const ranked = rankEntities(groupNames('The council met on Tuesday and again in September to discuss it.'), '');
  assert.ok(!ranked.includes('Tuesday'));
  assert.ok(!ranked.includes('September'));
});

// Regression guard. A judgement that could not run must not be reported as a
// subject that was checked and found consistent — the identical article was
// coming back contradicted on one run and unverified on the next, purely
// because the model provider was rate-limiting, and the report said "checked"
// either way.
test('a premise check that could not run is not reported as consistent', async () => {
  const { checkPremises } = require('../agents/referenceCheck');
  const wikipediaPath = require.resolve('../utils/wikipedia');
  const nimPath = require.resolve('../utils/nvidiaNimApi');

  const realWiki = require.cache[wikipediaPath];
  const realNim = require.cache[nimPath];

  require.cache[wikipediaPath] = {
    id: wikipediaPath, filename: wikipediaPath, loaded: true,
    exports: {
      fetchWikipediaContent: async () => ([{ title: 'Rahul Gandhi', content: 'An Indian politician.', url: 'x' }]),
      extractKeywords: () => []
    }
  };
  // Every model call fails, as it does when the provider is rate-limiting.
  require.cache[nimPath] = {
    id: nimPath, filename: nimPath, loaded: true,
    exports: { callNimApiJson: async () => { throw new Error('rate limited'); }, callNimApi: async () => '', extractJson: () => null }
  };

  delete require.cache[require.resolve('../agents/referenceCheck')];
  const fresh = require('../agents/referenceCheck');

  try {
    const result = await fresh.checkPremises(
      'Prime Minister Rahul Gandhi announces subsidy',
      'Prime Minister Rahul Gandhi announced a nationwide fuel subsidy on Tuesday in New Delhi.'
    );
    assert.strictEqual(result.status, 'error',
      `a failed judgement must not read as "consistent"; got "${result.status}"`);
    assert.strictEqual(result.contradictions.length, 0);
    assert.match(result.explanation, /could not be completed/);
  } finally {
    if (realWiki) require.cache[wikipediaPath] = realWiki; else delete require.cache[wikipediaPath];
    if (realNim) require.cache[nimPath] = realNim; else delete require.cache[nimPath];
    delete require.cache[require.resolve('../agents/referenceCheck')];
  }
});

// A shared name is not a shared identity.
//
// The adversarial set contains a genuine article quoting a council transport
// secretary named Meera Krishnan. The lookup resolved that to the encyclopedia
// entry for Meera Krishnan the actress, and the judge reported a
// contradiction: the article calls her a transport secretary, the entry calls
// her an actress. Both are true, about different people, and a genuine article
// was condemned on the strength of a name. Refusing to accuse when the subjects
// differ is the asymmetry this project rests on.
test('a different person with the same name is not a contradiction', async () => {
  const nimPath = require.resolve('../utils/nvidiaNimApi');
  const wikiPath = require.resolve('../utils/wikipedia');
  const realNim = require.cache[nimPath];
  const realWiki = require.cache[wikiPath];
  const agentPath = require.resolve('../agents/referenceCheck');

  require.cache[wikiPath] = {
    id: wikiPath, filename: wikiPath, loaded: true,
    exports: {
      fetchWikipediaContent: async () => ([{
        title: 'Meera Krishnan',
        url: 'https://en.wikipedia.org/wiki/Meera_Krishnan',
        content: 'Meera Krishnan is an Indian actress who has appeared in Tamil-language films and television serials.'
      }]),
      ReferenceUnavailableError: class extends Error {}
    }
  };
  require.cache[nimPath] = {
    id: nimPath, filename: nimPath, loaded: true,
    exports: {
      callNimApiJson: async () => ({
        same_subject: false,
        contradicts: true,          // the judge still says "contradicts"...
        article_states: 'Meera Krishnan is the council transport secretary.',
        reference_states: 'Meera Krishnan is an Indian actress.'
      }),
      callNimApi: async () => '',
      extractJson: () => ({})
    }
  };
  delete require.cache[agentPath];

  try {
    const { checkPremises } = require(agentPath);
    const result = await checkPremises(
      'Council approves cycle lane budget',
      'The transport secretary, Meera Krishnan, said construction would begin in January in Chennai.');

    // ...and it must not reach the reader as one, because the subjects differ.
    assert.equal(result.contradictions.length, 0,
      'a name collision must not be reported as a contradicted premise');
    assert.notEqual(result.status, 'contradicted');
  } finally {
    delete require.cache[agentPath];
    if (realNim) require.cache[nimPath] = realNim; else delete require.cache[nimPath];
    if (realWiki) require.cache[wikiPath] = realWiki; else delete require.cache[wikiPath];
  }
});
