const express = require('express');
const router = express.Router();
// The same check every other protected route uses. A second copy existed here
// that wrote each reader's email address to the server log on every request.
const authMiddleware = require('../middleware/authMiddleware');
const articleHistoryController = require('../controllers/articleHistoryController');

// Track article view
router.post('/track-view', authMiddleware, articleHistoryController.trackArticleView);

// Get user's article history
router.get('/history', authMiddleware, articleHistoryController.getUserArticleHistory);

module.exports = router;
