// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import { DatesProvider } from './context/DatesContext';
import Navigation from './components/Navigation';

import MainLogger from './components/MainLogger';
import Summary from './components/Summary';
import Dashboard from './components/Dashboard';
import RunningHeadsPage from './components/RunningHeadsPage';
import HistoryDetail from './components/HistoryDetail';
import HeadHistory from './components/HeadHistory';
import HeadIssuesChart from './components/HeadIssuesChart';

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
      <DatesProvider>
        <Navigation>
          <Routes>
            <Route path="/" element={<MainLogger data={data} setData={setData} />} />
            <Route path="/logger" element={<MainLogger data={data} setData={setData} />} />
            <Route path="/summary" element={<Summary data={data} />} />
            <Route path="/dashboard" element={<Dashboard data={data} />} />
            <Route path="/running" element={<RunningHeadsPage data={data} />} />
            <Route path="/history/:line/:head" element={<HistoryDetail />} />
            <Route path="/head-history" element={<HeadHistory />} />
            <Route path="/issues-chart" element={<HeadIssuesChart />} />
          </Routes>
        </Navigation>
      </DatesProvider>
    </BrowserRouter>
  );
}
