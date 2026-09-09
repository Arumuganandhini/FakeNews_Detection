// backend/agents/compareCoverageAgent.js
// Compare Coverage: take one story and show how DIFFERENT outlets reported it.
//
// This reuses the same building blocks as the trust pipeline — the source
// reputation database and the clickbait checker — but applies them across
// several outlets covering one story instead of one article in depth.
//
// Note on scoring: search results give only headline + description, not the
// full article body, so a full 4-factor trust score is not possible here.
// Each outlet gets a lighter "coverage score" (source reputation + headline
// quality) which is clearly labelled as such in the UI.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { searchCoverageBroadening } = require('../utils/newsFetcher');
const { getSourceReputation } = require('./sourceReputationAgent');
const { analyzeClickbait } = require('./clickbaitAgent');

// How the lightweight per-outlet coverage score is composed.
const COVERAGE_WEIGHTS = { reputation: 0.6, headline: 0.4 };
const MAX_OUTLETS = 6;

/**
 * Turn an article headline into search keywords other outlets would also use.
 * Skipped when the user supplies their own query.
 */
const deriveKeywords = async (title) => {
  // Keep this short: news search requires every term to match, so 3-4 highly
  // distinctive words (names, places) retrieve far more coverage than a long list.
  const prompt = `A news article has this headline:

"${title}"

Give the search keywords another news website would use for the SAME story.

Respond with ONLY a JSON object, no other text:
{
  "keywords": "<exactly 3 or 4 of the most distinctive words - names, places or events - most important first, no quotes, no punctuation>"
}`;

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 120 });
    const kw = String(result.keywords || '').trim();
    if (kw) return kw;
  } catch (err) {
    console.error('Keyword derivation failed:', err.message);
  }
  // Fallback: strip punctuation and common stop words from the title.
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'at', 'by', 'from', 'is', 'are', 'was', 'were', 'after', 'over', 'says']);
  return String(title || '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w.toLowerCase()))
    .slice(0, 6)
    .join(' ');
};

/**
 * One LLM call that reads every outlet's headline together and reports where
 * the coverage agrees and where it diverges.
 */
const compareFraming = async (outlets) => {
  const list = outlets
    .map((o, i) => `[${i + 1}] ${o.source}: "${o.title}" — ${(o.description || '').slice(0, 200)}`)
    .join('\n');

  const prompt = `You are a media analysis assistant. Below is how different news outlets reported the same story.

${list}

Compare the coverage. Respond with ONLY a JSON object, no other text:
{
  "topic": "<neutral description of the story in at most 12 words>",
  "agreement": "<high | mixed | low>",
  "shared_facts": ["<a fact reported by most or all outlets>"],
  "differences": [
    { "point": "<how the coverage differs in framing, emphasis or wording>", "outlets": ["<source name>"] }
  ],
  "summary": "<two sentences describing how the coverage differs across outlets>"
}
Report at most 3 shared facts and at most 3 differences. Base everything only on the text above.`;

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 900 });
    return {
      topic: String(result.topic || ''),
      agreement: ['high', 'mixed', 'low'].includes(result.agreement) ? result.agreement : 'mixed',
      sharedFacts: (Array.isArray(result.shared_facts) ? result.shared_facts : []).map(String).slice(0, 3),
      differences: (Array.isArray(result.differences) ? result.differences : [])
        .filter(d => d && d.point)
        .map(d => ({
          point: String(d.point),
          outlets: (Array.isArray(d.outlets) ? d.outlets : []).map(String)
        }))
        .slice(0, 3),
      summary: String(result.summary || '')
    };
  } catch (err) {
    console.error('Framing comparison failed:', err.message);
    return {
      topic: '',
      agreement: 'mixed',
      sharedFacts: [],
      differences: [],
      summary: 'Coverage comparison unavailable — outlet details are still shown below.',
      failed: true
    };
  }
};

/**
 * Compare how different outlets covered one story.
 * @param {Object} input
 * @param {string} [input.title]  - Headline of the article being compared from
 * @param {string} [input.query]  - Explicit search text (used instead of title)
 * @param {string} [input.source] - Originating outlet, kept and marked in results
 * @param {string} [input.url]    - Originating article URL
 * @returns {Promise<Object>} comparison report
 */
const compareCoverage = async ({ title, query, source, url }) => {
  const searchText = (query && query.trim()) || await deriveKeywords(title);

  // Pull coverage; keep the originating outlet in the list so users can see
  // their article side by side with the others. The search broadens itself
  // if the initial keyword set is too narrow to match anything.
  const { articles: found, query: usedQuery } = await searchCoverageBroadening(searchText, '', 24, 3);

  // One article per outlet — the most relevant — so the comparison is across
  // outlets rather than across many stories from the same outlet.
  const byOutlet = new Map();
  for (const article of found) {
    const key = String(article.source || '').toLowerCase();
    if (key && !byOutlet.has(key)) byOutlet.set(key, article);
  }
  const selected = [...byOutlet.values()].slice(0, MAX_OUTLETS);

  if (selected.length < 2) {
    return {
      status: 'insufficient-coverage',
      query: usedQuery || searchText,
      outlets: [],
      explanation: 'Not enough coverage from other outlets was found for this story. Try a broader search.'
    };
  }

  // Headline checks run in parallel; reputation lookups are instant.
  const headlineResults = await Promise.all(selected.map(a => analyzeClickbait(a.title)));

  const outlets = selected.map((article, i) => {
    const reputation = getSourceReputation(article.source, article.url);
    const headline = headlineResults[i];
    const coverageScore = Math.round(
      (reputation.score * COVERAGE_WEIGHTS.reputation + headline.score * COVERAGE_WEIGHTS.headline) * 10
    ) / 10;

    return {
      source: article.source,
      title: article.title,
      description: article.description,
      url: article.url,
      publishedAt: article.publishedAt,
      isOriginal: Boolean(source) && String(article.source).toLowerCase() === String(source).toLowerCase(),
      reputation: {
        score: reputation.score,
        bias: reputation.bias,
        type: reputation.type,
        matched: reputation.matched,
        matchedName: reputation.matchedName
      },
      headline: {
        score: headline.score,
        isClickbait: headline.isClickbait,
        signals: headline.signals || []
      },
      coverageScore
    };
  });

  outlets.sort((a, b) => b.coverageScore - a.coverageScore);

  const consensus = await compareFraming(outlets);

  // Deterministic spread statistics, computed from the reputation database.
  const leanCounts = outlets.reduce((acc, o) => {
    const lean = o.reputation.matched ? (o.reputation.bias || 'unknown') : 'unknown';
    acc[lean] = (acc[lean] || 0) + 1;
    return acc;
  }, {});
  const scores = outlets.map(o => o.coverageScore);

  return {
    status: 'ok',
    query: searchText,
    originalSource: source || null,
    originalUrl: url || null,
    outlets,
    consensus,
    spread: {
      outletCount: outlets.length,
      leanCounts,
      lowestScore: Math.min(...scores),
      highestScore: Math.max(...scores)
    },
    analyzedAt: new Date().toISOString()
  };
};

module.exports = { compareCoverage, COVERAGE_WEIGHTS };
