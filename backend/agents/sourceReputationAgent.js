// backend/agents/sourceReputationAgent.js
// Factor 1: Source reputation — deterministic lookup against a curated
// database of media reliability ratings. No LLM involved.
//
// WHO PUBLISHED THIS IS DECIDED BY THE WEB ADDRESS, NOT BY THE PAGE.
//
// This lookup used to match on the name a page gives itself — its og:site_name
// tag — and fell back to the address only when that failed. A page chooses its
// own site name, so any site could call itself "BBC News" and inherit the BBC's
// 9/10 record. Measured: bbc-breaking-news.xyz, bbc-world.com and
// bbc.news-today.com were all accepted as the BBC, and reuters-updates.info as
// Reuters. A fabricated story on any of them was then described as "an
// exclusive that others have not yet matched" at a probability of fabrication
// of a few per cent. That is author-controlled evidence establishing trust,
// which is exactly what this project's scoring rule forbids everywhere else.
//
// So a record is granted only on a registered domain the outlet publishes from
// (or a subdomain of it), or on a platform channel whose address is listed as
// the outlet's own. A page that CLAIMS a known outlet's name from any other
// address gets no record, and the claim is kept as evidence against it:
// passing a page off as a newsroom is a fabrication technique, and
// author-controlled evidence may always incriminate.
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

// Platforms host anyone's account under any name. A name there tells us what
// an account calls itself, not who runs it; only a listed channel address does.
const PLATFORM_HOSTS = [
  'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'facebook.com', 'fb.watch', 'instagram.com',
  'threads.net', 'tiktok.com', 't.me', 'telegram.me', 'reddit.com', 'linkedin.com', 'whatsapp.com'
];

// Archives, caches and translation proxies serve genuine pages from someone
// else's address. The site name they carry is usually true, so a mismatch
// there is not impersonation — but the address cannot vouch for it either.
const MIRROR_HOSTS = [
  'web.archive.org', 'archive.org', 'archive.ph', 'archive.today', 'archive.is',
  'ampproject.org', 'translate.goog', 'googleusercontent.com'
];

// Names too common for a claim of them to mean impersonation. Plenty of
// genuine papers are called The Guardian, The Sun or The Independent; a claim
// is only meaningful for a distinctive name like "BBC News" or "Reuters".
const GENERIC_NAMES = new Set([
  'guardian', 'independent', 'mirror', 'time', 'sun', 'science', 'nature', 'mint', 'insider',
  'economist', 'telegraph', 'wire', 'vox', 'times', 'express', 'post', 'herald'
]);

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

const looksLikeDomain = (s) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(String(s || '').trim());

const parseAddress = (url) => {
  try {
    const u = new URL(url);
    return {
      host: u.hostname.toLowerCase().replace(/^(www|m)\./, ''),
      path: u.pathname.toLowerCase().replace(/\/+$/, '')
    };
  } catch (_) {
    return null;
  }
};

// On the domain itself or any subdomain of it: news.bbc.co.uk is the BBC,
// bbc.news-today.com is not.
const onHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const hostIn = (host, list) => list.some(d => onHost(host, d));

// "bbc.co.uk/sport" -> { host: 'bbc.co.uk', path: '/sport' }
const splitSpec = (spec) => {
  const [host, ...rest] = String(spec).toLowerCase().replace(/\/+$/, '').split('/');
  return { host, path: rest.length ? `/${rest.join('/')}` : '', length: String(spec).length };
};

/** The outlet that publishes from this address, most specific match first. */
function outletForAddress({ host, path: urlPath }) {
  let best = null;
  for (const entry of loadDb().sources) {
    for (const spec of (entry.domains || []).map(splitSpec)) {
      if (!onHost(host, spec.host)) continue;
      if (spec.path && !(urlPath === spec.path || urlPath.startsWith(`${spec.path}/`))) continue;
      if (!best || spec.length > best.length) best = { entry, length: spec.length };
    }
  }
  return best ? best.entry : null;
}

/** The outlet a platform channel belongs to, when its address is listed. */
function outletForChannel({ host, path: urlPath }) {
  const address = `${host}${urlPath}`;
  for (const entry of loadDb().sources) {
    for (const channel of entry.channels || []) {
      const c = String(channel).toLowerCase().replace(/^(www|m)\./, '').replace(/\/+$/, '');
      if (address === c || address.startsWith(`${c}/`)) return entry;
    }
  }
  return null;
}

/**
 * The known outlet a name claims to be, compared exactly. Used only to recognise
 * impersonation, never to grant a record. Exact rather than prefix: "CNN-News18"
 * is a licensed Indian channel, not a CNN impersonator, and a false accusation
 * costs a genuine publisher more than a missed one costs us — the page still
 * gets no record either way.
 */
function claimedOutlet(sourceName) {
  const key = joinKey(sourceName);
  if (key.length < 3 || GENERIC_NAMES.has(key)) return null;
  for (const entry of loadDb().sources) {
    const names = [entry.name, ...(entry.aliases || []).filter(a => !looksLikeDomain(a))];
    if (names.some(n => joinKey(n) === key)) return entry;
  }
  return null;
}

/** Match on the name alone. Only for names from a curated dataset. */
function outletForTrustedName(sourceName) {
  const { sources } = loadDb();
  const nameKey = joinKey(sourceName);
  const nameTokens = tokenize(sourceName);
  for (const entry of sources) {
    if ([entry.name, ...(entry.aliases || [])].some(c => joinKey(c) && joinKey(c) === nameKey)) return entry;
  }
  for (const entry of sources) {
    if ([entry.name, ...(entry.aliases || [])].some(c => isPrefixMatch(tokenize(c), nameTokens))) return entry;
  }
  return null;
}

/**
 * Look up the reputation of a news source.
 *
 * @param {string} sourceName - the name the source goes by, however obtained
 * @param {string} [articleUrl] - the page's address; this, not the name, decides identity
 * @param {{trustedName?: boolean}} [options] - trustedName: the name comes from a
 *   curated dataset rather than from the page or the user, so it may be matched
 *   when there is no address (offline evaluation only)
 * @returns {{score: number, bias: string, type: string, matched: boolean,
 *   matchedName: string|null, notes: string, verifiedBy?: string, impersonates?: string}}
 */
function getSourceReputation(sourceName, articleUrl, { trustedName = false } = {}) {
  const { unknownSource } = loadDb();

  const asResult = (entry, verifiedBy) => ({
    score: entry.reliability,
    bias: entry.bias,
    type: entry.type,
    matched: true,
    matchedName: entry.name,
    verifiedBy,
    notes: entry.notes || `Rated ${entry.reliability}/10 for factual reporting; editorial lean: ${entry.bias}.`
  });

  const unknown = (notes, extra = {}) => ({
    score: unknownSource.reliability,
    bias: unknownSource.bias,
    type: unknownSource.type,
    matched: false,
    matchedName: null,
    notes: notes || unknownSource.notes,
    ...extra
  });

  const address = articleUrl ? parseAddress(articleUrl) : null;

  if (address && address.host) {
    if (hostIn(address.host, PLATFORM_HOSTS)) {
      const owner = outletForChannel(address);
      return owner
        ? asResult(owner, 'channel')
        : unknown('Posted on a platform where any account can use any name. This account is not one we hold as belonging to a newsroom.');
    }

    const owner = outletForAddress(address);
    if (owner) return asResult(owner, 'domain');

    if (hostIn(address.host, MIRROR_HOSTS)) {
      return unknown('Served from an archive or cache, so the address cannot confirm who first published it.');
    }

    const claimed = claimedOutlet(sourceName);
    if (claimed) {
      return unknown(
        `This page presents itself as ${claimed.name}, but it is not published on any web address ${claimed.name} uses. Passing a page off as a known newsroom is a common way of lending a fabricated story credibility.`,
        { impersonates: claimed.name }
      );
    }
    return unknown();
  }

  // No address. A name alone is only as good as whoever supplied it: a curated
  // dataset's label can be trusted; a name typed beside a screenshot or a
  // pasted message cannot, because the screenshot is the thing in question.
  if (trustedName) {
    const entry = outletForTrustedName(sourceName);
    if (entry) return asResult(entry, 'name');
  }
  return unknown();
}

module.exports = { getSourceReputation, claimedOutlet };
