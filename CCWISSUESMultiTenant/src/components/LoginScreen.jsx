import { useState } from 'react';

export default function LoginScreen({ onLogin, onResetPassword }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        setError('Invalid email or password');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many attempts. Please try again later.');
      } else {
        setError(err.message);
      }
    }
    setLoading(false);
  };

  const handleReset = async () => {
    setError('');
    setInfo('');
    if (!email) {
      setError('Enter your email above first, then tap “Forgot password?”');
      return;
    }
    if (!onResetPassword) return;
    setLoading(true);
    try {
      await onResetPassword(email);
      setInfo('If that email has an account, a password-reset link has been sent. Check your inbox (and spam).');
    } catch (err) {
      if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (err.code === 'auth/user-not-found') {
        // Don't reveal whether an account exists.
        setInfo('If that email has an account, a password-reset link has been sent. Check your inbox (and spam).');
      } else {
        setError(err.message);
      }
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', padding: '16px' }}>
      <div style={{ background: '#1e293b', borderRadius: '16px', border: '1px solid #334155', boxShadow: '0 10px 30px rgba(0,0,0,0.45)', padding: '32px', width: '100%', maxWidth: '380px' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '24px', color: '#f1f5f9', fontSize: '1.5rem', fontWeight: 'bold' }}>JTI CCW Log</h1>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', color: '#aaa', fontSize: '0.875rem' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: '11px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#f1f5f9', fontSize: '1rem', boxSizing: 'border-box' }}
              required
              autoComplete="email"
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', color: '#aaa', fontSize: '0.875rem' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '11px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#f1f5f9', fontSize: '1rem', boxSizing: 'border-box' }}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p style={{ color: '#ff6b6b', textAlign: 'center', marginBottom: '12px', fontSize: '0.875rem' }}>{error}</p>}
          {info && <p style={{ color: '#4ade80', textAlign: 'center', marginBottom: '12px', fontSize: '0.875rem' }}>{info}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: '#4f46e5', color: 'white', fontSize: '1rem', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={loading}
            style={{ width: '100%', marginTop: '12px', padding: '4px', background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.85rem', cursor: loading ? 'not-allowed' : 'pointer', textDecoration: 'underline' }}
          >
            Forgot password?
          </button>
        </form>
      </div>
    </div>
  );
}
