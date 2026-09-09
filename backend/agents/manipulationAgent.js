// backend/agents/manipulationAgent.js
//
// Propaganda / persuasion-technique detection.
//
// The bias factor answers "is this article slanted?". This answers a sharper
// question: "which specific rhetorical techniques is it using on the reader?"
//
// The taxonomy follows the propaganda-technique literature — SemEval-2020
// Task 11 (Detection of Propaganda Techniques in News Articles) — reduced to
// the techniques that appear most often in mainstream reporting and that a
// non-expert reader can recognise once they are named.
//
// This is a span-level task: each detection must quote the text it applies to,
// so the reader can see the technique in the article's own words.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { manipulationByRules } = require('./heuristics');

const TECHNIQUES = {
  'loaded language': 'Emotionally charged words chosen to provoke a reaction rather than inform.',
  'name calling': 'Attaching a label or insult to a person or group instead of addressing the substance.',
  'appeal to fear': 'Promoting an idea by stoking alarm about the alternative.',
  'exaggeration': 'Overstating the scale, danger or importance of something.',
  'minimisation': 'Downplaying something significant to make it seem unimportant.',
  'casting doubt': "Undermining someone's credibility without evidence.",
  'flag waving': 'Appealing to group identity, patriotism or "us vs them" loyalty.',
  'causal oversimplification': 'Reducing a complex situation to a single cause.',
  'false dilemma': 'Presenting only two options when more exist.',
  'whataboutism': "Deflecting criticism by pointing at an opponent's faults.",
  'bandwagon': 'Arguing something is right because many people believe it.',
  'thought-terminating cliche': 'A phrase that shuts down discussion instead of engaging with it.',
  'appeal to authority': 'Claiming something is true because an authority says so, without evidence.',
  'unnamed sources': 'Relying on vague attribution — "experts say", "sources claim" — that cannot be checked.'
};

const TECHNIQUE_NAMES = Object.keys(TECHNIQUES);

/**
 * Detect persuasion techniques in an article, with the exact text of each.
 * @param {string} title
 * @param {string} content
 * @returns {Promise<{score:number, intensity:string, techniques:Array, summary:string, failed?:boolean}>}
 *          score 0-10 where 10 = plain informative writing, 0 = heavily manipulative.
 */
const detectManipulation = async (title, content) => {
  const text = `${title}. ${content || ''}`.slice(0, 3000);

  const catalogue = TECHNIQUE_NAMES
    .map(name => `- ${name}: ${TECHNIQUES[name]}`)
    .join('\n');

  const prompt = `You are a propaganda-technique analyst. Identify persuasion techniques used in this news text.

Text:
"""
${text}
"""

Techniques to look for:
${catalogue}

Rules:
- Quote the text EXACTLY as it appears — never paraphrase.
- Only report a technique when it is clearly present. Straightforward factual reporting uses none, and an empty list is the correct answer for such an article.
- Report each distinct instance once. At most 3, the clearest ones.

Respond with ONLY a JSON object, no other text:
{
  "intensity": "<none | light | moderate | heavy>",
  "techniques": [
    {
      "technique": "<one of: ${TECHNIQUE_NAMES.join(' | ')}>",
      "quote": "<exact text from the article>",
      "effect": "<one short sentence on what this does to the reader>"
    }
  ],
  "summary": "<one sentence describing how the article addresses its reader>"
}`;

  try {
    // Budget trimmed from 1400: this was the slowest factor in the pipeline at
    // ~39s, and the output length was what made it slow. Three well-evidenced
    // techniques tell the reader as much as five.
    const result = await callNimApiJson(prompt, { maxTokens: 700 });

    const techniques = (Array.isArray(result.techniques) ? result.techniques : [])
      .filter(t => t && t.quote && t.technique)
      .map(t => {
        const name = String(t.technique).toLowerCase().trim();
        return {
          technique: TECHNIQUE_NAMES.includes(name) ? name : 'loaded language',
          definition: TECHNIQUES[name] || '',
          quote: String(t.quote),
          effect: String(t.effect || '')
        };
      })
      .slice(0, 3);

    const intensity = ['none', 'light', 'moderate', 'heavy'].includes(result.intensity)
      ? result.intensity
      : (techniques.length === 0 ? 'none'
        : techniques.length === 1 ? 'light'
        : techniques.length === 2 ? 'moderate' : 'heavy');

    // Each distinct technique costs 2.6 points. The cost per technique is tied
    // to how many we ask for: at "at most 5" it was 1.6, and simply keeping
    // that after cutting to 3 would have floored this factor at 5.2, making it
    // impossible for a heavily manipulative article to score badly here.
    const score = Math.round(Math.max(0, 10 - techniques.length * 2.6) * 10) / 10;

    return {
      score,
      intensity,
      techniques,
      summary: String(result.summary || ''),
      distinctCount: new Set(techniques.map(t => t.technique)).size,
      method: 'model'
    };
  } catch (err) {
    console.error('Manipulation analysis failed, falling back to rules:', err.message);
    const rules = manipulationByRules(title, content);
    // Fill in the definitions the lexicon path leaves blank.
    rules.techniques = rules.techniques.map(t => ({ ...t, definition: TECHNIQUES[t.technique] || '' }));
    return { ...rules, degraded: true };
  }
};

module.exports = { detectManipulation, TECHNIQUES };
