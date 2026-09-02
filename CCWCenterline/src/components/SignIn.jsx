import React, { useState } from 'react';
import { signIn, signOut, signInMessage } from '../config/firebase';

/**
 * Sign-in, in the header, deliberately small.
 *
 * It is NOT a gate on the app. Everything except reading a screen works signed
 * out, and an engineer on a plant floor with no signal must never be met by a
 * login wall standing between them and a centerline they are part-way through.
 * So this is a control in the corner that unlocks one button, not a door.
 */
export default function SignIn({ user, permission, onOpen, open }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      setPassword('');
      onOpen(false);
    } catch (err) {
      setError(signInMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="chip" title={user.email}>
          {permission?.allowed ? 'Reader ready' : 'Signed in'}
        </span>
        <button type="button" className="btn" onClick={() => signOut()}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button type="button" className="btn" onClick={() => onOpen(!open)}>
        Sign in
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="card p-3 absolute right-0 mt-1 z-10"
          style={{ width: '17rem', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}
        >
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            Only needed to read settings off a photo. Everything else works
            signed out.
          </p>
          <label className="field-label" htmlFor="si-email">Email</label>
          <input
            id="si-email" className="field mb-2" type="email" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} required
          />
          <label className="field-label" htmlFor="si-pass">Password</label>
          <input
            id="si-pass" className="field mb-3" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
          />
          {error && (
            <p className="text-sm mb-2" style={{ color: 'var(--danger)' }}>{error}</p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="btn" onClick={() => onOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Why the reader is unavailable, in a sentence an engineer can act on. */
export function readerHint({ healthy, user, permission }) {
  if (!healthy) return 'The screen reader is offline. Type the settings in below.';
  if (!user) return 'Sign in to read the settings off this photo.';
  if (permission && !permission.allowed) {
    return permission.reason === 'anonymous'
      ? 'Guest accounts cannot use the reader.'
      : 'This account is not provisioned for the reader — it needs admin or a customer on the CCW project.';
  }
  return '';
}
