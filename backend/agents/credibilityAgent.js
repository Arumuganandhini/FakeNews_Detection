// backend/agents/credibilityAgent.js
//
// The baseline: ask the model directly, once, and take whatever it says.
//
// This exists to be compared against, so it has to be honestly what it claims.
// It previously called a retrieval pipeline first — fetching Wikipedia articles
// over the network and ranking a static local file by keyword overlap — and
// pasted the result into the prompt. Every published comparison described it as
// "a single holistic prompt", which it was not, and a reviewer reading this file
// would have found a retrieval-augmented system wearing a plain baseline's name.
//
// The retrieval is gone. What remains is the thing the paper says it is: one
// prompt, one answer, no evidence, no decomposition. That makes it both a
// truthful label and a cleaner comparison — the difference measured against the
// pipeline is now attributable to the pipeline, rather than partly to a
// retrieval step nobody mentioned.
const { callNimApi } = require('../utils/nvidiaNimApi');

const checkCredibility = async (title, content, source) => {
  const prompt = `
You are a fact-checking assistant.
Analyze the credibility of the following news article based on its source, language, tone, and content details.

Title: ${title}
Source: ${source || 'Unknown'}
Content: ${content}

Respond with:
- Credibility Score (0-10)
- Reasoning (2-3 sentences detailing your analysis)
  `;

  const text = await callNimApi(prompt);

  let score = 5; // Default fallback
  let reasoning = 'No reasoning provided.';

  const scoreMatch = text.match(/Credibility Score\D*(\d+)/i) ||
                    text.match(/Score\D*(\d+)/i) ||
                    text.match(/(\d+)\s*(?:\/10)?/i);
  if (scoreMatch) {
    score = parseInt(scoreMatch[1]);
    if (score < 0 || score > 10) score = 5;
  }

  const reasoningMatch = text.split('\n').filter(line => !line.match(/score/i)).join(' ').trim();
  if (reasoningMatch) reasoning = reasoningMatch;

  return { score, reasoning };
};

module.exports = checkCredibility;
