// agents/summarizeAgent.js
//
// Short summary of a news article.
//
// History of this file, because it explains the shape of the code:
//
//   1. Originally it ran at the 0.7 default temperature with no caching, so the
//      same article summarised differently on every page load.
//   2. It also demanded "5-10 sentences" regardless of input. The news feed
//      truncates bodies to roughly 200 characters, so the model filled the gap
//      by inventing — differently each run. That produced the contradictions.
//   3. The fix for (2) was a prompt with explicit rules. The model in use is a
//      reasoning model, and it narrated those rules back into its answer:
//      "We need to summarize the news text in 1-2 sentences... So we can
//      summarize: ...". A tight token budget then cut the real summary off
//      mid-sentence.
//
// So the answer is not requested as free text at all. It is requested as a JSON
// field, which the shared extractor pulls out no matter what the model writes
// around it, and the budget is generous enough to hold the model's thinking as
// well as the answer.
const { callNimApiJson } = require('../utils/nvidiaNimApi');

// Phrases that mean the model narrated instead of answering. If one survives
// into the extracted field, the summary is not usable.
const REASONING_LEAK = /^\s*(we (need|must|should|can)\b|let me\b|first,? I\b|the text (is|appears)\b|okay,?\s|so we\b|i('| a)m going to\b)/i;

/**
 * Summarise an article using only the text provided.
 * @param {string} article - article text (often truncated by the news feed)
 * @returns {Promise<string>} plain-text summary
 * @throws when the model returns nothing usable
 */
const summarizeArticle = async (article) => {
  const text = String(article || '').trim();
  if (!text) throw new Error('No article text was supplied to summarise.');

  // Ask for a length the source can actually support. A 200-character snippet
  // supports one or two sentences; demanding more invites invention.
  const target = text.length < 400 ? '1 to 2 sentences'
    : text.length < 1200 ? '2 to 4 sentences'
    : '4 to 6 sentences';

  const prompt = `Summarise the news text below for a reader, in ${target}.

Cover only what the text actually says. If it breaks off mid-story, summarise the part that is there — do not continue the story yourself.

Respond with ONLY this JSON object and nothing else:
{"summary": "<the summary, as plain prose>"}

Text:
"""
${text}
"""`;

  // The budget has to hold the model's own reasoning as well as the answer;
  // the answer is read out of the JSON field, so extra thinking is harmless.
  const data = await callNimApiJson(prompt, { maxTokens: 700, temperature: 0.2 });

  const summary = String(data?.summary || '').trim();
  if (!summary) throw new Error('The model returned no summary text.');
  if (REASONING_LEAK.test(summary)) {
    throw new Error('The model narrated its instructions instead of summarising.');
  }
  return summary;
};

module.exports = summarizeArticle;
