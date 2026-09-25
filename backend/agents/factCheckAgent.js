// backend/agents/factCheckAgent.js
//
// NOT WIRED INTO THE PIPELINE. This module works and is tested, but the trust
// analysis no longer calls it — see the note at the top of trustAnalysisAgent.js
// for why (Google's API needs a billing-enabled account, and the keyless route
// spends a news-request budget of 100/day that the article feed depends on).
//
// To switch it back on: obtain a Fact Check Tools API key, set FACTCHECK_API_KEY,
// then in trustAnalysisAgent.js re-add the import, give `factCheck` a weight
// (rescaling the others so they still sum to 1), await it in the Promise.all,
// and restore its entry in the factors array.
//
// Professional fact-check matching.
//
// Cross-source verification tells us whether other NEWSROOMS reported the same
// facts. This goes one step further: it asks whether a professional
// fact-checking organisation — PolitiFact, Snopes, AFP, Full Fact, Boom Live —
// has already published a verdict on this claim.
//
// Evidence source: Google Fact Check Tools API, which indexes ClaimReview
// markup published by IFCN-signatory fact-checkers.
//
// Two-stage design, matching the rest of the pipeline's philosophy:
//   1. Retrieval  — the API returns candidate fact-checks for a claim (no AI).
//   2. Judgement  — the LLM decides which candidates actually address OUR claim
//                   (keyword overlap alone produces false matches).
// The model never supplies a verdict itself; it only matches our claim to a
// verdict a human fact-checker published.
//
// Two evidence sources, in order of preference:
//   1. Google Fact Check Tools API — hundreds of publishers, needs FACTCHECK_API_KEY.
//   2. ClaimReview read directly from fact-checker pages — narrower coverage,
//      no key required, so the factor still works on a fresh deployment.
// Both return a rating a human fact-checker published; neither asks the model
// what is true.
const axios = require('axios');
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { searchClaimReviews } = require('../utils/claimReviewReader');

const API_URL = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

// Fact-checkers use free text for their ratings ("Pants on Fire", "Mostly
// False", "Four Pinocchios"). Normalise to a small set we can score.
const RATING_BUCKETS = [
  { verdict: 'false', patterns: [/pants on fire/i, /^false/i, /fake/i, /fabricat/i, /incorrect/i, /debunk/i, /no evidence/i, /four pinocchio/i, /altered/i] },
  { verdict: 'mostly-false', patterns: [/mostly false/i, /misleading/i, /distort/i, /exaggerat/i, /partly false/i, /three pinocchio/i, /missing context/i] },
  { verdict: 'mixed', patterns: [/mixture/i, /half/i, /partly true/i, /unproven/i, /outdated/i, /two pinocchio/i, /needs context/i] },
  { verdict: 'mostly-true', patterns: [/mostly true/i, /largely (true|accurate)/i, /one pinocchio/i] },
  { verdict: 'true', patterns: [/^true/i, /correct/i, /accurate/i, /verified/i, /confirmed/i] }
];

const normaliseRating = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return 'unrated';
  for (const bucket of RATING_BUCKETS) {
    if (bucket.patterns.some(p => p.test(text))) return bucket.verdict;
  }
  return 'unrated';
};

// How each normalised verdict moves the factor score (baseline 5).
const VERDICT_WEIGHTS = {
  'false': -4.5,
  'mostly-false': -3,
  'mixed': -1,
  'mostly-true': +2,
  'true': +3,
  'unrated': 0
};

/**
 * Ask Google's Fact Check Tools API for published fact-checks matching a query.
 * Returns [] when no key is configured, so the factor degrades gracefully.
 */
const searchFactChecks = async (query, maxResults = 8) => {
  const key = process.env.FACTCHECK_API_KEY;
  if (!key) return [];

  try {
    const { data } = await axios.get(API_URL, {
      params: { query, key, languageCode: 'en', pageSize: maxResults },
      timeout: 10000
    });

    const claims = data.claims || [];
    const out = [];
    for (const claim of claims) {
      for (const review of claim.claimReview || []) {
        out.push({
          claimText: claim.text || '',
          claimant: claim.claimant || '',
          claimDate: claim.claimDate || null,
          publisher: review.publisher?.name || review.publisher?.site || 'Unknown fact-checker',
          title: review.title || '',
          url: review.url || '',
          rating: review.textualRating || '',
          verdict: normaliseRating(review.textualRating),
          reviewDate: review.reviewDate || null
        });
      }
    }
    return out.slice(0, maxResults);
  } catch (err) {
    // A quota or network failure must not fail the whole analysis.
    console.error('Fact-check search failed:', err.response?.data?.error?.message || err.message);
    return [];
  }
};

/**
 * Stage 2 — the LLM decides which retrieved fact-checks genuinely address our
 * claim. Keyword search returns topically-related checks that are often about
 * a different specific assertion, so this filter prevents false matches.
 */
const matchFactChecks = async (claim, candidates) => {
  const list = candidates
    .map((c, i) => `[${i + 1}] ${c.publisher} rated "${c.claimText || c.title}" as: ${c.rating}`)
    .join('\n');

  const prompt = `You are matching a news claim against published fact-checks.

Our claim: "${claim}"

Fact-checks found:
${list}

Which of these fact-checks are about the SAME specific assertion as our claim? Be strict — a fact-check on the same broad topic but a different specific assertion does NOT count.

Respond with ONLY a JSON object, no other text:
{
  "matching_indices": [<numbers of fact-checks about the same specific assertion>],
  "explanation": "<one sentence>"
}
If none genuinely match, return an empty array.`;

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 450 });
    const indices = Array.isArray(result.matching_indices) ? result.matching_indices : [];
    return {
      matched: indices
        .map(n => candidates[Number(n) - 1])
        .filter(Boolean),
      explanation: String(result.explanation || '')
    };
  } catch (err) {
    console.error('Fact-check matching failed:', err.message);
    return { matched: [], explanation: '' };
  }
};

/**
 * Check an article's claims against published professional fact-checks.
 * @param {Array<{claim: string, keywords: string}>} claims - from claim extraction
 * @returns {Promise<Object>} factor result
 */
const checkAgainstFactCheckers = async (claims = []) => {
  const hasGoogleKey = Boolean(process.env.FACTCHECK_API_KEY);
  const hasNewsKey = Boolean(process.env.NEWS_API_KEY);

  // Only truly unavailable when neither route can run.
  if (!hasGoogleKey && !hasNewsKey) {
    return {
      score: 5,
      status: 'not-configured',
      checkedClaims: [],
      explanation: 'Professional fact-check matching is not configured.',
      informative: false,
      evidenceSource: 'none'
    };
  }

  if (!claims.length) {
    return {
      score: 5,
      status: 'no-claims',
      checkedClaims: [],
      explanation: 'No checkable claims were available to match against fact-checks.',
      informative: false,
      evidenceSource: hasGoogleKey ? 'google' : 'claimreview'
    };
  }

  const results = [];
  const sourcesUsed = new Set();

  // The keyless route spends the NewsAPI request budget, which the news feed
  // and cross-source verification also draw on — and the free tier allows only
  // 100 requests a day in total. Google's API has its own, far larger quota, so
  // it is metered generously and the fallback is not. Claims arrive in
  // importance order, so the first few are the ones worth spending on.
  const FALLBACK_CLAIM_LIMIT = 2;
  let fallbackSearches = 0;

  for (const { claim, keywords } of claims) {
    // Fact-check databases are small relative to news; search the distinctive
    // keywords rather than the full sentence.
    let candidates = await searchFactChecks(keywords || claim);
    if (candidates.length) sourcesUsed.add('google');

    // Nothing from the aggregator (or no key): read ClaimReview off the
    // fact-checkers' own pages instead.
    if (!candidates.length && hasNewsKey && fallbackSearches < FALLBACK_CLAIM_LIMIT) {
      fallbackSearches++;
      candidates = await searchClaimReviews(keywords || claim);
      if (candidates.length) sourcesUsed.add('claimreview');
      // Give these the same shape the scoring below expects.
      candidates = candidates.map(c => ({
        ...c,
        title: c.claimText,
        verdict: normaliseRating(c.rating)
      }));
    }

    if (!candidates.length) {
      results.push({ claim, verdict: 'no-factcheck', matches: [], note: 'No published fact-check found for this claim.' });
      continue;
    }

    const { matched, explanation } = await matchFactChecks(claim, candidates);
    if (!matched.length) {
      results.push({
        claim,
        verdict: 'no-factcheck',
        matches: [],
        note: 'Fact-checks exist on this topic, but none address this specific claim.'
      });
      continue;
    }

    // Use the most severe verdict among genuine matches — if any fact-checker
    // called it false, that is the finding that matters.
    const order = ['false', 'mostly-false', 'mixed', 'unrated', 'mostly-true', 'true'];
    const worst = matched.reduce((acc, m) =>
      order.indexOf(m.verdict) < order.indexOf(acc) ? m.verdict : acc, 'true');

    results.push({
      claim,
      verdict: worst,
      matches: matched.map(m => ({
        publisher: m.publisher,
        rating: m.rating,
        verdict: m.verdict,
        title: m.title || m.claimText,
        url: m.url,
        reviewDate: m.reviewDate
      })),
      note: explanation
    });
  }

  // Aggregate into a 0-10 factor score.
  let score = 5;
  let debunked = 0, confirmed = 0, unchecked = 0;
  for (const r of results) {
    const delta = VERDICT_WEIGHTS[r.verdict];
    if (delta === undefined) { unchecked++; continue; }
    score += delta;
    if (delta < 0) debunked++;
    else if (delta > 0) confirmed++;
  }
  score = Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;

  const informative = debunked > 0 || confirmed > 0;
  const status = debunked > 0 ? 'debunked' : confirmed > 0 ? 'confirmed' : 'no-factcheck';

  const parts = [];
  if (debunked) parts.push(`${debunked} claim(s) already rated false or misleading by fact-checkers`);
  if (confirmed) parts.push(`${confirmed} claim(s) confirmed by fact-checkers`);
  if (!informative) parts.push('No professional fact-check covers these specific claims');

  // Name the route the evidence came from — the aggregator and the direct read
  // differ in coverage, and a reader (or a reviewer) should be able to tell.
  const evidenceSource = sourcesUsed.has('google') && sourcesUsed.has('claimreview')
    ? 'both'
    : sourcesUsed.has('google') ? 'google'
    : sourcesUsed.has('claimreview') ? 'claimreview'
    : (hasGoogleKey ? 'google' : 'claimreview');

  return {
    score,
    status,
    checkedClaims: results,
    explanation: parts.join('; ') + '.',
    informative,
    evidenceSource
  };
};

module.exports = { checkAgainstFactCheckers, searchFactChecks, normaliseRating };
