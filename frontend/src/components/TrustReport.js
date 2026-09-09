import { useState } from 'react';
import '../styles/TrustReport.css';

const LEVEL_COLORS = {
  'high': '#4a7c59',
  'medium-high': '#7d9a5f',
  'medium-low': '#c9862b',
  'low': '#a63c3c'
};

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

// Fact-checker ratings, normalised by the backend into these buckets.
const FACTCHECK_BADGES = {
  'false': { label: 'Rated False', className: 'claim-badge contradicted' },
  'mostly-false': { label: 'Rated Misleading', className: 'claim-badge contradicted' },
  'mixed': { label: 'Rated Mixed', className: 'claim-badge unverified' },
  'mostly-true': { label: 'Rated Mostly True', className: 'claim-badge supported' },
  'true': { label: 'Rated True', className: 'claim-badge supported' },
  'unrated': { label: 'Rated (see source)', className: 'claim-badge unverified' },
  'no-factcheck': { label: 'No fact-check found', className: 'claim-badge unverified' }
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

    case 'factCheck': {
      const checked = factor.detail.checkedClaims || [];
      if (factor.detail.status === 'not-configured') {
        return (
          <div className="factor-detail">
            <p>Professional fact-check matching is not configured on this server.</p>
          </div>
        );
      }
      if (checked.length === 0) {
        return (
          <div className="factor-detail">
            <p>No claims were available to match against fact-check databases.</p>
          </div>
        );
      }
      return (
        <div className="factor-detail">
          {checked.map((c, i) => {
            const badge = FACTCHECK_BADGES[c.verdict] || FACTCHECK_BADGES['no-factcheck'];
            return (
              <div key={i} className="claim-item">
                <div className="claim-header">
                  <span className={badge.className}>{badge.label}</span>
                </div>
                <p className="claim-text">&ldquo;{c.claim}&rdquo;</p>
                {c.note && <p className="claim-explanation">{c.note}</p>}
                {c.matches?.length > 0 && (
                  <ul className="evidence-list">
                    {c.matches.map((m, j) => (
                      <li key={j}>
                        <a href={m.url} target="_blank" rel="noopener noreferrer">
                          <strong>{m.publisher}</strong> rated it &ldquo;{m.rating}&rdquo;
                          {m.title ? ` — ${m.title}` : ''}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
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

const TrustReport = ({ report }) => {
  const [expanded, setExpanded] = useState(null);
  const [showWorking, setShowWorking] = useState(false);

  if (!report || !report.factors) return null;

  const color = LEVEL_COLORS[report.verdictLevel] || scoreColor(report.overallScore);
  const goodPoints = report.goodPoints || [];
  const concernPoints = report.concernPoints || [];

  return (
    <div className="trust-report">
      <div className="trust-overall">
        <div
          className="score-circle"
          style={{ background: `conic-gradient(${color} ${report.overallScore * 10}%, var(--paper-sunken) 0)` }}
        >
          <div className="score-inner">
            <span>{report.overallScore}</span>
            <span className="score-label">/10</span>
          </div>
        </div>
        <div className="trust-verdict" style={{ color }}>
          {report.verdict}
        </div>
        {report.plainSummary && (
          <p className="trust-plain-summary">{report.plainSummary}</p>
        )}
      </div>

      {/* The editor's note — what most readers need, in plain words. */}
      {(concernPoints.length > 0 || goodPoints.length > 0) && (
        <div className="trust-notes">
          {/* The modifier sits on the section as well as the heading, so the
              whole group can be tinted rather than just its title. */}
          {concernPoints.length > 0 && (
            <section className="note-group concern">
              <h4 className="note-heading concern">Things to watch</h4>
              <ul>{concernPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </section>
          )}
          {goodPoints.length > 0 && (
            <section className="note-group good">
              <h4 className="note-heading good">In its favour</h4>
              <ul>{goodPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </section>
          )}
        </div>
      )}

      {/* A run that fell back to word-pattern matching must say so up front,
          not bury it in the factor list. */}
      {report.degradedNote && (
        <p className="trust-degraded-note">{report.degradedNote}</p>
      )}

      <button
        className="working-toggle"
        onClick={() => setShowWorking(!showWorking)}
        aria-expanded={showWorking}
      >
        {showWorking ? 'Hide our working' : 'See how we checked this'}
      </button>

      {showWorking && (
      <div className="trust-factors">
        {report.factors.map((factor) => {
          // A factor that stood down contributed nothing, so it must not look
          // like a middling score that dragged the result down.
          const counted = factor.counted !== undefined ? factor.counted : factor.weight > 0;
          return (
            <div key={factor.id} className={`trust-factor ${counted ? '' : 'factor-stood-down'}`}>
              <button
                className="factor-row"
                onClick={() => setExpanded(expanded === factor.id ? null : factor.id)}
              >
                <div className="factor-info">
                  <span className="factor-name">{factor.name}</span>
                  <span className="factor-weight">
                    {counted
                      ? `counts for ${factor.weight}% of the score`
                      : (factor.standDownReason || 'Not counted for this article.')}
                    {factor.degraded && counted && ' · word-pattern check only'}
                  </span>
                </div>
                <div className="factor-bar-track">
                  {counted ? (
                    <div
                      className="factor-bar-fill"
                      style={{ width: `${factor.score * 10}%`, background: scoreColor(factor.score) }}
                    />
                  ) : (
                    <div className="factor-bar-empty" />
                  )}
                </div>
                <span className={`factor-score ${counted ? '' : 'factor-score-none'}`}>
                  {counted ? factor.score : '—'}
                </span>
                <span className={`factor-chevron ${expanded === factor.id ? 'open' : ''}`}>▾</span>
              </button>
              {expanded === factor.id && (
                <div className="factor-expanded">
                  {/* When a factor stood down its reason is already on the row,
                      so repeating it here (plus an empty detail) just confuses. */}
                  {counted ? (
                    <>
                      <p className="factor-explanation">{factor.explanation}</p>
                      <FactorDetail factor={factor} />
                    </>
                  ) : (
                    <p className="factor-explanation stood-down-note">
                      {factor.standDownReason || factor.explanation}{' '}
                      Its share of the score was given to the checks that did find something.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {showWorking && (
        <p className="trust-footnote">
          The score combines {report.factors.filter(f => (f.counted !== undefined ? f.counted : f.weight > 0)).length} of
          these {report.factors.length} checks. Click any line to read the evidence behind it.
        </p>
      )}
    </div>
  );
};

export default TrustReport;
