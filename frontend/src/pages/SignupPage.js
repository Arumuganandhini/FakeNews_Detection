import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthPanel from '../components/AuthPanel';

/**
 * Subscribe.
 *
 * The twin of the sign-in page, and it now shares its shell rather than
 * carrying its own 713-line copy of it.
 */
const SignupPage = ({ setUser }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Checked before the request rather than after, so the reader is told what is
  // wrong without a round trip.
  const validate =
    password && confirmPassword && password !== confirmPassword
      ? 'Those two passwords do not match.'
      : password && password.length < 8
        ? 'Please use at least 8 characters.'
        : null;

  return (
    <AuthPanel
      eyebrow="New subscriber"
      title="Subscribe"
      standfirst="An account keeps your reading record and the checks you have run."
      endpoint="signup"
      submitLabel="Start reading"
      setUser={setUser}
      body={{ name: name.trim() || undefined, email, password }}
      valid={Boolean(email && password && confirmPassword)}
      validate={validate}
      footer={<>Already a subscriber? <Link to="/login">Sign in</Link></>}
    >
      <label className="pp-field">
        <span className="pp-field__label">Name <span className="auth__optional">(optional)</span></span>
        <input
          className="pp-input"
          type="text"
          value={name}
          autoComplete="name"
          placeholder="How we should address you"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

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
          autoComplete="new-password"
          placeholder="At least 8 characters"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <label className="pp-field">
        <span className="pp-field__label">Confirm password</span>
        <input
          className="pp-input"
          type="password"
          value={confirmPassword}
          autoComplete="new-password"
          placeholder="Type it once more"
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </label>
    </AuthPanel>
  );
};

export default SignupPage;
