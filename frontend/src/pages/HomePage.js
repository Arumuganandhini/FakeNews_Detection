import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import api from '../services/api';
import NewsCard from '../components/NewsCard';
import PageShell from '../components/PageShell';
import '../styles/HomePage.css';

const CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'business', label: 'Business' },
  { id: 'technology', label: 'Technology' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'sports', label: 'Sports' },
  { id: 'science', label: 'Science' },
  { id: 'health', label: 'Health' }
];

/**
 * The front page: today's headlines, each carrying what we already know about
 * its publisher, with the full check one click away.
 */
const HomePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [personalizedMessage, setPersonalizedMessage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [trustBadges, setTrustBadges] = useState({});

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setSelectedCategory(params.get('category') || 'general');
  }, [location.search]);

  const fetchNews = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const token = localStorage.getItem('token');
    try {
      if (token && selectedCategory === 'general') {
        try {
          const response = await api.get('/news/personalized');
          if (response.data.articles?.length) {
            setArticles(response.data.articles);
            setPersonalizedMessage(response.data.message);
            return;
          }
        } catch (_) {
          // No personalised feed available; the general one still works.
        }
      }
      const res = await api.get(`/news?category=${selectedCategory}`);
      setArticles(res.data.articles || []);
      setPersonalizedMessage('');
    } catch (err) {
      // The backend explains recoverable causes (a used-up daily quota, a bad
      // key). Show that rather than a generic failure the reader cannot act on.
      setError(err.response?.data?.error || 'We could not load the news just now.');
      console.error('News fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory]);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  // Trust stamps for the visible clippings. Cheap on the server (cache lookup
  // plus the source database), so every card can carry a verdict without the
  // reader clicking anything.
  useEffect(() => {
    if (!articles.length) return;
    let cancelled = false;

    api.post('/ai/trust-badges', {
      articles: articles.map(a => ({ url: a.url, source: a.source }))
    })
      .then(res => {
        if (cancelled) return;
        const map = {};
        (res.data.badges || []).forEach(b => { if (b.url) map[b.url] = b; });
        setTrustBadges(map);
      })
      .catch(err => console.error('Trust badge fetch failed:', err));

    return () => { cancelled = true; };
  }, [articles]);

  const chooseCategory = (category) => {
    setSelectedCategory(category);
    const token = localStorage.getItem('token');
    if (!token) return;
    api.post('/tracking/activity', {
      articleId: `category_${category}`,
      title: `${category} News`,
      category,
      source: 'Category Selection',
      activityType: 'category',
      duration: 0,
      completed: true
    }).catch(err => console.warn('Could not record that choice:', err.message));
  };

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return (
    <PageShell
      width="wide"
      eyebrow={today}
      title="The Daily Chronicle"
      standfirst="Every headline carries what we know about who published it. Open one for the full check."
      actions={
        /* One way to check something, not two.
           The front page used to carry its own link box — a second, weaker
           version of the Check page, which also takes pasted text and
           screenshots and refuses input that asserts nothing checkable. Two
           doors to the same room, one of them narrower. */
        <button className="pp-btn pp-btn--primary" onClick={() => navigate('/check')}>
          <ShieldCheck size={15} /> Check something you were sent
        </button>
      }
    >
      <nav className="sections" aria-label="Sections">
        <span className="sections__label">Sections</span>
        <div className="sections__list">
          {CATEGORIES.map(category => (
            <button
              key={category.id}
              className={`sections__item${selectedCategory === category.id ? ' is-current' : ''}`}
              onClick={() => chooseCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
      </nav>

      {personalizedMessage && (
        <p className="pp-note home__editor-note">{personalizedMessage}</p>
      )}

      {isLoading ? (
        <div className="pp-loading">
          <div className="spinner" />
          <p className="pp-note">Setting today's edition…</p>
        </div>
      ) : error ? (
        <div className="pp-card pp-empty">
          <p>{error}</p>
          <button className="pp-btn pp-btn--quiet pp-btn--sm" onClick={fetchNews}>Try again</button>
        </div>
      ) : articles.length === 0 ? (
        <div className="pp-card pp-empty">
          <p>Nothing filed in this section today.</p>
        </div>
      ) : (
        <div className="pp-grid">
          {articles.map((article) => (
            <NewsCard key={article.url} article={article} trustBadge={trustBadges[article.url]} />
          ))}
        </div>
      )}
    </PageShell>
  );
};

export default HomePage;
