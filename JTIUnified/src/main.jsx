import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider, useAuth } from './context/AuthContext'
import App from './App.jsx'
import LoginScreen from './LoginScreen.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
        <div style={{ color: '#94a3b8' }}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
