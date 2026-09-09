// backend/utils/newsFetcher.js
const axios = require('axios');
require('dotenv').config();

/**
 * Turn a NewsAPI failure into something a reader can act on.
 *
 * The free tier allows 100 requests per 24 hours across the whole application —
 * the feed, cross-source verification and fact-check lookups all draw on it. It
 * is a condition that will happen, so it deserves a real message rather than a
 * bare "something went wrong".
 */
const describeNewsApiError = (err) => {
  const status = err.response?.status;
  const raw = err.response?.data;
  // Over quota the service sometimes answers 429 with JSON and sometimes 5xx
  // with an HTML error page. An HTML body carries nothing worth showing, so
  // only trust a structured message.
  const body = (raw && typeof raw === 'object') ? raw : {};
  const isHtmlBody = typeof raw === 'string' && /<html|<!doctype/i.test(raw);
  const detail = String(body.message || (isHtmlBody ? '' : err.message) || '');

  if (status === 429 || /too many requests|rate ?limit/i.test(detail)) {
    const e = new Error("Today's news quota is used up. The free news feed allows 100 requests a day; it resets 24 hours after the first one. Articles already analysed still open normally.");
    e.code = 'NEWS_QUOTA_EXHAUSTED';
    e.httpStatus = 429;
    return e;
  }
  if (status === 401 || body.code === 'apiKeyInvalid' || body.code === 'apiKeyMissing') {
    const e = new Error('The news API key is missing or invalid. Set NEWS_API_KEY in backend/.env.');
    e.code = 'NEWS_KEY_INVALID';
    e.httpStatus = 500;
    return e;
  }
  const e = new Error(
    detail ||
    'The news service is not responding. This often means the free daily request limit (100 per 24 hours) has been reached. Articles already analysed still open normally.'
  );
  e.code = 'NEWS_UNAVAILABLE';
  e.httpStatus = 502;
  return e;
};

const fetchTopNews = async (category = 'general') => {
  const apiKey = process.env.NEWS_API_KEY;

  const url = `https://newsapi.org/v2/top-headlines?category=${category}&language=en&pageSize=30&apiKey=${apiKey}`;

  let response;
  try {
    response = await axios.get(url);
  } catch (err) {
    throw describeNewsApiError(err);
  }

  return response.data.articles.map(article => ({
    title: article.title,
    description: article.description,
    content: article.content,
    url: article.url,
    urlToImage: article.urlToImage,
    source: { name: article.source.name },
    publishedAt: article.publishedAt
  }));
};

/**
 * Search all indexed articles for coverage of a topic/claim (NewsAPI "everything" endpoint).
 * Used by cross-source verification to find how OTHER outlets report the same story.
 * @param {string} query - Search keywords
 * @param {string} [excludeSourceName] - Source name to filter out (the article's own outlet)
 * @param {number} [pageSize=10] - Max results
 * @returns {Promise<Array<{title: string, description: string, url: string, source: string, publishedAt: string}>>}
 */
const searchNewsCoverage = async (query, excludeSourceName = '', pageSize = 10) => {
  const apiKey = process.env.NEWS_API_KEY;
  const url = 'https://newsapi.org/v2/everything';

  try {
    const response = await axios.get(url, {
      params: {
        q: query,
        language: 'en',
        sortBy: 'relevancy',
        pageSize,
        apiKey
      }
    });

    const exclude = String(excludeSourceName || '').toLowerCase();
    return (response.data.articles || [])
      .filter(a => a.title && a.source && String(a.source.name).toLowerCase() !== exclude)
      .map(a => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: a.source.name,
        publishedAt: a.publishedAt
      }));
  } catch (error) {
    console.error('News coverage search failed:', error.response?.data?.message || error.message);
    return [];
  }
};

/**
 * Search coverage, progressively broadening the query until enough outlets
 * are found. NewsAPI requires EVERY term in `q` to match, so a long keyword
 * list (6+ words) usually returns nothing — dropping the least distinctive
 * trailing terms recovers real coverage.
 * @param {string} query - Search keywords, most distinctive first
 * @param {string} [excludeSourceName] - Source to filter out
 * @param {number} [pageSize=10] - Max results per attempt
 * @param {number} [minOutlets=2] - Stop as soon as this many distinct outlets are found
 * @returns {Promise<{articles: Array, query: string}>} results plus the query that produced them
 */
const searchCoverageBroadening = async (query, excludeSourceName = '', pageSize = 10, minOutlets = 2) => {
  const terms = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { articles: [], query: '' };

  // Try the full phrase first, then progressively shorter prefixes (4, 3, 2 terms).
  const attempts = [];
  for (const len of [terms.length, 4, 3, 2]) {
    if (len > 0 && len <= terms.length) {
      const attempt = terms.slice(0, len).join(' ');
      if (!attempts.includes(attempt)) attempts.push(attempt);
    }
  }

  let best = { articles: [], query: attempts[0] };
  for (const attempt of attempts) {
    const articles = await searchNewsCoverage(attempt, excludeSourceName, pageSize);
    const outletCount = new Set(articles.map(a => String(a.source).toLowerCase())).size;
    if (articles.length > best.articles.length) best = { articles, query: attempt };
    if (outletCount >= minOutlets) return { articles, query: attempt };
  }
  return best;
};

module.exports = { fetchTopNews, searchNewsCoverage, searchCoverageBroadening };
