// backend/utils/domainAge.js
//
// How long ago a site's domain was registered, from the public registration
// record (RDAP, the registries' own replacement for WHOIS).
//
// A lookalike news site is usually days or weeks old: bbc-breaking-news.xyz is
// registered for the campaign it serves. A real newsroom's domain is years old.
// Age cannot be faked after the fact, but an old domain can be bought, so this
// is used in one direction only — a very young domain counts against a story,
// an old one earns nothing. That is the same one-sided rule the rest of the
// scoring follows for anything a publisher can arrange.
//
// A lookup that could not run returns null, never a guess. "We could not ask
// the registry" is not "the domain is old".
const axios = require('axios');

const RDAP_BOOTSTRAP = 'https://rdap.org/domain/';
const TIMEOUT_MS = 4000;

// Declared, not measured: under three months is young enough that a site
// cannot have built a publishing record. It is used only as one warning sign
// among several (verdictEngine R7), never as a verdict by itself.
const YOUNG_DOMAIN_DAYS = 90;

// The registrable domain: news.example.co.uk -> example.co.uk.
const registrable = (host) => {
  const labels = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  const secondLevel = /^(co|com|org|net|gov|ac|edu|or|ne|go)$/;
  const keep = labels.length >= 3 && secondLevel.test(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-keep).join('.');
};

const cache = new Map();

/**
 * @param {string} url - the page's address
 * @returns {Promise<{domain: string, registered: string, ageDays: number, young: boolean}|null>}
 */
const domainAge = async (url) => {
  let host;
  try { host = new URL(url).hostname; } catch (_) { return null; }
  const domain = registrable(host);
  if (!domain || !domain.includes('.')) return null;
  if (cache.has(domain)) return cache.get(domain);

  let result = null;
  try {
    const { data } = await axios.get(`${RDAP_BOOTSTRAP}${encodeURIComponent(domain)}`, {
      timeout: TIMEOUT_MS,
      maxRedirects: 3,
      headers: { Accept: 'application/rdap+json' }
    });
    const event = (data.events || []).find(e => e.eventAction === 'registration');
    const registered = event && new Date(event.eventDate);
    if (registered && !Number.isNaN(registered.getTime())) {
      const ageDays = Math.floor((Date.now() - registered.getTime()) / 86400000);
      result = { domain, registered: registered.toISOString().slice(0, 10), ageDays, young: ageDays < YOUNG_DOMAIN_DAYS };
    }
  } catch (_) {
    // Not cached: a registry that did not answer this time may answer next.
    return null;
  }
  if (result) cache.set(domain, result);
  return result;
};

module.exports = { domainAge, registrable, YOUNG_DOMAIN_DAYS };
