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
    throw new Error('That does not look like a valid link.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only web links (http or https) can be checked.');
  }

  const { address } = await dns.lookup(parsed.hostname).catch(() => {
    throw new Error('We could not reach that website.');
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
    throw new Error('That link points to a private address and cannot be checked.');
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
    throw new Error('That link does not appear to be a news article page.');
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

  const paragraphs = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
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
    throw new Error('We could not read a headline from that page.');
  }
  // Fall back to the page description when paragraph extraction finds little
  // (common on sites that render the body with JavaScript).
  const bodyText = content.length >= 200 ? content : description;
  if (!bodyText || bodyText.length < 80) {
    throw new Error('We could not read enough of that article to check it. Try opening the link and pasting a different one.');
  }

  return {
    title,
    content: bodyText,
    description: description || bodyText.slice(0, 300),
    source: { name: siteName || parsed.hostname.replace(/^www\./, '') },
    url: parsed.href,
    urlToImage: image || null,
    publishedAt: publishedAt || new Date().toISOString(),
    extractedChars: bodyText.length
  };
};

// assertPublicUrl is exported so anything else that fetches a third-party page
// (the fact-check reader, for one) reuses this guard rather than growing its
// own copy that could drift out of step.
module.exports = { extractArticle, assertPublicUrl, MAX_BYTES, FETCH_TIMEOUT };
