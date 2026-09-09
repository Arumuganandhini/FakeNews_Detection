// backend/agents/transparencyAgent.js
//
// Source transparency and evidence quality.
//
// The other content factors ask whether the article is slanted, sensational or
// manipulative. This asks a different question, drawn from journalism practice
// rather than from linguistics:
//
//     "Does this article give the reader anything they could go and check?"
//
// Real reporting names people, quotes them directly, cites documents and gives
// concrete dates and figures. Fabricated stories lean on unattributable
// authority — "experts say", "sources close to the investigation", "studies
// show" — because there is nothing behind them to name. That difference is
// visible in the text without knowing anything about the topic, which makes
// this factor useful precisely when the other evidence-based factors go quiet
// (an obscure story with no other coverage and no published fact-check).
//
// Output is a checklist rather than a single opinion, so a reader can see which
// journalistic practice is present and which is missing.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { transparencyByRules } = require('./heuristics');

// Each check contributes to the score. Weights reflect how strongly the
// practice separates reported journalism from fabricated copy.
const CHECKS = [
  { id: 'namedSources',   label: 'Names its sources',          weight: 3.0,
    help: 'Quotes identifiable people or organisations rather than anonymous "sources".' },
  { id: 'directQuotes',   label: 'Uses attributed quotes',     weight: 2.0,
    help: 'Contains direct quotes attributed to someone specific.' },
  { id: 'primaryEvidence',label: 'Points to primary evidence', weight: 2.0,
    help: 'Refers to documents, official statements, studies or data a reader could look up.' },
  { id: 'specificDetail', label: 'Gives concrete detail',      weight: 2.0,
    help: 'Includes specific dates, places and figures instead of vague generalities.' },
  { id: 'measuredClaims', label: 'Claims are measured',        weight: 1.0,
    help: 'Avoids sweeping absolutes that the reporting cannot support.' }
];

const CHECK_IDS = CHECKS.map(c => c.id);

/**
 * Assess how checkable an article is.
 * @param {string} title
 * @param {string} content
 * @returns {Promise<{score:number, level:string, checks:Array, vagueAttributions:Array, summary:string, failed?:boolean}>}
 *          score 0-10 where 10 = fully checkable reporting.
 */
const assessTransparency = async (title, content) => {
  const text = `${title}. ${content || ''}`.slice(0, 3000);

  const checklist = CHECKS
    .map(c => `- ${c.id}: ${c.help}`)
    .join('\n');

  const prompt = `You are a journalism standards analyst. Judge how VERIFIABLE this news text is — whether a reader could go and check what it says. Judge only what is present in the text, not whether the story sounds true.

Text:
"""
${text}
"""

Assess each check as true or false:
${checklist}

Also list any vague or unattributable phrases the article relies on, such as "experts say", "sources claim", "studies show", "many believe" — quote them EXACTLY as they appear. If there are none, return an empty list.

Note: news APIs often truncate article text. Judge only the portion shown, and do not penalise the article for ending abruptly.

Respond with ONLY a JSON object, no other text:
{
  "checks": {
    "namedSources": <true|false>,
    "directQuotes": <true|false>,
    "primaryEvidence": <true|false>,
    "specificDetail": <true|false>,
    "measuredClaims": <true|false>
  },
  "named_examples": ["<a person or organisation the article actually names, if any>"],
  "vague_attributions": ["<exact quote of a vague attribution>"],
  "summary": "<one sentence on how checkable this reporting is>"
}`;

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 900 });
    const raw = result.checks || {};

    const checks = CHECKS.map(c => ({
      id: c.id,
      label: c.label,
      help: c.help,
      passed: raw[c.id] === true
    }));

    const earned = CHECKS.reduce(
      (sum, c) => sum + (raw[c.id] === true ? c.weight : 0), 0
    );
    const total = CHECKS.reduce((sum, c) => sum + c.weight, 0);
    let score = (earned / total) * 10;

    const vagueAttributions = (Array.isArray(result.vague_attributions) ? result.vague_attributions : [])
      .filter(Boolean)
      .map(String)
      .slice(0, 5);

    // Each unattributable appeal costs a little beyond the checklist itself:
    // it is the signature move of fabricated copy.
    score = Math.max(0, score - Math.min(2, vagueAttributions.length * 0.5));
    score = Math.round(score * 10) / 10;

    const passedCount = checks.filter(c => c.passed).length;
    const level = score >= 7.5 ? 'well sourced'
      : score >= 5 ? 'partly sourced'
      : score >= 2.5 ? 'thinly sourced'
      : 'unsourced';

    return {
      score,
      level,
      checks,
      passedCount,
      totalChecks: CHECK_IDS.length,
      namedExamples: (Array.isArray(result.named_examples) ? result.named_examples : [])
        .filter(Boolean).map(String).slice(0, 4),
      vagueAttributions,
      summary: String(result.summary || ''),
      method: 'model'
    };
  } catch (err) {
    console.error('Transparency analysis failed, falling back to rules:', err.message);
    return { ...transparencyByRules(title, content, CHECKS), degraded: true };
  }
};

module.exports = { assessTransparency, CHECKS };
