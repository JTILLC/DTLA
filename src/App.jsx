import React, { useState, useEffect } from 'react';
import StartPage from './components/StartPage';
import MainLogger from './components/MainLogger';
import Dashboard from './components/Dashboard';
import Summary from './components/Summary';
import HistoryLog from './components/HistoryLog';
import DaySummaryModal from './components/DaySummaryModal';

export const lines = [
  { name: 'Line 1', section: 'PC Line' }, { name: 'Line 2', section: 'PC Line' },
  /* ... all 39 lines as before ... */
  { name: 'Line 39', section: 'Sheeted 2' }
];

function getDefaultDates(numDays = 5) {
  const today = new Date();
  return Array.from({ length: numDays }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().slice(0,10);
    return { id: `day${i+1}`, date: iso, label: `Day ${i+1}` };
  });
}

function App() {
  const [data, setData] = useState(() => {
    const saved = localStorage.getItem('downtimeLoggerData');
    return saved ? JSON.parse(saved) : {};
  });
  const [dates, setDates] = useState(() => {
    const saved = localStorage.getItem('downtimeLoggerDates');
    return saved ? JSON.parse(saved) : getDefaultDates(5);
  });
  const [historyLog, setHistoryLog] = useState(() => {
    const saved = localStorage.getItem('downtimeLoggerHistory');
    return saved ? JSON.parse(saved) : [];
  });

  const [currentPage, setCurrentPage] = useState('start');
  const [currentLine, setCurrentLine] = useState(lines[0].name);
  const [currentDay, setCurrentDay] = useState(dates[0].date);
  const [selectedDashboardDay, setSelectedDashboardDay] = useState(dates[0].date);
  const [summaryDay, setSummaryDay] = useState(null);
  const [selectedSummaryDay, setSelectedSummaryDay] = useState('All Days');
  const [selectedHistoryLine, setSelectedHistoryLine] = useState('All Lines');
  const [selectedHistoryHead, setSelectedHistoryHead] = useState('All Heads');

  // Persist state
  useEffect(() => { localStorage.setItem('downtimeLoggerData', JSON.stringify(data)); }, [data]);
  useEffect(() => {
    localStorage.setItem('downtimeLoggerDates', JSON.stringify(dates));
    setCurrentDay(dates[0].date);
    setSelectedDashboardDay(dates[0].date);
  }, [dates]);
  useEffect(() => { localStorage.setItem('downtimeLoggerHistory', JSON.stringify(historyLog)); }, [historyLog]);

  if (currentPage === 'start') {
    return <StartPage dates={dates} setDates={setDates} onStart={() => setCurrentPage('main')} />;
  }

  return (
    <div className="max-w-7xl mx-auto p-4">
      <h1 className="text-3xl font-bold text-center mb-6">JTI Downtime Logger</h1>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setCurrentPage('main')}
          className={currentPage==='main'?'bg-blue-500 text-white px-4 py-2 rounded':'bg-gray-200 px-4 py-2 rounded'}
        >
          Main Logger
        </button>
        <button
          onClick={() => setCurrentPage('dashboard')}
          className={currentPage==='dashboard'?'bg-blue-500 text-white px-4 py-2 rounded':'bg-gray-200 px-4 py-2 rounded'}
        >
          Dashboard
        </button>
        <button
          onClick={() => setCurrentPage('summary')}
          className={currentPage==='summary'?'bg-blue-500 text-white px-4 py-2 rounded':'bg-gray-200 px-4 py-2 rounded'}
        >
          Summary
        </button>
        <button
          onClick={() => setCurrentPage('history')}
          className={currentPage==='history'?'bg-blue-500 text-white px-4 py-2 rounded':'bg-gray-200 px-4 py-2 rounded'}
        >
          History
        </button>
      </div>

      {currentPage === 'main' && (
        <MainLogger
          data={data}
          setData={setData}
          dates={dates}
          setDates={setDates}
          lines={lines}
          currentLine={currentLine}
          setCurrentLine={setCurrentLine}
          currentDay={currentDay}
          setCurrentDay={setCurrentDay}
        />
      )}
      {currentPage === 'dashboard' && (
        <Dashboard
          data={data}
          lines={lines}
          dates={dates}
          selectedDay={selectedDashboardDay}
          setSelectedDay={setSelectedDashboardDay}
          onLineClick={line => { setCurrentLine(line); setCurrentPage('main'); }}
        />
      )}
      {currentPage === 'summary' && (
        <Summary
          data={data}
          setData={setData}
          lines={lines}
          dates={dates}
          selectedDay={selectedSummaryDay}
          setSelectedDay={setSelectedSummaryDay}
        />
      )}
      {currentPage === 'history' && (
        <HistoryLog
          historyLog={historyLog}
          setHistoryLog={setHistoryLog}
          lines={lines}
          selectedLine={selectedHistoryLine}
          setSelectedLine={setSelectedHistoryLine}
          selectedHead={selectedHistoryHead}
          setSelectedHead={setSelectedHistoryHead}
        />
      )}
      {summaryDay && <DaySummaryModal dayLabel={summaryDay} onClose={() => setSummaryDay(null)} />}
    </div>
  );
}

export default App;
