// src/App.jsx - Shearers CCW Maintenance Tracker Viewer
import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, useParams, Link, useLocation, Navigate } from 'react-router-dom';
import { getDatabase, ref, get } from 'firebase/database';
import { pollShared, fetchShared } from './shareApi';
import { app } from './firebaseConfig';
import './index.css';

// Import shared viewer components
import SharedLogger from './components/shared/SharedLogger';
import SharedSummary from './components/shared/SharedSummary';
import SharedDashboard from './components/shared/SharedDashboard';
import SharedRunning from './components/shared/SharedRunning';
import SharedHeadHistory from './components/shared/SharedHeadHistory';
import SharedIssuesChart from './components/shared/SharedIssuesChart';

const database = getDatabase(app);

// Firebase paths
const MAINLOGGER_DATA_PATH = 'jti-downtime/main-logger/data';
const HISTORY_PATH = 'jti-downtime/head-history';

const navItems = [
  { to: 'logger', label: 'Logger', icon: 'home' },
  { to: 'summary', label: 'Summary', icon: 'list' },
  { to: 'dashboard', label: 'Dashboard', icon: 'chart-bar' },
  { to: 'running', label: 'Running', icon: 'play' },
  { to: 'history', label: 'History', icon: 'history' },
  { to: 'issues-chart', label: 'Issues Chart', icon: 'chart-line' },
];

// Calendar Modal Component
function CalendarModal({ isOpen, onClose, availableDates, selectedDate, onSelectDate }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (selectedDate && selectedDate !== 'All Dates') {
      return new Date(selectedDate);
    }
    return new Date();
  });

  // Convert availableDates to a Set for quick lookup
  const dateSet = useMemo(() => {
    const set = new Set();
    availableDates.forEach(d => {
      // Normalize date format to YYYY-MM-DD for comparison
      const date = new Date(d);
      if (!isNaN(date)) {
        set.add(date.toISOString().split('T')[0]);
      }
    });
    return set;
  }, [availableDates]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    return { daysInMonth, startingDay, year, month };
  };

  const { daysInMonth, startingDay, year, month } = getDaysInMonth(currentMonth);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const prevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const handleDateClick = (day) => {
    const dateStr = `${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}-${year}`;
    const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Find the matching date format from availableDates
    const matchingDate = availableDates.find(d => {
      const parsed = new Date(d);
      return parsed.toISOString().split('T')[0] === isoDate;
    });

    if (matchingDate) {
      onSelectDate(matchingDate);
      onClose();
    }
  };

  const isDateAvailable = (day) => {
    const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return dateSet.has(isoDate);
  };

  const isSelectedDate = (day) => {
    if (!selectedDate || selectedDate === 'All Dates') return false;
    const selected = new Date(selectedDate);
    return selected.getFullYear() === year &&
           selected.getMonth() === month &&
           selected.getDate() === day;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h3 className="text-lg font-semibold dark:text-gray-100">Select Date</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <svg className="w-5 h-5 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={prevMonth}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
          >
            <svg className="w-5 h-5 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-semibold dark:text-gray-100">
            {monthNames[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
          >
            <svg className="w-5 h-5 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-1 px-4">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
            <div key={day} className="text-center text-sm font-medium text-gray-500 dark:text-gray-400 py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1 px-4 pb-4">
          {/* Empty cells for days before the 1st */}
          {Array.from({ length: startingDay }, (_, i) => (
            <div key={`empty-${i}`} className="h-10" />
          ))}

          {/* Days of the month */}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const hasData = isDateAvailable(day);
            const isSelected = isSelectedDate(day);

            return (
              <button
                key={day}
                onClick={() => hasData && handleDateClick(day)}
                disabled={!hasData}
                className={`h-10 w-full rounded-lg text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-indigo-600 text-white'
                    : hasData
                    ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-800 cursor-pointer'
                    : 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 px-4 pb-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-100 dark:bg-green-900 rounded"></div>
            <span className="text-gray-600 dark:text-gray-400">Has Data</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-indigo-600 rounded"></div>
            <span className="text-gray-600 dark:text-gray-400">Selected</span>
          </div>
        </div>

        {/* All Dates Button */}
        <div className="px-4 pb-4">
          <button
            onClick={() => { onSelectDate('All Dates'); onClose(); }}
            className="w-full py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg font-medium transition-colors"
          >
            View All Dates
          </button>
        </div>
      </div>
    </div>
  );
}

function SharedViewer() {
  const { token } = useParams();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isValidToken, setIsValidToken] = useState(false);
  const [createdAt, setCreatedAt] = useState(null);
  const [data, setData] = useState({});
  const [historyData, setHistoryData] = useState([]);
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  // First, validate the token
  useEffect(() => {
    const validateToken = async () => {
      try {
        const snapshot = await get(ref(database, `jti-downtime/shares/${token}`));
        if (!snapshot.exists()) {
          setError('Share link not found or has expired.');
          setLoading(false);
          return;
        }

        const shareData = snapshot.val();
        setCreatedAt(shareData.createdAt);
        setIsValidToken(true);
      } catch (err) {
        console.error('Failed to validate token:', err);
        setError('Failed to validate share link. Please try again later.');
        setLoading(false);
      }
    };

    if (token) {
      validateToken();
    }
  }, [token]);

  // Once the token is validated, keep the data fresh through the broker.
  //
  // This was a live subscription straight to the Realtime Database, which is
  // why the downtime data had to be public for it to work. It polls the broker
  // now: the credential stays server-side, the token is checked on every
  // request, and the database is closed. Downtime is reviewed rather than
  // watched, so a minute behind costs nothing.
  useEffect(() => {
    if (!isValidToken) return;

    const stopData = pollShared('data', (loaded) => {
      if (loaded) {
        // Some snapshots nest everything under a further "data" key.
        setData(loaded.data || loaded);
        setLastUpdated(new Date());
      }
      setLoading(false);
    }, (err) => {
      setError(err.message || 'Failed to load data. Please try again later.');
      setLoading(false);
    });

    const stopHistory = pollShared('history', (val) => {
      const arr = Array.isArray(val) ? val.filter(Boolean) : Object.values(val || {});
      setHistoryData(arr);
    });

    return () => { stopData(); stopHistory(); };
  }, [isValidToken]);

  // Combine dates from both current data and history
  useEffect(() => {
    const currentDataDates = Object.keys(data || {}).filter(key => key.includes('-') || key.includes('/'));
    const historyDates = [...new Set(historyData.map(e => e.date).filter(Boolean))];

    // Combine and dedupe all dates
    const allDates = [...new Set([...currentDataDates, ...historyDates])];
    const sortedDates = allDates.sort((a, b) => new Date(b) - new Date(a));

    console.log('Current data dates:', currentDataDates.length, 'History dates:', historyDates.length, 'Total unique:', sortedDates.length);
    setDates(sortedDates);
  }, [data, historyData]);

  // Set default selectedDate when dates are loaded
  useEffect(() => {
    if (dates.length > 0 && !selectedDate) {
      // Default to most recent date
      const sortedDates = [...dates].sort((a, b) => new Date(b) - new Date(a));
      setSelectedDate(sortedDates[0]);
    }
  }, [dates, selectedDate]);

  // Get sorted dates for display (most recent first)
  const sortedDates = [...dates].sort((a, b) => new Date(b) - new Date(a));

  // Reconstruct data from history entries for a given date
  const reconstructDataFromHistory = (date) => {
    const entriesForDate = historyData.filter(e => e.date === date);
    if (entriesForDate.length === 0) return null;

    const reconstructed = {};

    entriesForDate.forEach(entry => {
      const line = entry.line;
      if (!line) return;

      if (!reconstructed[line]) {
        // Initialize line with default heads
        reconstructed[line] = {
          running: true, // Assume running since it has history
          machineNotes: '',
          heads: Array.from({ length: 14 }, (_, i) => ({
            head: i + 1,
            offline: 'Active',
            issues: [],
            notes: ''
          }))
        };
      }

      // If this is a machine note entry (no head)
      if (!entry.head && entry.notes) {
        reconstructed[line].machineNotes = entry.notes;
        return;
      }

      // Find the head and update it
      const headIndex = entry.head ? parseInt(entry.head) - 1 : -1;
      if (headIndex >= 0 && headIndex < 14) {
        const head = reconstructed[line].heads[headIndex];
        head.offline = 'Offline';
        head.notes = entry.notes || '';

        // Add issue
        if (entry.issue) {
          head.issues.push({
            type: entry.issue,
            repaired: entry.repaired || 'Not Fixed',
            replacementReason: entry.replacementReason || ''
          });
        }
      }
    });

    return reconstructed;
  };

  // Filter/reconstruct data based on selected date
  const getFilteredData = () => {
    if (selectedDate === 'All Dates') {
      // Combine current data with reconstructed history data
      const combined = { ...data };

      // Get dates that only exist in history (not in current data)
      const historyOnlyDates = [...new Set(historyData.map(e => e.date))]
        .filter(d => !data[d]);

      historyOnlyDates.forEach(date => {
        const reconstructed = reconstructDataFromHistory(date);
        if (reconstructed) {
          combined[date] = reconstructed;
        }
      });

      return combined;
    }

    // Single date selected
    if (data[selectedDate]) {
      return { [selectedDate]: data[selectedDate] };
    }

    // Try to reconstruct from history
    const reconstructed = reconstructDataFromHistory(selectedDate);
    if (reconstructed) {
      return { [selectedDate]: reconstructed };
    }

    return {};
  };

  const filteredData = getFilteredData();

  const filteredDates = selectedDate === 'All Dates'
    ? sortedDates
    : [selectedDate];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading live data...</p>
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
            <span className="font-semibold text-xl text-gray-800 dark:text-gray-100">
              Shearers CCW Maintenance Tracker
              <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900 px-2 py-1 rounded">
                Live Data
              </span>
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {lastUpdated && (
              <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
                Updated: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
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
          <div className="flex items-center justify-between py-2 gap-4">
            {/* Navigation Links */}
            <div className="flex space-x-1 overflow-x-auto">
              {navItems.map((item) => {
                const isActive = location.pathname.includes(`/view/${token}/${item.to}`);
                return (
                  <Link
                    key={item.to}
                    to={`/view/${token}/${item.to}`}
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

            {/* Date Selector */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowCalendar(true)}
                className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>{selectedDate === 'All Dates' ? 'All Dates' : selectedDate}</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {sortedDates.length > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
                  ({sortedDates.length} dates)
                </span>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-20 lg:pb-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Routes>
            <Route index element={<Navigate to="logger" replace />} />
            <Route path="logger" element={<SharedLogger data={filteredData} dates={filteredDates} selectedDate={selectedDate} />} />
            <Route path="summary" element={<SharedSummary data={filteredData} dates={filteredDates} selectedDate={selectedDate} />} />
            <Route path="dashboard" element={<SharedDashboard data={filteredData} dates={filteredDates} selectedDate={selectedDate} />} />
            <Route path="running" element={<SharedRunning data={filteredData} dates={filteredDates} selectedDate={selectedDate} />} />
            <Route path="history" element={<SharedHeadHistory />} />
            <Route path="issues-chart" element={<SharedIssuesChart data={data} dates={sortedDates} selectedDate={selectedDate} />} />
          </Routes>
        </div>
      </main>

      {/* Calendar Modal */}
      <CalendarModal
        isOpen={showCalendar}
        onClose={() => setShowCalendar(false)}
        availableDates={sortedDates}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-40">
        <div className="grid grid-cols-6">
          {navItems.map((item) => {
            const isActive = location.pathname.includes(`/view/${token}/${item.to}`);
            return (
              <Link
                key={item.to}
                to={`/view/${token}/${item.to}`}
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

function HomePage() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-4">
          Shearers CCW Maintenance Tracker
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          This is a read-only viewer for live maintenance data.
          You need a valid share link to view data.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500">
          Share links are generated from the main Shearers Logger app.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/view/:token/*" element={<SharedViewer />} />
      </Routes>
    </BrowserRouter>
  );
}
