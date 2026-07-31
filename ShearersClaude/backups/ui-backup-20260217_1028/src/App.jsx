// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext';
import { DatesProvider } from './context/DatesContext';
import Navigation from './components/Navigation';
import LoginScreen from './components/LoginScreen';

import MainLogger from './components/MainLogger';
import Summary from './components/Summary';
import Dashboard from './components/Dashboard';
import RunningHeadsPage from './components/RunningHeadsPage';
import HistoryDetail from './components/HistoryDetail';
import HeadHistory from './components/HeadHistory';
import HeadIssuesChart from './components/HeadIssuesChart';
import SharedViewer from './components/SharedViewer';

function AppContent({ data, setData }) {
  const location = useLocation();
  const { user, loading, logout } = useAuth();

  // Shared routes are always accessible (no login required)
  if (location.pathname.startsWith('/share/')) {
    return (
      <Routes>
        <Route path="/share/:token/*" element={<SharedViewer />} />
      </Routes>
    );
  }

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  // Require login for all non-shared routes
  if (!user) {
    return <LoginScreen />;
  }

  return (
    <Navigation onLogout={logout}>
      <Routes>
        <Route path="/" element={<MainLogger data={data} setData={setData} />} />
        <Route path="/logger" element={<MainLogger data={data} setData={setData} />} />
        <Route path="/summary" element={<Summary data={data} />} />
        <Route path="/dashboard" element={<Dashboard data={data} />} />
        <Route path="/running" element={<RunningHeadsPage data={data} />} />
        <Route path="/history/:line/:head" element={<HistoryDetail />} />
        <Route path="/head-history" element={<HeadHistory />} />
        <Route path="/issues-chart" element={<HeadIssuesChart />} />
      </Routes>
    </Navigation>
  );
}

export default function App() {
  const [data, setData] = useState(() => {
    const saved = localStorage.getItem('downtimeLoggerData');
    return saved ? JSON.parse(saved) : {};
  });

  // Persist data locally
  useEffect(() => {
    localStorage.setItem('downtimeLoggerData', JSON.stringify(data));
  }, [data]);

  return (
    <BrowserRouter>
      <AuthProvider>
        <DatesProvider>
          <AppContent data={data} setData={setData} />
        </DatesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
