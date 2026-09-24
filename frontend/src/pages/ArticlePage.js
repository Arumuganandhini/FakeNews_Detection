import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import TrustReport from '../components/TrustReport';
import PageShell from '../components/PageShell';
import '../styles/ArticlePage.css';

const BASE_URL = process.env.REACT_APP_API_URL ||
  (window.location.hostname.includes('onrender.com')
    ? 'https://news-curator-deployed.onrender.com'
    : 'http://localhost:5000');

/**
 * Run a streamed trust analysis, reporting each check as the server finishes it.
 *
 * The endpoint answers with newline-delimited JSON rather than Server-Sent
 * Events, because the article body must be POSTed and EventSource is GET-only.
 * If streaming is unavailable for any reason the caller falls back to the plain
 * endpoint, so an older browser or a proxy that buffers still works.
 *
 * @param {Object} body     - the analysis request
 * @param {Object} headers  - auth headers
 * @param {Function} onStep - called with {id, name, ms} per completed check
 * @returns {Promise<Object>} the finished report
 */
const streamTrustAnalysis = async (body, headers, onStep) => {
  const response = await fetch(`${BASE_URL}/api/ai/trust-analysis/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

  if (!response.ok || !response.body) {
    const plain = await axios.post(`${BASE_URL}/api/ai/trust-analysis`, body, { headers });
    return plain.data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let report = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let event;
      try { event = JSON.parse(line); } catch (_) { continue; }

      if (event.type === 'progress') onStep(event);
      else if (event.type === 'report') report = event.report;
      else if (event.type === 'error') throw new Error(event.error);
    }
  }

  if (!report) throw new Error('The analysis ended without a report.');
  return report;
};

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ''
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

/**
 * One article: what it says, and whether it holds up.
 *
 * The verdict comes first. It used to sit at the bottom of the right-hand
 * column, below the summary and the reader comments, so the answer the page
 * exists to give was the last thing on it.
 */
const ArticlePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const startTime = location.state?.startTime || Date.now();

  // The article used to live only in router state, and the address bar said
  // "/article" with nothing after it. Reloading the page, bookmarking it,
  // opening it in a new tab or sending the link to anyone all produced a blank
  // page that bounced back to the front page. The URL now carries the story,
  // and the page fetches it when it arrives without state.
  const linkedUrl = new URLSearchParams(location.search).get('u');
  const [article, setArticle] = useState(location.state?.article || null);
  const [recovering, setRecovering] = useState(Boolean(!location.state?.article && linkedUrl));
  const [recoveryFailed, setRecoveryFailed] = useState(false);

  useEffect(() => {
    if (article || !linkedUrl) return;
    let cancelled = false;
    setRecovering(true);
    axios.post(`${BASE_URL}/api/ai/extract-article`, { url: linkedUrl })
      .then(res => { if (!cancelled) setArticle(res.data.article); })
      .catch(err => {
        console.error('Could not reopen that article:', err);
        if (!cancelled) setRecoveryFailed(true);
      })
      .finally(() => { if (!cancelled) setRecovering(false); });
    return () => { cancelled = true; };
  }, [article, linkedUrl]);

  const [summary, setSummary] = useState('');
  const [detailedSummary, setDetailedSummary] = useState('');
  const [summarySourceText, setSummarySourceText] = useState(null);
  const [report, setReport] = useState(null);
  // The six checks, filled in as the server reports each one finishing, so the
  // reader watches the report being built instead of waiting on a spinner.
  const [completedChecks, setCompletedChecks] = useState([]);
  const [busy, setBusy] = useState({ summary: true, detailedSummary: false, report: true });
  const [failed, setFailed] = useState({});

  // Which article the page is showing. Replies for anything else are dropped —
  // these calls take seconds, and a late one would otherwise land under the
  // next article's headline.
  const latestRequest = useRef(article?.url);
  useEffect(() => { latestRequest.current = article?.url; }, [article]);

  const trackActivity = useCallback(async (activityType, duration = 0) => {
    const token = localStorage.getItem('token');
    if (!token || !article) return;
    try {
      await axios.post(`${BASE_URL}/api/tracking/activity`, {
        articleId: article.url,
        title: article.title,
        category: article.category || 'general',
        source: article.source?.name || 'Unknown Source',
        activityType,
        duration,
        completed: activityType === 'read'
      }, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      // Reading statistics are not worth interrupting a reader for.
      console.warn('Could not record this view:', err.message);
    }
  }, [article]);

  const runSummary = useCallback(async (kind) => {
    if (!article) return;
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const endpoint = kind === 'detailedSummary' ? 'detailed-summary' : 'summarize';
    const body = {
      article: article.content || article.description || article.title,
      url: article.url,
      title: article.title
    };

    setBusy(prev => ({ ...prev, [kind]: true }));
    setFailed(prev => ({ ...prev, [kind]: false }));
    try {
      const response = await axios.post(`${BASE_URL}/api/ai/${endpoint}`, body, { headers });
      if (latestRequest.current !== article.url) return;
      if (kind === 'detailedSummary') {
        setDetailedSummary(response.data.summary);
      } else {
        setSummary(response.data.summary);
        setSummarySourceText(response.data.sourceText || null);
      }
    } catch (err) {
      console.error(`${kind} failed:`, err);
      if (latestRequest.current === article.url) setFailed(prev => ({ ...prev, [kind]: true }));
    } finally {
      setBusy(prev => ({ ...prev, [kind]: false }));
    }
  }, [article]);

  const runReport = useCallback(async () => {
    if (!article) return;
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    setBusy(prev => ({ ...prev, report: true }));
    setFailed(prev => ({ ...prev, report: false }));
    setCompletedChecks([]);
    try {
      const finished = await streamTrustAnalysis({
        title: article.title,
        content: article.content || article.description || article.title,
        source: article.source?.name || article.source || 'Unknown',
        url: article.url
      }, headers, (step) => {
        if (latestRequest.current !== article.url) return;
        setCompletedChecks(prev => (prev.some(c => c.id === step.id) ? prev : [...prev, step]));
      });
      if (latestRequest.current !== article.url) return;
      setReport(finished);
    } catch (err) {
      console.error('Trust analysis failed:', err);
      if (latestRequest.current === article.url) setFailed(prev => ({ ...prev, report: true }));
    } finally {
      setBusy(prev => ({ ...prev, report: false }));
    }
  }, [article]);

  useEffect(() => {
    // Only give up when there is nothing to work from at all.
    if (!article && !linkedUrl) navigate('/home');
  }, [article, linkedUrl, navigate]);

  // Both start on their own. A reader should never have to ask the paper
  // whether a story can be trusted.
  useEffect(() => {
    if (!article) return;
    runSummary('summary');
    runReport();
  }, [article, runSummary, runReport]);

  useEffect(() => {
    if (!article) return;
    trackActivity('view');
    return () => {
      if (startTime) trackActivity('read', Math.round((Date.now() - startTime) / 1000));
    };
  }, [article, startTime, trackActivity]);

  if (!article) {
    return (
      <PageShell>
        {recovering ? (
          <div className="pp-loading">
            <div className="spinner" />
            <p className="pp-note">Reopening that story…</p>
          </div>
        ) : recoveryFailed ? (
          <div className="pp-card pp-empty">
            <p>We could not reopen that story.</p>
            <button className="pp-btn pp-btn--quiet pp-btn--sm" onClick={() => navigate('/home')}>
              Back to the front page
            </button>
          </div>
        ) : null}
      </PageShell>
    );
  }

  const publishedOn = formatDate(article.publishedAt);
  const excerpt = (article.description || '').trim();
  const hasExcerpt = excerpt.replace(/[^a-zA-Z0-9]/g, '').length > 3;
  const fullTextAvailable = summarySourceText?.coverage === 'article-text';

  return (
    <PageShell>
      <article className="article">
        <header className="article__head">
          <p className="article__kicker">
            <span className="article__source">{article.source?.name || 'Unknown source'}</span>
            {publishedOn && <span className="article__date">{publishedOn}</span>}
          </p>
          <h1 className="article__title">{article.title}</h1>
        </header>

        {/* The answer, before the story. */}
        <section className="article__verdict" aria-label="Verdict">
          {busy.report ? (
            <div className="pp-card pp-loading">
              <div className="spinner" />
              <p className="pp-note">
                {completedChecks.length ? `Checked ${completedChecks.length} of 6…` : 'Starting the checks…'}
              </p>
              <ul className="article__checklist">
                {completedChecks.map(check => <li key={check.id}>{check.name}</li>)}
              </ul>
            </div>
          ) : report ? (
            <TrustReport report={report} />
          ) : (
            <div className="pp-card pp-empty">
              <p>We could not check this article just now.</p>
              <button className="pp-btn pp-btn--quiet pp-btn--sm" onClick={runReport}>Try again</button>
            </div>
          )}
        </section>

        <section className="article__story">
          <div className="pp-section-head">
            <h2>The story</h2>
            {summarySourceText && (
              <span className="pp-section-head__note">
                {fullTextAvailable ? 'From the full article' : "From the publisher's excerpt"}
              </span>
            )}
          </div>

          {article.urlToImage && (
            <img
              className="article__image"
              src={article.urlToImage}
              alt=""
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}

          {/* One account of the story, not two.
              The page used to print the feed's truncated excerpt and then our
              summary of the same 200 characters directly beneath it, which for
              most articles said the same thing twice — once broken off
              mid-word. The summary reads better, so it leads; the publisher's
              own words appear only when we have nothing else. */}
          {busy.summary ? (
            <div className="pp-loading"><div className="spinner" /></div>
          ) : summary ? (
            <p className="article__body">{summary}</p>
          ) : hasExcerpt ? (
            <p className="article__body">{excerpt}</p>
          ) : (
            <p className="pp-note">The publisher supplied no text with this story.</p>
          )}

          {failed.summary && (
            <p className="pp-note">
              We could not summarise this one.{' '}
              <button className="article__inline-retry" onClick={() => runSummary('summary')}>Try again</button>
            </p>
          )}

          {detailedSummary && <p className="article__body article__body--detail">{detailedSummary}</p>}

          <div className="pp-btn-row article__actions">
            <a className="pp-btn pp-btn--primary" href={article.url} target="_blank" rel="noopener noreferrer">
              Read the original
            </a>
            <button className="pp-btn pp-btn--quiet" onClick={() => navigate('/compare', { state: { article } })}>
              Compare coverage
            </button>
            {/* Offered only when there is more to say. On a publisher excerpt
                the "longer" summary came back the same length as the short one,
                because both were written from the same 200 characters. */}
            {fullTextAvailable && !detailedSummary && (
              <button
                className="pp-btn pp-btn--quiet"
                onClick={() => runSummary('detailedSummary')}
                disabled={busy.detailedSummary}
              >
                {busy.detailedSummary ? 'Reading…' : 'Longer summary'}
              </button>
            )}
          </div>
        </section>
      </article>
    </PageShell>
  );
};

export default ArticlePage;
