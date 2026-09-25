import { useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Link2, ClipboardType, Image as ImageIcon } from 'lucide-react';
import api from '../services/api';
import TrustReport from '../components/TrustReport';
import '../styles/CheckPage.css';

/**
 * Check anything — the page for everything that is not an article from our feed.
 *
 * A reader almost never meets a claim as a news article. They meet it as a
 * message somebody forwarded, a caption under a picture, or a sentence spoken
 * in a video. The backend has handled those for a while; until now nothing in
 * the interface could reach it, so the capability existed and no one could use
 * it.
 *
 * This page is also the only place the input gate is visible. Most of what
 * people paste asserts nothing a newsroom could confirm or deny, and the honest
 * answer to that is not a verdict — it is a refusal that says what is missing.
 */

const MODES = [
  { id: 'text', label: 'Paste text', icon: ClipboardType,
    hint: 'A forwarded message, a post, or the claim itself.' },
  { id: 'link', label: 'Paste a link', icon: Link2,
    hint: 'A news article, a YouTube video, or a social post.' },
  { id: 'image', label: 'Upload a screenshot', icon: ImageIcon,
    hint: 'A screenshot of a post or message. We read the text out of it.' }
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CheckPage = () => {
  // A video or social link pasted into the feed's link box is redirected here,
  // arriving prefilled so the reader does not have to paste it twice.
  const handedOver = useLocation().state?.url;

  const [mode, setMode] = useState(handedOver ? 'link' : 'text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState(handedOver || '');
  const [account, setAccount] = useState('');
  const [imageName, setImageName] = useState('');
  const imageData = useRef(null);

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [error, setError] = useState('');

  const reset = () => {
    setReport(null);
    setRefusal(null);
    setError('');
  };

  const chooseMode = (id) => {
    setMode(id);
    reset();
  };

  const handleImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    reset();

    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is larger than 8 MB. Try a screenshot rather than a photo.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      imageData.current = reader.result;
      setImageName(file.name);
    };
    reader.onerror = () => setError('That file could not be read. Try saving it again as a PNG or JPEG.');
    reader.readAsDataURL(file);
  };

  const payload = () => {
    if (mode === 'link') return { url: url.trim() };
    if (mode === 'image') return { imageBase64: imageData.current, account: account.trim() || undefined };
    return { text: text.trim(), account: account.trim() || undefined };
  };

  const ready = () => {
    if (mode === 'link') return url.trim().length > 0;
    if (mode === 'image') return Boolean(imageData.current);
    return text.trim().length > 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!ready() || loading) return;

    reset();
    setLoading(true);
    try {
      const response = await api.post('/ai/analyze-content', payload());
      setReport(response.data);
    } catch (err) {
      const data = err.response?.data;
      // A refusal is not a failure. The backend declines input that asserts
      // nothing checkable and says what would make it checkable; that answer is
      // as useful as a verdict and is shown as its own result, not as an error.
      if (data && (data.checkable === false || data.canRetryWith)) {
        setRefusal({
          reason: data.error,
          missing: data.missing || [],
          canRetryWith: data.canRetryWith || []
        });
      } else {
        setError(data?.error || 'We could not check that just now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const active = MODES.find((m) => m.id === mode);

  return (
    <div className="press-sheet press-sheet-narrow check-page">
      <header className="press-masthead">
        <div className="press-dateline">The Verification Desk</div>
        <h1 className="press-name">Check Anything</h1>
        <div className="press-tagline">
          Paste it and we will tell you whether it holds up
        </div>
      </header>

      <p className="check-lede">
        A link, a forwarded message, or a screenshot of a post. We will say
        plainly whether it holds up — or that there is nothing here we can check.
      </p>

      <form className="check-form" onSubmit={handleSubmit}>
        <div className="check-modes" role="tablist">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`check-mode ${mode === m.id ? 'active' : ''}`}
                onClick={() => chooseMode(m.id)}
              >
                <Icon size={15} /> {m.label}
              </button>
            );
          })}
        </div>

        <p className="check-hint">{active.hint}</p>

        {mode === 'text' && (
          <textarea
            className="press-input check-textarea"
            rows={7}
            value={text}
            onChange={(e) => { setText(e.target.value); reset(); }}
            placeholder="Paste the message or post here…"
          />
        )}

        {mode === 'link' && (
          <input
            className="press-input"
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); reset(); }}
            placeholder="https://…"
          />
        )}

        {mode === 'image' && (
          <div className="check-upload">
            <input id="check-image" type="file" accept="image/*" onChange={handleImage} />
            <label htmlFor="check-image" className="check-upload-label">
              {imageName || 'Choose a screenshot…'}
            </label>
          </div>
        )}

        {mode !== 'link' && (
          <input
            className="press-input check-account"
            type="text"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="Who posted it? (optional — helps us judge the source)"
          />
        )}

        <button className="press-btn check-submit" type="submit" disabled={!ready() || loading}>
          {loading ? 'Checking…' : 'Check it'}
        </button>
      </form>

      {error && <p className="check-error">{error}</p>}

      {/* A refusal, shown as a result in its own right. */}
      {refusal && (
        <section className="check-refusal">
          <h2>Nothing to check</h2>
          <p>{refusal.reason}</p>
          {refusal.missing.length > 0 && (
            <p className="check-missing">
              <strong>To check this we would need:</strong> {refusal.missing.join('; ')}.
            </p>
          )}
          {refusal.canRetryWith.length > 0 && (
            <p className="check-missing">
              Try pasting the text of the post, or a screenshot of it, instead.
            </p>
          )}
        </section>
      )}

      {report && (
        <section className="check-result">
          <TrustReport report={report} />
        </section>
      )}
    </div>
  );
};

export default CheckPage;
