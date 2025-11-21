import React, { useEffect } from 'react';
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
  return (
    <Router>
      <TimeSheetProvider>
        <DeepLinkHandler />
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
