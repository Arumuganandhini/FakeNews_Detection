import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import PageShell from '../components/PageShell';
import '../styles/Dashboard.css';

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? null
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * What this reader has opened, and what the checks concluded about it.
 *
 * The figures are the point of the page: not "you read twelve articles", which
 * says only that the app was used, but how many were confirmed, how many could
 * not be confirmed, and how many turned out to be false. That is the record of
 * the tool doing its job.
 */
const Dashboard = () => {
  const [articleHistory, setArticleHistory] = useState([]);
  const [verdicts, setVerdicts] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const navigate = useNavigate();

  const fetchUserProfile = useCallback(async () => {
    const response = await api.get('/users/profile');
    setUserProfile(response.data);
  }, []);

  const fetchArticleHistory = useCallback(async () => {
    const response = await api.get('/article-history/history');
    const history = response.data.data || [];
    setArticleHistory(history);

    // What the checks concluded about what this reader actually opened.
    // Counting articles read says the app was used; counting verdicts says
    // what using it found. The verdicts are already cached per article, so
    // this is a lookup rather than a re-analysis.
    const urls = history.map(a => a.articleId).filter(Boolean);
    if (urls.length === 0) return;

    const badges = await api.post('/ai/trust-badges', { articles: urls.map(url => ({ url })) });
    setVerdicts((badges.data.badges || []).filter(b => b.kind === 'analyzed' && b.call));
  }, []);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchUserProfile(), fetchArticleHistory()]);
    } catch (err) {
      console.error('Dashboard load failed:', err);
      setError('We could not load your reading record just now.');
    } finally {
      setLoading(false);
    }
  }, [fetchUserProfile, fetchArticleHistory]);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  /* One pass over the history — every figure below comes from here. */
  const stats = useMemo(() => {
    const categories = [...new Set(articleHistory.map(a => a.category).filter(Boolean))];

    const tally = {};
    articleHistory.forEach(a => {
      if (a.category) tally[a.category] = (tally[a.category] || 0) + (a.viewCount || 1);
    });
    const topTopic = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || null;

    const lastRead = articleHistory
      .map(a => a.lastViewed)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];

    // Articles with no cached verdict are excluded rather than counted as
    // anything — an unchecked article is not a clean one.
    const calls = verdicts.reduce((acc, v) => {
      acc[v.call] = (acc[v.call] || 0) + 1;
      return acc;
    }, {});

    return {
      opened: articleHistory.length,
      topics: categories.length,
      topTopic,
      lastRead,
      checked: verdicts.length,
      confirmed: calls.REAL || 0,
      falsehoods: calls.FAKE || 0,
      unconfirmed: calls['CANNOT VERIFY'] || 0
    };
  }, [articleHistory, verdicts]);

  const openArticle = (article) => {
    navigate(`/article?u=${encodeURIComponent(article.articleId)}`, {
      state: {
        article: {
          url: article.articleId,
          title: article.title,
          source: { name: article.source },
          category: article.category
        },
        startTime: Date.now()
      }
    });
  };

  const saveName = async () => {
    try {
      const response = await api.put('/users/profile', { name: newName });
      setUserProfile(response.data.user);
      setIsEditingName(false);
    } catch (err) {
      console.error('Could not save that name:', err);
      setError('We could not save that name.');
    }
  };

  const figures = [
    { label: 'Opened', value: stats.opened },
    { label: 'Checked', value: stats.checked },
    { label: 'Confirmed', value: stats.confirmed },
    { label: 'Not confirmed', value: stats.unconfirmed },
    { label: 'Found false', value: stats.falsehoods },
    { label: 'Topics', value: stats.topics }
  ];

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  if (loading) {
    return (
      <PageShell>
        <div className="pp-loading">
          <div className="spinner" />
          <p className="pp-note">Setting today's edition…</p>
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="The Reader's Chronicle" eyebrow={today}>
        <div className="pp-card pp-empty">
          <p>{error}</p>
          <button className="pp-btn pp-btn--quiet pp-btn--sm" onClick={fetchAllData}>Try again</button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow={today}
      title="The Reader's Chronicle"
      standfirst={userProfile?.name ? `Compiled for ${userProfile.name}` : 'Your reading record'}
    >
      <section className="figures" aria-label="Summary">
        {figures.map(figure => (
          <div className="figures__item" key={figure.label}>
            <span className="figures__value">{figure.value}</span>
            <span className="figures__label">{figure.label}</span>
          </div>
        ))}
      </section>

      <div className="dash">
        <aside className="dash__side pp-stack">
          <div className="pp-card">
            <div className="pp-section-head"><h3>Reader</h3></div>
            {isEditingName ? (
              <div className="pp-stack pp-stack--tight">
                <input
                  className="pp-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Your name"
                />
                <div className="pp-btn-row">
                  <button className="pp-btn pp-btn--primary pp-btn--sm" onClick={saveName}>Save</button>
                  <button className="pp-btn pp-btn--quiet pp-btn--sm" onClick={() => setIsEditingName(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="dash__identity">
                <h4>{userProfile?.name || 'Distinguished Reader'}</h4>
                <p className="pp-note">{userProfile?.email}</p>
                <button
                  className="pp-btn pp-btn--quiet pp-btn--sm"
                  onClick={() => { setIsEditingName(true); setNewName(userProfile?.name || ''); }}
                >
                  Change name
                </button>
              </div>
            )}
          </div>

          <div className="pp-card">
            <div className="pp-section-head"><h3>At a glance</h3></div>
            <dl className="glance">
              <div><dt>Most-read topic</dt><dd>{stats.topTopic || 'Not yet known'}</dd></div>
              <div><dt>Last read</dt><dd>{formatDate(stats.lastRead) || 'Never'}</dd></div>
              <div>
                <dt>Topics of interest</dt>
                <dd>{userProfile?.interests?.length ? userProfile.interests.join(', ') : 'None recorded'}</dd>
              </div>
            </dl>
          </div>
        </aside>

        <section className="dash__main">
          <div className="pp-card">
            <div className="pp-section-head">
              <h3>Reading archive</h3>
              <span className="pp-section-head__note">
                {stats.opened} {stats.opened === 1 ? 'story' : 'stories'}
              </span>
            </div>

            {articleHistory.length === 0 ? (
              <div className="pp-empty">
                <p>Nothing filed here yet.</p>
                <button className="pp-btn pp-btn--quiet pp-btn--sm" onClick={() => navigate('/home')}>
                  Browse the front page
                </button>
              </div>
            ) : (
              <ul className="archive">
                {articleHistory.map(article => {
                  const verdict = verdicts.find(v => v.url === article.articleId);
                  return (
                    <li key={article.articleId}>
                      <button className="archive__item" onClick={() => openArticle(article)}>
                        <span className="archive__title">{article.title}</span>
                        <span className="archive__meta">
                          <span className="archive__source">{article.source}</span>
                          {formatDate(article.lastViewed) && <span>{formatDate(article.lastViewed)}</span>}
                          {verdict && (
                            <span className={`archive__call archive__call--${String(verdict.call).toLowerCase().replace(/\s+/g, '-')}`}>
                              {verdict.call}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </PageShell>
  );
};

export default Dashboard;
