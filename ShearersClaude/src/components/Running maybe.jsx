import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';

// Default structure for each head
const defaultHeads = Array.from({ length: 14 }, (_, i) => ({
  head: i + 1,
  offline: 'Active',
  issue: 'None',
  repaired: 'Not Fixed',
  notes: ''
}));

export default function RunningHeadsPage() {
  const [dates, setDates] = useState([]);
  const [currentDay, setCurrentDay] = useState(localStorage.getItem('currentDay') || '2025-07-10');
  const [linesMap, setLinesMap] = useState({});
  const navigate = useNavigate();

  const loadData = () => {
    // Load from localStorage
    const storedData = JSON.parse(localStorage.getItem('downtimeLoggerData') || '{}');
    let storedDates = JSON.parse(localStorage.getItem('downtimeLoggerDates') || '[]');
    // Normalize to array of strings
    storedDates = storedDates.map(d => typeof d === 'object' && d.date ? d.date : (typeof d === 'string' ? d : '')).filter(Boolean);
    const summaryArr = JSON.parse(localStorage.getItem('summaryEntries') || '[]');

    // Determine date list: use summary entries if present, else storedDates
    const summaryDates = Array.from(new Set(summaryArr.map(x => x.date).filter(Boolean)));
    let allDates = summaryDates.length > 0 ? summaryDates : storedDates;
    if (allDates.length === 0) {
      allDates = ['2025-07-10']; // Fallback default date
    }
    setDates(allDates);
    const persistedDay = localStorage.getItem('currentDay');
    const validDay = allDates.includes(persistedDay) ? persistedDay : allDates[0] || '2025-07-10';
    setCurrentDay(validDay);

    // Build lines map based on summary or full data
    const map = {};
    if (summaryArr.length > 0) {
      // Summary import: build only those entries
      summaryArr.forEach(item => {
        const { date, line, offlineHeads, issues, notes, repaired, running } = item;
        const headsArr = defaultHeads.map(h => ({ ...h }));
        const idx = parseInt(offlineHeads, 10) - 1;
        if (idx >= 0 && idx < headsArr.length) {
          headsArr[idx] = {
            ...headsArr[idx],
            offline: 'Offline',
            issue: issues || 'None',
            notes: notes || '',
            repaired: repaired ? 'Fixed' : 'Not Fixed',
            running: !!running
          };
        }
        if (!map[date]) map[date] = {};
        map[date][line] = { heads: headsArr, running: !!running };
      });
    } else {
      // Full data import
      Object.keys(storedData).forEach(date => {
        if (!map[date]) map[date] = {};
        const dayData = storedData[date] || {};
        Object.keys(dayData).forEach(line => {
          map[date][line] = dayData[line] || { heads: defaultHeads, running: false };
        });
      });
    }
    setLinesMap(map);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleClick = (line, head) => {
    navigate('/logger', { state: { selectedDate: currentDay, selectedLine: line } });
  };

  const lines = linesMap[currentDay] || {};

  // Sort lines numerically and filter running
  const sortedRunningLines = Object.keys(lines)
    .filter(line => lines[line].running)
    .sort((a, b) => parseInt(a.replace('Line ', '')) - parseInt(b.replace('Line ', '')));

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md md:p-4 sm:p-2">
      <h2 className="text-2xl font-semibold mb-4 text-center sm:text-xl">Running Heads Status</h2>
      <div className="flex justify-between mb-4">
        <Link to="/logger" className="px-4 py-2 bg-blue-500 text-white rounded sm:px-2 sm:py-1">Back to Logger</Link>
        <Link to="/summary" className="px-4 py-2 bg-blue-500 text-white rounded sm:px-2 sm:py-1">View Summary</Link>
        <Link to="/dashboard" className="px-4 py-2 bg-indigo-500 text-white rounded sm:px-2 sm:py-1">Dashboard</Link>
      </div>
      <div className="flex justify-center mb-6 space-x-4 sm:flex-col sm:space-x-0 sm:space-y-2">
        <label className="mr-2 font-medium sm:mr-0">Date:</label>
        <select
          value={currentDay}
          onChange={e => setCurrentDay(e.target.value)}
          className="border p-1 rounded sm:w-full"
        >
          {dates.map((date, i) => (
            <option key={date} value={date}>{`Day ${i + 1}: ${date}`}</option>
          ))}
        </select>
        <button onClick={loadData} className="px-3 py-1 bg-blue-500 text-white rounded sm:px-2 sm:py-1">Refresh</button>
      </div>
      <div className="space-y-6">
        {sortedRunningLines.length === 0 ? (
          <p className="text-center text-gray-600 sm:text-sm">No running lines for {currentDay}.</p>
        ) : (
          sortedRunningLines.map(line => {
            const entry = lines[line];
            return (
              <div key={line}>
                <h3 className="font-medium mb-2 sm:text-base">{line}</h3>
                <div className="flex space-x-2 flex-wrap">
                  {entry.heads.map(h => {
                    const bgClass = h.offline === 'Active'
                      ? 'bg-green-500'
                      : h.repaired === 'Fixed'
                        ? 'bg-orange-500'
                        : 'bg-red-500';
                    return (
                      <button
                        key={h.head}
                        onClick={() => handleClick(line, h.head)}
                        className={`${bgClass} w-8 h-8 rounded flex items-center justify-center text-white font-semibold sm:w-6 sm:h-6 sm:text-xs`}
                        title={`Line ${line}, Head ${h.head}: ${h.issue}`}
                      >
                        {h.head}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}