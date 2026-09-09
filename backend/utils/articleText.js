// backend/utils/articleText.js
//
// One place that answers "what is the actual text of this article?".
//
// The news feed gives roughly 200 characters and a "[+8026 chars]" marker. Every
// consumer downstream — the two summaries and all six trust factors — was
// working from that stub. Measured against real articles, fetching the page
// instead yields 2,000-6,000 characters for 1-3 seconds and no model call.
//
// The result is cached per URL, so the fetch happens once per article rather
// than once per reader. When a page cannot be fetched (paywall, blocked, dead
// link) the feed snippet is used and the caller is told which it got, so it can
// be honest about a summary that is short because the source was short.
const ArticleTextCache = require('../models/ArticleTextCache');
const { extractArticle } = require('./articleExtractor');

/** Strip the news feed's truncation marker; it is not part of the article. */
const stripMarker = (text) =>
  String(text || '').replace(/\[\+\d+\s*chars?\]/gi, '').trim();

// Below this, a "full" page fetch has not actually told us more than the feed
// did — a consent wall or a stub page — so the snippet is just as good.
const MIN_USEFUL_CHARS = 400;

// How much of the article each consumer should receive.
//
// More text is not uniformly better. The model in use reasons before it answers,
// and its reply budget is shared between that reasoning and the JSON it must
// produce. Handing the trust factors the full 6,000-character article made them
// reason at length and run out of budget before emitting any JSON — the logs
// filled with "No JSON found" and factors fell back to the pattern checks.
//
// So each consumer gets what it can actually use: summarising benefits from a
// lot of text, while the factor checks read sourcing, tone and framing, which
// are established in the opening paragraphs.
// Measured against the article body on the current model:
//
//     input   short summary        detailed summary
//      800    6.8s, 361 chars      3.6s, 504 chars      <- both good
//     1500    9.6s, 666 chars      32.7s, EMPTY         <- detailed collapses
//     3000    32.8s, NO JSON       23.9s, EMPTY         <- both collapse
//
// Past roughly 800 characters this model spends its reply budget reasoning and
// never reaches the JSON, so more text is not just slower — it returns nothing.
// 900 sits inside the working range and is still four to five times the ~200
// characters the news feed supplies.
const TEXT_BUDGET = {
  summary: 900,
  factors: 900
};

/**
 * Does the fetched text actually belong to this article?
 *
 * Page extraction is not reliable enough to trust blindly. On an AP article
 * about the Pope it returned the page's navigation instead — a list of other
 * headlines plus newsletter promotions — and the summary that came back
 * confidently described a Canadian trade dispute. A wrong summary is far worse
 * than a short one, so text that does not carry the headline's distinctive
 * words is rejected and the feed snippet is used instead.
 *
 * @param {string} text  - candidate article text
 * @param {string} title - the article's headline
 * @returns {boolean}
 */
const looksLikeTheArticle = (text, title) => {
  if (!title) return true;   // nothing to check against; accept

  const stop = new Set(['the','a','an','and','or','of','to','in','on','for','with',
    'at','by','from','as','is','are','was','were','be','been','it','its','that',
    'this','after','over','into','out','up','down','new','says','say','said']);

  const words = String(title).toLowerCase().match(/[a-z']{4,}/g) || [];
  const distinctive = [...new Set(words.filter(w => !stop.has(w)))];
  if (distinctive.length < 2) return true;   // too generic to judge

  const haystack = String(text).toLowerCase();
  const hits = distinctive.filter(w => haystack.includes(w)).length;
  // Half the headline's distinctive words should appear in its own body.
  return hits / distinctive.length >= 0.5;
};

/** Trim to a budget on a sentence boundary where possible. */
const limitText = (text, budget) => {
  const t = String(text || '');
  if (t.length <= budget) return t;
  const cut = t.slice(0, budget);
  const lastStop = cut.lastIndexOf('. ');
  return (lastStop > budget * 0.6 ? cut.slice(0, lastStop + 1) : cut).trim();
};

/**
 * Resolve the best available text for an article.
 *
 * @param {Object} opts
 * @param {string} [opts.url]      - article URL; without it only the snippet is available
 * @param {string} [opts.title]    - headline, used to confirm the fetch is the right page
 * @param {string} [opts.fallback] - the feed's snippet/description
 * @param {boolean} [opts.allowFetch=true] - set false to skip the network entirely
 * @returns {Promise<{text: string, source: 'full'|'snippet', chars: number}>}
 */
const resolveArticleText = async ({ url, title = '', fallback = '', allowFetch = true }) => {
  const snippet = stripMarker(fallback);
  const asSnippet = () => ({ text: snippet, source: 'snippet', chars: snippet.length });

  if (!url || !allowFetch) return asSnippet();

  // Previously resolved? Reuse it — including a previous failure, so a page
  // that cannot be read is not re-fetched on every visit.
  try {
    const hit = await ArticleTextCache.findOne({ articleUrl: url }).lean();
    if (hit) {
      return hit.status === 'ok' && hit.chars >= MIN_USEFUL_CHARS
        ? { text: hit.text, source: 'full', chars: hit.chars }
        : asSnippet();
    }
  } catch (err) {
    console.error('Article text cache read failed:', err.message);
  }

  let resolved = asSnippet();
  let record = { status: 'unavailable', text: '', chars: 0 };

  try {
    const article = await extractArticle(url);
    const full = stripMarker(article?.content);
    if (full.length >= MIN_USEFUL_CHARS && full.length > snippet.length
        && looksLikeTheArticle(full, title || article?.title)) {
      resolved = { text: full, source: 'full', chars: full.length };
      record = { status: 'ok', text: full, chars: full.length };
    }
  } catch (err) {
    // Paywalled, blocked, or unreachable. Not an error worth failing over —
    // the snippet still works, it is just thinner.
    console.warn('Full text unavailable, using the feed snippet:', err.message);
  }

  if (record.status === 'unavailable' && url) {
    console.warn(`Fetched page did not match the headline; using the feed snippet for ${url}`);
  }

  ArticleTextCache.updateOne(
    { articleUrl: url },
    { $set: { articleUrl: url, ...record, createdAt: new Date() } },
    { upsert: true }
  ).catch(err => console.error('Article text cache write failed:', err.message));

  return resolved;
};

module.exports = {
  resolveArticleText, stripMarker, limitText, looksLikeTheArticle,
  TEXT_BUDGET, MIN_USEFUL_CHARS
};
