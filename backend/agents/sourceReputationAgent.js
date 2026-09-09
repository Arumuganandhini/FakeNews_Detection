// backend/agents/sourceReputationAgent.js
// Factor 1: Source reputation — deterministic lookup against a curated
// database of media reliability ratings. No LLM involved.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/sourceReputation.json');
let db = null;

function loadDb() {
  if (!db) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  }
  return db;
}

// Split a source name or domain into comparable words:
// lowercase, drop protocol/www/TLD/path, split on punctuation, drop a leading "the".
function tokenize(str) {
  const tokens = String(str || '')
    .toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|in|co\.uk|co)\b.*$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens[0] === 'the' ? tokens.slice(1) : tokens;
}

// Joined form used for exact comparison ("ABC News" and "abcnews.com" -> "abcnews").
function joinKey(str) {
  return tokenize(str).join('');
}

// True when one name is the other with extra trailing words ("BBC" ~ "BBC News").
// Matching whole words prevents false hits like "Yahoo Entertainment" ~ "RT",
// which a plain substring check would wrongly accept.
function isPrefixMatch(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return false;
  const [shorter, longer] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  return shorter.every((token, i) => token === longer[i]);
}

/**
 * Look up the reputation of a news source.
 * @param {string} sourceName - Source name as reported by the news API (e.g. "BBC News")
 * @param {string} [articleUrl] - Optional article URL, used as a fallback domain match
 * @returns {{score: number, bias: string, type: string, matched: boolean, matchedName: string|null, notes: string}}
 */
function getSourceReputation(sourceName, articleUrl) {
  const { sources, unknownSource } = loadDb();
  const nameKey = joinKey(sourceName);
  const nameTokens = tokenize(sourceName);

  let domainKey = '';
  if (articleUrl) {
    try {
      domainKey = joinKey(new URL(articleUrl).hostname);
    } catch (_) { /* invalid URL — ignore */ }
  }

  const asResult = (entry) => ({
    score: entry.reliability,
    bias: entry.bias,
    type: entry.type,
    matched: true,
    matchedName: entry.name,
    notes: entry.notes || `Rated ${entry.reliability}/10 for factual reporting; editorial lean: ${entry.bias}.`
  });

  // Pass 1 — exact match on the full name or the article's domain.
  for (const entry of sources) {
    const candidates = [entry.name, ...(entry.aliases || [])];
    const hit = candidates.some(c => {
      const key = joinKey(c);
      return key && (key === nameKey || key === domainKey);
    });
    if (hit) return asResult(entry);
  }

  // Pass 2 — whole-word prefix match ("BBC" matches "BBC News").
  for (const entry of sources) {
    const candidates = [entry.name, ...(entry.aliases || [])];
    if (candidates.some(c => isPrefixMatch(tokenize(c), nameTokens))) {
      return asResult(entry);
    }
  }

  return {
    score: unknownSource.reliability,
    bias: unknownSource.bias,
    type: unknownSource.type,
    matched: false,
    matchedName: null,
    notes: unknownSource.notes
  };
}

module.exports = { getSourceReputation };
