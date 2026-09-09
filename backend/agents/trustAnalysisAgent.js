// backend/agents/trustAnalysisAgent.js
// Orchestrator: runs the four analysis factors in parallel and combines them
// into one transparent, weighted trust score with a full per-factor breakdown.
// This replaces the single-prompt black-box score with an explainable pipeline.
const { getSourceReputation } = require('./sourceReputationAgent');
const { analyzeClickbait } = require('./clickbaitAgent');
const { analyzeBias } = require('./biasAgent');
const { verifyClaims, extractClaims } = require('./claimVerificationAgent');
const { detectManipulation } = require('./manipulationAgent');
const { assessTransparency } = require('./transparencyAgent');

// A note on professional fact-check matching
// ------------------------------------------
// A seventh factor matched an article's claims against verdicts published by
// professional fact-checkers. It is no longer part of the pipeline. Both routes
// to that evidence proved impractical here:
//
//   - Google's Fact Check Tools API requires a billing-enabled account.
//   - Reading ClaimReview markup off fact-checkers' own pages works, but the
//     only way to find the right page is the news search, and the free news tier
//     allows 100 requests a day in total — a budget the article feed and
//     cross-source verification already depend on.
//
// Searching the fact-checkers directly was tested and does not work: their
// search pages render results in JavaScript, so there is nothing to read.
//
// agents/factCheckAgent.js and utils/claimReviewReader.js are kept, working and
// unwired, for anyone who has a Fact Check Tools key — re-adding the import, a
// weight below, and the factor entry is all it takes. See the README.

// Factor weights — must sum to 1.
//
// Cross-source verification carries the largest share because it is checked
// against the world rather than inferred from the article's own text. It stands
// down and redistributes its weight when no other coverage is found.
//
// Bumped whenever the shape of a report changes — a new factor, a renamed
// field, a different scale. Cached reports below the current version are
// re-analysed instead of served, so an upgrade can never leave a reader
// looking at a report built by an older pipeline. Cache entries written before
// versioning existed have no version at all and are treated as stale.
const REPORT_SCHEMA_VERSION = 3;

// The reader-facing name of each step, used for progress updates while the
// analysis runs. These match the factor names in the finished report.
const FACTOR_LABELS = {
  sourceReputation: 'Who published it',
  clickbait: 'Is the headline honest?',
  bias: 'Is the writing fair?',
  transparency: 'Can you check it yourself?',
  manipulation: 'Is it using persuasion tricks?',
  verification: 'Do other outlets agree?'
};

// Only the scored checks are announced. Claim extraction is timed like the
// rest, but it is a sub-step of verification rather than a check of its own —
// announcing it made the page count "7 of 6".
const REPORTED_STEPS = new Set(Object.keys(FACTOR_LABELS));

const WEIGHTS = {
  sourceReputation: 0.15,
  clickbait: 0.10,
  bias: 0.15,
  manipulation: 0.15,
  transparency: 0.18,
  verification: 0.27
};

// Verdicts are written the way a reader would say them out loud, not as
// technical grades. `advice` tells the reader what to actually do.
const verdictFromScore = (score) => {
  if (score >= 7.5) return {
    label: 'Looks trustworthy',
    level: 'high',
    advice: 'Nothing concerning stood out in our checks.'
  };
  if (score >= 5.5) return {
    label: 'Mostly fine',
    level: 'medium-high',
    advice: 'Broadly reliable, with a few things worth noticing.'
  };
  if (score >= 4) return {
    label: 'Read carefully',
    level: 'medium-low',
    advice: 'Some parts of this article need a second look.'
  };
  return {
    label: 'Be skeptical',
    level: 'low',
    advice: 'We found several warning signs. Check another source before believing this.'
  };
};

/**
 * Turn the factor results into short plain-English points a non-technical
 * reader understands. Built from the results themselves — no extra AI call.
 * @returns {{goodPoints: string[], concernPoints: string[], summary: string}}
 */
const buildPlainLanguage = ({
  sourceResult, clickbaitResult, biasResult, manipulationResult,
  transparencyResult, verificationResult, verdict
}) => {
  const goodPoints = [];
  const concernPoints = [];

  // Who published it
  if (sourceResult.matched && sourceResult.score >= 7.5) {
    goodPoints.push(`Published by ${sourceResult.matchedName}, an outlet with a strong record for accuracy.`);
  } else if (sourceResult.matched && sourceResult.score < 5) {
    concernPoints.push(`${sourceResult.matchedName} has a weak record for factual reporting.`);
  } else if (!sourceResult.matched) {
    concernPoints.push('We do not have a reliability record for this news outlet.');
  }

  // Headline
  if (clickbaitResult.isClickbait) {
    concernPoints.push('The headline uses clickbait techniques to attract clicks.');
  } else if (clickbaitResult.score >= 7.5) {
    goodPoints.push('The headline describes the story plainly, without exaggeration.');
  }

  // Language
  const flagged = (biasResult.flaggedSentences || []).length;
  if (flagged > 0) {
    concernPoints.push(
      `${flagged} sentence${flagged > 1 ? 's use' : ' uses'} biased or emotional wording (highlighted below).`
    );
  } else if (biasResult.score >= 7.5) {
    goodPoints.push('The article is written in neutral language.');
  }
  // 'not-assessed' means the pattern check ran and cannot judge direction —
  // saying "leans not-assessed" would be nonsense, so stay silent instead.
  if (biasResult.politicalLean && !['none-detected', 'none', 'neutral', 'not-assessed'].includes(biasResult.politicalLean)) {
    concernPoints.push(`The article leans ${biasResult.politicalLean} in how it presents the story.`);
  }

  // Can the reader check any of this themselves?
  const vague = (transparencyResult?.vagueAttributions) || [];
  if (transparencyResult && transparencyResult.score < 4) {
    concernPoints.push(
      vague.length > 0
        ? `Little you can check: the article leans on unnamed authority such as “${vague[0]}”.`
        : 'The article names no sources you could go and verify.'
    );
  } else if (transparencyResult && transparencyResult.score >= 7.5) {
    goodPoints.push('Names its sources and gives detail you can check independently.');
  }

  // Persuasion techniques — named, so the reader learns to spot them
  const techniques = (manipulationResult?.techniques) || [];
  if (techniques.length > 0) {
    const names = [...new Set(techniques.map(t => t.technique))];
    concernPoints.push(
      `Uses persuasion techniques on the reader: ${names.slice(0, 3).join(', ')}.`
    );
  } else if (manipulationResult && manipulationResult.score >= 9) {
    goodPoints.push('Written as plain information, without persuasion techniques.');
  }

  // What other outlets say — the part readers care about most
  const claims = verificationResult.claims || [];
  const supported = claims.filter(c => c.verdict === 'supported').length;
  const contradicted = claims.filter(c => c.verdict === 'contradicted').length;
  if (contradicted > 0) {
    concernPoints.unshift(`Other news outlets report something different about ${contradicted} key claim${contradicted > 1 ? 's' : ''}.`);
  }
  if (supported > 0) {
    goodPoints.unshift(`${supported} key claim${supported > 1 ? 's are' : ' is'} also reported by other news outlets.`);
  }
  if (supported === 0 && contradicted === 0 && claims.length > 0) {
    concernPoints.push('We could not find other outlets covering this story, so its claims are unconfirmed.');
  }

  // One-sentence takeaway
  let summary;
  if (contradicted > 0) {
    summary = 'Other outlets contradict part of this story — treat it with caution.';
  } else if (concernPoints.length === 0) {
    summary = 'Everything we checked looks fine.';
  } else if (goodPoints.length === 0) {
    summary = `We found ${concernPoints.length} thing${concernPoints.length > 1 ? 's' : ''} to be careful about in this article.`;
  } else {
    // The verdict's stock advice is only used when there is genuinely nothing
    // flagged — otherwise it contradicts the concerns listed right below it.
    const concernText = `${concernPoints.length} thing${concernPoints.length > 1 ? 's' : ''} worth a look`;
    const goodText = `${goodPoints.length} good sign${goodPoints.length > 1 ? 's' : ''}`;
    summary = `Broadly holds up, but check the detail: ${goodText}, and ${concernText}.`;
  }

  return { goodPoints, concernPoints, summary };
};

/**
 * Run the full trust analysis pipeline for an article.
 * @param {Object} article - { title, content, source, url }
 * @returns {Promise<Object>} structured trust report
 */
const analyzeTrust = async ({ title, content, source, url, textCoverage, onProgress }) => {
  const startedAt = Date.now();
  const timings = {};
  // Every factor passes through here, so this is also where a caller watching
  // the analysis is told that one has landed. A reader should see the checks
  // arrive one by one rather than staring at a spinner until all six finish.
  const timed = async (name, task) => {
    const started = Date.now();
    try {
      const result = await task();
      if (typeof onProgress === 'function' && REPORTED_STEPS.has(name)) {
        try {
          onProgress({ id: name, name: FACTOR_LABELS[name], ms: Date.now() - started });
        } catch (_) { /* a broken listener must never fail the analysis */ }
      }
      return result;
    } finally {
      timings[name] = Date.now() - started;
    }
  };
  // NewsAPI ends a truncated body with "… [+8026 chars]". That marker is not
  // part of the article, and a model that echoes it back puts a stray "["
  // ahead of its own JSON. Drop it before any factor sees the text.
  const text = String(content || '').replace(/\[\+\d+\s*chars\]/gi, '').trim();

  // Source lookup is synchronous and free.
  const sourceResult = await timed('sourceReputation', () => getSourceReputation(source, url));

  // Claim extraction feeds only verification; the four content checks never use
  // it. Starting it alongside them keeps it off the critical path.
  //
  // This was tried once before and made things markedly worse (63s -> 116s).
  // The cause was the gate, not the idea: at two slots, extraction queued behind
  // the content checks and delayed the verification waiting on it. The gate is
  // now sized to the provider (six for Gemini), so the five checks plus this
  // extraction fit at once. Measured A/B over identical articles:
  //
  //     overlapped   7.4s / 10.4s / 39.7s   -> 19.2s average
  //     sequential  11.2s / 16.4s / 42.9s   -> 23.5s average
  const claimsPromise = timed('claimExtraction', () => extractClaims(title, text).catch(() => []));

  const [
    clickbaitResult, biasResult, manipulationResult,
    transparencyResult, verificationResult
  ] = await Promise.all([
    timed('clickbait', () => analyzeClickbait(title)),
    timed('bias', () => analyzeBias(title, text)),
    timed('manipulation', () => detectManipulation(title, text)),
    timed('transparency', () => assessTransparency(title, text)),
    claimsPromise.then(claims => timed('verification', () => verifyClaims(title, text, source, claims)))
  ]);

  // Evidence-grounded factors stand down when they found no evidence: their
  // weight is redistributed across the factors that DID produce signal, so a
  // neutral placeholder never dilutes a real finding.
  const verificationInformative = ['corroborated', 'contradicted'].includes(verificationResult.status);

  // When a factor stands down, say precisely why — "not counted" alone leaves
  // the reader guessing whether the check failed or simply found nothing.
  const VERIFICATION_REASONS = {
    'no-claims': 'Not counted — this article makes no specific factual claim we could look up.',
    'unverified': 'Not counted — no other outlet has covered this story yet.',
    'error': 'Not counted — this check could not run just now.'
  };

  const verificationNote = verificationInformative ? null
    : (VERIFICATION_REASONS[verificationResult.status] || VERIFICATION_REASONS.unverified);

  let weights = { ...WEIGHTS };
  let standDown = 0;
  if (!verificationInformative) { standDown += weights.verification; weights.verification = 0; }

  if (standDown > 0) {
    const remaining = 1 - standDown;
    for (const key of Object.keys(weights)) {
      if (weights[key] > 0) weights[key] /= remaining;
    }
  }

  // The report prints each weight as a whole percentage, and readers add them
  // up. Rounding each one independently does not necessarily total 100 — with
  // one factor stood down the remaining five rounded to 102%. Apportion by
  // largest remainder so the printed figures sum to exactly 100.
  const displayWeights = (() => {
    const keys = Object.keys(weights).filter(k => weights[k] > 0);
    const exact = keys.map(k => ({ key: k, value: weights[k] * 100 }));
    const out = {};
    for (const k of Object.keys(weights)) out[k] = 0;

    let assigned = 0;
    for (const e of exact) {
      out[e.key] = Math.floor(e.value);
      assigned += out[e.key];
    }
    // Hand the leftover points to the largest fractional parts first.
    const leftover = 100 - assigned;
    exact
      .map(e => ({ key: e.key, frac: e.value - Math.floor(e.value) }))
      .sort((a, b) => b.frac - a.frac)
      .slice(0, Math.max(0, leftover))
      .forEach(e => { out[e.key] += 1; });

    return out;
  })();

  const overallScore = Math.round((
    sourceResult.score * weights.sourceReputation +
    clickbaitResult.score * weights.clickbait +
    biasResult.score * weights.bias +
    manipulationResult.score * weights.manipulation +
    transparencyResult.score * weights.transparency +
    verificationResult.score * weights.verification
  ) * 10) / 10;

  const verdict = verdictFromScore(overallScore);
  const plain = buildPlainLanguage({
    sourceResult, clickbaitResult, biasResult, manipulationResult,
    transparencyResult, verificationResult, verdict
  });

  // A factor that fell back to the pattern check produced a real result, but a
  // weaker one. Say so on the report rather than letting a degraded run pass
  // for a full one — the reader is entitled to know how the score was reached.
  const degradedFactors = [
    ['clickbait', clickbaitResult], ['bias', biasResult],
    ['manipulation', manipulationResult], ['transparency', transparencyResult]
  ].filter(([, r]) => r.degraded).map(([id]) => id);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    overallScore,
    verdict: verdict.label,
    verdictLevel: verdict.level,
    advice: verdict.advice,
    degradedFactors,
    degradedNote: degradedFactors.length
      ? `${degradedFactors.length} of these checks ran without the language model and used word-pattern matching instead. They catch less than a full check would.`
      : null,
    // Plain-English layer shown first; the factor breakdown below is for
    // readers who want the detail.
    plainSummary: plain.summary,
    goodPoints: plain.goodPoints,
    concernPoints: plain.concernPoints,
    factors: [
      {
        id: 'sourceReputation',
        name: 'Who published it',
        score: sourceResult.score,
        weight: displayWeights.sourceReputation,
        detail: {
          matched: sourceResult.matched,
          matchedName: sourceResult.matchedName,
          bias: sourceResult.bias,
          type: sourceResult.type
        },
        explanation: sourceResult.matched
          ? `${sourceResult.matchedName} (${sourceResult.type}) — ${sourceResult.notes}`
          : sourceResult.notes
      },
      {
        id: 'clickbait',
        name: 'Is the headline honest?',
        score: clickbaitResult.score,
        weight: displayWeights.clickbait,
        degraded: Boolean(clickbaitResult.degraded),
        detail: {
          isClickbait: clickbaitResult.isClickbait,
          signals: clickbaitResult.signals
        },
        explanation: clickbaitResult.explanation
      },
      {
        id: 'bias',
        name: 'Is the writing fair?',
        score: biasResult.score,
        weight: displayWeights.bias,
        degraded: Boolean(biasResult.degraded),
        detail: {
          biasLevel: biasResult.biasLevel,
          politicalLean: biasResult.politicalLean,
          flaggedSentences: biasResult.flaggedSentences
        },
        explanation: biasResult.explanation
      },
      {
        id: 'transparency',
        name: 'Can you check it yourself?',
        score: transparencyResult.score,
        weight: displayWeights.transparency,
        degraded: Boolean(transparencyResult.degraded),
        detail: {
          level: transparencyResult.level,
          checks: transparencyResult.checks,
          passedCount: transparencyResult.passedCount,
          totalChecks: transparencyResult.totalChecks,
          namedExamples: transparencyResult.namedExamples,
          vagueAttributions: transparencyResult.vagueAttributions
        },
        explanation: transparencyResult.summary
      },
      {
        id: 'manipulation',
        name: 'Is it using persuasion tricks?',
        score: manipulationResult.score,
        weight: displayWeights.manipulation,
        degraded: Boolean(manipulationResult.degraded),
        detail: {
          intensity: manipulationResult.intensity,
          techniques: manipulationResult.techniques,
          summary: manipulationResult.summary
        },
        explanation: manipulationResult.summary || 'No persuasion techniques were detected.'
      },
      {
        id: 'verification',
        name: 'Do other outlets agree?',
        score: verificationResult.score,
        weight: displayWeights.verification,
        counted: verificationInformative,
        standDownReason: verificationNote,
        detail: {
          status: verificationResult.status,
          claims: verificationResult.claims
        },
        explanation: verificationInformative ? verificationResult.explanation : verificationNote
      }
    ],
    analyzedAt: new Date().toISOString(),
    // Operational metadata, not part of the score. It lets us optimise using
    // measured bottlenecks instead of guessing and is useful in development.
    // Which text the factors actually judged: the publisher's page, or the
    // feed's short excerpt when the page could not be read.
    textCoverage: textCoverage === 'full' ? 'article-text' : 'publisher-excerpt',
    analysedChars: text.length,
    timings: { total: Date.now() - startedAt, ...timings }
  };
};

module.exports = { analyzeTrust, WEIGHTS, verdictFromScore, REPORT_SCHEMA_VERSION, FACTOR_LABELS };
