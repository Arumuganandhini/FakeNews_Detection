// backend/agents/claimVerificationAgent.js
// Factor 4: Cross-source verification — extract the article's key checkable
// claims, search for coverage from OTHER outlets, and have the LLM judge
// whether that independent coverage supports or contradicts each claim.
const { callNimApiJson } = require('../utils/nvidiaNimApi');
const { searchCoverageBroadening } = require('../utils/newsFetcher');
const { getSourceReputation } = require('./sourceReputationAgent');
const { isSearchable } = require('../utils/language');
const { filterRelevant } = require('./evidenceRelevance');

/**
 * Step 1: extract up to `maxClaims` checkable factual claims plus search keywords.
 */
const extractClaims = async (title, content, maxClaims = 2, language = null) => {
  const isForeign = language && language.code && language.code !== 'en';

  // For a non-English article we ask for English keywords as well. An event
  // reported in Tamil is very often also reported in English, and searching
  // only in the original language would find nothing and conclude — wrongly —
  // that no other outlet covers the story. English search terms are what make
  // the corroboration check work across languages.
  const keywordFields = isForeign
    ? `      "search_keywords": "<exactly 3 or 4 of the most distinctive words IN ${language.name.toUpperCase()}, most important first>",
      "search_keywords_en": "<the same 3 or 4 distinctive terms translated into English - proper nouns transliterated>"`
    : `      "search_keywords": "<exactly 3 or 4 of the most distinctive words - names, places or events - most important first, no quotes or operators>"`;

  const prompt = `You are a fact-checking assistant. Extract the most important CHECKABLE factual claims from this news article — concrete statements about events, numbers, or actions that other news outlets would also report if true. Skip opinions and vague statements.

Title: ${title}
Content: ${(content || '').slice(0, 2000)}

Respond with ONLY a JSON object, no other text:
{
  "claims": [
    {
      "claim": "<the factual claim in one sentence>",
${keywordFields}
    }
  ]
}
Return at most ${maxClaims} claims. If the article contains no checkable claims, return an empty array.${isForeign ? `\nWrite "claim" in English so the verdict can be explained to the reader, but keep "search_keywords" in ${language.name}.` : ''}`;

  const result = await callNimApiJson(prompt, { maxTokens: 700 });
  const claims = Array.isArray(result.claims) ? result.claims : [];
  return claims
    .filter(c => c && c.claim && c.search_keywords)
    .slice(0, maxClaims)
    .map(c => ({
      claim: String(c.claim),
      keywords: String(c.search_keywords),
      keywordsEn: c.search_keywords_en ? String(c.search_keywords_en) : null
    }));
};

/**
 * Step 2: judge one claim against headlines/descriptions from other outlets.
 */
const judgeClaim = async (claim, coverage) => {
  const evidenceText = coverage
    .map((a, i) => `[${i + 1}] ${a.source}: "${a.title}" — ${a.description}`.slice(0, 300))
    .join('\n');

  const prompt = `You are a claim verification system. Determine whether independent news coverage supports, contradicts, or does not address this claim.

Claim: "${claim}"

Coverage from other news outlets:
${evidenceText}

Respond with ONLY a JSON object, no other text:
{
  "verdict": "<supported | contradicted | unverified>",
  "supporting_indices": [<numbers of coverage items that clearly report the same fact>],
  "contradicting_indices": [<numbers of coverage items that clearly report conflicting facts>],
  "explanation": "<one sentence>"
}
Use "supported" only if at least one item clearly reports the same fact. Use "contradicted" if any item reports conflicting facts. Otherwise "unverified".`;

  // A model that could not be reached, or whose reply could not be parsed,
  // has not judged this claim. The old code let that fall through to the
  // default verdict below - "unverified" - which the report then presented to
  // the reader as "no other outlet is reporting this", about coverage it was
  // holding in its hand at the time.
  let result;
  try {
    result = await callNimApiJson(prompt, { maxTokens: 500 });
  } catch (err) {
    console.error('Claim judgement failed:', err.message);
    return { verdict: 'undetermined', failed: true, supportingEvidence: [], contradictingEvidence: [],
      discardedEvidence: [], explanation: 'This claim could not be judged against the coverage that was found.' };
  }

  // A recovered-but-truncated reply can arrive without the field at all. That
  // is not a judgement of "unverified" either.
  if (!['supported', 'contradicted', 'unverified'].includes(result?.verdict)) {
    return { verdict: 'undetermined', failed: true, supportingEvidence: [], contradictingEvidence: [],
      discardedEvidence: [], explanation: 'The judgement of this claim came back unreadable, so it was not counted.' };
  }

  const pick = (indices) =>
    (Array.isArray(indices) ? indices : [])
      .map(n => coverage[Number(n) - 1])
      .filter(Boolean)
      // `description` travels with the evidence because wire syndication is
      // detected from the agency credit in the headline or standfirst — see
      // agents/independence.js. Dropping it here would make five reprints of one
      // Reuters story look like five independent confirmations.
      .map(a => ({
        source: a.source,
        title: a.title,
        description: a.description || '',
        url: a.url,
        publishedAt: a.publishedAt,
        reliability: getSourceReputation(a.source, a.url).score
      }));

  let verdict = result.verdict;

  // The model will cite coverage that is not about this claim at all. Measured
  // on the adversarial set, an invented "secret chemical leak" was reported as
  // supported by real articles concerning an unrelated evacuation — turning a
  // fabrication into "likely true". Evidence that shares no distinctive terms
  // with the claim is therefore discarded before it can count, and a verdict
  // left with no surviving evidence falls back to unverified.
  const support = filterRelevant(claim, pick(result.supporting_indices));
  const contradiction = filterRelevant(claim, pick(result.contradicting_indices));

  if (verdict === 'supported' && support.kept.length === 0) verdict = 'unverified';
  if (verdict === 'contradicted' && contradiction.kept.length === 0) {
    verdict = support.kept.length > 0 ? 'supported' : 'unverified';
  }

  const notes = [support.note, contradiction.note].filter(Boolean);

  return {
    verdict,
    supportingEvidence: support.kept,
    contradictingEvidence: contradiction.kept,
    discardedEvidence: [...support.dropped, ...contradiction.dropped],
    explanation: [String(result.explanation || ''), ...notes].filter(Boolean).join(' ')
  };
};

/**
 * Retrieve coverage of one claim, in the article's own language and in English.
 *
 * A story published in Tamil, Hindi or Malayalam is frequently also covered in
 * English, and an English-only search would miss the native coverage while a
 * native-only search would miss the English. Searching both and merging is what
 * lets the corroboration count work across a language boundary — and an outlet
 * reporting the same facts in a different language is genuinely independent
 * evidence, often more so than a same-language reprint.
 *
 * @returns {Promise<Array>} deduplicated coverage, each item tagged with the
 *          search language that found it
 */
const gatherCoverage = async ({ keywords, keywordsEn, sourceName, language }) => {
  const code = language?.code || 'en';
  const searches = [];

  if (isSearchable(code)) {
    searches.push({ query: keywords, lang: code });
  }
  // English is searched whenever the article is not English, using the
  // translated terms when the extractor supplied them.
  if (code !== 'en') {
    const englishQuery = keywordsEn || keywords;
    if (englishQuery) searches.push({ query: englishQuery, lang: 'en' });
  } else {
    searches.push({ query: keywords, lang: 'en' });
  }

  // A search that could not run is recorded as such rather than as an empty
  // result. With two searches in flight, one failing while the other returns
  // coverage is still a usable answer; both failing is not an answer at all.
  const batches = await Promise.all(
    searches.map(({ query, lang }) =>
      searchCoverageBroadening(query, sourceName, 8, 2, lang)
        .then(({ articles }) => ({ articles: articles.map(a => ({ ...a, foundIn: lang })) }))
        .catch(err => {
          console.error(`Coverage search (${lang}) could not run:`, err.message);
          return { articles: [], failed: true };
        }))
  );

  const seen = new Set();
  const merged = [];
  for (const article of batches.flatMap(b => b.articles)) {
    const key = article.url || `${article.source}|${article.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(article);
  }
  return {
    articles: merged.slice(0, 10),
    searchFailed: batches.length > 0 && batches.every(b => b.failed)
  };
};

/**
 * Aggregate per-claim verdicts into a factor score and a status.
 *
 * Baseline 5 (unknown). Each supported claim adds, weighted by how reliable
 * the corroborating outlets are; each contradicted claim subtracts. A claim
 * whose check never ran is counted apart from one that was checked and found
 * nothing, because the two mean opposite things to the reader.
 */
const summariseResults = (results) => {
  let score = 5;
  let supported = 0, contradicted = 0, unverified = 0, undetermined = 0;
  for (const r of results) {
    if (r.failed) {
      undetermined++;
    } else if (r.verdict === 'supported') {
      const bestReliability = Math.max(...(r.supportingEvidence || []).map(e => e.reliability), 5);
      score += 2.5 * (bestReliability / 10);
      supported++;
    } else if (r.verdict === 'contradicted') {
      score -= 3;
      contradicted++;
    } else {
      unverified++;
    }
  }
  score = Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;

  const status = contradicted > 0 ? 'contradicted'
    : supported > 0 ? 'corroborated'
    : 'unverified';

  const parts = [];
  if (supported) parts.push(`${supported} claim(s) corroborated by other outlets`);
  if (contradicted) parts.push(`${contradicted} claim(s) contradicted by other coverage`);
  if (unverified) parts.push(`${unverified} claim(s) could not be verified`);
  if (undetermined) parts.push(`${undetermined} claim(s) could not be checked at all`);

  return { score, status, partialFailure: undetermined > 0, explanation: parts.join('; ') + '.' };
};

/**
 * Full cross-source verification for an article.
 * @returns {Promise<{score: number, status: string, claims: Array, explanation: string}>}
 *          score 0-10: supported claims from reliable outlets push it up,
 *          contradicted claims push it down, no coverage stays neutral.
 */
const verifyClaims = async (title, content, sourceName, preExtractedClaims = null, extractionFailed = false, language = null) => {
  try {
    // An extraction that FAILED and an article with nothing worth checking both
    // arrive here as an empty list, and they mean opposite things: one is an
    // absence of knowledge, the other is a finding about the article. Conflating
    // them let a model outage reclassify every article as commentary, which
    // carries a much higher ceiling. The caller tells us which happened.
    if (extractionFailed) {
      return {
        score: 5,
        status: 'error',
        claims: [],
        explanation: 'The claims in this article could not be read, so nothing was checked against other outlets.',
        failed: true
      };
    }

    // The orchestrator extracts claims once and shares them, so we accept them
    // rather than extracting again.
    const claims = preExtractedClaims || await extractClaims(title, content, 2, language);
    if (claims.length === 0) {
      return {
        score: 5,
        status: 'no-claims',
        claims: [],
        explanation: 'No independently checkable claims were found in this article.'
      };
    }

    // Claims are independent of one another, so they are checked together
    // rather than one after the next. This loop used to run strictly in series
    // — search, wait, judge, wait, then the same again for the next claim —
    // which made verification the slowest factor in the pipeline at ~28s.
    // The model gateway still caps how many calls are actually in flight.
    const results = await Promise.all(claims.map(async ({ claim, keywords, keywordsEn }) => {
      const { articles: coverage, searchFailed } = await gatherCoverage({ keywords, keywordsEn, sourceName, language });
      if (searchFailed) {
        return {
          claim,
          verdict: 'undetermined',
          failed: true,
          supportingEvidence: [],
          contradictingEvidence: [],
          explanation: 'Other outlets could not be searched for this claim.'
        };
      }
      if (coverage.length === 0) {
        return {
          claim,
          verdict: 'no-coverage',
          supportingEvidence: [],
          contradictingEvidence: [],
          explanation: 'No coverage of this claim was found from other outlets.'
        };
      }
      const judgement = await judgeClaim(claim, coverage);
      return { claim, ...judgement };
    }));

    // If not one claim could actually be checked, the article has not been
    // verified and has not failed verification - the check did not happen.
    // Saying anything else about other outlets here would be inventing a
    // finding out of an outage.
    if (results.every(r => r.failed)) {
      return {
        score: 5,
        status: 'error',
        claims: results,
        explanation: 'The check against other outlets could not be completed, so nothing was confirmed or denied.',
        failed: true
      };
    }

    return { claims: results, ...summariseResults(results) };
  } catch (err) {
    console.error('Claim verification failed:', err.message);
    return {
      score: 5,
      status: 'error',
      claims: [],
      explanation: 'Cross-source verification unavailable — treated as neutral.',
      failed: true
    };
  }
};

module.exports = {
  verifyClaims,
  extractClaims,
  // Exposed for the regression tests that cover what happens when the search
  // or the judgement cannot run. Not part of the pipeline's interface.
  __test: { judgeClaim, gatherCoverage, summariseResults }
};
