import { useState } from 'react';
import '../styles/TrustReport.css';

const LEVEL_COLORS = {
  'high': '#4a7c59',
  'medium-high': '#7d9a5f',
  'medium-low': '#c9862b',
  'low': '#a63c3c',
  // Verdict classes. These are the headline answer now, so each gets its own
  // colour rather than inheriting one from the score band.
  'corroborated': '#4a7c59',
  'likely-true': '#7d9a5f',
  'opinion': '#6b7280',
  'unverified': '#8a6d3b',
  'satire': '#6b5b95',
  'likely-false': '#c9862b',
  'false': '#a63c3c'
};

// Reader-facing names for the internal check ids.
const LEDGER_NAMES = {
  prior: 'Who published it',
  'Before reading the article': 'Who published it',
  clickbait: 'Headline honesty',
  bias: 'Fairness of the language',
  manipulation: 'Persuasion tricks',
  transparency: 'Sources you could check',
  sourceReputation: "The outlet's track record",
  'Independent corroboration': 'Other outlets reporting it',
  'style-correlation-damping': 'Overlap between the writing checks',
  'style-weight-cap': 'Limit on how far writing alone can count',
  calibration: 'Adjustment from past checked articles'
};

/**
 * Say what a weight of evidence means, without the arithmetic.
 *
 * The model works in log-odds, which is the right thing for it to do and the
 * wrong thing to put in front of a reader. Nobody needs the word "deciban" to
 * understand "no effect" or "strongly suggests it is made up".
 */
const describeEffect = (decibans) => {
  const size = Math.abs(decibans);
  if (size < 0.5) return 'no effect';
  const strength = size >= 8 ? 'strongly' : size >= 3 ? 'moderately' : 'slightly';
  return decibans > 0
    ? `${strength} suggests it is made up`
    : `${strength} suggests it is genuine`;
};

const effectClass = (decibans) =>
  Math.abs(decibans) < 0.5 ? 'neutral' : (decibans > 0 ? 'toward-fake' : 'toward-real');

/**
 * Not every line of the ledger is evidence.
 *
 * Three of them are bookkeeping: the starting point before anything is read,
 * the discount for writing checks that overlap each other, and the correction
 * that keeps the scale honest against past checked articles. They move the
 * arithmetic, so they have to be shown - but calling a negative one "suggests
 * it is genuine" would claim a fabricated story had something in its favour,
 * which is exactly what the model refuses to do. They get their own words and
 * no colour.
 */
const describeLedgerEntry = (entry) => {
  const size = Math.abs(entry.decibans);
  if (entry.step === 'prior') {
    if (size < 0.5) return 'starts out neutral';
    return entry.decibans > 0 ? 'starts out doubtful' : 'starts out trusted';
  }
  if (entry.step === 'adjustment') {
    if (size < 0.5) return 'changed nothing';
    return entry.decibans > 0
      ? 'counts the writing checks for more'
      : 'counts the writing checks for less';
  }
  return describeEffect(entry.decibans);
};

const ledgerEntryClass = (entry) =>
  entry.step === 'prior' || entry.step === 'adjustment'
    ? 'neutral'
    : effectClass(entry.decibans);

const scoreColor = (score) => {
  if (score >= 7.5) return LEVEL_COLORS['high'];
  if (score >= 5.5) return LEVEL_COLORS['medium-high'];
  if (score >= 4) return LEVEL_COLORS['medium-low'];
  return LEVEL_COLORS['low'];
};

const VERDICT_BADGES = {
  supported: { label: 'Corroborated', className: 'claim-badge supported' },
  contradicted: { label: 'Contradicted', className: 'claim-badge contradicted' },
  unverified: { label: 'Unverified', className: 'claim-badge unverified' },
  'no-coverage': { label: 'No Coverage', className: 'claim-badge unverified' }
};

const FactorDetail = ({ factor }) => {
  switch (factor.id) {
    case 'transparency': {
      const checks = factor.detail.checks || [];
      const vague = factor.detail.vagueAttributions || [];
      const named = factor.detail.namedExamples || [];
      return (
        <div className="factor-detail">
          <p>
            This article passes <strong>{factor.detail.passedCount} of {factor.detail.totalChecks}</strong>{' '}
            journalism checks — it is <strong>{factor.detail.level}</strong>.
          </p>

          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.id} className={c.passed ? 'check-pass' : 'check-fail'} title={c.help}>
                <span className="check-mark">{c.passed ? '✓' : '✕'}</span>
                {c.label}
              </li>
            ))}
          </ul>

          {named.length > 0 && (
            <p className="named-sources">
              Names: {named.map((n, i) => <strong key={i}>{n}{i < named.length - 1 ? ', ' : ''}</strong>)}
            </p>
          )}

          {vague.length > 0 && (
            <>
              <p className="vague-heading">Unattributable phrasing it relies on:</p>
              <ul className="vague-list">
                {vague.map((v, i) => <li key={i}>&ldquo;{v}&rdquo;</li>)}
              </ul>
            </>
          )}
        </div>
      );
    }

    case 'manipulation': {
      const techniques = factor.detail.techniques || [];
      if (techniques.length === 0) {
        return (
          <div className="factor-detail">
            <p>No persuasion techniques were detected — the article reads as plain reporting.</p>
          </div>
        );
      }
      return (
        <div className="factor-detail">
          <p>
            Persuasion intensity: <strong>{factor.detail.intensity}</strong>. These are the
            techniques found, in the article&apos;s own words:
          </p>
          <div className="technique-list">
            {techniques.map((t, i) => (
              <figure key={i} className="technique">
                <figcaption className="technique-name">{t.technique}</figcaption>
                <blockquote>&ldquo;{t.quote}&rdquo;</blockquote>
                {t.effect && <p className="technique-effect">{t.effect}</p>}
                {t.definition && <p className="technique-def">{t.definition}</p>}
              </figure>
            ))}
          </div>
        </div>
      );
    }

    case 'sourceReputation':
      return (
        <div className="factor-detail">
          {factor.detail.matched ? (
            <p>
              Recognized as <strong>{factor.detail.matchedName}</strong> ({factor.detail.type})
              {factor.detail.bias && factor.detail.bias !== 'unknown' && (
                <> &middot; editorial lean: <strong>{factor.detail.bias}</strong></>
              )}
            </p>
          ) : (
            <p>This source is not in the reputation database, so it is treated neutrally.</p>
          )}
        </div>
      );

    case 'clickbait':
      return (
        <div className="factor-detail">
          {factor.detail.signals && factor.detail.signals.length > 0 ? (
            <>
              <p>Clickbait signals detected:</p>
              <ul>
                {factor.detail.signals.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          ) : (
            <p>No clickbait signals detected in the headline.</p>
          )}
        </div>
      );

    case 'bias':
      return (
        <div className="factor-detail">
          <p>
            Bias level: <strong>{factor.detail.biasLevel}</strong>
            {factor.detail.politicalLean && factor.detail.politicalLean !== 'none-detected' && (
              <> &middot; political lean: <strong>{factor.detail.politicalLean}</strong></>
            )}
          </p>
          {factor.detail.flaggedSentences && factor.detail.flaggedSentences.length > 0 && (
            <div className="flagged-sentences">
              {factor.detail.flaggedSentences.map((f, i) => (
                <div key={i} className="flagged-sentence">
                  <blockquote>&ldquo;{f.sentence}&rdquo;</blockquote>
                  <span className="flag-type">{f.type}</span>
                  {f.reason && <span className="flag-reason"> — {f.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 'verification':
      return (
        <div className="factor-detail">
          {factor.detail.claims && factor.detail.claims.length > 0 ? (
            factor.detail.claims.map((c, i) => {
              const badge = VERDICT_BADGES[c.verdict] || VERDICT_BADGES.unverified;
              const evidence = [...(c.supportingEvidence || []), ...(c.contradictingEvidence || [])];
              return (
                <div key={i} className="claim-item">
                  <div className="claim-header">
                    <span className={badge.className}>{badge.label}</span>
                  </div>
                  <p className="claim-text">&ldquo;{c.claim}&rdquo;</p>
                  {c.explanation && <p className="claim-explanation">{c.explanation}</p>}
                  {evidence.length > 0 && (
                    <ul className="evidence-list">
                      {evidence.map((e, j) => (
                        <li key={j}>
                          <a href={e.url} target="_blank" rel="noopener noreferrer">
                            {e.source}: {e.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          ) : (
            <p>No checkable claims were identified for cross-source verification.</p>
          )}
        </div>
      );

    default:
      return null;
  }
};

/**
 * Which report factor holds the detail behind a ledger row.
 *
 * The working used to be printed twice: a ledger saying "Headline honesty —
 * scored 3/10 · strongly suggests it is made up", and then, below it, a second
 * list saying "Is the headline honest? · strongly suggests it is made up · 3".
 * Same checks, same numbers, different words, one after the other — and "Who
 * published it" appeared in both, which made it look as though the publisher
 * had been counted twice. They are one list now: the ledger row is the summary
 * and the factor's detail is what opens underneath it.
 */
const FACTOR_FOR_LEDGER = {
  'Before reading the article': 'sourceReputation',
  clickbait: 'clickbait',
  bias: 'bias',
  manipulation: 'manipulation',
  transparency: 'transparency',
  'Independent corroboration': 'verification'
};

const TrustReport = ({ report }) => {
  const [expanded, setExpanded] = useState(null);
  // Three panels, all peers. The full working used to be nested inside the
  // other two — it appeared only once you had opened "How do you know?" or
  // "How is it written?", which made the deepest tier the hardest to reach and
  // tied it to whichever one you happened to open first.
  const [panel, setPanel] = useState(null);

  if (!report || !report.factors) return null;

  const color = LEVEL_COLORS[report.verdictLevel] || scoreColor(report.overallScore);
  const quality = report.quality;
  const evidence = report.evidence || {};
  const factorById = Object.fromEntries(report.factors.map(f => [f.id, f]));
  const show = (name) => setPanel(panel === name ? null : name);

  // Every step that moved the answer, in the order it was weighed, each
  // carrying whatever detail the report holds for it.
  const rows = (report.evidenceLedger || []).map((entry, i) => {
    const factor = factorById[FACTOR_FOR_LEDGER[entry.label]] || null;
    return {
      key: entry.label + '-' + i,
      name: LEDGER_NAMES[entry.label] || entry.label,
      entry,
      factor,
      observation: typeof entry.observation === 'number' ? entry.observation : factor?.score,
      effect: describeLedgerEntry(entry),
      tone: ledgerEntryClass(entry)
    };
  });

  // A check that ran but carried no weight still has something to report.
  const unweighed = report.factors.filter(
    f => !rows.some(r => r.factor?.id === f.id) && typeof f.score === 'number'
  );

  return (
    <div className="trust-report">
      {/* ── THE ANSWER ────────────────────────────────────────────────────
          One word, and one sentence saying why. No score: showing "4.9 / 10"
          beside a fabricated story reads as a mark for truthfulness, which is
          the thing readers and reviewers objected to most. */}
      <div className={`verdict-card verdict-${report.verdictLevel || 'unverified'}`}>
        <div className="verdict-call" style={{ color }}>{report.call || report.verdict}</div>
        {report.oneLine && <p className="verdict-oneline">{report.oneLine}</p>}
      </div>

      <div className="tier-buttons">
        <button
          className={`pp-btn pp-btn--quiet pp-btn--sm${panel === 'why' ? ' is-open' : ''}`}
          onClick={() => show('why')}
          aria-expanded={panel === 'why'}
        >
          How do you know?
        </button>
        <button
          className={`pp-btn pp-btn--quiet pp-btn--sm${panel === 'working' ? ' is-open' : ''}`}
          onClick={() => show('working')}
          aria-expanded={panel === 'working'}
        >
          The full working
        </button>
        {quality && (
          <button
            className={`pp-btn pp-btn--quiet pp-btn--sm${panel === 'writing' ? ' is-open' : ''}`}
            onClick={() => show('writing')}
            aria-expanded={panel === 'writing'}
          >
            How is it written?
          </button>
        )}
      </div>

      {/* ── WHY ─────────────────────────────────────────────────────────── */}
      {panel === 'why' && (
        <section className="trust-panel">
          <div className="pp-section-head"><h4>What we found</h4></div>
          {report.decision?.grounds?.length > 0 && (
            <ul className="verdict-grounds">
              {report.decision.grounds
                // The independent-source count is rendered on its own line
                // below, so the ground repeating it is dropped, not said twice.
                .filter(ground => !/articles? (were|was) retrieved/i.test(ground))
                .slice(0, 3)
                .map((ground, i) => <li key={i}>{ground}</li>)}
            </ul>
          )}
          {evidence.independentSupport > 0 && (
            <p className="evidence-count">
              Found <strong>{evidence.independentSupport}</strong>{' '}
              {evidence.independentSupport === 1 ? 'other outlet' : 'separate outlets'} reporting the same thing
              {evidence.articlesRetrieved > evidence.independentSupport &&
                ` (${evidence.articlesRetrieved} articles, but the rest were the same story reprinted)`}.
            </p>
          )}
          {evidence.independenceNotes?.length > 0 && (
            <ul className="independence-notes">
              {evidence.independenceNotes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          )}
          {report.provenance && !report.provenance.knownOutletChannel && (
            <p className="trust-provenance-note">{report.provenance.note}</p>
          )}
          {report.ingestNotes?.length > 0 && (
            <ul className="trust-ingest-notes">
              {report.ingestNotes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          )}
        </section>
      )}

      {/* ── THE WORKING ──────────────────────────────────────────────────
          What actually moved the answer. The arithmetic underneath is a sum of
          log-odds; nobody needs that word to understand "no effect" or
          "strongly suggests it is made up". The numbers stay in the API for the
          evaluation, and the page says what they mean. */}
      {panel === 'working' && (
        <section className="trust-panel">
          <div className="pp-section-head">
            <h4>What changed the answer</h4>
            <span className="pp-section-head__note">Open a line to see what it found</span>
          </div>

          <ul className="working-list">
            {rows.map(row => {
              const openable = Boolean(row.factor);
              const isOpen = expanded === row.key;
              return (
                <li
                  key={row.key}
                  className={row.entry.step === 'adjustment' ? 'working-row is-bookkeeping' : 'working-row'}
                >
                  <button
                    className="working-row__head"
                    onClick={() => openable && setExpanded(isOpen ? null : row.key)}
                    disabled={!openable}
                  >
                    <span className="working-row__name">{row.name}</span>
                    {typeof row.observation === 'number' && (
                      <span className="working-row__score">{row.observation}<span>/10</span></span>
                    )}
                    <span className={`working-row__effect ${row.tone}`}>{row.effect}</span>
                    {openable && <span className={`working-row__chevron${isOpen ? ' is-open' : ''}`}>▾</span>}
                  </button>
                  {isOpen && row.factor && (
                    <div className="working-row__detail">
                      {row.factor.explanation && <p className="factor-explanation">{row.factor.explanation}</p>}
                      <FactorDetail factor={row.factor} />
                    </div>
                  )}
                </li>
              );
            })}

            {unweighed.map(factor => (
              <li key={factor.id} className="working-row is-bookkeeping">
                <button className="working-row__head" disabled>
                  <span className="working-row__name">{factor.name}</span>
                  {typeof factor.score === 'number' && factor.counted !== false && (
                    <span className="working-row__score">{factor.score}<span>/10</span></span>
                  )}
                  <span className="working-row__effect neutral">
                    {factor.standDownReason || 'ran, but carried no weight'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {typeof report.probabilityPercent === 'number' && (
            <p className="ledger-outcome">
              Putting that together: we estimate a <strong>{report.probabilityPercent}%</strong> chance
              this story is made up.
            </p>
          )}

          <p className="ledger-note">
            Checks that describe the writing can only count against an article, never for it —
            anyone can write neatly, so neat writing is not a reason to believe a story.
            Only other outlets reporting the same thing can count in its favour.
          </p>

          {report.unmeasuredFactors?.length > 0 && (
            <p className="ledger-note">
              These ran but changed nothing, because we do not yet have enough checked examples
              to know what they are worth: {report.unmeasuredFactors.map(u => LEDGER_NAMES[u.factor] || u.factor).join(', ')}.
            </p>
          )}

          {report.degradedNote && <p className="ledger-note">{report.degradedNote}</p>}
        </section>
      )}

      {/* ── A DIFFERENT QUESTION ─────────────────────────────────────────
          How well it is written, fenced off from the verdict: propaganda is
          often well written and a true local report is often scrappy, so
          putting this in the reader's way while they are asking "is it true?"
          only confuses the two. */}
      {panel === 'writing' && quality && (
        <section className={`trust-panel quality-card quality-${quality.level}`}>
          <div className="pp-section-head">
            <h4>How it is written</h4>
            <span className="quality-score">{quality.score}<span className="quality-outof">/10</span></span>
          </div>
          <p className="quality-caveat">
            This says nothing about whether the story is true — a well-written story
            can still be false, and a true one can be badly written.
          </p>
          <ul className="quality-checks">
            {quality.checks.map(check => (
              <li key={check.id}>
                <span className="quality-check-name">{check.name}</span>
                <span className="quality-check-bar">
                  <span style={{ width: `${check.score * 10}%`, background: scoreColor(check.score) }} />
                </span>
                <span className="quality-check-score">{check.score}</span>
              </li>
            ))}
          </ul>
          {report.concernPoints?.length > 0 && (
            <div className="quality-notes">
              <h5>Worth noticing</h5>
              <ul>{report.concernPoints.slice(0, 3).map((point, i) => <li key={i}>{point}</li>)}</ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default TrustReport;
