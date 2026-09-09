const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Articles come from a news feed, not from a local collection — every other
  // model keys them by URL. This was an ObjectId referencing an "Article" model
  // that does not exist, so every save threw a cast error before reaching the
  // database.
  articleId: {
    type: String,
    required: true
  },
  articleTitle: String,
  questions: [{
    question: String,
    options: [String],
    // Indices into `options`, matching the quiz format the rest of the app uses.
    correctAnswer: Number,
    selectedAnswer: Number,
    isCorrect: Boolean
  }],
  score: {
    type: Number,
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  feedback: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create compound index for userId and articleId
quizSchema.index({ userId: 1, articleId: 1 });

module.exports = mongoose.model('Quiz', quizSchema); 