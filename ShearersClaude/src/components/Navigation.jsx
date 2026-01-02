// src/components/Navigation.jsx
import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { app } from '../firebaseConfig';

const auth = getAuth(app);

const navItems = [
  { to: '/logger',   label: 'Logger',   icon: 'home' },
  { to: '/summary',  label: 'Summary',  icon: 'list' },
  { to: '/dashboard',label: 'Dashboard',icon: 'chart-bar' },
  { to: '/running',  label: 'Running',  icon: 'play' },
  { to: '/head-history', label: 'History', icon: 'history' },
  { to: '/issues-chart', label: 'Issues Chart', icon: 'chart-line' },
];

export default function Navigation({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [showSide, setShowSide] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved !== null ? saved === 'true' : true; // Default to true (dark mode on)
  });

  // ----- Dark mode toggle -------------------------------------------------
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  // ----- auth -------------------------------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return () => unsub();
  }, []);

  // ----- unsaved‑changes indicator (you can call setHasUnsaved from any page) -----
  // Example usage in a page:
  //   const setUnsaved = useContext(UnsavedContext);
  //   setUnsaved(true); // when editing
  //   setUnsaved(false); // after save
  // (We expose a tiny context at the bottom of this file)

  // ----- breadcrumb -------------------------------------------------
  const path = location.pathname;
  const parts = path.split('/').filter(p => p);
  const breadcrumb = parts.map((p, i) => {
    const to = '/' + parts.slice(0, i + 1).join('/');
    const label = p === 'history' ? `Head ${parts[i + 2]}` : p.charAt(0).toUpperCase() + p.slice(1);
    return { to, label };
  });

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900">
      {/* ----- TOP BAR ----- */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            {/* Hamburger (desktop) */}
            <button
              onClick={() => setShowSide(!showSide)}
              className="lg:hidden p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <Link to="/logger" className="flex items-center space-x-2">
              <img src="/Logo.png" alt="Shearers Logger" className="w-8 h-8 rounded-full object-cover" />
              <span className="font-semibold text-xl text-gray-800 dark:text-gray-100 hidden sm:inline">Shearers Logger</span>
            </Link>
          </div>

          {/* Breadcrumb */}
          <nav className="hidden md:flex items-center space-x-1 text-sm text-gray-600 dark:text-gray-400">
            <Link to="/logger" className="hover:text-indigo-600 dark:hover:text-indigo-400">Home</Link>
            {breadcrumb.map((b, i) => (
              <React.Fragment key={b.to}>
                <span className="mx-1">/</span>
                <Link to={b.to} className="hover:text-indigo-600 dark:hover:text-indigo-400">{b.label}</Link>
              </React.Fragment>
            ))}
          </nav>

          <div className="flex items-center space-x-3">
            {hasUnsaved && <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" title="Unsaved changes" />}
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
            <span className="text-sm text-gray-600 dark:text-gray-300 hidden sm:inline">
              {user ? user.displayName || user.email : 'Guest'}
            </span>
          </div>
        </div>
      </header>

      {/* ----- SIDE MENU (desktop) ----- */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-gray-800 shadow-lg transform transition-transform lg:translate-x-0 ${
          showSide ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full pt-20 lg:pt-16">
          <nav className="flex-1 px-4 pb-4 space-y-1">
            {navItems.map(item => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setShowSide(false)}
                className={`flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname === item.to
                    ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {item.icon === 'home' && <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />}
                  {item.icon === 'list' && <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
                  {item.icon === 'chart-bar' && <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0v-6a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2zM9 9v-2a2 2 0 00-2-2H5a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2zm10 0v-2a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2z" />}
                  {item.icon === 'play' && <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />}
                  {item.icon === 'history' && <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
                  {item.icon === 'chart-line' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />}
                </svg>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* Logout */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-4">
            <button
              onClick={() => auth.signOut().then(() => navigate('/'))}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ----- MAIN CONTENT ----- */}
      <main className="flex-1 overflow-y-auto lg:ml-64">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </div>
      </main>

      {/* ----- MOBILE BOTTOM BAR ----- */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-40">
        <div className="grid grid-cols-6">
          {navItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center py-2 text-xs font-medium transition-colors ${
                location.pathname === item.to ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {item.icon === 'home' && <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />}
                {item.icon === 'list' && <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
                {item.icon === 'chart-bar' && <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0v-6a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2zM9 9v-2a2 2 0 00-2-2H5a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2zm10 0v-2a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2z" />}
                {item.icon === 'play' && <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />}
                {item.icon === 'history' && <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
                {item.icon === 'chart-line' && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />}
              </svg>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* ----- OPTIONAL: Unsaved‑changes context (use in any page) ----- */}
      <UnsavedContext.Provider value={setHasUnsaved}>
        {/* children are already rendered above */}
      </UnsavedContext.Provider>
    </div>
  );
}

/* --------------------------------------------------------------
   Tiny context so any page can say “I have unsaved changes”.
   Example in a page:
     import { useContext } from 'react';
     import { UnsavedContext } from '../components/Navigation';
     const setUnsaved = useContext(UnsavedContext);
     // then: setUnsaved(true) when editing, setUnsaved(false) after save
---------------------------------------------------------------- */
import { createContext } from 'react';
export const UnsavedContext = createContext(() => {});