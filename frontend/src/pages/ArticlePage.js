import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import FeedbackModal from '../components/FeedbackModal';
import TrustReport from '../components/TrustReport';
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
    // No stream available — fall back to the ordinary endpoint.
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

const ArticlePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const article = location.state?.article;
  const startTime = location.state?.startTime || Date.now();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [summary, setSummary] = useState('');
  const [detailedSummary, setDetailedSummary] = useState('');
  const [summarySourceText, setSummarySourceText] = useState(null);
  const [detailedSourceText, setDetailedSourceText] = useState(null);
  const [credibility, setCredibility] = useState(null);
  // The six checks, filled in as the server reports each one finishing. The
  // reader watches the report being built instead of waiting on a spinner.
  const [completedChecks, setCompletedChecks] = useState([]);
  const [articleFeedbacks, setArticleFeedbacks] = useState([]);
  const [loadingStates, setLoadingStates] = useState({
    summary: true,
    detailedSummary: false,
    credibility: true,
    articleFeedbacks: true
  });
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  // Which article the page is currently showing. Replies for anything else are
  // discarded — see the guard in analyze().
  const latestRequest = useRef(article?.url);
  useEffect(() => { latestRequest.current = article?.url; }, [article]);

  // Define trackActivity function using useCallback to avoid recreation on each render
  const trackActivity = useCallback(async (activityType, duration = 0) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await axios.post(`${BASE_URL}/api/tracking/activity`, {
        articleId: article.url,
        title: article.title,
        category: article.category || 'general',
        source: article.source?.name || 'Unknown Source',
        activityType,
        duration,
        completed: activityType === 'read'
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (error) {
      // Silently handle errors
    }
  }, [article]);

  // Define analyze function using useCallback
  const analyze = useCallback(async (type) => {
    if (!article) return;

    const content = article.content || article.description || article.title;
    setLoadingStates(prev => ({ ...prev, [type]: true }));
    setError(null);

    try {
      let endpoint, body;

      switch (type) {
        case 'summary':
          endpoint = '/api/ai/summarize';
          // The URL lets the server reuse this article's existing summary, so
          // the same article always reads the same way.
          body = { article: content, url: article.url, title: article.title };
          break;
        case 'detailedSummary':
          endpoint = '/api/ai/detailed-summary';
          body = { article: content, url: article.url, title: article.title };
          break;
        case 'credibility':
          endpoint = '/api/ai/trust-analysis';
          body = {
            title: article.title,
            content,
            source: article.source?.name || article.source || 'Unknown',
            url: article.url,
          };
          break;
        default:
          console.warn('Unknown analysis type:', type);
          return;
      }

      // Get the token from localStorage
      const token = localStorage.getItem('token');

      // Add authorization header if token exists
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      // The trust analysis is streamed so each check can be shown as it lands.
      // Everything else is a single request/response.
      if (type === 'credibility') {
        setCompletedChecks([]);
        const finished = await streamTrustAnalysis(body, headers, (step) => {
          if (latestRequest.current !== article.url) return;
          setCompletedChecks(prev =>
            prev.some(c => c.id === step.id) ? prev : [...prev, step]);
        });
        if (latestRequest.current !== article.url) return;
        setCredibility(finished);
        return;
      }

      const response = await axios.post(`${BASE_URL}${endpoint}`, body, { headers });

      // These calls take seconds. If the reader has moved to another article in
      // the meantime, a late reply belongs to the previous one — dropping it
      // stops one article's summary appearing under another's headline.
      if (latestRequest.current !== article.url) return;

      switch (type) {
        case 'summary':
          setSummary(response.data.summary);
          setSummarySourceText(response.data.sourceText || null);
          break;
        case 'detailedSummary':
          setDetailedSummary(response.data.summary);
          setDetailedSourceText(response.data.sourceText || null);
          break;
        case 'credibility':
          setCredibility(response.data);
          break;
        default:
          break;
      }
    } catch (err) {
      console.error(`Error in ${type} analysis:`, err);
      setError(`Failed to analyze ${type}. Please try again.`);
    } finally {
      setLoadingStates(prev => ({ ...prev, [type]: false }));
    }
  }, [article]);

  // Redirect if no article data
  useEffect(() => {
    if (!article) {
      navigate('/home');
    }
  }, [article, navigate]);

  // Handle tracking when component unmounts
  useEffect(() => {
    return () => {
      // Calculate duration and track activity if user was logged in
      if (startTime) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        trackActivity('read', duration);
      }
    };
  }, [startTime, trackActivity]);

  // Summary and the trust check both start on their own — a reader should
  // never have to ask the paper whether a story can be trusted.
  useEffect(() => {
    if (article) {
      analyze('summary');
      analyze('credibility');
    }
  }, [article, analyze]);

  useEffect(() => {
    // Check if user is authenticated
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
  }, []);

  useEffect(() => {
    const trackArticleView = async () => {
      if (isAuthenticated && article) {
        try {
          const token = localStorage.getItem('token');
          await axios.post(
            `${BASE_URL}/api/article-history/track-view`,
            {
              articleId: article.url,
              title: article.title,
              source: article.source?.name || 'Unknown Source',
              category: article.category || 'general'
            },
            {
              headers: { Authorization: `Bearer ${token}` }
            }
          );
        } catch (error) {
          console.error('Error tracking article view:', error);
        }
      }
    };

    if (article) {
      trackArticleView();
    }
  }, [article, isAuthenticated]);

  const fetchArticleFeedbacks = useCallback(async () => {
    if (!article) return;
    try {
      const response = await axios.get(`${BASE_URL}/api/article-feedback/all/${encodeURIComponent(article.url)}`);
      setArticleFeedbacks(response.data.data || []);
    } catch (error) {
      console.error('Error fetching article feedbacks:', error);
    } finally {
      setLoadingStates(prev => ({ ...prev, articleFeedbacks: false }));
    }
  }, [article]);

  useEffect(() => {
    fetchArticleFeedbacks();
  }, [fetchArticleFeedbacks]);

  const handleShowFullFeedback = () => {
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
  };

  const handleSubmitFeedback = async (userFeedback) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setError('Please login to submit feedback');
        return;
      }

      // Submit feedback to the backend
      await axios.post(
        `${BASE_URL}/api/article-feedback/submit`,
        {
          articleId: article.url,
          feedback: userFeedback.feedback,
          rating: userFeedback.rating
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setShowModal(false);

      // Confirm inline and refresh the list, so the reader sees their own view
      // appear rather than being interrupted by a browser dialog.
      setNotice('Thanks — your view has been added below.');
      setTimeout(() => setNotice(''), 5000);
      fetchArticleFeedbacks();

    } catch (error) {
      console.error('Error submitting feedback:', error);
      setError('We could not save your view. Please try again.');
    }
  };

  const handleDetailedSummary = () => {
    analyze('detailedSummary');
  };

  // The quiz is built from the long summary. Rather than making the reader
  // discover that, fetch it for them if it is not ready yet.
  const handleQuizClick = async () => {
    let summaryForQuiz = detailedSummary;

    if (!summaryForQuiz) {
      setLoadingStates(prev => ({ ...prev, detailedSummary: true }));
      try {
        const token = localStorage.getItem('token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const content = article.content || article.description || article.title;
        const response = await axios.post(
          `${BASE_URL}/api/ai/detailed-summary`,
          // Same cache key as the button above, so the quiz is built from the
          // very summary the reader was shown.
          { article: content, url: article.url, title: article.title },
          { headers }
        );
        summaryForQuiz = response.data.summary;
        setDetailedSummary(summaryForQuiz);
        setDetailedSourceText(response.data.sourceText || null);
      } catch (err) {
        console.error('Could not prepare the quiz:', err);
        setError('We could not prepare the quiz just now. Please try again.');
        return;
      } finally {
        setLoadingStates(prev => ({ ...prev, detailedSummary: false }));
      }
    }

    navigate('/quiz', {
      state: { detailedSummary: summaryForQuiz, articleTitle: article.title, article }
    });
  };

  const renderArticleFeedbacks = () => {
    if (loadingStates.articleFeedbacks) {
      return (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading feedbacks...</p>
        </div>
      );
    }

    if (articleFeedbacks.length === 0) {
      return <p className="no-feedbacks">No feedbacks yet. Be the first to share your thoughts!</p>;
    }

    return (
      <div className="article-feedbacks">
        {articleFeedbacks.map((feedback) => (
          <div key={feedback._id} className="feedback-item">
            <div className="feedback-header">
              <span className="feedback-user">{feedback.userId?.email || 'Anonymous User'}</span>
              <span className="feedback-date">
                {new Date(feedback.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="feedback-rating">
              {'★'.repeat(feedback.rating)}{'☆'.repeat(5 - feedback.rating)}
            </div>
            <p className="feedback-text">{feedback.feedback}</p>
          </div>
        ))}
      </div>
    );
  };

  if (!article) {
    return (
      <div className="article-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p className="loading-text">Loading article...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="article-page">
      {/* Anything that fails is said out loud rather than swallowed. */}
      {error && (
        <div className="page-notice" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      {notice && (
        <div className="page-notice page-notice-good" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss message">×</button>
        </div>
      )}

      <div className="article-header">
        <h1 className="article-title">{article.title}</h1>
        <div className="article-meta">
          <span className="article-source">{article.source?.name || 'Unknown Source'}</span>
          <span className="article-date">
            {new Date(article.publishedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </span>
        </div>
        {article.urlToImage && (
          <img
            className="article-image"
            src={article.urlToImage}
            alt={article.title}
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = 'https://via.placeholder.com/800x400?text=No+Image+Available';
            }}
          />
        )}
        {/* Some feed entries carry no description at all, or a stray fragment
            like a single full stop. Rendering that leaves a lone mark floating
            under the photo, so the block is skipped unless there is real text. */}
        {(article.description || '').replace(/[^a-zA-Z0-9]/g, '').length > 3 && (
          <div className="article-content">
            <p>{article.description}</p>
          </div>
        )}
        <div className="article-actions">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="feedback-button"
          >
            Read Original Article
          </a>
          <button
            className="feedback-button"
            onClick={() => navigate('/compare', { state: { article } })}
          >
            Compare Coverage
          </button>
        </div>
      </div>

      <div className="article-bottom-section">
        {/* The summary and the reader feedback share the left column. They
            were previously separate grid items, which tied their heights to
            the report beside them and left a large gap under the summary. */}
        <div className="article-left-column">
          <div className="summary-section">
            <h2>Summary</h2>
            {loadingStates.summary ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Generating summary...</p>
              </div>
            ) : (
              <>
                <p>{summary}</p>
                {summarySourceText?.coverage === 'publisher-excerpt' && (
                  <p className="summary-source-note">
                    Based on the publisher&apos;s short excerpt. Open the original article for fuller context.
                  </p>
                )}
                <div className="summary-actions">
                  <button
                    className="action-button"
                    onClick={handleDetailedSummary}
                    disabled={loadingStates.detailedSummary}
                  >
                    {loadingStates.detailedSummary ? 'Setting type…' : 'Read a longer summary'}
                  </button>
                  <button
                    className="action-button"
                    onClick={handleQuizClick}
                    disabled={loadingStates.detailedSummary}
                  >
                    {loadingStates.detailedSummary ? 'Preparing…' : 'Test yourself on this story'}
                  </button>
                </div>
                {detailedSummary && (
                  <div className="detailed-summary">
                    <h3>Detailed Summary</h3>
                    <p>{detailedSummary}</p>
                    {detailedSourceText?.coverage === 'publisher-excerpt' && (
                      <p className="summary-source-note">
                        This story was supplied as a short publisher excerpt, so there is no additional verified detail to expand.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="article-feedbacks-section">
            <div className="feedbacks-header">
              <h3 className="feedback-title">What readers think</h3>
              <button className="feedback-button" onClick={handleShowFullFeedback}>
                Share your view
              </button>
            </div>
            {renderArticleFeedbacks()}
          </div>
        </div>

        <div className="right-cards">
          <div className="credibility-card">
            <h3 className="credibility-title">Can you trust this article?</h3>
            {loadingStates.credibility ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p className="loading-text">
                  {completedChecks.length
                    ? `Checked ${completedChecks.length} of 6…`
                    : 'Starting the checks…'}
                </p>
                <ul className="check-progress">
                  {completedChecks.map(check => (
                    <li key={check.id} className="check-done">{check.name}</li>
                  ))}
                </ul>
                <p className="loading-subtext">
                  Six independent checks are combined into one explainable report.
                </p>
              </div>
            ) : credibility ? (
              <TrustReport report={credibility} />
            ) : (
              <div className="error-message">
                <p>We couldn&apos;t check this article just now.</p>
                <button
                  className="feedback-button"
                  onClick={() => analyze('credibility')}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <FeedbackModal
          onSubmit={handleSubmitFeedback}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default ArticlePage;
