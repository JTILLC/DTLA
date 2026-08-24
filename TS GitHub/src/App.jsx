import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TimeSheetProvider, useTimeSheet } from './context/TimeSheetContext';
import TimeSheet from './components/TimeSheet/TimeSheet';
import ServiceReportPage from './pages/ServiceReportPage';
import InvoicePage from './pages/InvoicePage';
import LoginScreen from './components/LoginScreen';
import './index.css';
import Layout from './components/Layout';

// Deep link handler - loads specific timesheet from URL parameter
function DeepLinkHandler() {
  const [searchParams] = useSearchParams();
  const { loadFromHistory } = useTimeSheet();

  useEffect(() => {
    const docId = searchParams.get('id') || searchParams.get('docId');
    if (docId) {
      loadFromHistory(docId);
    }
  }, [searchParams, loadFromHistory]);

  return null;
}

function AppContent() {
  const { user, loading, logout } = useAuth();

  // Dark mode state - defaults to dark
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('timesheet-theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    const theme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('timesheet-theme', theme);
  }, [isDark]);

  const toggleDarkMode = () => setIsDark(!isDark);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <TimeSheetProvider>
      <DeepLinkHandler />
      <Layout isDark={isDark} toggleDarkMode={toggleDarkMode} onLogout={logout}>
        <Routes>
          <Route path="/" element={<TimeSheet />} />
          <Route path="/service-report" element={<ServiceReportPage />} />
          <Route path="/invoice" element={<InvoicePage />} />
        </Routes>
      </Layout>
    </TimeSheetProvider>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;
