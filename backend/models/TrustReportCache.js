const mongoose = require('mongoose');

// Cached trust analysis, keyed by article URL.
// Analysis takes several seconds and several LLM calls, so the first reader
// pays that cost and everyone after them gets the report instantly. Entries
// expire automatically so a re-analysis happens if an article is revisited
// much later.
const trustReportCacheSchema = new mongoose.Schema({
  articleUrl: { type: String, required: true, unique: true, index: true },
  title: { type: String },
  source: { type: String },
  report: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 14 } // 14 days
});

module.exports = mongoose.models.TrustReportCache
  || mongoose.model('TrustReportCache', trustReportCacheSchema);
