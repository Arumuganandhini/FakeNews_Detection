// backend/utils/articleExtractor.js
// Fetch a news article from a user-supplied URL and pull out its title, text
// and publisher, so the trust pipeline can analyze links people receive on
// WhatsApp or social media — not just articles from our own feed.
//
// No HTML-parsing dependency: news articles put their body text in <p> tags,
// so stripping non-content elements and collecting paragraphs is enough.
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB is far more than any article page needs
const FETCH_TIMEOUT = 12000;

/**
 * Reject anything that is not a public http(s) address.
 * A user-supplied URL must never be usable to reach internal services.
 */
const assertPublicUrl = async (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    const badUrl = new Error('That does not look like a valid link.');
    // The caller maps this to 400: a malformed link is the request's problem,
    // not a fault on our side, and a 500 tells monitoring the wrong story.
    badUrl.code = 'BAD_URL';
    throw badUrl;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const scheme = new Error('Only web links (http or https) can be checked.');
    scheme.code = 'BAD_URL';
    throw scheme;
  }

  const { address } = await dns.lookup(parsed.hostname).catch(() => {
    // A host that does not resolve is not a fault on our side, and it is not
    // a finding about the article either. Reported as 500 it told monitoring
    // the server had broken; the reader now gets 422 and the two things they
    // can do instead.
    const unreachable = new Error('We could not reach that website.');
    unreachable.code = 'FETCH_FAILED';
    throw unreachable;
  });

  const isPrivate = (ip) => {
    if (net.isIPv4(ip)) {
      const [a, b] = ip.split('.').map(Number);
      return a === 10 || a === 127 || a === 0 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) ||
        (a === 100 && b >= 64 && b <= 127);
    }
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  };

  if (isPrivate(address)) {
    // Refusing to fetch our own network is a guard working, not a crash.
    const priv = new Error('That link points to a private address and cannot be checked.');
    priv.code = 'BAD_URL';
    throw priv;
  }

  return parsed;
};

const decodeEntities = (str) => String(str || '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const stripTags = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const metaContent = (html, patterns) => {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1] && match[1].trim()) return decodeEntities(match[1].trim());
  }
  return '';
};

/**
 * Extract the readable article from a news page.
 * @param {string} rawUrl
 * @returns {Promise<{title, content, description, source, url, extractedChars}>}
 */
const extractArticle = async (rawUrl) => {
  const parsed = await assertPublicUrl(rawUrl);

  let html;
  try {
    const response = await axios.get(parsed.href, {
      timeout: FETCH_TIMEOUT,
      maxContentLength: MAX_BYTES,
      maxRedirects: 3,
      responseType: 'text',
      headers: {
        // Some publishers serve a blocking page to unknown clients.
        'User-Agent': 'Mozilla/5.0 (compatible; NewsTrustBot/1.0; +news-trust-analysis)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    html = String(response.data || '');
  } catch (err) {
    // Many publishers block non-browser traffic outright. That is not the
    // reader's mistake, so say so plainly and let the caller still report
    // what it knows about the publisher.
    const blocked = new Error(
      `${parsed.hostname.replace(/^www\./, '')} does not allow its pages to be read automatically, so we cannot check this article's contents.`
    );
    blocked.code = 'FETCH_BLOCKED';
    blocked.hostname = parsed.hostname;
    blocked.url = parsed.href;
    throw blocked;
  }

  if (!/<html|<body|<p[\s>]/i.test(html)) {
    const notArticle = new Error('That link does not appear to be a news article page.');
    notArticle.code = 'FETCH_FAILED';
    throw notArticle;
  }

  // Remove everything that is not article prose before collecting paragraphs.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ');

  // Scope to the page's own article container when it declares one.
  //
  // News templates ship unbalanced markup as a matter of course: the BBC
  // article page measured here has 76 <p> opens against 37 </p> closes. The
  // paragraph regex below is non-greedy, so a stray unclosed <p> up in the
  // site chrome runs on to the first real </p> and returns one "paragraph"
  // holding the whole navigation, the headline, the byline and the lede —
  // "Home News Sport Business Technology … Five men have been arrested". That
  // text is then what every content factor scores and what claim extraction
  // reads. Restricting the search to <article> or <main> costs nothing on
  // pages that have neither.
  const container = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const scoped = container && container[1].length > 500 ? container[1] : cleaned;

  // A paragraph may not span another paragraph tag. With the plain non-greedy
  // form, an unclosed <p> still absorbs whatever sits between it and the next
  // </p> — on the same BBC page that meant the share widget and byline were
  // glued to the front of the lede. Refusing to cross a <p> boundary leaves
  // the paragraph count unchanged and starts the text at the first real
  // sentence.
  const paragraphs = [...scoped.matchAll(/<p[^>]*>((?:(?!<\/?p[\s>])[\s\S])*?)<\/p>/gi)]
    .map(m => stripTags(m[1]))
    // Drop boilerplate lines: cookie notices, share prompts, bylines.
    .filter(text => text.length >= 60 && /[.!?]/.test(text));

  const content = paragraphs.join('\n\n').slice(0, 6000);

  const title = metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
  ]).replace(/\s*[|\-–—]\s*[^|\-–—]{0,40}$/, '').trim(); // drop trailing " | Site Name"

  const description = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ]);

  const siteName = metaContent(html, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i
  ]);

  const image = metaContent(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  ]);

  const publishedAt = metaContent(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i
  ]);

  if (!title) {
    const noTitle = new Error('We could not read a headline from that page.');
    noTitle.code = 'FETCH_FAILED';
    throw noTitle;
  }
  // Fall back to the page description when paragraph extraction finds little
  // (common on sites that render the body with JavaScript).
  const bodyText = content.length >= 200 ? content : description;
  if (!bodyText || bodyText.length < 80) {
    const tooLittle = new Error('We could not read enough of that article to check it. Try opening the link and pasting a different one.');
    tooLittle.code = 'FETCH_FAILED';
    throw tooLittle;
  }

  return {
    title,
    content: bodyText,
    description: description || bodyText.slice(0, 300),
    source: { name: siteName || parsed.hostname.replace(/^www\./, '') },
    url: parsed.href,
    urlToImage: image || null,
    publishedAt: publishedAt || new Date().toISOString(),
    // Whether that date came from the page or is just "now". A guessed date
    // must not be allowed to stand in for a real one when the freshness of
    // the article decides whether an absence of coverage means anything.
    publishedAtKnown: Boolean(publishedAt),
    extractedChars: bodyText.length
  };
};

// assertPublicUrl is exported so anything else that fetches a third-party page
// (the fact-check reader, for one) reuses this guard rather than growing its
// own copy that could drift out of step.
module.exports = { extractArticle, assertPublicUrl, MAX_BYTES, FETCH_TIMEOUT };
