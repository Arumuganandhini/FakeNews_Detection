import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AlertCircle } from 'lucide-react';
import '../styles/ui.css';
import '../styles/Auth.css';

const BASE_URL = process.env.REACT_APP_API_URL ||
  (window.location.hostname.includes('onrender.com')
    ? 'https://news-curator-deployed.onrender.com'
    : 'http://localhost:5000');

/**
 * The shell both sign-in and sign-up sit in.
 *
 * The two pages were near-identical and shared nothing: 1,407 lines of
 * stylesheet between them, two copies of the same submit handler, two
 * entrance animations, and two sets of decorative newspaper props. The form
 * fields differ; everything around them does not.
 *
 * @param {object} props
 * @param {string} props.endpoint    'login' or 'signup'
 * @param {object} props.body        what to post
 * @param {boolean} props.valid      whether the form can be submitted
 * @param {Function} props.setUser   lifts the session into App
 * @param {string} [props.validate]  a message to show instead of submitting
 */
const AuthPanel = ({
  eyebrow, title, standfirst, endpoint, submitLabel,
  body, valid, validate, setUser, footer, children
}) => {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (validate) { setError(validate); return; }
    if (!valid) { setError('Please fill in every field.'); return; }

    setBusy(true);
    try {
      const res = await axios.post(`${BASE_URL}/api/auth/${endpoint}`, body);
      localStorage.setItem('token', res.data.token);
      setUser({ token: res.data.token });
      navigate('/home');
    } catch (err) {
      setError(err.response?.data?.error || 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__sheet pp-card">
        <header className="auth__head">
          <p className="pp-masthead__eyebrow">{eyebrow}</p>
          <h1 className="auth__title">{title}</h1>
          {standfirst && <p className="auth__standfirst">{standfirst}</p>}
        </header>

        {error && (
          <p className="pp-alert auth__error" role="alert">
            <AlertCircle size={16} aria-hidden="true" /> {error}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {children}
          <button className="pp-btn pp-btn--primary pp-btn--block" type="submit" disabled={busy}>
            {busy ? 'One moment…' : submitLabel}
          </button>
        </form>

        {footer && <p className="auth__footer">{footer}</p>}
      </div>
    </div>
  );
};

export default AuthPanel;
