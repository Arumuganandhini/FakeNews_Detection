const mongoose = require('mongoose');

// Full article text fetched from the publisher's page, keyed by article URL.
//
// The news feed only supplies about 200 characters of each article plus a
// "[+8026 chars]" marker. Everything downstream — both summaries and all six
// trust factors — was therefore judging a stub: the "long" summary had no more
// material than the short one, and asking for detail from two sentences is what
// made earlier versions invent content.
//
// Fetching the page costs 1-3 seconds and no model call, and yields 2,000-6,000
// characters. Doing it once per article and storing the result keeps that cost
// off every later read.
//
// `status` records outcomes as well as successes, so a page that cannot be
// fetched is not retried on every visit.
const articleTextCacheSchema = new mongoose.Schema({
  articleUrl: { type: String, required: true, unique: true, index: true },
  text: { type: String, default: '' },
  chars: { type: Number, default: 0 },
  status: { type: String, enum: ['ok', 'unavailable'], default: 'ok' },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 14 } // 14 days
});

module.exports = mongoose.models.ArticleTextCache
  || mongoose.model('ArticleTextCache', articleTextCacheSchema);
