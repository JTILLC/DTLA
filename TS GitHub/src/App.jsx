import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useSearchParams } from 'react-router-dom';
import { TimeSheetProvider, useTimeSheet } from './context/TimeSheetContext';
import TimeSheet from './components/TimeSheet/TimeSheet';
import ServiceReportPage from './pages/ServiceReportPage';
import InvoicePage from './pages/InvoicePage';
import './index.css';
import Layout from './components/Layout';

// Deep link handler - loads specific timesheet from URL parameter
function DeepLinkHandler() {
  const [searchParams] = useSearchParams();
  const { loadFromHistory } = useTimeSheet();

  useEffect(() => {
    const docId = searchParams.get('id') || searchParams.get('docId');
    if (docId) {
      console.log('Deep linking to timesheet:', docId);
      loadFromHistory(docId);
    }
  }, [searchParams, loadFromHistory]);

  return null;
}

function App() {
  // Dark mode state - defaults to dark
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('timesheet-theme');
    const initialTheme = saved ? saved === 'dark' : true; // Default to dark mode
    console.log('[Theme] Initial theme from localStorage:', saved, '-> isDark:', initialTheme);
    return initialTheme;
  });

  // Apply theme on mount and when isDark changes
  useEffect(() => {
    const theme = isDark ? 'dark' : 'light';
    console.log('[Theme] Setting theme to:', theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('timesheet-theme', theme);
  }, [isDark]);

  const toggleDarkMode = () => {
    console.log('[Theme] Toggling from', isDark ? 'dark' : 'light', 'to', !isDark ? 'dark' : 'light');
    setIsDark(!isDark);
  };

  return (
    <Router>
      <TimeSheetProvider>
        <DeepLinkHandler />
        <Layout isDark={isDark} toggleDarkMode={toggleDarkMode}>
          <Routes>
            <Route path="/" element={<TimeSheet />} />
            <Route path="/service-report" element={<ServiceReportPage />} />
            <Route path="/invoice" element={<InvoicePage />} />
          </Routes>
        </Layout>
      </TimeSheetProvider>
    </Router>
  );
}

export default App;
