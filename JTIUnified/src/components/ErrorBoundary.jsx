import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('Dashboard error boundary caught:', error, info);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div style={{ minHeight: '100vh', background: '#111827', color: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
        <div style={{ maxWidth: '480px', textAlign: 'center', background: '#1f2937', padding: '32px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚠️</div>
          <h1 style={{ margin: '0 0 8px', fontSize: '20px' }}>Something went wrong</h1>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '20px' }}>
            The dashboard hit an error. The page is still loaded — try the buttons below.
          </p>
          <pre style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', fontSize: '12px', textAlign: 'left', overflow: 'auto', maxHeight: '160px', color: '#fca5a5' }}>{msg}</pre>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '20px' }}>
            <button onClick={this.reset} style={{ padding: '8px 16px', background: '#3b82f6', border: 0, borderRadius: '6px', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Retry</button>
            <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid #374151', borderRadius: '6px', color: '#e5e7eb', cursor: 'pointer' }}>Hard reload</button>
          </div>
        </div>
      </div>
    );
  }
}
