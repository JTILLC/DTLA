import { AuthProvider, useAuth } from './context/AuthContext'
import LoginScreen from './components/LoginScreen'
import DiagramManager from './components/DiagramManager'
import './App.css'

function AppContent() {
  const { user, loading, login, logout } = useAuth();

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e293b', color: '#94a3b8' }}>Loading...</div>;
  }

  if (!user) {
    return <LoginScreen onLogin={login} />;
  }

  return <DiagramManager onLogout={logout} />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
