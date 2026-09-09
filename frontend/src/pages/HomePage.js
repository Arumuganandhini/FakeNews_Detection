import React, { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Link2, Search } from 'lucide-react';
import api from '../services/api';
import NewsCard from '../components/NewsCard';
import '../styles/HomePage.css';

const HomePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [personalizedMessage, setPersonalizedMessage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [currentDate] = useState(new Date());
  const [trustBadges, setTrustBadges] = useState({});
  const [linkInput, setLinkInput] = useState('');
  const [checkingLink, setCheckingLink] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkPartial, setLinkPartial] = useState(null);

  // Get category from URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const category = params.get('category') || 'general';
    setSelectedCategory(category);
  }, [location.search]);

  const fetchNews = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Check if user is logged in
      const token = localStorage.getItem('token');
      
      // If user is logged in and on general category, fetch personalized news
      if (token && selectedCategory === 'general') {
        try {
          const response = await api.get('/news/personalized');
          
          if (response.data.articles && response.data.articles.length > 0) {
            setArticles(response.data.articles);
            setPersonalizedMessage(response.data.message);
          } else {
            // Fallback to regular news if no personalized articles
            const res = await api.get(`/news?category=${selectedCategory}`);
            setArticles(res.data.articles || []);
            setPersonalizedMessage('');
          }
        } catch (personalizedError) {
          // If personalized news fails, fallback to regular news
          const res = await api.get(`/news?category=${selectedCategory}`);
          setArticles(res.data.articles || []);
          setPersonalizedMessage('');
        }
      } else {
        // Regular news fetch for non-logged in users or specific categories
        const res = await api.get(`/news?category=${selectedCategory}`);
        setArticles(res.data.articles || []);
        setPersonalizedMessage('');
      }
      
      setError(null);
    } catch (err) {
      // The backend explains recoverable causes (a used-up daily quota, a bad
      // key). Show that rather than a generic failure the reader can't act on.
      setError(err.response?.data?.error || 'Failed to load news. Please try again later.');
      console.error('News fetch error:', err);
    } finally {
      setIsLoading(false);
      setInitialLoad(false);
    }
  }, [selectedCategory]);

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

  // Read a pasted link, then hand it to the article page so it gets exactly
  // the same treatment as anything from our own feed.
  const handleCheckLink = async (e) => {
    e.preventDefault();
    const url = linkInput.trim();
    if (!url) return;

    setCheckingLink(true);
    setLinkError('');
    setLinkPartial(null);
    try {
      const res = await api.post('/ai/extract-article', { url });
      navigate('/article', { state: { article: res.data.article, startTime: Date.now() } });
    } catch (err) {
      setLinkError(err.response?.data?.error || 'We could not check that link. Please try another one.');
      setLinkPartial(err.response?.data?.partial || null);
    } finally {
      setCheckingLink(false);
    }
  };

  const handleRetry = () => {
    window.location.reload();
  };

  const trackCategoryClick = async (category) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await api.post('/tracking/activity', {
        articleId: `category_${category}`,
        title: `${category} News`,
        category: category,
        source: 'Category Selection',
        activityType: 'category',
        duration: 0,
        completed: true
      });
    } catch (error) {
      console.error('Error tracking category click:', error);
    }
  };

  useEffect(() => {
    fetchNews();
    if (!initialLoad) {
      trackCategoryClick(selectedCategory);
    }
  }, [selectedCategory, fetchNews, initialLoad]);

  const getCategoryEmoji = (category) => {
    const emojiMap = {
      'general': '🌐',
      'technology': '💻',
      'business': '💼',
      'sports': '⚽',
      'science': '🔬',
      'health': '🏥',
      'entertainment': '🎬'
    };
    return emojiMap[category] || '📰';
  };

  const getCategoryTitle = (category) => {
    const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
    return `${categoryName} Daily`;
  };

  const formatCurrentDate = () => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return currentDate.toLocaleDateString(undefined, options);
  };

  return (
    <div className="newspaper-container">
      <div className="newspaper-masthead">
        <div className="newspaper-date">{formatCurrentDate()}</div>
        <h1 className="newspaper-name">The Daily Chronicle</h1>
        <div className="newspaper-tagline">All the News That's Fit to Print</div>
      </div>
      
      {/* Most misinformation arrives as a forwarded link, not through a feed —
          so checking one is offered before the day's headlines. */}
      <section className="wire-desk">
        <div className="wire-desk-intro">
          <span className="wire-icon"><Link2 size={16} /></span>
          <div>
            <h2 className="wire-title">The Verification Desk</h2>
            <p className="wire-strapline">
              Sent a news link on WhatsApp or social media? Submit it for checking.
            </p>
          </div>
        </div>

        <form className="wire-form" onSubmit={handleCheckLink}>
          <input
            type="url"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="https://example.com/news-article"
            aria-label="Paste a news link to check"
            disabled={checkingLink}
          />
          <button type="submit" disabled={checkingLink || !linkInput.trim()}>
            <Search size={14} /> {checkingLink ? 'Reading…' : 'Check it'}
          </button>
        </form>

        {linkError && (
          <div className="wire-notice">
            <strong>{linkError}</strong>
            {linkPartial && <span className="wire-partial">{linkPartial.note}</span>}
          </div>
        )}
      </section>

      <div className="newspaper-categories">
        <div className="category-label">SECTIONS:</div>
        <div className="categories-list">
          <button 
            className={`category-btn ${selectedCategory === 'general' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('general')}
          >
            General
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'business' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('business')}
          >
            Business
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'technology' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('technology')}
          >
            Technology
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'entertainment' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('entertainment')}
          >
            Entertainment
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'sports' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('sports')}
          >
            Sports
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'science' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('science')}
          >
            Science
          </button>
          <button 
            className={`category-btn ${selectedCategory === 'health' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('health')}
          >
            Health
          </button>
        </div>
      </div>
      
      <div className="section-header">
        <div className="section-divider"></div>
        <h2 className="section-title">
          {getCategoryEmoji(selectedCategory)} {getCategoryTitle(selectedCategory)}
        </h2>
        <div className="section-divider"></div>
      </div>
      
      {personalizedMessage && (
        <div className="editor-note">
          <div className="editor-note-inner">
            <h3 className="editor-title">Editor's Pick</h3>
            <p>{personalizedMessage}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="newspaper-loading">
          <div className="typewriter">
            <div className="typewriter-text">Loading latest headlines...</div>
          </div>
          <div className="loading-text">Please wait while we prepare your newspaper</div>
        </div>
      ) : error ? (
        <div className="newspaper-error">
          <div className="error-headline">BREAKING: NEWS UNAVAILABLE</div>
          <p className="error-subheading">Our press machines are experiencing technical difficulties</p>
          <p>{error}</p>
          <button onClick={handleRetry} className="retry-button">Refresh Paper</button>
        </div>
      ) : articles.length === 0 ? (
        <div className="newspaper-empty">
          <h3 className="empty-headline">SLOW NEWS DAY</h3>
          <p>Our reporters are currently investigating stories for this section.</p>
          <p>Please check back in our evening edition.</p>
        </div>
      ) : (
        <div className="newspaper-grid">
          {articles.map((article, index) => (
            <NewsCard key={index} article={article} trustBadge={trustBadges[article.url]} />
          ))}
        </div>
      )}
      
      <div className="newspaper-footer">
        <div className="footer-divider"></div>
        <p>© {currentDate.getFullYear()} The Daily Chronicle • All Rights Reserved</p>
        <p>Our reporters strive to deliver accurate, fair, and thorough news reporting</p>
      </div>
    </div>
  );
};

export default HomePage;