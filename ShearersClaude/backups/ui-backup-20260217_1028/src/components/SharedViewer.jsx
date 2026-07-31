// src/components/SharedViewer.jsx
import React, { useState, useEffect } from 'react';
import { useParams, Link, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { getDatabase, ref, get, onValue } from 'firebase/database';
import { app } from '../firebaseConfig';

// Import viewer versions of components
import SharedLogger from './shared/SharedLogger';
import SharedSummary from './shared/SharedSummary';
import SharedDashboard from './shared/SharedDashboard';
import SharedRunning from './shared/SharedRunning';
import SharedHeadHistory from './shared/SharedHeadHistory';
import SharedIssuesChart from './shared/SharedIssuesChart';

const database = getDatabase(app);

const navItems = [
  { to: 'logger', label: 'Logger', icon: 'home' },
  { to: 'summary', label: 'Summary', icon: 'list' },
  { to: 'dashboard', label: 'Dashboard', icon: 'chart-bar' },
  { to: 'running', label: 'Running', icon: 'play' },
  { to: 'history', label: 'History', icon: 'history' },
  { to: 'issues-chart', label: 'Issues Chart', icon: 'chart-line' },
];

export default function SharedViewer() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveData, setLiveData] = useState(null);
  const [liveDates, setLiveDates] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved !== null ? saved === 'true' : true;
  });
  const location = useLocation();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (!token) return;

    // First validate the token exists
    get(ref(database, `jti-downtime/shares/${token}`)).then((snapshot) => {
      if (!snapshot.exists()) {
        setError('Share link not found or has been revoked.');
        setLoading(false);
        return;
      }
      const shareRecord = snapshot.val();
      setCreatedAt(shareRecord.createdAt || null);

      // Subscribe to live data
      const unsubscribe = onValue(
        ref(database, 'jti-downtime/main-logger/data'),
        (dataSnap) => {
          if (dataSnap.exists()) {
            const val = dataSnap.val();
            setLiveData(val.data ?? null);
            setLiveDates(val.dates ?? null);
          }
          setLoading(false);
        },
        (err) => {
          console.error('Failed to load live data:', err);
          setError('Failed to load live data. Please try again later.');
          setLoading(false);
        }
      );

      return () => unsubscribe();
    }).catch((err) => {
      console.error('Failed to validate share token:', err);
      setError('Failed to load shared data. Please try again later.');
      setLoading(false);
    });
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading shared data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-5xl mb-4">!</div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
            Unable to Load Data
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <Link
            to="/"
            className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  const createdDate = createdAt ? new Date(createdAt).toLocaleDateString() : 'Unknown';

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            <img src="/Logo.png" alt="Shearers Logger" className="w-8 h-8 rounded-full object-cover" />
            <span className="font-semibold text-xl text-gray-800 dark:text-gray-100">
              Shearers Logger
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                Read-Only
              </span>
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">
              Shared on {createdDate}
            </span>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-1 overflow-x-auto py-2">
            {navItems.map((item) => {
              const isActive = location.pathname.includes(`/share/${token}/${item.to}`);
              return (
                <Link
                  key={item.to}
                  to={`/share/${token}/${item.to}`}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Routes>
            <Route index element={<Navigate to="logger" replace />} />
            <Route path="logger" element={<SharedLogger data={liveData} dates={liveDates} />} />
            <Route path="summary" element={<SharedSummary data={liveData} dates={liveDates} />} />
            <Route path="dashboard" element={<SharedDashboard data={liveData} dates={liveDates} />} />
            <Route path="running" element={<SharedRunning data={liveData} dates={liveDates} />} />
            <Route path="history" element={<SharedHeadHistory />} />
            <Route path="issues-chart" element={<SharedIssuesChart data={liveData} dates={liveDates} />} />
          </Routes>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-40">
        <div className="grid grid-cols-6">
          {navItems.map((item) => {
            const isActive = location.pathname.includes(`/share/${token}/${item.to}`);
            return (
              <Link
                key={item.to}
                to={`/share/${token}/${item.to}`}
                className={`flex flex-col items-center py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                <span className="text-xs">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
