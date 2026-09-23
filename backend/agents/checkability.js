// backend/agents/checkability.js
//
// Is there anything here we could actually check?
//
// Once people can paste whatever they found — a WhatsApp forward, an Instagram
// caption, a line someone said in a video — most of what arrives is not a
// factual claim at all. "They are hiding the truth from you, wake up" asserts
// nothing that any newsroom could confirm or deny. Running the pipeline on it
// produces a verdict, and that verdict is meaningless.
//
// So the gate comes first. A system that answers every question, including the
// ones it cannot answer, teaches people to distrust the answers it gets right.
// If the input will not support a verdict, we say so and say what is missing,
// instead of manufacturing one.
//
// A claim is checkable when it makes an assertion about the world that is
// specific enough to look up. In practice that means it needs an ANCHOR — a
// name, a place, a number, a date. Without one there is nothing to search for,
// and no amount of analysis invents it.
//
// Deterministic, no model call, and it runs before anything expensive.

const MIN_CHARACTERS = 40;
const MIN_WORDS = 8;

/** Words that carry no searchable specificity. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'from', 'by', 'with', 'this', 'that', 'these', 'those', 'it', 'its', 'is',
  'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'will', 'would',
  'they', 'them', 'their', 'there', 'you', 'your', 'we', 'our', 'he', 'she',
  'his', 'her', 'who', 'what', 'when', 'where', 'why', 'how', 'all', 'some',
  'more', 'most', 'very', 'just', 'now', 'then', 'than', 'so', 'if', 'not'
]);

const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

// Statements about the speaker's own feelings or preferences. These are not
// false — they are simply not the kind of thing another outlet can confirm.
const OPINION_MARKERS = /\b(i think|i believe|i feel|in my opinion|should|ought to|must be|disgusting|beautiful|terrible|wonderful|best|worst|amazing|pathetic|hate|love)\b/i;

// Pure exhortation. Characteristic of forwarded messages, and asserts nothing.
const EXHORTATION = /\b(share this|forward this|wake up|spread the word|do not let them|before (it is|it's) too late|tell everyone|pass it on)\b/i;

/**
 * The specific things a claim is about: proper nouns, numbers and dates.
 * These are what a search can be built from; everything else is connective
 * tissue.
 */
const findAnchors = (text) => {
  const raw = String(text || '');
  const names = new Set();
  const numbers = new Set();

  raw.split(/(?<=[.!?])\s+/).forEach(sentence => {
    sentence.trim().split(/\s+/).forEach((word, index) => {
      const clean = word.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
      if (!clean) return;
      if (/\d/.test(clean)) { numbers.add(clean.toLowerCase()); return; }
      // The first word of a sentence is capitalised by grammar, not by being a
      // name, so it is not counted as an anchor on its own.
      if (index === 0) return;
      if (/^\p{Lu}/u.test(clean) && clean.length > 2 && !STOPWORDS.has(clean.toLowerCase())) {
        names.add(clean);
      }
    });
  });

  const dates = MONTHS.test(raw) ? [raw.match(MONTHS)[0]] : [];
  return { names: [...names], numbers: [...numbers], dates };
};

/**
 * Decide whether a piece of user-supplied content can be fact-checked at all.
 *
 * @param {string} text - what the user pasted
 * @param {string} [title] - a headline, when there is one
 * @returns {{checkable: boolean, kind: string, reason: string|null,
 *            missing: string[], anchors: Object, anchorCount: number}}
 */
const assessCheckability = (text, title = '') => {
  const combined = `${title} ${text}`.trim();
  const words = combined.split(/\s+/).filter(Boolean);
  const anchors = findAnchors(combined);
  const anchorCount = anchors.names.length + anchors.numbers.length + anchors.dates.length;

  const result = (kind, reason, missing = []) => ({
    checkable: kind === 'claim',
    kind,
    reason,
    missing,
    anchors,
    anchorCount
  });

  if (combined.length < MIN_CHARACTERS || words.length < MIN_WORDS) {
    return result('too-short',
      'There is not enough here to check. Paste the whole message or post, including what is being claimed and who it is about.',
      ['the full text']);
  }

  // A question asks rather than asserts. There is no claim to verify.
  const withoutQuestions = combined.replace(/[^.!?]*\?/g, '').trim();
  if (withoutQuestions.split(/\s+/).filter(Boolean).length < MIN_WORDS) {
    return result('question',
      'This asks a question rather than stating something. Paste the claim you want checked, not the question about it.',
      ['a statement of what is claimed']);
  }

  if (anchorCount === 0) {
    const missing = [];
    if (anchors.names.length === 0) missing.push('who or where it happened');
    if (anchors.numbers.length === 0 && anchors.dates.length === 0) missing.push('when it happened, or a figure');

    if (EXHORTATION.test(combined)) {
      return result('unfalsifiable',
        'This tells the reader what to do but does not say what actually happened. There is no specific claim here for another outlet to confirm or deny.',
        missing);
    }
    if (OPINION_MARKERS.test(combined)) {
      return result('opinion',
        'This reads as someone’s opinion rather than a factual claim. Opinions are not true or false in a way anyone can check.',
        missing);
    }
    return result('too-vague',
      'This does not name anyone, anywhere or any figure, so there is nothing specific to look up. Add the names, places or numbers involved.',
      missing);
  }

  // It has something specific to say, but says it only about feelings.
  if (OPINION_MARKERS.test(combined) && anchorCount < 2 && !MONTHS.test(combined)) {
    return result('opinion',
      'This is mostly an opinion. We can only check statements about what happened.',
      ['a factual claim about what happened']);
  }

  return result('claim', null, []);
};

module.exports = { assessCheckability, findAnchors, MIN_CHARACTERS, MIN_WORDS };
