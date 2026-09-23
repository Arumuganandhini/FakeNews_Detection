// backend/agents/evidenceRelevance.js
//
// Is this retrieved article actually about the claim?
//
// The language model is asked a narrow question — does this coverage support or
// contradict the claim — and it answers willingly even when the coverage is
// about something else. A fabricated story about a "secret chemical leak" and an
// "overnight evacuation" retrieves real articles about some other evacuation
// somewhere else, and the model reports the claim as supported. The verdict then
// says "likely true" about an invented event, which is the most damaging error
// this system can make.
//
// The fix is not a better prompt. It is a check the model does not get to make:
// evidence only counts if it mentions what the claim is about. Distinctive terms
// — names, places, numbers, uncommon words — must be shared between the claim and
// the evidence's own headline. This is deterministic, costs nothing, and is
// applied after the model has spoken, so the model cannot argue with it.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'from', 'by', 'with', 'about', 'into', 'over', 'after', 'before', 'that',
  'this', 'these', 'those', 'it', 'its', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'has', 'have', 'had', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'said', 'says', 'say', 'told', 'according', 'new',
  'now', 'more', 'most', 'other', 'some', 'all', 'they', 'their', 'there',
  'which', 'who', 'what', 'when', 'where', 'how', 'than', 'then', 'also',
  'report', 'reports', 'reported', 'news', 'year', 'years', 'day', 'days',
  'week', 'weeks', 'month', 'months', 'people', 'government', 'officials'
]);

/**
 * Content words worth matching on. Numbers are kept — "312 patients" and
 * "40 crore" are among the most distinctive things a claim contains.
 */
const distinctiveTerms = (text) => {
  const terms = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    // Anything containing a digit is kept whatever its length: "312" is three
    // characters and is the single most identifying thing in "312 patients".
    .filter(term => (/\d/.test(term) ? term.length >= 2 : term.length > 3) && !STOPWORDS.has(term));
  return new Set(terms);
};

/** Minimum distinctive terms a piece of evidence must share with the claim. */
const MIN_SHARED_TERMS = 2;

/**
 * The terms that pin a claim to a particular event: proper nouns and numbers.
 *
 * Counting ordinary content words is not enough. "A secret chemical leak forced
 * the overnight evacuation of three districts near Visakhapatnam" and "Wildfire
 * prompts evacuation orders in northern California" share *evacuation* and
 * *overnight*, which is two content words and no connection whatsoever. What
 * separates them is the anchor: one is about Visakhapatnam and the other is not.
 *
 * Capitalisation is read from the claim before it is lowercased; the first word
 * is skipped because every sentence begins with a capital.
 */
const anchorTerms = (text) => {
  const raw = String(text || '');
  const anchors = new Set();

  const words = raw.split(/\s+/);
  words.forEach((word, index) => {
    const clean = word.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
    if (!clean) return;
    if (/\d/.test(clean)) { anchors.add(clean.toLowerCase()); return; }
    if (index === 0) return;
    if (/^\p{Lu}/u.test(clean) && clean.length > 3 && !STOPWORDS.has(clean.toLowerCase())) {
      anchors.add(clean.toLowerCase());
    }
  });

  return anchors;
};

/**
 * Does this evidence item plausibly concern the claim?
 *
 * @param {string} claim
 * @param {{title?: string, description?: string}} evidence
 * @returns {{relevant: boolean, shared: string[], sharedAnchors: string[], score: number}}
 */
const isRelevant = (claim, evidence) => {
  const claimTerms = distinctiveTerms(claim);
  const evidenceText = `${evidence?.title || ''} ${evidence?.description || ''}`;
  const evidenceTerms = distinctiveTerms(evidenceText);

  const shared = [...claimTerms].filter(term => evidenceTerms.has(term));
  const anchors = anchorTerms(claim);
  const sharedAnchors = [...anchors].filter(term => evidenceTerms.has(term));

  // A claim with almost no distinctive vocabulary cannot be matched this way, so
  // the gate stands aside rather than rejecting everything. Being unable to
  // check relevance is not evidence of irrelevance.
  if (claimTerms.size < MIN_SHARED_TERMS) {
    return { relevant: true, shared, sharedAnchors, score: 0, unchecked: true };
  }

  const score = claimTerms.size ? shared.length / claimTerms.size : 0;

  // With anchors present, one of them must appear: the evidence has to be about
  // the same place, body, person or quantity. Without anchors there is nothing
  // to pin to, so a substantial share of the claim's vocabulary is required
  // instead.
  const relevant = anchors.size > 0
    ? (sharedAnchors.length >= 1 && shared.length >= MIN_SHARED_TERMS)
    : (shared.length >= MIN_SHARED_TERMS && score >= 0.3);

  return { relevant, shared, sharedAnchors, score: Math.round(score * 100) / 100 };
};

/**
 * Drop evidence that is not about the claim, and report what was dropped.
 *
 * @returns {{kept: Array, dropped: Array, note: string|null}}
 */
const filterRelevant = (claim, evidenceItems = []) => {
  const kept = [];
  const dropped = [];

  for (const item of evidenceItems) {
    const verdict = isRelevant(claim, item);
    if (verdict.relevant) {
      kept.push({ ...item, sharedTerms: verdict.shared });
    } else {
      dropped.push({ source: item.source, title: item.title });
    }
  }

  return {
    kept,
    dropped,
    note: dropped.length
      ? `${dropped.length} retrieved article${dropped.length > 1 ? 's were' : ' was'} discarded for not being about this claim.`
      : null
  };
};

module.exports = { isRelevant, filterRelevant, distinctiveTerms, anchorTerms, MIN_SHARED_TERMS };
