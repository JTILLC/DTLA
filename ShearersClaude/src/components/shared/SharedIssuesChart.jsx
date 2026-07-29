// src/components/shared/SharedIssuesChart.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { getDatabase, ref, get } from 'firebase/database';
import { app } from '../../firebaseConfig';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

const database = getDatabase(app);
const HISTORY_PATH = 'jti-downtime/head-history';

const HEADS_PER_LINE = 14;

const issueTypes = [
  'WDU Replacement', 'Chute', 'Operator', 'Load Cell', 'Detached Head',
  'Stepper Motor Error', 'Hopper Issues', 'Installed Wrong', 'Other',
];

const issueColors = {
  'WDU Replacement': '#A855F7', Chute: '#FF6384', Operator: '#36A2EB',
  'Load Cell': '#FFCE56', 'Detached Head': '#4BC0C0', 'Stepper Motor Error': '#9966FF',
  'Hopper Issues': '#FF9F40', 'Installed Wrong': '#4CAF50', Other: '#9CA3AF',
};

const sections = [
  { name: 'PC Line',     lines: Array.from({ length: 7 },  (_, i) => `Line ${i + 1}`) },
  { name: 'Pellet Line', lines: Array.from({ length: 3 },  (_, i) => `Line ${i + 8}`) },
  { name: 'Extruded',    lines: Array.from({ length: 6 },  (_, i) => `Line ${i + 11}`) },
  { name: 'Hand Kettle', lines: Array.from({ length: 7 },  (_, i) => `Line ${i + 17}`) },
  { name: 'Twin Screw',  lines: Array.from({ length: 8 },  (_, i) => `Line ${i + 24}`) },
  { name: 'Sheeted 1',   lines: Array.from({ length: 6 },  (_, i) => `Line ${i + 32}`) },
  { name: 'Sheeted 2',   lines: Array.from({ length: 2 },  (_, i) => `Line ${i + 38}`) },
];

const makeDefaultHeads = () =>
  Array.from({ length: HEADS_PER_LINE }, (_, i) => ({
    head: i + 1, offline: 'Active', issues: [], notes: ''
  }));

export default function SharedIssuesChart({ data = {}, dates = [] }) {
  const [selectedSource, setSelectedSource] = useState('current'); // 'current', 'history', 'all'
  const [selectedDate, setSelectedDate] = useState('All Days');
  const [chartType, setChartType] = useState('bar');
  const [historyData, setHistoryData] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Load history data from Firebase
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const snapshot = await get(ref(database, HISTORY_PATH));
        if (snapshot.exists()) {
          const val = snapshot.val();
          const arr = Array.isArray(val) ? val.filter(Boolean) : Object.values(val || {});
          setHistoryData(arr);
        }
      } catch (err) {
        console.error('Failed to load history:', err);
      } finally {
        setLoadingHistory(false);
      }
    };
    loadHistory();
  }, []);

  const chartTextColor = isDarkMode ? '#f3f4f6' : '#374151';
  const gridColor = isDarkMode ? '#374151' : '#e5e7eb';

  // Get unique dates from history
  const historyDates = useMemo(() => {
    const dateSet = new Set(historyData.map(e => e.date).filter(Boolean));
    return Array.from(dateSet).sort((a, b) => new Date(b) - new Date(a));
  }, [historyData]);

  // Combined dates for the selector
  const allDates = useMemo(() => {
    const dateSet = new Set([...dates, ...historyDates]);
    return Array.from(dateSet).sort((a, b) => new Date(b) - new Date(a));
  }, [dates, historyDates]);

  const issueData = useMemo(() => {
    const counts = issueTypes.reduce((acc, type) => ({ ...acc, [type]: 0 }), {});

    // Count from current data (if source is 'current' or 'all')
    if (selectedSource === 'current' || selectedSource === 'all') {
      const targetDates = selectedDate === 'All Days' ? dates : [selectedDate];

      targetDates.forEach((date) => {
        const dayData = data?.[date] || {};
        Object.keys(dayData).forEach((line) => {
          const entry = dayData[line];
          if (!entry?.running) return;

          const heads = entry.heads || makeDefaultHeads();
          heads.filter(h => h.offline !== 'Active').forEach((h) => {
            const issues = h.issues || [];
            if (issues.length > 0) {
              issues.forEach(iss => {
                const type = iss.type || 'Other';
                if (counts[type] !== undefined) counts[type]++;
              });
            } else if (h.issue && h.issue !== 'None') {
              const type = h.issue || 'Other';
              if (counts[type] !== undefined) counts[type]++;
            }
          });
        });
      });
    }

    // Count from history data (if source is 'history' or 'all')
    if (selectedSource === 'history' || selectedSource === 'all') {
      const targetDates = selectedDate === 'All Days' ? null : [selectedDate];

      historyData.forEach((entry) => {
        // Filter by date if not 'All Days'
        if (targetDates && !targetDates.includes(entry.date)) return;

        const issue = entry.issue || 'Other';
        if (issue && issue !== 'None' && counts[issue] !== undefined) {
          counts[issue]++;
        }
      });
    }

    return counts;
  }, [data, dates, selectedDate, selectedSource, historyData]);

  const chartData = {
    labels: issueTypes.filter(type => issueData[type] > 0),
    datasets: [{
      label: 'Issue Count',
      data: issueTypes.filter(type => issueData[type] > 0).map(type => issueData[type]),
      backgroundColor: issueTypes.filter(type => issueData[type] > 0).map(type => issueColors[type]),
      borderWidth: 1,
    }],
  };

  const sourceLabel = selectedSource === 'current' ? 'Current Data' : selectedSource === 'history' ? 'History' : 'All Data';
  const chartTitle = `Issue Types — ${selectedDate} (${sourceLabel})`;

  const barOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: chartTitle,
        color: chartTextColor,
      },
    },
    scales: {
      x: {
        ticks: { color: chartTextColor },
        grid: { color: gridColor },
      },
      y: {
        beginAtZero: true,
        ticks: { color: chartTextColor, precision: 0 },
        grid: { color: gridColor },
      },
    },
  };

  const pieOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top', labels: { color: chartTextColor } },
      title: {
        display: true,
        text: chartTitle,
        color: chartTextColor,
      },
    },
  };

  const totalIssues = Object.values(issueData).reduce((sum, v) => sum + v, 0);

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold text-center mb-4 dark:text-gray-100">Issues Chart (Read Only)</h2>

      {/* Controls */}
      <div className="flex flex-wrap justify-center items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <label className="font-medium dark:text-gray-200">Source:</label>
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded"
          >
            <option value="current">Current Data</option>
            <option value="history">History Only</option>
            <option value="all">All Data (Current + History)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="font-medium dark:text-gray-200">Date:</label>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded"
          >
            <option value="All Days">All Days</option>
            {(selectedSource === 'current' ? dates : allDates).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="font-medium dark:text-gray-200">Chart:</label>
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value)}
            className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded"
          >
            <option value="bar">Bar Chart</option>
            <option value="pie">Pie Chart</option>
          </select>
        </div>
      </div>

      {loadingHistory && selectedSource !== 'current' && (
        <div className="text-center text-gray-500 dark:text-gray-400 mb-4">
          Loading history data...
        </div>
      )}

      {/* Total */}
      <div className="flex flex-wrap justify-center gap-4 mb-6">
        <span className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-lg font-medium">
          Total Issues: {totalIssues}
        </span>
        {(selectedSource === 'history' || selectedSource === 'all') && (
          <span className="px-4 py-2 bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 rounded-lg font-medium">
            History Entries: {historyData.length}
          </span>
        )}
      </div>

      {/* Chart */}
      {totalIssues > 0 ? (
        <div className="max-w-2xl mx-auto">
          {chartType === 'bar' ? (
            <Bar data={chartData} options={barOptions} />
          ) : (
            <Pie data={chartData} options={pieOptions} />
          )}
        </div>
      ) : (
        <p className="text-center text-gray-600 dark:text-gray-400 py-8">No issues to display for {selectedDate}.</p>
      )}

      {/* Issue breakdown table */}
      {totalIssues > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-3 dark:text-gray-100">Issue Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-700">
                  <th className="p-2 text-left border dark:border-gray-600 dark:text-gray-200">Issue Type</th>
                  <th className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">Count</th>
                  <th className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {issueTypes.filter(type => issueData[type] > 0).map((type) => (
                  <tr key={type}>
                    <td className="p-2 border dark:border-gray-600">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: issueColors[type] }}></div>
                        <span className="dark:text-gray-200">{type}</span>
                      </div>
                    </td>
                    <td className="p-2 text-center border dark:border-gray-600 dark:text-gray-200 font-medium">
                      {issueData[type]}
                    </td>
                    <td className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">
                      {((issueData[type] / totalIssues) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
