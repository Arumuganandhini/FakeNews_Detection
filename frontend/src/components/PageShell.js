import '../styles/ui.css';

/**
 * The frame every inner page sits in.
 *
 * Each page used to build its own header and pick its own column width, so the
 * masthead, the article and the dashboard all began at slightly different
 * places on the same screen and used slightly different type for the same job.
 * One frame, one width, one heading treatment.
 *
 * @param {object}   props
 * @param {string}   props.title      the page's headline
 * @param {string}  [props.eyebrow]   small caps line above it
 * @param {string}  [props.standfirst] one italic line below it
 * @param {'narrow'|'wide'} [props.width] column width; default is the standard one
 * @param {React.ReactNode} [props.actions] controls shown under the standfirst
 */
const PageShell = ({ title, eyebrow, standfirst, width, actions, children }) => (
  <div className={`pp-page${width ? ` pp-page--${width}` : ''}`}>
    {title && (
      <header className="pp-masthead">
        {eyebrow && <p className="pp-masthead__eyebrow">{eyebrow}</p>}
        <h1 className="pp-masthead__title">{title}</h1>
        {standfirst && <p className="pp-masthead__standfirst">{standfirst}</p>}
        {actions && <div className="pp-btn-row" style={{ justifyContent: 'center', marginTop: '1.25rem' }}>{actions}</div>}
      </header>
    )}
    {children}
  </div>
);

export default PageShell;
