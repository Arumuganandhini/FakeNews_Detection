// backend/agents/verdictEngine.js
//
// The decision layer: turns evidence into a stated verdict, and stops a
// well-written fabrication from scoring as trustworthy.
//
// WHY THIS EXISTS
//
// Five of the six factors measure how an article PRESENTS itself — who
// published it, headline style, neutral wording, whether it names sources,
// whether it leans on persuasion. All five are cheap to fake. Inventing a
// quote from a named professor raises the transparency factor; writing calmly
// raises the language factor. Only cross-source verification asks whether the
// events described actually happened.
//
// The earlier design combined all six in a weighted sum and, when verification
// found nothing, redistributed its weight across the other five. That inverted
// the meaning of the evidence: a fabricated story has no corroborating coverage
// precisely BECAUSE it is fabricated, and the pipeline read that absence as a
// reason to trust the remaining factors more. A competent fabrication scored
// 7-8/10.
//
// The rule applied here instead:
//
//     presentation can only LOWER trust; evidence is what RAISES it.
//
// Final score = min(presentation score, evidence ceiling). An article nobody
// else reports cannot exceed the "unverified" ceiling however well written it
// is. Separately, a discrete verdict is derived from the evidence by rules
// stated below, so the reader is told what the system concluded and which rule
// concluded it — not only a number.
//
// Every decision in this file is deterministic. No model is called. Given the
// same evidence it returns the same verdict, and the rule that fired is named
// in the output.

const { analyseIndependence } = require('./independence');

/**
 * Verdict classes. `ceiling` is the highest trust score an article in this
 * class may receive, whatever the presentation factors say.
 *
 * The ceilings are set against the reader-facing bands (>=7.5 trustworthy,
 * >=5.5 mostly fine, >=4.0 read carefully): "unverified" sits at 4.9 so that an
 * uncorroborated story can never be described as fine, and "opinion" at 6.4 so
 * that commentary is not punished as though it were a false report.
 */
const VERDICT_CLASSES = {
  false: {
    label: 'False',
    call: 'FAKE',
    level: 'false',
    ceiling: 2.0,
    advice: 'Independent reporting contradicts this. Do not share it.'
  },
  'likely-false': {
    label: 'Probably false',
    call: 'FAKE',
    level: 'likely-false',
    ceiling: 3.5,
    advice: 'The evidence points against this story. Treat it as false unless it is confirmed elsewhere.'
  },
  unverified: {
    label: 'Not confirmed',
    call: 'CANNOT VERIFY',
    level: 'unverified',
    ceiling: 4.9,
    advice: 'No independent outlet reports this. That is not proof it is false — it means nothing yet supports it.'
  },
  opinion: {
    label: 'Opinion, not reporting',
    call: 'NOT A FACTUAL CLAIM',
    level: 'opinion',
    ceiling: 6.4,
    advice: 'This is argument rather than reporting. There is no factual claim here to verify.'
  },
  satire: {
    label: 'Satire',
    call: 'SATIRE',
    level: 'satire',
    ceiling: 4.0,
    advice: 'This is a satirical publication. It is not intended as factual reporting.'
  },
  'likely-true': {
    label: 'Probably true',
    call: 'REAL',
    level: 'likely-true',
    ceiling: 8.0,
    advice: 'One independent source reports the same facts. A second would settle it.'
  },
  corroborated: {
    label: 'Confirmed by other outlets',
    call: 'REAL',
    level: 'corroborated',
    ceiling: 10,
    advice: 'Independent outlets report the same facts.'
  }
};

// Wording that marks a claim as consequential enough that silence from every
// other outlet is itself meaningful. A local council decision going unreported
// elsewhere is ordinary; a cure, a coup or a mass casualty event going
// unreported everywhere is not.
const HIGH_IMPACT_PATTERNS = [
  /\bcure[sd]?\b/i, /\bbreakthrough\b/i, /\bfirst[- ]ever\b/i, /\bbanned\b/i,
  /\bdeath toll\b/i, /\bkilled\b/i, /\bmassacre\b/i, /\bcoup\b/i, /\bresign(s|ed|ation)\b/i,
  /\barrest(s|ed)\b/i, /\bimpeach/i, /\bdeclares? war\b/i, /\bnuclear\b/i,
  /\bsecret(ly)?\b/i, /\bleaked\b/i, /\bexposed\b/i, /\bcover[- ]up\b/i,
  /\bmillions? (of )?(people|deaths|dollars)\b/i, /\bemergency\b/i, /\bevacuat/i,
  /\bpandemic\b/i, /\boutbreak\b/i, /\brecall(s|ed)?\b/i, /\bcollapse[sd]?\b/i
];

const looksHighImpact = (text) => HIGH_IMPACT_PATTERNS.some(pattern => pattern.test(String(text || '')));

/**
 * Reduce the verification factor's per-claim results to an evidence ledger,
 * counting INDEPENDENT sources rather than articles.
 *
 * @param {Object} input
 * @param {Array}  input.claims - per-claim results from the verification factor
 * @param {Object} input.sourceResult - source reputation factor result
 * @param {Object} [input.transparencyResult]
 * @param {Object} [input.manipulationResult]
 * @param {string} [input.title]
 * @returns {Object} the ledger the verdict rules read
 */
const buildEvidenceLedger = ({
  claims = [], sourceResult = {}, transparencyResult = {}, manipulationResult = {}, title = '',
  verificationStatus = 'unverified', premiseResult = null
}) => {
  const perClaim = claims.map(claim => {
    const support = analyseIndependence(claim.supportingEvidence || []);
    const contradiction = analyseIndependence(claim.contradictingEvidence || []);
    return {
      claim: claim.claim,
      verdict: claim.verdict,
      independentSupport: support.independentCount,
      independentContradiction: contradiction.independentCount,
      support,
      contradiction,
      highImpact: looksHighImpact(claim.claim)
    };
  });

  // The article's support level is the best-evidenced single claim, not the sum
  // across claims: two outlets confirming two DIFFERENT claims is weaker
  // evidence than two outlets confirming the same one.
  const best = (key) => perClaim.reduce((max, c) => Math.max(max, c[key]), 0);

  const supportingClusters = perClaim.flatMap(c => c.support.clusters);
  const strongestSupport = perClaim.reduce(
    (bestClaim, c) => (c.independentSupport > (bestClaim?.independentSupport ?? -1) ? c : bestClaim),
    null
  );

  return {
    checkableClaimCount: claims.length,
    // "We found no claim worth checking" and "the check could not run" look
    // identical in the claim list and mean opposite things. Without this flag a
    // model outage would silently reclassify every article as commentary, which
    // carries a far higher ceiling than an unverified report.
    verificationRan: verificationStatus !== 'error',
    // A reference work contradicting something the article states about a named
    // subject. Distinct from a news contradiction, and not merged with it: an
    // encyclopedia is not an independent newsroom reporting an event, it is a
    // record of stable facts, so it speaks to the article's premises rather
    // than to what happened.
    premiseContradictions: premiseResult?.contradictions || [],
    premiseStatus: premiseResult?.status || 'not-run',
    independentSupport: best('independentSupport'),
    independentContradiction: best('independentContradiction'),
    perClaim,
    mergeNotes: [...new Set(perClaim.flatMap(c => [...c.support.mergeNotes, ...c.contradiction.mergeNotes]))],
    rawSupportingArticles: perClaim.reduce((sum, c) => sum + c.support.itemCount, 0),
    hasHighQualitySource: perClaim.some(c => c.support.hasHighQualitySource),
    stateOnlySupport: Boolean(strongestSupport && strongestSupport.independentSupport > 0 && strongestSupport.support.stateOnly),
    supportingClusters,
    // Presentation-side risk signals, used only to separate "we found nothing"
    // from "we found nothing and the article looks engineered".
    sourceKnown: Boolean(sourceResult.matched),
    sourceReliability: Number(sourceResult.score) || 0,
    sourceIsSatire: String(sourceResult.type || '').toLowerCase() === 'satire',
    sourceIsConspiracy: String(sourceResult.type || '').toLowerCase() === 'conspiracy',
    transparencyScore: Number(transparencyResult.score) || 0,
    persuasionTechniqueCount: (manipulationResult.techniques || []).length,
    highImpact: looksHighImpact(title) || perClaim.some(c => c.highImpact)
  };
};

/**
 * Decide the verdict from the ledger.
 *
 * Rules are evaluated in order and the first match wins. Each returns the rule
 * id that fired and the grounds in plain language, so the report can show its
 * working rather than asserting a conclusion.
 *
 * @param {Object} ledger - from buildEvidenceLedger
 * @returns {{verdict: string, label: string, level: string, ceiling: number, advice: string,
 *            rule: string, grounds: string[], confidence: number}}
 */
const decideVerdict = (ledger) => {
  const grounds = [];
  const decide = (verdict, rule, reasons, adviceOverride) => {
    const spec = VERDICT_CLASSES[verdict];
    return {
      verdict,
      label: spec.label,
      level: spec.level,
      ceiling: spec.ceiling,
      // Most verdicts want their class's stock advice, but a couple of rules
      // reach the same verdict for a different reason and must not tell the
      // reader we searched when we could not.
      advice: adviceOverride || spec.advice,
      // The call is the answer in one word — FAKE, REAL, CANNOT VERIFY — and
      // `oneLine` is the whole reason for it in a single sentence. A reader who
      // reads nothing else should still have both, and be correctly informed.
      // Everything below is for the reader who wants to see the working.
      call: spec.call,
      oneLine: summarise(verdict, ledger),
      rule,
      grounds: reasons,
      confidence: confidenceFor(verdict, ledger)
    };
  };

  // R0 — A satirical publication is not making a truth claim at all, so
  // corroboration and contradiction are both meaningless for it.
  if (ledger.sourceIsSatire) {
    return decide('satire', 'satirical-publisher', [
      'The publisher is a satirical outlet in our source database.'
    ]);
  }

  // R1 — Contradicted by two or more independent sources. This is the only
  // route to a flat "False": one outlet disagreeing can be the outlet that is
  // wrong, two independent ones rarely are.
  if (ledger.independentContradiction >= 2) {
    return decide('false', 'contradicted-by-multiple-independent-sources', [
      `${ledger.independentContradiction} independent sources report facts that conflict with this article's central claim.`
    ]);
  }

  // R2 — One independent contradiction: strong evidence against, short of proof.
  if (ledger.independentContradiction === 1) {
    return decide('likely-false', 'contradicted-by-one-independent-source', [
      'An independent outlet reports facts that conflict with this article.',
      'One contradiction is not conclusive, so this is stated as likely rather than certain.'
    ]);
  }

  // R2b — A reference work contradicts something the article states about a
  // named subject. This catches what the news channel structurally cannot: an
  // article built on a false premise describes an event nobody reports, so the
  // news search correctly finds nothing and the real finding — that the premise
  // is wrong — would otherwise be missed entirely.
  //
  // Stated as "probably false" rather than "false". The encyclopedia entry may
  // be out of date, or may be about a different person of the same name, and
  // neither is visible from here. It is strong evidence, not proof.
  if (ledger.premiseContradictions.length > 0) {
    const first = ledger.premiseContradictions[0];
    return decide('likely-false', 'premise-contradicted-by-reference', [
      `This article states: ${first.articleStates}`,
      `A reference entry on ${first.entity} says otherwise: "${first.referenceStates}"`,
      'A story built on a premise that is wrong does not become true because no one has reported it.'
    ]);
  }

  // R3 — The verification check itself could not run. This must never be read
  // as "nothing to verify": an unrun check is an absence of knowledge, and the
  // report says so rather than quietly reclassifying the article as commentary.
  if (!ledger.verificationRan) {
    return decide('unverified', 'verification-unavailable', [
      'We could not search other outlets just now, so nothing about this story has been confirmed either way.',
      'The writing checks below still ran, but how an article is written says nothing about whether it happened.'
    ], 'We could not complete the check. Treat this as unconfirmed rather than as either true or false.');
  }

  // R4 — Nothing checkable was asserted. Commentary is not false; it is simply
  // outside what verification can speak to.
  //
  // The exception matters. "Commentary" carries the highest ceiling available
  // to an uncorroborated article, and making unfalsifiable claims is the normal
  // working method of a publisher with a poor factual record — so without this
  // guard, being too vague to check becomes a way of scoring better. A known
  // conspiracy outlet writing untestable assertions is not a columnist.
  if (ledger.checkableClaimCount === 0) {
    if (ledger.sourceIsConspiracy || (ledger.sourceKnown && ledger.sourceReliability <= 3)) {
      return decide('unverified', 'no-checkable-claims-poor-record-publisher', [
        'The article makes no claim specific enough for another outlet to confirm or deny.',
        'Its publisher has a poor factual-reporting record, so this is treated as unverifiable rather than as commentary — being too vague to check is not a mark in an article’s favour.'
      ]);
    }
    return decide('opinion', 'no-checkable-claims', [
      'The article makes no specific factual claim that another outlet could confirm or deny.',
      'It is argument or analysis, so there is nothing here to verify.'
    ]);
  }

  // R5 — Corroborated by two or more independent sources.
  if (ledger.independentSupport >= 2) {
    grounds.push(`${ledger.independentSupport} independent sources report the same facts.`);
    if (ledger.rawSupportingArticles > ledger.independentSupport) {
      grounds.push(`${ledger.rawSupportingArticles} articles were retrieved, but only ${ledger.independentSupport} represent genuinely separate sources — the rest share an owner or run the same agency copy.`);
    }
    if (ledger.stateOnlySupport) {
      // Two state outlets from one state are one source; analyseIndependence
      // already merges those, so this is a different case: corroboration that
      // is entirely state-controlled, which the reader should be told.
      grounds.push('All corroboration comes from state-controlled media.');
      return decide('likely-true', 'corroborated-state-media-only', grounds);
    }
    return decide('corroborated', 'corroborated-by-multiple-independent-sources', grounds);
  }

  // R6 — A single independent source.
  if (ledger.independentSupport === 1) {
    grounds.push('One independent source reports the same facts.');
    if (!ledger.hasHighQualitySource) {
      grounds.push('That source does not have a strong factual-reporting record, so the confirmation is weak.');
    }
    return decide('likely-true', 'corroborated-by-one-independent-source', grounds);
  }

  // R7 — Nothing corroborates it, and the article carries the marks of
  // engineered content. Stated as likely false rather than merely unverified:
  // a consequential event that no other outlet reports, published by an outlet
  // with no record and written to persuade, is not a neutral situation.
  const risk = [];
  if (ledger.highImpact) risk.push('the claim is consequential enough that other outlets would be expected to report it');
  if (!ledger.sourceKnown) risk.push('the publisher has no reliability record');
  if (ledger.sourceIsConspiracy || ledger.sourceReliability <= 3) risk.push('the publisher has a poor factual-reporting record');
  if (ledger.persuasionTechniqueCount >= 2) risk.push(`the article uses ${ledger.persuasionTechniqueCount} persuasion techniques on the reader`);
  if (ledger.transparencyScore > 0 && ledger.transparencyScore < 4) risk.push('its claims cannot be traced to any nameable source');

  if (ledger.highImpact && risk.length >= 3) {
    return decide('likely-false', 'uncorroborated-high-impact-with-risk-signals', [
      'No independent outlet reports this story.',
      `It also shows ${risk.length} warning signs: ${risk.join('; ')}.`,
      'Taken together, that pattern is more consistent with a fabricated story than with an unreported true one.'
    ]);
  }

  // R8 — The honest default. We looked and found nothing either way.
  const reasons = ['No independent outlet was found reporting these claims.'];
  if (ledger.highImpact) {
    reasons.push('For a story of this significance, an absence of other coverage is itself a warning sign.');
  }
  reasons.push('This is not a finding that the story is false. It means nothing independent supports it yet.');
  if (risk.length) reasons.push(`Also noted: ${risk.join('; ')}.`);
  return applyProvenanceRelief(decide('unverified', 'no-independent-coverage', reasons), ledger);
};

/**
 * A genuine exclusive by an established newsroom is not the same object as an
 * anonymous site's uncorroborated claim, though both are "unverified". Without
 * this adjustment the system would rate a Reuters scoop that no one has matched
 * yet at the same ceiling as a fabricated story, which is wrong and would be the
 * first thing an examiner attacked.
 *
 * The relief is deliberately narrow: it requires an outlet we hold a strong
 * factual-reporting record for, and it still cannot reach "looks trustworthy"
 * (>=7.5), because the claim remains unconfirmed.
 */
const PROVENANCE_RELIEF_THRESHOLD = 8.5;

const applyProvenanceRelief = (decision, ledger) => {
  if (decision.verdict !== 'unverified') return decision;
  if (!ledger.sourceKnown || ledger.sourceReliability < PROVENANCE_RELIEF_THRESHOLD) return decision;

  return {
    ...decision,
    ceiling: VERDICT_CLASSES.opinion.ceiling,
    rule: 'no-independent-coverage-established-publisher',
    grounds: [
      ...decision.grounds,
      `Reported by an outlet with a strong factual record (${ledger.sourceReliability}/10), so this is treated as an exclusive that others have not yet matched rather than as an unsourced claim. It still cannot be called confirmed.`
    ]
  };
};

/**
 * The whole reason, in one sentence.
 *
 * Not a summary of the analysis — the single fact that decided it. If the
 * reader takes away one line, this is the line, so it names the evidence rather
 * than describing the process.
 */
const summarise = (verdict, ledger) => {
  const sources = (n) => `${n} independent ${n === 1 ? 'outlet' : 'outlets'}`;

  switch (verdict) {
    case 'false':
      return `${sources(ledger.independentContradiction)} report the opposite of what this says.`;
    case 'likely-false':
      if (ledger.premiseContradictions?.length > 0) {
        return `A reference entry on ${ledger.premiseContradictions[0].entity} contradicts what this article states about them.`;
      }
      return ledger.independentContradiction > 0
        ? 'An independent outlet reports the opposite of what this says.'
        : 'No outlet is reporting this, and it carries several marks of a fabricated story.';
    case 'corroborated':
      return `Confirmed by ${sources(ledger.independentSupport)} reporting the same facts.`;
    case 'likely-true':
      return ledger.stateOnlySupport
        ? 'Reported elsewhere, but only by state-controlled media.'
        : 'One independent outlet reports the same facts.';
    case 'satire':
      return 'This comes from a satirical publication, so it was never meant as news.';
    case 'opinion':
      return 'This argues a position rather than reporting events, so there is nothing to check.';
    case 'unverified':
    default:
      if (!ledger.verificationRan) return 'We could not complete the search, so nothing has been checked.';
      return ledger.highImpact
        ? 'No other outlet is reporting this — and a story this big would normally be everywhere.'
        : 'No other outlet is reporting this, so nothing supports it either way.';
  }
};

/**
 * Confidence in the verdict, on 0-1.
 *
 * Derived only from how much independent evidence exists and how good it is —
 * never from the language model's own certainty, which is not measurable. The
 * value is deliberately capped below 1: the system does not claim certainty.
 */
const confidenceFor = (verdict, ledger) => {
  const cap = (value) => Math.max(0.3, Math.min(0.95, Math.round(value * 100) / 100));
  switch (verdict) {
    case 'false':
      return cap(0.7 + 0.07 * Math.min(ledger.independentContradiction - 2, 3));
    case 'likely-false':
      return cap(ledger.independentContradiction === 1 ? 0.62 : 0.55);
    case 'corroborated': {
      const base = 0.7 + 0.06 * Math.min(ledger.independentSupport - 2, 3);
      return cap(ledger.hasHighQualitySource ? base + 0.08 : base);
    }
    case 'likely-true':
      return cap(ledger.hasHighQualitySource ? 0.6 : 0.5);
    case 'satire':
      return cap(0.9);
    case 'opinion':
      return cap(0.65);
    case 'unverified':
    default:
      // Confidence that the situation is "unestablished", which searching
      // harder could change at any time.
      return cap(0.5);
  }
};

/**
 * Apply the evidence ceiling to a presentation score.
 * @param {number} presentationScore - weighted score of the content factors, 0-10
 * @param {Object} verdict - from decideVerdict
 * @returns {{score: number, capped: boolean, ceilingReason: string|null}}
 */
const applyCeiling = (presentationScore, verdict) => {
  const score = Math.round(Math.min(presentationScore, verdict.ceiling) * 10) / 10;
  const capped = presentationScore > verdict.ceiling + 0.05;
  return {
    score,
    capped,
    ceilingReason: capped
      ? `The article reads well (${presentationScore.toFixed(1)}/10 on presentation), but presentation is not evidence. Verdict "${verdict.label}" limits the trust score to ${verdict.ceiling}.`
      : null
  };
};

module.exports = {
  buildEvidenceLedger,
  decideVerdict,
  applyCeiling,
  VERDICT_CLASSES,
  looksHighImpact
};
