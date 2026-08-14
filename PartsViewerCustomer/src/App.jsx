import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginScreen from './components/LoginScreen';
import CustomerViewer from './components/CustomerViewer';
import SharedCustomerViewer from './components/SharedCustomerViewer';
import './App.css';

function AppContent() {
  const { user, loading, login, logout } = useAuth();
  const [route, setRoute] = useState({ type: 'main', token: null });

  useEffect(() => {
    const parseRoute = () => {
      const path = window.location.pathname;
      const viewMatch = path.match(/^\/view\/([A-Za-z0-9]+)$/);
      if (viewMatch) {
        setRoute({ type: 'shared', token: viewMatch[1] });
        return;
      }
      setRoute({ type: 'main', token: null });
    };

    parseRoute();
    window.addEventListener('popstate', parseRoute);
    return () => window.removeEventListener('popstate', parseRoute);
  }, []);

  // Shared views bypass authentication - read-only public access
  if (route.type === 'shared' && route.token) {
    return <SharedCustomerViewer token={route.token} />;
  }

  // Main view requires authentication
  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e293b', color: '#94a3b8' }}>Loading...</div>;
  }

  if (!user) {
    return <LoginScreen onLogin={login} />;
  }

  return <CustomerViewer onLogout={logout} />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
