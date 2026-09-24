import { Link } from 'react-router-dom';
import '../styles/ui.css';
import '../styles/LandingPage.css';

/**
 * The front door.
 *
 * What used to be here described a different product: a "LLaMA3 model with
 * RAG-enhanced verification" (the retrieval pipeline was removed), breaking
 * news alerts (there are none), an adaptive recommendation engine, and four
 * "Learn more" links to routes that do not exist — every one of them landing
 * the reader back here via the catch-all. It also carried a five-panel 3D
 * carousel in purple, blue and green, on a newsprint site.
 *
 * This says what the system actually does.
 */

const VERDICTS = [
  {
    call: 'REAL',
    tone: 'real',
    line: 'Independent outlets report the same events.',
    detail: 'Outlets are counted, not articles: five papers reprinting one wire story are one source, not five.'
  },
  {
    call: 'FAKE',
    tone: 'fake',
    line: 'Independent reporting contradicts it, or a premise of it is false.',
    detail: 'A story built on something that did not happen does not become true because nobody has reported it.'
  },
  {
    call: 'CANNOT VERIFY',
    tone: 'unknown',
    line: 'Nothing independent supports it yet.',
    detail: 'Not a finding that it is false. An honest answer is better than a confident guess.'
  }
];

const STEPS = [
  {
    n: '01',
    title: 'Give it anything',
    body: 'A link, a forwarded message, or a screenshot of a post. If what you paste asserts nothing that can be checked, it says so instead of scoring it anyway.'
  },
  {
    n: '02',
    title: 'It looks for independent reporting',
    body: 'Six checks run at once, in fifteen languages. Ownership groups, wire syndication and near-duplicate text are collapsed, so corroboration means what it says.'
  },
  {
    n: '03',
    title: 'You get an answer, and the working',
    body: 'One line first. Then what was found, and if you want it, every observation that moved the answer and by how much.'
  }
];

const LandingPage = () => (
  <div className="landing">
    <header className="landing__hero">
      <p className="landing__eyebrow">Pure Press</p>
      <h1 className="landing__headline">
        Is it true, or is it<br />just well written?
      </h1>
      <p className="landing__standfirst">
        Those are different questions, and most detectors answer the second while appearing
        to answer the first. A calm headline, neutral language and named sources are all
        things whoever wrote the story chose. This tells you which question it is answering.
      </p>
      <div className="pp-btn-row landing__cta">
        <Link className="pp-btn pp-btn--primary" to="/signup">Start reading</Link>
        <Link className="pp-btn pp-btn--quiet" to="/login">Sign in</Link>
      </div>
    </header>

    <section className="landing__section">
      <div className="landing__section-head">
        <h2>Three answers, and it will use all three</h2>
        <p>Definite where the evidence is definite, and plainly undecided where it is not.</p>
      </div>
      <div className="verdicts">
        {VERDICTS.map(verdict => (
          <article className={`verdict verdict--${verdict.tone}`} key={verdict.call}>
            <h3 className="verdict__call">{verdict.call}</h3>
            <p className="verdict__line">{verdict.line}</p>
            <p className="verdict__detail">{verdict.detail}</p>
          </article>
        ))}
      </div>
    </section>

    <section className="landing__section landing__section--ruled">
      <div className="landing__section-head">
        <h2>The rule the whole thing rests on</h2>
      </div>
      <blockquote className="landing__claim">
        Anything you can observe in the article itself was chosen by whoever wrote it.
        So it can count against a story — never for it.
        <footer>
          Only outlets that had no hand in writing it can speak in its favour. A fabrication
          polished until it reads like a wire report gets no credit for the polish.
        </footer>
      </blockquote>
    </section>

    <section className="landing__section">
      <div className="landing__section-head">
        <h2>How it works</h2>
      </div>
      <ol className="steps">
        {STEPS.map(step => (
          <li className="steps__item" key={step.n}>
            <span className="steps__n">{step.n}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>

    <footer className="landing__foot">
      <p className="landing__foot-line">Read the news. Check what you were sent.</p>
      <Link className="pp-btn pp-btn--primary" to="/signup">Subscribe</Link>
    </footer>
  </div>
);

export default LandingPage;
