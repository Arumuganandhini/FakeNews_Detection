// backend/agents/biasAgent.js
// Factor 3: Bias and emotional-language detection — structured LLM call that
// flags specific sentences so the frontend can highlight them.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { languageDirective } = require('../utils/language');
const { biasByRules } = require('./heuristics');

const BIAS_TYPES =['political bias', 'emotional manipulation', 'loaded language', 'one-sided reporting', 'opinion as fact', 'sensationalism'];

/**
 * Analyze article text for bias and emotionally manipulative language.
 * @param {string} title - Article headline
 * @param {string} content - Article body text (may be truncated by the news API)
 * @returns {Promise<{score: number, biasLevel: string, politicalLean: string, flaggedSentences: Array<{sentence: string, type: string, reason: string}>, explanation: string}>}
 *          score is 0-10 where 10 = neutral/objective, 0 = heavily biased.
 */
const analyzeBias = async (title, content, language) => {
  const text = `${title}. ${content || ''}`.slice(0, 3000);


  // Keys described, not drawn — see the note in manipulationAgent.js:
  // under constrained JSON decoding a placeholder template is itself a
  // valid completion, and these agents were returning objects with the
  // required key missing.
  const prompt = `You are a media bias analysis system. Analyze this news text for bias and emotionally manipulative language.

Text:
"""
${text}
"""

Look for: ${BIAS_TYPES.join(', ')}.
Quote flagged sentences EXACTLY as they appear in the text. Only flag sentences that genuinely show bias — a neutral article should have an empty list.

Return a JSON object with these keys:
- "bias_score": a number from 0 to 10, where 0 is fully neutral and objective and 10 is extremely biased.
- "political_lean": one of left, center, right, none-detected.
- "flagged_sentences": an array, empty when nothing stands out. Each entry has "sentence" (the exact quote), "type" (one of: ${BIAS_TYPES.join(', ')}) and "reason" (short).
- "explanation": one or two sentences summarising the overall tone and objectivity.` + languageDirective(language);

  try {
    const result = await callNimApiJson(prompt, { maxTokens: 700, requiredKeys: ['bias_score'], label: 'bias' });
    let biasScore = Number(result.bias_score);
    if (!Number.isFinite(biasScore)) biasScore = 0;
    biasScore = Math.min(10, Math.max(0, biasScore));

    const flagged = Array.isArray(result.flagged_sentences)
      ? result.flagged_sentences
          .filter(f => f && f.sentence)
          .map(f => ({
            sentence: String(f.sentence),
            type: String(f.type || 'bias'),
            reason: String(f.reason || '')
          }))
      : [];

    const biasLevel = biasScore <= 2 ? 'low' : biasScore <= 5 ? 'moderate' : 'high';

    return {
      // Invert: high score = objective article
      score: Math.round((10 - biasScore) * 10) / 10,
      biasLevel,
      politicalLean: String(result.political_lean || 'none-detected'),
      flaggedSentences: flagged,
      explanation: String(result.explanation || 'No explanation provided.'),
      method: 'model'
    };
  } catch (err) {
    console.error('Bias analysis failed, falling back to rules:', err.message);
    return { ...biasByRules(title, content), degraded: true };
  }
};

module.exports = { analyzeBias };
