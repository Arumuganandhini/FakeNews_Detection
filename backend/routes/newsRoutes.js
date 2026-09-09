// backend/routes/newsRoutes.js
const express = require('express');
const router = express.Router();
const { fetchTopNews } = require('../utils/newsFetcher');
const newsController = require('../controllers/newsController');
const authMiddleware = require('../middleware/authMiddleware');

// Get news articles
router.get('/', async (req, res) => {
  try {
    const { category = 'general' } = req.query;
    const news = await fetchTopNews(category);
    res.json({ articles: news });
  } catch (err) {
    console.error('❌ Error fetching news:', err.message);
    // Pass the real reason through — a used-up daily quota is a normal
    // condition the reader can understand, not an unexplained server error.
    res.status(err.httpStatus || 500).json({
      error: err.message || 'Error fetching news',
      code: err.code || 'NEWS_ERROR'
    });
  }
});

// Protected routes (require authentication)
router.get('/personalized', authMiddleware, newsController.getPersonalizedNews);

module.exports = router;
