import React from 'react';

import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';

function Layout({ children }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="nav shadow-sm">
        <div className="nav-inner">
          <div className="flex justify-center mb-4 sm:mb-6">
            <img src={logo} alt="Logo" className="h-16 sm:h-20 md:h-24 w-auto" />

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
