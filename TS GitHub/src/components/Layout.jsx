import React from 'react';

import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';

function Layout({ children, isDark, toggleDarkMode, onLogout }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="nav shadow-sm">
        <div className="nav-inner">
          <div className="flex justify-between items-center mb-4 sm:mb-6">
            <img src={logo} alt="Logo" className="h-16 sm:h-20 md:h-24 w-auto mx-auto" />
            <div className="absolute right-4 top-4 flex gap-2">
              <button
                onClick={toggleDarkMode}
                className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition text-sm"
                title="Toggle Dark/Light Mode"
              >
                {isDark ? '☀️ Light' : '🌙 Dark'}
              </button>
              <button
                onClick={() => onLogout && onLogout()}
                className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition text-sm"
                title="Sign Out"
              >
                Logout
              </button>
            </div>
          </div>

        </div>
      </header>

      <main className="section">
        <div className="card">
          <div className="card-body p-2 sm:p-4">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export default Layout;
