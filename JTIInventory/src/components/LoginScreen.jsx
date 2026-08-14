import { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useToast } from './Toast';
import { LogIn } from 'lucide-react';

export default function LoginScreen() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error(err);
      toast.error(err.message.replace('Firebase: ', ''));
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!email) {
      toast.error('Enter your email first, then tap reset.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success('Password reset email sent.');
    } catch (err) {
      toast.error(err.message.replace('Firebase: ', ''));
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>JTI Inventory</h1>
        <p>Sign in to manage parts &amp; boards.</p>
        <div className="mb-3">
          <label className="form-label">Email</label>
          <input
            type="email"
            className="form-control"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="mb-3">
          <label className="form-label">Password</label>
          <input
            type="password"
            className="form-control"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="btn btn-primary w-100" disabled={busy}>
          <LogIn size={16} style={{ marginRight: 6 }} />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="btn btn-link w-100 mt-2"
          style={{ fontSize: '0.85rem' }}
        >
          Forgot password?
        </button>
      </form>
    </div>
  );
}
