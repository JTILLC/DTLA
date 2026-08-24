import React, { useState } from 'react';

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err.code === 'auth/invalid-credential' ? 'Invalid email or password' : err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e293b' }}>
      <form onSubmit={handleSubmit} style={{ background: '#334155', padding: '40px', borderRadius: '12px', width: '360px', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
        <h2 style={{ color: '#f1f5f9', marginBottom: '8px', fontSize: '24px', fontWeight: '700', textAlign: 'center' }}>Parts Viewer</h2>
        <p style={{ color: '#94a3b8', marginBottom: '24px', textAlign: 'center', fontSize: '14px' }}>Sign in to manage diagrams</p>
        {error && <div style={{ background: '#ef444420', color: '#f87171', padding: '10px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', textAlign: 'center' }}>{error}</div>}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #475569', background: '#1e293b', color: '#f1f5f9', fontSize: '14px', marginBottom: '12px', boxSizing: 'border-box' }} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #475569', background: '#1e293b', color: '#f1f5f9', fontSize: '14px', marginBottom: '20px', boxSizing: 'border-box' }} />
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: 'white', fontSize: '14px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>{loading ? 'Signing in...' : 'Sign In'}</button>
      </form>
    </div>
  );
}
