// backend/agents/referenceCheck.js
//
// Checking an article's PREMISES, as opposed to its events.
//
// Cross-source verification asks whether other newsrooms report the same event.
// That is the right question, and it has a blind spot: a news index only covers
// what was recently published, so a claim resting on a false premise sails
// through it. "Prime Minister Rahul Gandhi announced a new scheme" describes an
// event no outlet reports — which our pipeline correctly calls unconfirmed —
// when the real finding is that the premise is wrong, and a reference work
// settles it in one lookup.
//
// This is the gap. "Cannot verify" is by far our most common outcome, and a
// large share of it is claims about STABLE facts rather than events: who holds
// an office, when an organisation was founded, whether a treatment is approved.
// A news search cannot answer those. Wikipedia can.
//
// The division of labour is deliberate and the two are not merged:
//
//   news search  -> did this EVENT happen?        (independent outlets)
//   this module  -> are the article's PREMISES right?  (a reference work)
//
// Wikipedia is not an independent newsroom and is never counted as one. A
// Wikipedia article agreeing that a minister exists does not corroborate a story
// about what the minister did. It is used only in the direction where it is
// strong: catching a stated fact about a known entity that the reference work
// flatly contradicts.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { fetchWikipediaContent } = require('../utils/wikipedia');
const { findAnchors } = require('./checkability');

/** How many entities to look up. Each costs one search plus one extract. */
const MAX_ENTITIES = 2;

// Titles and honorifics attach to names and are not names themselves. Left in,
// "Prime Minister Rahul Gandhi" retrieves the encyclopedia's article on the
// OFFICE of prime minister, which says nothing about the person and wastes the
// lookup. Stripped, the same phrase retrieves the person.
const TITLES = /^(prime |chief |deputy |vice |former |ex[- ])?(minister|president|secretary|justice|governor|mayor|commissioner|director|chairman|chairperson|professor|doctor|dr|mr|mrs|ms|sir|lord|general|colonel|captain|inspector|officer|spokesperson|leader)\b/i;

const stripTitle = (name) => {
  let stripped = String(name).trim();
  // Applied repeatedly: "Prime Minister Rahul Gandhi" sheds "Prime Minister"
  // in two passes, not one.
  for (let i = 0; i < 3; i++) {
    const next = stripped.replace(TITLES, '').trim();
    if (next === stripped) break;
    stripped = next;
  }
  return stripped;
};

// Days and months are capitalised and are not subjects to look up.
const CALENDAR = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)$/i;

/**
 * Which entities are worth the lookup?
 *
 * Ranking by length alone picks the longest name, which is routinely an
 * incidental one — in "Prime Minister Rahul Gandhi announced ... Meera Krishnan
 * attended", it chose Meera Krishnan and dropped the subject of the sentence.
 * What the article is ABOUT is what needs checking, and the headline is the
 * best available statement of that, so a name appearing there outranks
 * everything else; failing that, the earlier a name appears the more central it
 * usually is.
 */
const rankEntities = (names, title = '') => {
  const headline = String(title).toLowerCase();
  const cleaned = [];
  const seen = new Set();

  names.forEach((raw, position) => {
    const name = stripTitle(raw);
    // What remains after the title is removed must still be a name: a phrase
    // that was ONLY a title has nothing to look up.
    if (name.length <= 3 || TITLES.test(name) || CALENDAR.test(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cleaned.push({ name, position, inTitle: headline.includes(key) });
  });

  return cleaned
    .sort((a, b) =>
      (b.inTitle - a.inTitle) ||
      (a.position - b.position) ||
      (b.name.length - a.name.length))
    .slice(0, MAX_ENTITIES)
    .map(entry => entry.name);
};

/**
 * Group adjacent capitalised words into one name, so "Rahul Gandhi" is looked
 * up as a person rather than as "Rahul" and "Gandhi" separately.
 */
const groupNames = (text) => {
  const grouped = [];
  for (const sentence of String(text || '').split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/);
    let run = [];
    words.forEach((word, index) => {
      const clean = word.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
      const isName = clean.length > 2 && /^\p{Lu}/u.test(clean) && index > 0;
      if (isName) {
        run.push(clean);
      } else {
        if (run.length) grouped.push(run.join(' '));
        run = [];
      }
    });
    if (run.length) grouped.push(run.join(' '));
  }
  return [...new Set(grouped)];
};

/**
 * Does a reference work contradict what this article says about the entities
 * it names?
 *
 * @param {string} title
 * @param {string} content
 * @returns {Promise<{status: string, checked: Array, contradictions: Array, explanation: string}>}
 */
const checkPremises = async (title, content) => {
  const text = `${title}. ${content || ''}`;
  const anchors = findAnchors(text);
  if (anchors.names.length === 0) {
    return { status: 'no-entities', checked: [], contradictions: [], explanation: 'This article names no person or organisation to look up.' };
  }

  const entities = rankEntities(groupNames(text), title);
  if (entities.length === 0) {
    return { status: 'no-entities', checked: [], contradictions: [], explanation: 'This article names no person or organisation to look up.' };
  }

  try {
    const lookups = await Promise.all(entities.map(async (entity) => {
      // A lookup that could not run is marked, not silently emptied: the
      // reference work having no entry for someone is a fact about the
      // reference work, while being unable to ask it is a fact about us.
      let articles;
      try {
        articles = await fetchWikipediaContent(entity, 1);
      } catch (err) {
        return { entity, lookupFailed: true };
      }
      if (!articles.length || !articles[0].content) return null;
      return { entity, reference: articles[0] };
    }));

    const found = lookups.filter(l => l && l.reference);
    if (found.length === 0) {
      // Every lookup failing means the reference work was unreachable, not
      // that none of these names has an entry.
      if (lookups.every(l => l && l.lookupFailed)) {
        return {
          status: 'error',
          checked: [],
          contradictions: [],
          explanation: 'The reference work could not be reached, so the article’s premises were not tested.'
        };
      }
      return { status: 'not-found', checked: [], contradictions: [], explanation: 'No reference entry was found for the names in this article.' };
    }

    const results = await Promise.all(found.map(async ({ entity, reference }) => {
      const judgement = await judgeAgainstReference(title, content, entity, reference);
      return { entity, reference: { title: reference.title, url: reference.url }, ...judgement };
    }));

    const contradictions = results.filter(r => r.contradicts);
    const failures = results.filter(r => r.failed);

    // A judgement that could not run is not a judgement that found nothing.
    // Treating the two alike would report "we checked this subject and it was
    // consistent" about a lookup that never completed — the same error this
    // project removes everywhere else, and the reason the identical article can
    // come back contradicted on one run and unverified on the next when the
    // model provider is rate-limiting.
    if (failures.length === results.length) {
      return {
        status: 'error',
        checked: results,
        contradictions: [],
        explanation: 'The reference check could not be completed, so the article’s premises were not tested.'
      };
    }

    return {
      status: contradictions.length ? 'contradicted' : 'consistent',
      checked: results,
      contradictions,
      partialFailure: failures.length > 0,
      explanation: contradictions.length
        ? `A reference entry contradicts what this article states about ${contradictions.map(c => c.entity).join(' and ')}.`
        : `Checked ${results.length - failures.length} named ${results.length - failures.length === 1 ? 'subject' : 'subjects'} against reference entries and found nothing contradicted`
          + (failures.length ? `; ${failures.length} could not be checked.` : '.')
    };
  } catch (err) {
    // Consistent with the rest of the pipeline: a check that could not run
    // contributes nothing, and says so, rather than guessing.
    return { status: 'error', checked: [], contradictions: [], explanation: 'The reference check could not run.' };
  }
};

/**
 * Ask the model one narrow question over retrieved text.
 *
 * The framing matters. A reference entry will be silent about almost everything
 * an article says — it is an encyclopaedia, not a newswire — and silence must
 * not read as disagreement. Only a DIRECT conflict counts, and the model has to
 * quote the reference text that conflicts, so the claim can be checked rather
 * than taken on trust.
 */
const judgeAgainstReference = async (title, content, entity, reference) => {
  const prompt = `You are checking whether an encyclopedia entry CONTRADICTS a news article's stated facts about one subject.

Subject: ${entity}

Encyclopedia entry:
"""
${String(reference.content).slice(0, 1200)}
"""

News article:
Title: ${title}
Text: ${String(content || '').slice(0, 900)}

The encyclopedia will not mention most of what the article says. That is normal and is NOT a contradiction. Answer "contradicts": true ONLY if the entry states something that directly conflicts with a fact the article asserts about ${entity} — for example a different office holder, a different date, a different organisation.

Respond with ONLY a JSON object:
{
  "contradicts": <true or false>,
  "article_states": "<what the article says about ${entity}, in one short sentence>",
  "reference_states": "<the conflicting sentence copied exactly from the encyclopedia entry, or empty if there is no conflict>"
}`;

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 400, requiredKeys: ['contradicts'], label: 'premise check' });
    const referenceStates = String(result.reference_states || '').trim();

    // The model must ground a contradiction in the reference text. An assertion
    // with no quotation behind it, or a quotation that is not actually in the
    // entry, is discarded — the same rule the news evidence is held to.
    const quoted = referenceStates.length > 10
      && String(reference.content).toLowerCase().includes(referenceStates.slice(0, 40).toLowerCase());

    return {
      contradicts: Boolean(result.contradicts) && quoted,
      articleStates: String(result.article_states || ''),
      referenceStates: quoted ? referenceStates : '',
      ungrounded: Boolean(result.contradicts) && !quoted
    };
  } catch (_) {
    return { contradicts: false, articleStates: '', referenceStates: '', failed: true };
  }
};

module.exports = { checkPremises, groupNames, rankEntities, MAX_ENTITIES };
