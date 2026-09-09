import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/Dashboard.css';

const Dashboard = () => {
  const [articleHistory, setArticleHistory] = useState([]);
  const [quizHistory, setQuizHistory] = useState([]);
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [showArticleHistory, setShowArticleHistory] = useState(true);
  const [showQuizHistory, setShowQuizHistory] = useState(true);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(true);
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const navigate = useNavigate();

  const fetchUserProfile = async () => {
    try {
      const response = await api.get('/users/profile');
      setUserProfile(response.data);
    } catch (err) {
      console.error('Error fetching user profile:', err);
      setError('Failed to load user profile');
    }
  };

  const fetchArticleHistory = async () => {
    try {
      const response = await api.get('/article-history/history');
      setArticleHistory(response.data.data || []);
    } catch (err) {
      console.error('Error fetching article history:', err);
      setError('Failed to load article history');
    }
  };

  const fetchQuizHistory = async () => {
    try {
      const response = await api.get('/prompt-quiz/history');
      setQuizHistory(response.data.data || []);
    } catch (err) {
      console.error('Error fetching quiz history:', err);
      setError('Failed to load quiz history');
    }
  };

  const fetchFeedbackHistory = async () => {
    try {
      const response = await api.get('/article-feedback/history/all');
      setFeedbackHistory(response.data.data || []);
    } catch (err) {
      console.error('Error fetching feedback history:', err);
      setError('Failed to load feedback history');
    }
  };

  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchUserProfile(),
        fetchArticleHistory(),
        fetchQuizHistory(),
        fetchFeedbackHistory(),
      ]);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();

    // Cleanup to prevent memory leaks
    return () => {
      setArticleHistory([]);
      setQuizHistory([]);
      setFeedbackHistory([]);
      setUserProfile(null);
    };
  }, []);

  const formatDate = (dateString) => {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const handleArticleClick = (article) => {
    const articleData = {
      url: article.articleId,
      title: article.title,
      source: {
        name: article.source,
      },
      category: article.category,
    };

    navigate('/article', {
      state: {
        article: articleData,
        startTime: Date.now(),
      },
    });
  };

  /* One pass over each history list — the figures below all come from here. */
  const stats = useMemo(() => {
    const totalViews = articleHistory.reduce((sum, a) => sum + (a.viewCount || 0), 0);
    const categories = [...new Set(articleHistory.map((a) => a.category).filter(Boolean))];

    // The topic that appears most often in the reading history.
    const tally = {};
    articleHistory.forEach((a) => {
      if (a.category) tally[a.category] = (tally[a.category] || 0) + (a.viewCount || 1);
    });
    const topTopic = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || null;

    const lastRead = articleHistory
      .map((a) => a.lastViewed)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];

    const averageScore =
      quizHistory.length > 0
        ? Math.round(
            quizHistory.reduce(
              (sum, q) => sum + (q.score / (q.totalQuestions || 1)) * 100,
              0
            ) / quizHistory.length
          )
        : 0;

    const averageRating =
      feedbackHistory.length > 0
        ? Math.round(
            (feedbackHistory.reduce((sum, f) => sum + (f.rating || 0), 0) /
              feedbackHistory.length) *
              10
          ) / 10
        : 0;

    return {
      totalArticles: articleHistory.length,
      totalViews,
      categories: categories.length,
      topTopic,
      lastRead,
      totalQuizzes: quizHistory.length,
      averageScore,
      totalFeedback: feedbackHistory.length,
      averageRating,
    };
  }, [articleHistory, quizHistory, feedbackHistory]);

  const handleQuizClick = (quiz) => {
    setSelectedQuiz(quiz);
    setShowQuizModal(true);
  };

  const closeQuizModal = () => {
    setShowQuizModal(false);
    setSelectedQuiz(null);
  };

  // Escape closes the quiz modal, as it would any dialog.
  useEffect(() => {
    if (!showQuizModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeQuizModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showQuizModal]);

  const handleNameEdit = () => {
    setIsEditingName(true);
    setNewName(userProfile?.name || '');
  };

  const handleNameSave = async () => {
    try {
      const response = await api.put('/users/profile', { name: newName });
      setUserProfile(response.data.user);
      setIsEditingName(false);
    } catch (err) {
      console.error('Error updating profile:', err);
      setError('Failed to update profile');
    }
  };

  const handleNameCancel = () => {
    setIsEditingName(false);
    setNewName('');
  };

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  /* The masthead figures, printed as one hairline-ruled strip. */
  const summaryFigures = [
    { label: 'Articles', value: stats.totalArticles },
    { label: 'Times opened', value: stats.totalViews },
    { label: 'Topics', value: stats.categories },
    { label: 'Quizzes', value: stats.totalQuizzes },
    { label: 'Avg. score', value: stats.totalQuizzes ? `${stats.averageScore}%` : '—' },
    { label: 'Reviews', value: stats.totalFeedback },
  ];

  return (
    <div className="newspaper-dashboard">
      {loading ? (
        <div className="newspaper-loading-state">
          <div className="newspaper-spinner"></div>
          <p>Setting today's edition…</p>
        </div>
      ) : error ? (
        <div className="newspaper-error-message">
          <p className="error-headline">{error}</p>
          <button className="newspaper-btn" onClick={fetchAllData}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="newspaper-header">
            <div className="newspaper-date">{currentDate}</div>
            <h1 className="newspaper-title">THE READER&apos;S CHRONICLE</h1>
            <div className="newspaper-subtitle">
              {userProfile?.name ? `Compiled for ${userProfile.name}` : 'Your personal reading journal'}
            </div>
            <div className="newspaper-divider"></div>
          </div>

          {/* Everything the reader has done, in one glance */}
          <div className="newspaper-stats newspaper-summary-strip">
            {summaryFigures.map((figure) => (
              <div className="newspaper-stat" key={figure.label}>
                <span className="newspaper-stat-value">{figure.value}</span>
                <span className="newspaper-stat-label">{figure.label}</span>
              </div>
            ))}
          </div>

          <div className="newspaper-content">
            <div className="newspaper-sidebar">
              <div className="newspaper-user-profile">
                <h3 className="sidebar-heading">Reader profile</h3>
                <div className="newspaper-avatar">
                  {(userProfile?.name || userProfile?.email || 'R').charAt(0).toUpperCase()}
                </div>
                <div className="newspaper-profile-info">
                  {isEditingName ? (
                    <div className="newspaper-name-edit">
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="newspaper-name-input"
                        placeholder="Enter your name"
                      />
                      <div className="newspaper-name-actions">
                        <button onClick={handleNameSave} className="newspaper-name-btn save">
                          Save
                        </button>
                        <button onClick={handleNameCancel} className="newspaper-name-btn cancel">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="newspaper-name-container">
                      <h4 className="newspaper-name">
                        {userProfile?.name || 'Distinguished Reader'}
                      </h4>
                      <button onClick={handleNameEdit} className="newspaper-name-btn edit">
                        Edit
                      </button>
                    </div>
                  )}
                  <p className="newspaper-email">{userProfile?.email}</p>
                </div>

                <div className="newspaper-interests">
                  <h4 className="sidebar-heading">Topics of interest</h4>
                  <div className="newspaper-tags">
                    {userProfile?.interests?.length > 0 ? (
                      userProfile.interests.map((interest, index) => (
                        <span key={index} className="newspaper-tag">
                          {interest}
                        </span>
                      ))
                    ) : (
                      <span className="newspaper-tag-empty">No interests recorded</span>
                    )}
                  </div>
                </div>
              </div>

              {/* A short standing column of facts drawn from the history above */}
              <div className="newspaper-glance">
                <h3 className="sidebar-heading">At a glance</h3>
                <dl className="newspaper-glance-list">
                  <div className="newspaper-glance-row">
                    <dt>Most-read topic</dt>
                    <dd className={stats.topTopic ? 'newspaper-glance-topic' : undefined}>
                      {stats.topTopic || 'Not yet known'}
                    </dd>
                  </div>
                  <div className="newspaper-glance-row">
                    <dt>Last read</dt>
                    <dd>{stats.lastRead ? formatDate(stats.lastRead) : 'Never'}</dd>
                  </div>
                  <div className="newspaper-glance-row">
                    <dt>Quiz average</dt>
                    <dd>{stats.totalQuizzes ? `${stats.averageScore}%` : 'No quizzes yet'}</dd>
                  </div>
                  <div className="newspaper-glance-row">
                    <dt>Rating given</dt>
                    <dd>
                      {stats.totalFeedback ? `${stats.averageRating} out of 5` : 'No reviews yet'}
                    </dd>
                  </div>
                </dl>
                <button className="newspaper-btn newspaper-glance-btn" onClick={() => navigate('/home')}>
                  Read something new
                </button>
              </div>
            </div>

            <div className="newspaper-main">
              <div className="newspaper-section">
                <div className="newspaper-section-header">
                  <h2 className="newspaper-section-title">Reading archives</h2>
                  <span className="newspaper-section-byline">
                    {stats.totalArticles} {stats.totalArticles === 1 ? 'article' : 'articles'} ·{' '}
                    {stats.totalViews} opened
                  </span>
                  <button
                    className="newspaper-toggle-btn"
                    onClick={() => setShowArticleHistory(!showArticleHistory)}
                    aria-expanded={showArticleHistory}
                  >
                    {showArticleHistory ? 'Collapse' : 'Expand'}
                  </button>
                </div>

                {showArticleHistory && (
                  <div className="newspaper-expanded-content">
                    {articleHistory.length > 0 ? (
                      <div className="newspaper-grid">
                        {articleHistory.map((article) => (
                          <div
                            key={article._id}
                            className="newspaper-article-card"
                            onClick={() => handleArticleClick(article)}
                          >
                            <div className="newspaper-card-header">
                              <h3 className="newspaper-article-title">{article.title}</h3>
                              <div className="newspaper-source">{article.source}</div>
                            </div>
                            <div className="newspaper-card-content">
                              <div className="newspaper-article-details">
                                {article.category && (
                                  <span className="newspaper-category">{article.category}</span>
                                )}
                                <span className="newspaper-views">
                                  Opened {article.viewCount}{' '}
                                  {article.viewCount === 1 ? 'time' : 'times'}
                                </span>
                                <span className="newspaper-read-date">
                                  Last read {formatDate(article.lastViewed)}
                                </span>
                                {article.quizAttempted && (
                                  <span className="newspaper-quiz-note">
                                    Quiz {article.quizScore}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="newspaper-empty-state">
                        <p>Nothing filed here yet.</p>
                        <button className="newspaper-btn" onClick={() => navigate('/home')}>
                          Browse the front page
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="newspaper-section">
                <div className="newspaper-section-header">
                  <h2 className="newspaper-section-title">Quiz archives</h2>
                  <span className="newspaper-section-byline">
                    {stats.totalQuizzes} taken
                    {stats.totalQuizzes > 0 ? ` · ${stats.averageScore}% average` : ''}
                  </span>
                  <button
                    className="newspaper-toggle-btn"
                    onClick={() => setShowQuizHistory(!showQuizHistory)}
                    aria-expanded={showQuizHistory}
                  >
                    {showQuizHistory ? 'Collapse' : 'Expand'}
                  </button>
                </div>

                {showQuizHistory && (
                  <div className="newspaper-expanded-content">
                    {quizHistory.length > 0 ? (
                      <div className="newspaper-grid">
                        {quizHistory.map((quiz) => {
                          const pct = Math.round(
                            (quiz.score / (quiz.totalQuestions || 1)) * 100
                          );
                          return (
                            <div
                              key={quiz._id}
                              className="newspaper-quiz-card"
                              onClick={() => handleQuizClick(quiz)}
                            >
                              <div className="newspaper-card-header">
                                <h3 className="newspaper-quiz-title">
                                  {quiz.prompt
                                    ? quiz.prompt.slice(0, 70) +
                                      (quiz.prompt.length > 70 ? '…' : '')
                                    : 'Knowledge assessment'}
                                </h3>
                                <div
                                  className={`newspaper-quiz-result ${
                                    pct >= 70 ? 'good' : pct >= 40 ? 'fair' : 'poor'
                                  }`}
                                >
                                  {quiz.score}/{quiz.totalQuestions}
                                </div>
                              </div>
                              <div className="newspaper-card-content">
                                {quiz.feedback && (
                                  <p className="newspaper-quiz-feedback">
                                    {quiz.feedback.slice(0, 110)}
                                    {quiz.feedback.length > 110 ? '…' : ''}
                                  </p>
                                )}
                                <div className="newspaper-article-details">
                                  <span className="newspaper-quiz-date">
                                    {formatDate(quiz.createdAt)}
                                  </span>
                                  <span className="newspaper-views">Click to review answers</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="newspaper-empty-state">
                        <p>No quizzes taken yet.</p>
                        <button className="newspaper-btn" onClick={() => navigate('/prompt-quiz')}>
                          Test yourself
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="newspaper-section">
                <div className="newspaper-section-header">
                  <h2 className="newspaper-section-title">Reader&apos;s opinions</h2>
                  <span className="newspaper-section-byline">
                    {stats.totalFeedback} {stats.totalFeedback === 1 ? 'review' : 'reviews'}
                    {stats.totalFeedback > 0 ? ` · ${stats.averageRating} average` : ''}
                  </span>
                  <button
                    className="newspaper-toggle-btn"
                    onClick={() => setShowFeedbackHistory(!showFeedbackHistory)}
                    aria-expanded={showFeedbackHistory}
                  >
                    {showFeedbackHistory ? 'Collapse' : 'Expand'}
                  </button>
                </div>

                {showFeedbackHistory && (
                  <div className="newspaper-expanded-content">
                    {feedbackHistory.length > 0 ? (
                      <div className="newspaper-grid">
                        {feedbackHistory.map((item) => (
                          <div key={item._id} className="newspaper-feedback-card">
                            <div className="newspaper-card-header">
                              <h3 className="newspaper-feedback-title">
                                {item.articleTitle || 'Article review'}
                              </h3>
                              <div className="newspaper-rating">
                                <span className="newspaper-stars">
                                  {'★'.repeat(item.rating) + '☆'.repeat(5 - item.rating)}
                                </span>
                                <span className="newspaper-rating-value">{item.rating}/5</span>
                              </div>
                            </div>
                            <div className="newspaper-card-content">
                              {item.feedback && (
                                <p className="newspaper-feedback-text">{item.feedback}</p>
                              )}
                              <div className="newspaper-article-details">
                                <span className="newspaper-feedback-date">
                                  {formatDate(item.createdAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="newspaper-empty-state">
                        <p>You haven&apos;t reviewed an article yet.</p>
                        <button className="newspaper-btn" onClick={() => navigate('/home')}>
                          Find an article to review
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {showQuizModal && selectedQuiz && (
            <div className="newspaper-modal-overlay" onClick={closeQuizModal}>
              <div
                className="newspaper-modal-content"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Quiz details"
              >
                <div className="newspaper-modal-header">
                  <h2 className="newspaper-modal-title">Quiz details</h2>
                  <button
                    className="newspaper-close-btn"
                    onClick={closeQuizModal}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <div className="newspaper-modal-body">
                  <div className="newspaper-quiz-details">
                    <h3 className="newspaper-quiz-prompt-title">Inquiry</h3>
                    <p className="newspaper-prompt-text">{selectedQuiz.prompt}</p>
                    <div className="newspaper-results-summary">
                      <span className="newspaper-score-detail">
                        Score {selectedQuiz.score}/{selectedQuiz.totalQuestions}
                      </span>
                      <span className="newspaper-percentage">
                        {Math.round(
                          (selectedQuiz.score / (selectedQuiz.totalQuestions || 1)) * 100
                        )}
                        % correct
                      </span>
                    </div>
                    {selectedQuiz.feedback && (
                      <div className="newspaper-feedback-detail">
                        <h3 className="newspaper-quiz-prompt-title">Examiner&apos;s notes</h3>
                        <p className="newspaper-feedback-content">{selectedQuiz.feedback}</p>
                      </div>
                    )}
                  </div>

                  <div className="newspaper-questions-section">
                    <h3 className="newspaper-questions-title">Questions &amp; responses</h3>
                    {selectedQuiz.questions && selectedQuiz.questions.length > 0 ? (
                      selectedQuiz.questions.map((question, index) => (
                        <div
                          key={index}
                          className={`newspaper-question-item ${
                            question.isCorrect ? 'correct' : 'incorrect'
                          }`}
                        >
                          <div className="newspaper-question-header">
                            <h4 className="newspaper-question-number">Question {index + 1}</h4>
                            <span
                              className={`newspaper-question-result ${
                                question.isCorrect ? 'correct' : 'incorrect'
                              }`}
                            >
                              {question.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                            </span>
                          </div>
                          <p className="newspaper-question-text">{question.question}</p>
                          <div className="newspaper-options">
                            {question.options &&
                              question.options.map((option, optionIndex) => (
                                <div
                                  key={optionIndex}
                                  className={`newspaper-option ${
                                    optionIndex === question.correctAnswer ? 'correct-answer' : ''
                                  } ${
                                    optionIndex === question.selectedAnswer &&
                                    optionIndex !== question.correctAnswer
                                      ? 'wrong-answer'
                                      : ''
                                  } ${optionIndex === question.selectedAnswer ? 'selected' : ''}`}
                                >
                                  {option}
                                </div>
                              ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="newspaper-no-questions">No questions available</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;
