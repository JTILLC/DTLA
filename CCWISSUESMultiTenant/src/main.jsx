import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
// Teaches the shared parts UI how this app talks to the broker.
import '@shared/config/partsRegister.js';

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error('React Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ color: 'red' }}>Something went wrong</h2>
          <p><strong>Error:</strong> {this.state.error?.toString()}</p>
          <details style={{ marginTop: '10px' }}>
            <summary>Error Details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', background: '#f5f5f5', padding: '10px' }}>
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '20px', padding: '10px 20px', fontSize: '16px', cursor: 'pointer' }}
          >
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

console.log('CCW Issues App starting...');

try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
  console.log('CCW Issues App rendered successfully');
} catch (err) {
  console.error('Failed to render app:', err);
  // Build the error UI with the DOM API (textContent) rather than innerHTML so a
  // crafted error message can't inject markup.
  const root = document.getElementById('root');
  if (root) {
    root.textContent = '';
    const wrap = document.createElement('div');
    wrap.style.padding = '20px';
    const h = document.createElement('h2');
    h.style.color = 'red';
    h.textContent = 'Failed to start app';
    const p = document.createElement('p');
    p.textContent = (err && err.message) ? err.message : String(err);
    wrap.appendChild(h);
    wrap.appendChild(p);
    root.appendChild(wrap);
  }
}