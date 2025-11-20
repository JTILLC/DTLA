import React from 'react';                    // ← ADD THIS LINE
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { TimeSheetProvider } from './context/TimeSheetContext';
import TimeSheet from './components/TimeSheet/TimeSheet';
import ServiceReportPage from './pages/ServiceReportPage';
import InvoicePage from './pages/InvoicePage';
import './index.css';
import Layout from './components/Layout';

function App() {
  return (
    <Router>
      <TimeSheetProvider>
        <Layout>
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