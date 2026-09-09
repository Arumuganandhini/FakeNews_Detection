const {
  resolveProviderChain, resolveConcurrency,
  isRetired, isOverloaded, isRateLimited, isAuthFailure, isConnectionFailure
} = require('./llmProviders');

// Provider endpoints, model lists and error classification all live in
// llmProviders.js. This file is the gateway around them: one request gate, one
// retry policy, one JSON extractor, shared by every agent.

// Whichever model each provider last answered on, so a dead primary is not
// re-tested on every single call. Keyed by provider name.
const activeModel = {};

/* ---------------------------------------------------------------------------
   Request gate
   ---------------------------------------------------------------------------
   A single trust analysis fires seven-plus prompts. Sending them all at once
   trips the hosted tier's rate limit, and every rejected call silently became a
   neutral 5 in the reader's report — the analysis looked complete but half of
   it had not run. So calls queue here, a few at a time, and a rate-limited call
   waits and retries rather than degrading.
--------------------------------------------------------------------------- */

// Set by whichever provider leads: NIM degrades when pushed and stays at two,
// Gemini does not and runs six. Resolved once at startup so the value is stable
// for the life of the process.
const MAX_CONCURRENT = resolveConcurrency();
const MAX_RATE_LIMIT_RETRIES = 3;

let inFlight = 0;
const waiting = [];

console.log(`LLM gateway: ${MAX_CONCURRENT} concurrent call(s) max.`);

const acquireSlot = () =>
  new Promise((resolve) => {
    if (inFlight < MAX_CONCURRENT) {
      inFlight++;
      resolve();
    } else {
      waiting.push(resolve);
    }
  });

const releaseSlot = () => {
  const next = waiting.shift();
  if (next) next();          // hand the slot straight to the next caller
  else inFlight--;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a prompt to the language model.
 *
 * Despite the file name this is provider-agnostic: it walks the providers
 * configured in llmProviders.js (NVIDIA NIM by default, Google Gemini as an
 * alternative), and within each provider walks that provider's model list.
 * The name is kept so the twelve agents that import it do not all have to
 * change at once.
 *
 * Order of escalation for a failing call:
 *   1. rate limited / busy  -> wait and retry the SAME model
 *   2. retired (404/410)    -> next model for this provider, permanently
 *   3. out of models        -> next provider
 *
 * @param {string} prompt
 * @param {Object} options - maxTokens, temperature, topP
 * @returns {Promise<string>} the reply text
 */
const callNimApi = async (prompt, options = {}) => {
  const providers = resolveProviderChain();
  if (!providers.length) {
    throw new Error(
      'No language model provider is configured. Set NIM_API_KEY (or GEMINI_API_KEY) in your backend .env file.'
    );
  }

  const request = {
    prompt,
    maxTokens: options.maxTokens || 512,
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
    topP: options.topP || 1.0,
    timeout: 90000
  };

  await acquireSlot();
  try {
    let lastError;

    for (const provider of providers) {
      // Prefer whichever model this provider last answered on.
      const preferred = activeModel[provider.name] || provider.models[0];
      const models = [preferred, ...provider.models.filter(m => m !== preferred)];
      let preferredRetired = false;

      for (const model of models) {
        for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
          try {
            const text = await provider.send({ ...request, model });
            // Only adopt a different model permanently when the previous one is
            // actually gone. A backup used during a passing overload must not
            // demote a healthy primary for the rest of the process.
            if (model !== preferred && preferredRetired) {
              console.warn(`${provider.label}: switched to "${model}" (previous model retired).`);
              activeModel[provider.name] = model;
            }
            if (provider !== providers[0]) {
              console.warn(`${provider.label} answered after ${providers[0].label} could not.`);
            }
            return text;
          } catch (error) {
            lastError = error;
            const status = error.response?.status;

            if (isAuthFailure(status)) {
              // Never retried, and never silently swallowed: a bad key must be
              // fixed, not worked around.
              console.error(`${provider.label}: credentials rejected (${status}).`);
              break;
            }

            // Busy or rate limited: wait and try the same model again. Honour
            // the server's Retry-After when it sends one, else 1s, 2s, 4s.
            if ((isRateLimited(status) || isOverloaded(status)) && attempt < MAX_RATE_LIMIT_RETRIES) {
              const retryAfter = Number(error.response?.headers?.['retry-after']);
              const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : 1000 * Math.pow(2, attempt);
              console.warn(`${provider.label}: ${isRateLimited(status) ? 'rate limited' : 'model busy'}, retrying in ${waitMs}ms (attempt ${attempt + 1}).`);
              await sleep(waitMs);
              continue;
            }

            if (isRetired(status)) {
              console.error(`${provider.label}: model "${model}" is retired (${status}) — trying the next one.`);
              if (model === preferred) preferredRetired = true;
              break;
            }

            if (isOverloaded(status)) {
              console.error(`${provider.label}: model "${model}" still busy after retries — trying the next one.`);
              break;
            }

            if (isConnectionFailure(error.code)) {
              console.error(`${provider.label}: model "${model}" connection failed (${error.code}) — trying the next one.`);
              break;
            }

            console.error(`${provider.label} error:`, status || error.code || error.message);
            break;
          }
        }
      }
      if (providers.length > 1) {
        console.warn(`${provider.label} exhausted; falling through to the next provider.`);
      }
    }

    throw lastError || new Error('No language model was available.');
  } finally {
    releaseSlot();
  }
};

/**
 * Find the balanced block that opens at `start`, or -1 if it never closes.
 * String contents are skipped so a brace inside a quote cannot fool the scan.
 * @returns {number} index of the closing bracket, or -1
 */
const findBalancedEnd = (text, start) => {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/**
 * Rescue a reply that was cut off mid-structure.
 *
 * A truncated answer is not a wrong answer — it is a good answer missing its
 * tail. Trimming back to the last element that completed and closing the open
 * brackets keeps the questions, factors or techniques the model did finish,
 * instead of discarding the whole reply and paying for another round trip.
 *
 * @param {string} text - full candidate text
 * @param {number} start - index of the opening bracket
 * @returns {string|null} a balanced JSON string, or null if nothing survives
 */
const salvageTruncated = (text, start) => {
  const stack = [];
  let inString = false;
  let escaped = false;
  let lastSafe = -1;   // index just past the last element that closed cleanly

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      // A nested element just finished, so the text up to here is coherent.
      if (stack.length >= 1) lastSafe = i + 1;
    }
  }

  if (!stack.length) return null;          // not truncated after all
  if (lastSafe === -1) return null;         // nothing completed; nothing to keep

  let body = text.slice(start, lastSafe).replace(/,\s*$/, '');
  // Re-derive what is still open in the trimmed text, then close it.
  const open = [];
  inString = false; escaped = false;
  for (const ch of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') open.push('}');
    else if (ch === '[') open.push(']');
    else if (ch === '}' || ch === ']') open.pop();
  }
  while (open.length) body += open.pop();
  return body;
};

/**
 * Repair the two malformations these models actually produce.
 * Conservative on purpose: a wrong repair is worse than a clean failure.
 * @param {string} json - text that looked like JSON but would not parse
 * @returns {string} possibly-repaired text
 */
const repairJson = (json) => json
  // Trailing comma before a closing brace or bracket.
  .replace(/,\s*([}\]])/g, '$1')
  // An unquoted string value: `"explanation": The headline is plain,` — quote
  // it up to the next comma or closing brace. Values that are already valid
  // JSON (a quote, object, array, number, true/false/null) are left alone.
  .replace(
    /("(?:[^"\\]|\\.)*"\s*:\s*)(?!\s*["{[\d\-]|\s*(?:true|false|null)\b)([^,}\]\n]+)/g,
    (_m, key, value) => `${key}"${value.trim().replace(/"/g, '\\"')}"`
  );

/**
 * Extract the JSON object or array embedded in a text response.
 * Handles code fences and prose around the JSON.
 *
 * The scan tries every bracket position rather than committing to the first.
 * NewsAPI truncates article bodies with a "[+8026 chars]" marker, and when a
 * model echoes that back the first "[" in the reply belongs to the marker, not
 * to the answer — locking onto it produced "Unexpected token '+'" and threw
 * away a reply that was otherwise perfectly good.
 *
 * @param {string} text - Raw LLM output
 * @returns {Object|Array} - Parsed JSON
 */
const extractJson = (text) => {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  // Try direct parse first
  try {
    return JSON.parse(candidate.trim());
  } catch (_) { /* fall through */ }

  // If the outermost bracket never closes, the reply was cut off. Salvage it
  // here, before the block scan below — that scan would otherwise find a
  // complete *inner* object (one question out of five) and return that
  // fragment as if it were the whole answer.
  const firstOpen = candidate.search(/[{[]/);
  if (firstOpen !== -1 && findBalancedEnd(candidate, firstOpen) === -1) {
    const salvaged = salvageTruncated(candidate, firstOpen);
    if (salvaged) {
      try {
        const parsed = JSON.parse(salvaged);
        console.warn('NIM: reply was truncated; recovered the complete part.');
        return parsed;
      } catch (_) { /* fall through to the block scan */ }
    }
  }

  // Collect every balanced block, objects first — every prompt here asks for
  // an object, so an array is only a fallback.
  const blocks = [];
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] !== '{' && candidate[i] !== '[') continue;
    const end = findBalancedEnd(candidate, i);
    if (end === -1) continue;
    blocks.push({ text: candidate.slice(i, end + 1), isObject: candidate[i] === '{' });
    i = end;   // don't rescan the block's own interior
  }

  const ordered = [...blocks.filter(b => b.isObject), ...blocks.filter(b => !b.isObject)];

  for (const block of ordered) {
    try {
      return JSON.parse(block.text);
    } catch (_) { /* try the next one */ }
  }

  // Nothing parsed as-is. Try repairing the most promising block.
  for (const block of ordered) {
    try {
      return JSON.parse(repairJson(block.text));
    } catch (_) { /* try the next one */ }
  }

  if (!blocks.length) throw new Error('No JSON found in LLM response');
  throw new Error('Unbalanced JSON in LLM response');
};

/**
 * Call the NIM API expecting a structured JSON response.
 *
 * Low temperature keeps output deterministic. On a parse failure the call is
 * retried with a larger token budget: "Unbalanced JSON" almost always means the
 * reply was cut off mid-object, and a more verbose model needs more room than
 * the one the prompt was originally sized for.
 *
 * @param {string} prompt - Prompt that instructs the model to answer in JSON
 * @param {Object} options - API options (maxTokens etc.)
 * @returns {Promise<Object|Array>} - Parsed JSON response
 */
const callNimApiJson = async (prompt, options = {}) => {
  const baseTokens = options.maxTokens || 800;
  let lastError;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Second attempt gets ~75% more room in case the first was truncated.
    const jsonOptions = {
      temperature: 0.2,
      ...options,
      maxTokens: attempt === 0 ? baseTokens : Math.round(baseTokens * 1.75)
    };

    const text = await callNimApi(prompt, jsonOptions);
    try {
      return extractJson(text);
    } catch (err) {
      lastError = err;
      console.warn(`JSON parse failed (attempt ${attempt + 1}):`, err.message);
    }
  }
  throw lastError;
};

module.exports = { callNimApi, callNimApiJson, extractJson };
