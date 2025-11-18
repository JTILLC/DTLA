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
];

export default function Navigation({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [showSide, setShowSide] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);

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
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* ----- TOP BAR ----- */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            {/* Hamburger (desktop) */}
            <button
              onClick={() => setShowSide(!showSide)}
              className="lg:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <Link to="/logger" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white font-bold">S</div>
              <span className="font-semibold text-xl text-gray-800 hidden sm:inline">Shearers Logger</span>
            </Link>
          </div>

          {/* Breadcrumb */}
          <nav className="hidden md:flex items-center space-x-1 text-sm text-gray-600">
            <Link to="/logger" className="hover:text-indigo-600">Home</Link>
            {breadcrumb.map((b, i) => (
              <React.Fragment key={b.to}>
                <span className="mx-1">/</span>
                <Link to={b.to} className="hover:text-indigo-600">{b.label}</Link>
              </React.Fragment>
            ))}
          </nav>

          <div className="flex items-center space-x-3">
            {hasUnsaved && <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" title="Unsaved changes" />}
            <span className="text-sm text-gray-600 hidden sm:inline">
              {user ? user.displayName || user.email : 'Guest'}
            </span>
          </div>
        </div>
      </header>

      {/* ----- SIDE MENU (desktop) ----- */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-white shadow-lg transform transition-transform lg:translate-x-0 lg:static lg:inset-0 ${
          showSide ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full pt-20 lg:pt-0">
          <nav className="flex-1 px-4 pb-4 space-y-1">
            {navItems.map(item => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setShowSide(false)}
                className={`flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname === item.to
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {item.icon === 'home' && <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />}
                  {item.icon === 'list' && <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
                  {item.icon === 'chart-bar' && <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0v-6a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2zM9 9v-2a2 2 0 00-2-2H5a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2zm10 0v-2a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2z" />}
                  {item.icon === 'play' && <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />}
                  {item.icon === 'history' && <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
                </svg>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* Logout */}
          <div className="border-t border-gray-200 p-4">
            <button
              onClick={() => auth.signOut().then(() => navigate('/'))}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
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
      <main className="flex-1 overflow-y-auto lg:ml-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </div>
      </main>

      {/* ----- MOBILE BOTTOM BAR ----- */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40">
        <div className="grid grid-cols-5">
          {navItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center py-2 text-xs font-medium transition-colors ${
                location.pathname === item.to ? 'text-indigo-600' : 'text-gray-600'
              }`}
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {item.icon === 'home' && <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />}
                {item.icon === 'list' && <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />}
                {item.icon === 'chart-bar' && <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0v-6a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2zM9 9v-2a2 2 0 00-2-2H5a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2zm10 0v-2a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2z" />}
                {item.icon === 'play' && <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />}
                {item.icon === 'history' && <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
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