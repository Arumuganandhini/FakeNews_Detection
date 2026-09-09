// agents/promptQuizAgent.js
//
// Quiz generated from a topic the reader types in, grounded in retrieved
// context (Wikipedia plus a local context file) rather than model memory.
//
// Same history as quizAgent: a greedy /\{[\s\S]*\}/ regex parsed the reply, and
// any failure fell through to five hard-coded questions whose options read
// "Option A / Option B / Option C / Option D". That fallback is what a reader
// actually saw when the parse failed — a quiz that looked real and tested
// nothing — so it is gone. The shared JSON path handles the parsing, and a real
// failure is raised for the page to report.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { fetchContext } = require('../rag/ragPipeline');

/** Reject anything shaped like a quiz but carrying placeholder text. */
const isPlaceholder = (q) =>
  !q.question ||
  /^option [a-d]$/i.test(String(q.options?.[0] || '')) ||
  q.options.every((o, i) => String(o).trim() === `Option ${'ABCD'[i]}`);

/**
 * Build a five-question quiz about a reader-supplied topic.
 * @param {string} userPrompt - the topic the reader asked about
 * @returns {Promise<{questions: Array, contextUsed: number}>}
 * @throws when the model cannot produce a usable quiz
 */
const generatePromptQuiz = async (userPrompt) => {
  // Retrieval first, so questions rest on sourced text rather than recall.
  let context = [];
  try {
    context = await fetchContext({ title: userPrompt, content: userPrompt, source: 'User Prompt' });
  } catch (err) {
    console.warn('Prompt quiz retrieval failed, continuing without context:', err.message);
  }

  const contextText = (context || [])
    .map(item => `- ${item.snippet}${item.link ? ` (Source: ${item.link})` : ''}`)
    .join('\n');

  const prompt = `You are a quiz writer. Write 5 multiple-choice questions on the topic below.

Rules:
- Ground the questions in the reference material where it is relevant.
- Give exactly 4 answer options, and make the wrong ones plausible.
- Use the real subject matter — never placeholder text like "Option A".
- "correctAnswer" is the 0-based index of the correct option.

Respond with ONLY a JSON object, no other text:
{
  "questions": [
    { "question": "<question text>", "options": ["<a>", "<b>", "<c>", "<d>"], "correctAnswer": <0-3> }
  ]
}

Topic: ${userPrompt}

Reference material:
${contextText || '(none retrieved — rely on well-established general knowledge)'}`;

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

  return { questions: usable.slice(0, 5), contextUsed: (context || []).length };
};

module.exports = generatePromptQuiz;
