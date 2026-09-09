import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, ExternalLink } from 'lucide-react';
import api from '../services/api';
import '../styles/ComparePage.css';

const LEAN_COLORS = {
  left: '#3d6fb4',
  'lean-left': '#6f95c9',
  center: '#4a7c59',
  'lean-right': '#c98a6f',
  right: '#b4553d',
  'state media': '#a63c3c',
  unknown: '#8a8271'
};

const AGREEMENT = {
  high: { label: 'Outlets broadly agree', className: 'agreement-stamp high' },
  mixed: { label: 'Coverage differs in places', className: 'agreement-stamp mixed' },
  low: { label: 'Outlets disagree notably', className: 'agreement-stamp low' }
};

const scoreColor = (score) => {
  if (score >= 7.5) return 'var(--trust-high)';
  if (score >= 5.5) return 'var(--trust-good)';
  if (score >= 4) return 'var(--trust-caution)';
  return 'var(--trust-low)';
};

const OutletColumn = ({ outlet }) => (
  <article className={`outlet-column ${outlet.isOriginal ? 'is-original' : ''}`}>
    <header className="outlet-masthead">
      <span className="outlet-name">{outlet.source}</span>
      {outlet.isOriginal && <span className="outlet-flag">Your article</span>}
    </header>

    <div className="outlet-scoreline">
      <span className="outlet-score" style={{ color: scoreColor(outlet.coverageScore) }}>
        {outlet.coverageScore}
      </span>
      <span className="outlet-score-label">coverage<br />score</span>
    </div>

    <div className="outlet-tags">
      {outlet.reputation.matched ? (
        <>
          <span className="lean-tag" style={{ background: LEAN_COLORS[outlet.reputation.bias] || LEAN_COLORS.unknown }}>
            {outlet.reputation.bias}
          </span>
          <span className="plain-tag">accuracy {outlet.reputation.score}/10</span>
        </>
      ) : (
        <span className="plain-tag">unrated outlet</span>
      )}
      {outlet.headline.isClickbait && <span className="warn-tag">clickbait headline</span>}
    </div>

    <h3 className="outlet-headline">{outlet.title}</h3>
    {outlet.description && <p className="outlet-standfirst">{outlet.description}</p>}

    <a className="outlet-read" href={outlet.url} target="_blank" rel="noopener noreferrer">
      Read on {outlet.source} <ExternalLink size={12} />
    </a>
  </article>
);

const ComparePage = () => {
  const incoming = useLocation().state?.article;
  const [query, setQuery] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async (payload) => {
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const { data } = await api.post('/ai/compare-coverage', payload);
      setReport(data);
    } catch (err) {
      console.error('Comparison failed:', err);
      setError('We could not compare coverage just now. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (incoming?.title) {
      run({
        title: incoming.title,
        source: incoming.source?.name || incoming.source,
        url: incoming.url
      });
    }
  }, [incoming, run]);

  const agreement = report?.consensus?.agreement
    ? AGREEMENT[report.consensus.agreement] || AGREEMENT.mixed
    : null;

  return (
    <div className="compare-page">
      <header className="compare-masthead">
        <span className="masthead-rule" />
        <h1 className="compare-title">The Press Comparison</h1>
        <p className="compare-strapline">
          One story, side by side — as each newsroom chose to tell it
        </p>
        <span className="masthead-rule" />
      </header>

      <form
        className="compare-search"
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) run({ query: query.trim() }); }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a story — e.g. election results, budget announcement"
          aria-label="Search a story to compare"
        />
        <button type="submit" disabled={loading || !query.trim()}>
          <Search size={15} /> {loading ? 'Comparing…' : 'Compare'}
        </button>
      </form>

      {error && <div className="compare-notice error">{error}</div>}

      {loading && (
        <div className="compare-loading">
          <div className="spinner" />
          <p>Gathering the day's coverage from other newsrooms…</p>
        </div>
      )}

      {report?.status === 'insufficient-coverage' && (
        <div className="compare-notice">
          {report.explanation}
          {report.query && <div className="searched-line">Searched for “{report.query}”</div>}
        </div>
      )}

      {report?.status === 'ok' && (
        <>
          <section className="consensus-sheet">
            <div className="consensus-head">
              <div>
                <span className="kicker">The story</span>
                <h2 className="consensus-topic">
                  {report.consensus.topic || 'How the outlets covered it'}
                </h2>
                <p className="searched-line">
                  {report.spread.outletCount} outlets · searched for “{report.query}”
                </p>
              </div>
              {agreement && <span className={agreement.className}>{agreement.label}</span>}
            </div>

            {report.consensus.summary && (
              <p className="consensus-summary">{report.consensus.summary}</p>
            )}

            <div className="lean-block">
              <span className="kicker">Political lean of these outlets</span>
              <div className="lean-bar">
                {Object.entries(report.spread.leanCounts).map(([lean, count]) => (
                  <span
                    key={lean}
                    className="lean-seg"
                    style={{ flex: count, background: LEAN_COLORS[lean] || LEAN_COLORS.unknown }}
                    title={`${lean}: ${count} outlet(s)`}
                  >
                    {count}
                  </span>
                ))}
              </div>
              <div className="lean-key">
                {Object.entries(report.spread.leanCounts).map(([lean, count]) => (
                  <span key={lean}>
                    <i style={{ background: LEAN_COLORS[lean] || LEAN_COLORS.unknown }} />
                    {lean} ({count})
                  </span>
                ))}
              </div>
            </div>

            <div className="consensus-columns">
              {report.consensus.sharedFacts?.length > 0 && (
                <div>
                  <span className="kicker">Reported by most outlets</span>
                  <ul className="agreed-list">
                    {report.consensus.sharedFacts.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              {report.consensus.differences?.length > 0 && (
                <div>
                  <span className="kicker">Where the coverage differs</span>
                  <ul className="differ-list">
                    {report.consensus.differences.map((d, i) => (
                      <li key={i}>
                        {d.point}
                        {d.outlets?.length > 0 && <em> — {d.outlets.join(', ')}</em>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <div className="outlet-grid">
            {report.outlets.map((o, i) => <OutletColumn key={i} outlet={o} />)}
          </div>

          <p className="compare-footnote">
            The coverage score blends each outlet's accuracy record (60%) with the honesty of its
            headline (40%). Open an article for the full four-part trust check.
          </p>
        </>
      )}

      {!loading && !report && !error && (
        <div className="compare-notice">
          Search above, or open an article and choose “Compare Coverage”.
        </div>
      )}
    </div>
  );
};

export default ComparePage;
