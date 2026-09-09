// agents/quizAgent.js
//
// Comprehension quiz generated from an article's detailed summary.
//
// This used to parse the reply with a greedy /\{[\s\S]*\}/ regex — which spans
// from the first "{" to the LAST "}" in the whole reply, so any trailing prose
// or a second object broke it — and then answered a parse failure with five
// hard-coded placeholder questions reading "Option A / Option B / Option C /
// Option D". The reader got a quiz that looked real and tested nothing.
//
// It now uses the shared JSON path (fenced blocks, candidate scanning, a repair
// pass and a larger-budget retry), and a genuine failure is raised rather than
// papered over, so the page can say something honest.
const { callNimApiJson } = require('../utils/nvidiaNimApi');

/** Reject anything that is shaped like a quiz but carries placeholder text. */
const isPlaceholder = (q) =>
  !q.question ||
  /^option [a-d]$/i.test(String(q.options?.[0] || '')) ||
  q.options.every((o, i) => String(o).trim() === `Option ${'ABCD'[i]}`);

/**
 * Build a five-question multiple-choice quiz from a summary.
 * @param {string} detailedSummary
 * @returns {Promise<{questions: Array<{question: string, options: string[], correctAnswer: number}>}>}
 * @throws when the model cannot produce a usable quiz
 */
const generateQuiz = async (detailedSummary) => {
  const prompt = `You are a quiz writer. Write 5 multiple-choice comprehension questions about the summary below.

Rules:
- Every question must be answerable from the summary alone.
- Give exactly 4 answer options, and make the wrong ones plausible.
- Use the real subject matter — never placeholder text like "Option A".
- "correctAnswer" is the 0-based index of the correct option.

Respond with ONLY a JSON object, no other text:
{
  "questions": [
    { "question": "<question text>", "options": ["<a>", "<b>", "<c>", "<d>"], "correctAnswer": <0-3> }
  ]
}

Summary:
"""
${detailedSummary}
"""`;

  const data = await callNimApiJson(prompt, { maxTokens: 2600, temperature: 0.3 });
  const questions = Array.isArray(data?.questions) ? data.questions : [];

  const usable = questions.filter(q =>
    q &&
    typeof q.question === 'string' &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    Number.isInteger(q.correctAnswer) &&
    q.correctAnswer >= 0 && q.correctAnswer <= 3 &&
    !isPlaceholder(q)
  );

  // The stored quiz schema and the page both expect a full set of five, so
  // a short reply is a failure to retry, not a quiz to serve.
  if (usable.length < 5) {
    throw new Error(`Quiz generation produced ${usable.length} usable question(s) of ${questions.length}`);
  }

  return { questions: usable.slice(0, 5) };
};

module.exports = generateQuiz;
