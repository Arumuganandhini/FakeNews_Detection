const express = require('express');
const router = express.Router();

const summarizeArticle = require('../agents/summarizeAgent');
const checkCredibility = require('../agents/credibilityAgent');
const generateDetailedSummary = require('../agents/detailedSummaryAgent');
const generateQuiz = require('../agents/quizAgent');
const generatePromptQuiz = require('../agents/promptQuizAgent');
const { analyzeTrust, REPORT_SCHEMA_VERSION } = require('../agents/trustAnalysisAgent');

/** A cached report is only usable if it came from the current pipeline. */
const isCurrent = (report) => report && report.schemaVersion === REPORT_SCHEMA_VERSION;
const { compareCoverage } = require('../agents/compareCoverageAgent');
const { getSourceReputation } = require('../agents/sourceReputationAgent');
const { extractArticle } = require('../utils/articleExtractor');
const { resolveArticleText, limitText, TEXT_BUDGET } = require('../utils/articleText');
const TrustReportCache = require('../models/TrustReportCache');
const SummaryCache = require('../models/SummaryCache');
const auth = require('../middleware/auth');

// When a reader double-clicks, opens the same story in two tabs, or two feed
// cards request the same report together, run one analysis and share its
// promise. This saves model capacity without changing what is analysed.
const inFlightTrustReports = new Map();
const inFlightSummaries = new Map();

/**
 * Summarise once per article and reuse the result.
 *
 * Regenerating on every page load meant a reader who returned to an article saw
 * a different summary from the one they read before — which looks like the
 * system changing its mind. Caching by URL makes it stable and instant.
 *
 * Requests that carry no URL (a pasted body with nothing to key on) simply run
 * uncached rather than failing.
 */
const summariseWithCache = async (kind, { url, title, text }, generate) => {
  const clean = sanitizeContent(text);
  if (!clean) throw new Error('Article content is required');

  // Cache first — a hit costs nothing and skips the page fetch entirely.
  if (url) {
    const hit = await SummaryCache.findOne({ articleUrl: url, kind }).lean();
    if (hit) {
      return {
        summary: hit.summary,
        cached: true,
        sourceText: { chars: hit.summary.length, coverage: 'cached' }
      };
    }
  }

  // The feed supplies ~200 characters, which is why the "long" summary used to
  // come back the same length as the short one — both were working from the
  // same stub. Fetch the article itself so there is something to be detailed
  // about; falls back to the snippet when the page cannot be read.
  const resolved = await resolveArticleText({ url, title, fallback: clean });
  const body = limitText(resolved.text || clean, TEXT_BUDGET.summary);
  const sourceText = {
    chars: resolved.chars,
    coverage: resolved.source === 'full' ? 'article-text' : 'publisher-excerpt'
  };

  const key = url ? `${kind}:${url}` : null;
  let job = key && inFlightSummaries.get(key);
  if (!job) {
    job = generate(body);
    if (key) {
      inFlightSummaries.set(key, job);
      job.then(
        () => inFlightSummaries.delete(key),
        () => inFlightSummaries.delete(key)
      );
    }
  }
  const summary = await job;

  if (url && summary) {
    // Awaited for the same reason as the trust report: a reader who reloads at
    // once must hit the cache, not regenerate. Failure is never fatal.
    await SummaryCache.updateOne(
      { articleUrl: url, kind },
      { $set: { articleUrl: url, kind, summary, createdAt: new Date() } },
      { upsert: true }
    ).catch(err => console.error('Summary cache write failed:', err.message));
  }

  return { summary, cached: false, sourceText };
};

// NewsAPI truncates article bodies and appends markers like "[+7500 chars]".
// These confuse the LLM and end up inside its JSON output, causing parse
// failures. Strip them before any text reaches an agent.
const sanitizeContent = (text) => {
  if (!text) return text;
  return text.replace(/\[\+\d+\s*chars?\]/gi, '').trim();
};

router.post('/summarize', async (req, res) => {
  const { article, url, title } = req.body;
  if (!article) {
    return res.status(400).json({ error: 'Article content is required' });
  }
  try {
    const result = await summariseWithCache('short', { url, title, text: article }, summarizeArticle);
    res.json(result);
  } catch (err) {
    console.error('Summarize failed:', err.message);
    res.status(500).json({ error: 'Failed to summarize article.' });
  }
});

router.post('/credibility', async (req, res) => {
  const { title, content, source } = req.body;
  try {
    const { score, reasoning } = await checkCredibility(title, content, source);
    res.json({ score, reasoning }); // Send flat { score, reasoning }
  } catch (err) {
    res.status(500).json({ error: 'Failed to check credibility.' });
  }
});

// Full explainable trust analysis: source reputation + clickbait + bias +
// cross-source claim verification, aggregated into a weighted trust score.
// Results are cached by article URL so the analysis runs once per article
// and every later reader gets it instantly.
router.post('/trust-analysis', async (req, res) => {
  const { title, content, source, url } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Article title is required.' });
  }
  try {
    if (url) {
      const cached = await TrustReportCache.findOne({ articleUrl: url }).lean();
      // A report from an older pipeline is missing factors this one reports,
      // so re-analyse rather than showing an outdated breakdown.
      if (cached && isCurrent(cached.report)) {
        return res.json({ ...cached.report, cached: true });
      }
    }

    // Coalesce duplicate work for the same article. A URL is the normal key;
    // pasted articles without one deliberately remain independent.
    let job = url && inFlightTrustReports.get(url);
    if (!job) {
      // Give the factors the real article rather than the feed's ~200-character
      // stub. This costs one page fetch (1-3s, no model call) and is what lets
      // transparency, bias and persuasion checks see actual sourcing.
      job = resolveArticleText({ url, title, fallback: sanitizeContent(content) })
        .then(resolved => analyzeTrust({
          title,
          content: limitText(resolved.text || content, TEXT_BUDGET.factors),
          source,
          url,
          textCoverage: resolved.source
        }));
      if (url) {
        inFlightTrustReports.set(url, job);
        job.then(
          () => inFlightTrustReports.delete(url),
          () => inFlightTrustReports.delete(url)
        );
      }
    }
    const report = await job;

    if (url) {
      // Awaited, not fire-and-forget. Responding first left a window where a
      // reader who refreshed immediately missed the cache and paid for a second
      // full analysis. The upsert costs a few milliseconds against an analysis
      // measured in seconds. A write failure is still never fatal.
      await TrustReportCache.updateOne(
        { articleUrl: url },
        { $set: { articleUrl: url, title, source, report, createdAt: new Date() } },
        { upsert: true }
      ).catch(err => console.error('Trust cache write failed:', err.message));
    }

    res.json({ ...report, cached: false });
  } catch (err) {
    console.error('Trust analysis failed:', err);
    res.status(500).json({ error: 'Failed to run trust analysis.' });
  }
});

// The same analysis, streamed.
//
// A full analysis takes seconds, and the reader used to see nothing at all
// until every check had finished. This sends each check the moment it lands, so
// the page fills in progressively instead of holding a spinner.
//
// Newline-delimited JSON rather than Server-Sent Events, because the article
// body has to be POSTed and the browser's EventSource is GET-only. The client
// reads it with fetch() and a stream reader.
router.post('/trust-analysis/stream', async (req, res) => {
  const { title, content, source, url } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Article title is required.' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');   // stop proxies buffering the stream
  res.flushHeaders?.();

  // Watch the RESPONSE for the client going away, not the request. A request
  // stream emits 'close' as soon as its body has been read, which for a POST is
  // immediately — listening there suppressed every single event.
  let closed = false;
  res.on('close', () => { closed = true; });
  const emit = (event) => {
    if (closed || res.writableEnded) return;
    res.write(JSON.stringify(event) + '\n');
  };

  try {
    if (url) {
      const cached = await TrustReportCache.findOne({ articleUrl: url }).lean();
      if (cached && isCurrent(cached.report)) {
        emit({ type: 'report', report: { ...cached.report, cached: true } });
        return res.end();
      }
    }

    emit({ type: 'start', total: 6 });

    const resolved = await resolveArticleText({ url, title, fallback: sanitizeContent(content) });
    emit({ type: 'source-text', coverage: resolved.source, chars: resolved.chars });

    const report = await analyzeTrust({
      title,
      content: limitText(resolved.text || content, TEXT_BUDGET.factors),
      source,
      url,
      textCoverage: resolved.source,
      onProgress: (step) => emit({ type: 'progress', ...step })
    });

    if (url) {
      await TrustReportCache.updateOne(
        { articleUrl: url },
        { $set: { articleUrl: url, title, source, report, createdAt: new Date() } },
        { upsert: true }
      ).catch(err => console.error('Trust cache write failed:', err.message));
    }

    emit({ type: 'report', report: { ...report, cached: false } });
    res.end();
  } catch (err) {
    console.error('Streamed trust analysis failed:', err.message);
    // The stream is already open, so the failure is reported inside it rather
    // than as a status code the client will never look at.
    emit({ type: 'error', error: 'Failed to run trust analysis.' });
    res.end();
  }
});

// Read any news link the user pastes (e.g. shared on WhatsApp) and return it
// in the same shape as a feed article, so the normal article flow — summary,
// trust check, coverage comparison — works on it unchanged.
router.post('/extract-article', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please paste a news link.' });
  }
  try {
    const article = await extractArticle(url.trim());
    res.json({ article });
  } catch (err) {
    // When a publisher blocks automated reading we still know who published
    // it — report that rather than leaving the reader with nothing.
    if (err.code === 'FETCH_BLOCKED') {
      const reputation = getSourceReputation(err.hostname, err.url);
      return res.status(422).json({
        error: err.message,
        partial: {
          sourceName: reputation.matched ? reputation.matchedName : err.hostname.replace(/^www\./, ''),
          matched: reputation.matched,
          score: reputation.score,
          bias: reputation.matched ? reputation.bias : null,
          note: reputation.matched
            ? `What we can tell you: ${reputation.matchedName} is rated ${reputation.score}/10 for factual reporting${reputation.bias && reputation.bias !== 'unknown' ? `, with a ${reputation.bias} editorial lean` : ''}.`
            : 'We also have no reliability record for this publisher, so treat the article with extra care.'
        }
      });
    }
    // Other messages are already written for the reader.
    res.status(422).json({ error: err.message });
  }
});

// Feed badges: for a list of articles, return what we can show immediately —
// the full cached score when the article has been analyzed before, otherwise
// an instant source-reputation hint. No LLM calls, so this stays fast enough
// to run for a whole page of articles.
router.post('/trust-badges', async (req, res) => {
  const { articles } = req.body;
  if (!Array.isArray(articles)) {
    return res.status(400).json({ error: 'articles array is required.' });
  }
  try {
    const urls = articles.map(a => a && a.url).filter(Boolean);
    const cached = await TrustReportCache.find({ articleUrl: { $in: urls } })
      .select('articleUrl report')
      .lean();
    const cacheByUrl = new Map(
      cached.filter(c => isCurrent(c.report)).map(c => [c.articleUrl, c.report])
    );

    const badges = articles.filter(Boolean).map(article => {
      const hit = article.url && cacheByUrl.get(article.url);
      if (hit) {
        return {
          url: article.url,
          kind: 'analyzed',
          score: hit.overallScore,
          verdict: hit.verdict,
          level: hit.verdictLevel,
          concernCount: (hit.concernPoints || []).length
        };
      }

      const sourceName = article.source?.name || article.source;
      const reputation = getSourceReputation(sourceName, article.url);
      return {
        url: article.url,
        kind: 'source-only',
        score: reputation.score,
        sourceMatched: reputation.matched,
        sourceName: reputation.matchedName,
        bias: reputation.matched ? reputation.bias : null,
        label: reputation.matched
          ? (reputation.score >= 7.5 ? 'Reliable source'
            : reputation.score >= 5 ? 'Mixed record'
            : 'Low-rated source')
          : 'Unrated source'
      };
    });

    res.json({ badges });
  } catch (err) {
    console.error('Trust badges failed:', err);
    res.status(500).json({ error: 'Failed to load trust badges.' });
  }
});

// Compare Coverage: how different outlets reported the same story, each with
// its source reputation and headline quality, plus a framing comparison.
router.post('/compare-coverage', async (req, res) => {
  const { title, query, source, url } = req.body;
  if (!title && !query) {
    return res.status(400).json({ error: 'An article title or a search query is required.' });
  }
  try {
    const report = await compareCoverage({ title, query, source, url });
    res.json(report);
  } catch (err) {
    console.error('Coverage comparison failed:', err);
    res.status(500).json({ error: 'Failed to compare coverage.' });
  }
});

router.post('/detailed-summary', async (req, res) => {
  try {
    const { article, url, title } = req.body;
    if (!article) {
      return res.status(400).json({ error: 'Article content is required' });
    }

    const result = await summariseWithCache('detailed', { url, title, text: article }, generateDetailedSummary);
    res.json(result);
  } catch (error) {
    console.error('Error generating detailed summary:', error);
    res.status(500).json({ error: 'Failed to generate detailed summary' });
  }
});

router.post('/quiz', async (req, res) => {
  try {
    const { detailedSummary } = req.body;
    if (!detailedSummary) {
      return res.status(400).json({ error: 'Detailed summary is required' });
    }

    const quiz = await generateQuiz(detailedSummary);
    res.json({ quiz });
  } catch (error) {
    console.error('Error generating quiz:', error);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

// Generate quiz from user prompt
router.post('/generate-prompt-quiz', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    const quizData = await generatePromptQuiz(prompt);
    
    // Ensure the response format is correct
    if (!quizData || !quizData.questions || !Array.isArray(quizData.questions)) {
      console.error('Invalid quiz data format:', quizData);
      return res.status(500).json({ error: 'Failed to generate quiz: Invalid format' });
    }
    
    // Return the quiz data directly
    res.json(quizData);
  } catch (error) {
    console.error('Error generating prompt quiz:', error);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

module.exports = router;
