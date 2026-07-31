// src/App.jsx
import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext';
import { DatesProvider } from './context/DatesContext';
import { ToastProvider } from './context/ToastContext';
import Navigation from './components/Navigation';
import LoginScreen from './components/LoginScreen';

// Lazy-loaded routes — each page becomes its own chunk so the first paint
// doesn't download Chart.js / jsPDF / react-datepicker up front.
const MainLogger = lazy(() => import('./components/MainLogger'));
const Summary = lazy(() => import('./components/Summary'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const RunningHeadsPage = lazy(() => import('./components/RunningHeadsPage'));
const HeadHistory = lazy(() => import('./components/HeadHistory'));
const HeadIssuesChart = lazy(() => import('./components/HeadIssuesChart'));
const SpanAdjustPage = lazy(() => import('./components/SpanAdjustPage'));
const PartsPage = lazy(() => import('./components/PartsPage'));
const SharedViewer = lazy(() => import('./components/SharedViewer'));

const RouteFallback = () => (
  <div className="flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
    Loading…
  </div>
);

function AppContent({ data, setData }) {
  const location = useLocation();
  const { user, loading, logout } = useAuth();

  // Shared routes are always accessible (no login required)
  if (location.pathname.startsWith('/share/')) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/share/:token/*" element={<SharedViewer />} />
        </Routes>
      </Suspense>
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
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<MainLogger data={data} setData={setData} />} />
          <Route path="/logger" element={<MainLogger data={data} setData={setData} />} />
          <Route path="/summary" element={<Summary data={data} />} />
          <Route path="/dashboard" element={<Dashboard data={data} />} />
          <Route path="/span-adjust" element={<SpanAdjustPage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/running" element={<RunningHeadsPage data={data} />} />
          <Route path="/head-history" element={<HeadHistory />} />
          <Route path="/issues-chart" element={<HeadIssuesChart />} />
        </Routes>
      </Suspense>
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
          <ToastProvider>
            <AppContent data={data} setData={setData} />
          </ToastProvider>
        </DatesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
