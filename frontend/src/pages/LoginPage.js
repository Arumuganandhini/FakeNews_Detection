import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthPanel from '../components/AuthPanel';

/**
 * Sign in.
 *
 * What used to be here: a newspaper-unfold entrance animation in three stages,
 * twenty decorative grid lines rendered into the DOM, a viewport-height
 * listener, background newspaper props and 694 lines of stylesheet — around a
 * form with two fields. The theme is the same; the scaffolding is gone.
 */
const LoginPage = ({ setUser }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <AuthPanel
      eyebrow="Subscriber access"
      title="Sign in"
      standfirst="Your reading record and the checks you have run are kept with your account."
      endpoint="login"
      submitLabel="Read now"
      setUser={setUser}
      body={{ email, password }}
      valid={Boolean(email && password)}
      footer={<>First time here? <Link to="/signup">Subscribe</Link></>}
    >
      <label className="pp-field">
        <span className="pp-field__label">Email address</span>
        <input
          className="pp-input"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="pp-field">
        <span className="pp-field__label">Password</span>
        <input
          className="pp-input"
          type="password"
          value={password}
          autoComplete="current-password"
          placeholder="Your password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
    </AuthPanel>
  );
};

export default LoginPage;
