// backend/utils/claimReviewReader.js
//
// A second source of published fact-checks, for when Google's Fact Check Tools
// API is not configured.
//
// Why this exists
// ---------------
// The primary source is Google's API, which indexes ClaimReview markup from
// hundreds of IFCN signatories. It needs an API key. Without one the whole
// fact-check factor stands down, so a deployment that has not set that key up
// never sees the seventh check at all.
//
// ClaimReview is a public schema.org type, and fact-checkers publish it in the
// page itself — so the rating can be read straight from the source rather than
// from an aggregator. This module finds candidate fact-check pages through the
// news search already in use, then reads the rating out of each page's own
// structured markup.
//
// The important property is preserved: the verdict is still written by a human
// fact-checker. Nothing here asks a model what is true. A page with no
// ClaimReview markup (a collection page, a news write-up) yields no rating and
// is simply skipped, rather than having a rating guessed for it.
//
// This is a fallback, not an equal. Coverage is narrower than Google's index —
// measured against NewsAPI, Snopes is well represented, FactCheck.org and Full
// Fact thinly, PolitiFact not at all — and it costs one page fetch per
// candidate. Prefer the API key where it is available.
const axios = require('axios');
const { assertPublicUrl } = require('./articleExtractor');

// IFCN signatories and established fact-check desks that publish ClaimReview.
const FACT_CHECK_DOMAINS = [
  'snopes.com',
  'factcheck.org',
  'fullfact.org',
  'politifact.com',
  'leadstories.com',
  'checkyourfact.com',
  'truthorfiction.com',
  'apnews.com'
];

const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;
const PAGE_TIMEOUT = 12000;
// Each candidate costs a page fetch, so keep the fan-out small.
const MAX_PAGES = 4;

/**
 * Pull every ClaimReview node out of a page's JSON-LD.
 * Handles the three shapes publishers actually use: a bare object, an array,
 * and an @graph wrapper.
 * @param {string} html
 * @returns {Array<Object>} ClaimReview nodes
 */
const extractClaimReviews = (html) => {
  const found = [];
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRe.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch (_) {
      continue;   // a malformed block is not worth failing the page over
    }

    const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const type = node['@type'];
      const isClaimReview = type === 'ClaimReview' ||
        (Array.isArray(type) && type.includes('ClaimReview'));
      if (isClaimReview) found.push(node);
    }
  }
  return found;
};

/**
 * Tidy a citation URL. Publishers sometimes emit a doubled slash in their own
 * ClaimReview markup ("snopes.com//fact-check/..."); the link works either way
 * but it looks careless printed next to a verdict.
 */
const tidyUrl = (raw) => {
  const url = String(raw || '').trim();
  if (!url) return '';
  return url.replace(/([^:])\/{2,}/g, '$1/');
};

/** The publisher's own words for its rating, e.g. "False", "Mostly True". */
const ratingTextOf = (review) => {
  const r = review.reviewRating || {};
  if (r.alternateName) return String(r.alternateName);
  // Some publishers give only a numeric scale; express it in their terms.
  if (r.ratingValue !== undefined && r.bestRating !== undefined) {
    return `${r.ratingValue} of ${r.bestRating}`;
  }
  if (r.ratingValue !== undefined) return String(r.ratingValue);
  return '';
};

/**
 * Read the ClaimReview ratings published on one fact-check page.
 * @param {string} url
 * @returns {Promise<Array>} zero or more {claimText, rating, publisher, url}
 */
const readFactCheckPage = async (url, publisherHint = '') => {
  await assertPublicUrl(url);   // same guard the article reader uses

  const response = await axios.get(url, {
    timeout: PAGE_TIMEOUT,
    maxRedirects: 3,
    maxContentLength: MAX_PAGE_BYTES,
    responseType: 'text',
    // Some fact-check sites serve a stub to unrecognised clients.
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PurePress/1.0; +trust-analysis)' },
    validateStatus: (s) => s >= 200 && s < 400
  });

  return extractClaimReviews(response.data)
    .map(review => ({
      claimText: String(review.claimReviewed || '').trim(),
      rating: ratingTextOf(review),
      publisher: review.author?.name || review.publisher?.name || publisherHint || 'Fact-checker',
      url: tidyUrl(review.url || url),
      reviewDate: review.datePublished || null
    }))
    // A review with no claim or no rating tells the reader nothing.
    .filter(r => r.claimText && r.rating);
};

/**
 * Find published fact-checks for a query by searching fact-checker domains and
 * reading the ClaimReview markup on each result.
 * @param {string} query - distinctive keywords from the claim
 * @param {number} maxResults
 * @returns {Promise<Array>} fact-check records in the same shape the Google path returns
 */
const searchClaimReviews = async (query, maxResults = 6) => {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey || !query) return [];

  let candidates = [];
  try {
    const { data } = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query,
        domains: FACT_CHECK_DOMAINS.join(','),
        language: 'en',
        sortBy: 'relevancy',
        pageSize: MAX_PAGES * 2,
        apiKey
      },
      timeout: 12000
    });
    candidates = data.articles || [];
  } catch (err) {
    console.error('Fact-check domain search failed:',
      err.response?.data?.message || err.message);
    return [];
  }

  const reviews = [];
  // Sequential: these are third-party sites, and a burst of parallel requests
  // is both rude and more likely to be throttled.
  for (const candidate of candidates.slice(0, MAX_PAGES)) {
    if (reviews.length >= maxResults) break;
    if (!candidate.url) continue;
    try {
      const found = await readFactCheckPage(candidate.url, candidate.source?.name);
      reviews.push(...found);
    } catch (err) {
      // A page that will not load or carries no markup is not an error worth
      // surfacing — it simply contributes nothing.
      continue;
    }
  }

  return reviews.slice(0, maxResults);
};

module.exports = {
  searchClaimReviews,
  extractClaimReviews,
  readFactCheckPage,
  FACT_CHECK_DOMAINS
};
