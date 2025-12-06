// src/components/HeadIssuesChart.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bar, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend } from 'chart.js';
import { getDatabase, ref, get } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { app } from '../firebaseConfig';
import Navigation from './Navigation';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend);

const database = getDatabase(app);
const auth = getAuth(app);

const DB_ROOT = 'jti-downtime';
const HEADHISTORY_PATH = `${DB_ROOT}/head-history`;

const CHART_TYPES = [
  { value: 'issues-by-type', label: 'Issues by Type Over Time' },
  { value: 'error-type-breakdown', label: 'Error Type Breakdown' },
  { value: 'issues-per-head', label: 'Issues per Head Number' },
  { value: 'issues-per-line', label: 'Issues per Line' },
  { value: 'fixed-vs-not-fixed', label: 'Fixed vs Not Fixed Trend' },
  { value: 'avg-heads-down', label: 'Average Heads Down Per Day' }
];

const ISSUE_TYPES = [
  'Chute',
  'Operator',
  'Load Cell',
  'Detached Head',
  'Stepper Motor Error',
  'Hopper Issues',
  'Installed Wrong',
  'Other'
];

const COLORS = {
  'Chute': '#ef4444',
  'Operator': '#f97316',
  'Load Cell': '#eab308',
  'Detached Head': '#84cc16',
  'Stepper Motor Error': '#22c55e',
  'Hopper Issues': '#14b8a6',
  'Installed Wrong': '#06b6d4',
  'Other': '#8b5cf6',
  'Fixed': '#10b981',
  'Not Fixed': '#ef4444'
};

export default function HeadIssuesChart() {
  const location = useLocation();
  const navigate = useNavigate();

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [chartType, setChartType] = useState('issues-by-type');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedLine, setSelectedLine] = useState(location.state?.line || 'all');
  const [selectedHead, setSelectedHead] = useState('all');

  // Auth
  useEffect(() => {
    signInAnonymously(auth).catch((e) => setError(e.message));
  }, []);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const snapshot = await get(ref(database, HEADHISTORY_PATH));
        if (snapshot.exists()) {
          const data = snapshot.val();
          const entriesArray = Object.entries(data).map(([id, entry]) => ({
            id,
            ...entry
          })).filter(e => e.head); // Only head entries, not machine notes
          setEntries(entriesArray);
        }
      } catch (err) {
        setError('Failed to load data: ' + err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Filter entries by date range and selections
  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      const entryDate = entry.date;
      if (entryDate < startDate || entryDate > endDate) return false;
      if (selectedLine !== 'all' && entry.line !== selectedLine) return false;
      if (selectedHead !== 'all' && entry.head !== selectedHead) return false;
      if (entry.issue === 'None') return false; // Exclude "None" issues
      return true;
    });
  }, [entries, startDate, endDate, selectedLine, selectedHead]);

  // Get unique lines and heads
  const lines = useMemo(() => {
    const lineSet = new Set(entries.map(e => e.line));
    // Natural sort for lines (e.g., Line 1, Line 2, Line 10)
    const sortedLines = Array.from(lineSet).sort((a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      // Extract numbers from line names for natural sorting
      const numA = parseInt(a.match(/\d+/)?.[0] || '0');
      const numB = parseInt(b.match(/\d+/)?.[0] || '0');
      return numA - numB;
    });
    return ['all', ...sortedLines];
  }, [entries]);

  const heads = useMemo(() => {
    const headSet = new Set(entries.map(e => e.head).filter(h => h));
    return ['all', ...Array.from(headSet).sort((a, b) => Number(a) - Number(b))];
  }, [entries]);

  // Calculate error type breakdown
  const errorTypeBreakdown = useMemo(() => {
    const breakdown = {};
    ISSUE_TYPES.forEach(type => breakdown[type] = 0);

    filteredEntries.forEach(entry => {
      if (ISSUE_TYPES.includes(entry.issue)) {
        breakdown[entry.issue]++;
      }
    });

    return breakdown;
  }, [filteredEntries]);

  // Reset filters function
  const resetFilters = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    setStartDate(d.toISOString().split('T')[0]);
    setEndDate(new Date().toISOString().split('T')[0]);
    setSelectedLine('all');
    setSelectedHead('all');
    setChartType('issues-by-type');
  };

  // Chart data generators
  const generateIssuesByTypeChart = () => {
    // Group by date and issue type
    const dateGroups = {};
    filteredEntries.forEach(entry => {
      if (!dateGroups[entry.date]) {
        dateGroups[entry.date] = {};
        ISSUE_TYPES.forEach(type => dateGroups[entry.date][type] = 0);
      }
      if (ISSUE_TYPES.includes(entry.issue)) {
        dateGroups[entry.date][entry.issue]++;
      }
    });

    const sortedDates = Object.keys(dateGroups).sort();
    const datasets = ISSUE_TYPES.map(issueType => ({
      label: issueType,
      data: sortedDates.map(date => dateGroups[date][issueType]),
      backgroundColor: COLORS[issueType],
      borderColor: COLORS[issueType],
      borderWidth: 1
    }));

    return {
      labels: sortedDates,
      datasets
    };
  };

  const generateIssuesPerHeadChart = () => {
    const headCounts = {};
    filteredEntries.forEach(entry => {
      const head = entry.head || 'Unknown';
      headCounts[head] = (headCounts[head] || 0) + 1;
    });

    const sortedHeads = Object.keys(headCounts).sort((a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      return Number(a) - Number(b);
    });

    return {
      labels: sortedHeads.map(h => `Head ${h}`),
      datasets: [{
        label: 'Total Issues',
        data: sortedHeads.map(h => headCounts[h]),
        backgroundColor: '#3b82f6',
        borderColor: '#2563eb',
        borderWidth: 1
      }]
    };
  };

  const generateIssuesPerLineChart = () => {
    const lineCounts = {};
    filteredEntries.forEach(entry => {
      const line = entry.line || 'Unknown';
      lineCounts[line] = (lineCounts[line] || 0) + 1;
    });

    // Natural sort for lines (e.g., Line 1, Line 2, Line 10)
    const sortedLines = Object.keys(lineCounts).sort((a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      // Extract numbers from line names for natural sorting
      const numA = parseInt(a.match(/\d+/)?.[0] || '0');
      const numB = parseInt(b.match(/\d+/)?.[0] || '0');
      return numA - numB;
    });

    return {
      labels: sortedLines,
      datasets: [{
        label: 'Total Issues',
        data: sortedLines.map(l => lineCounts[l]),
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderWidth: 1
      }]
    };
  };

  const generateFixedVsNotFixedChart = () => {
    const dateGroups = {};
    filteredEntries.forEach(entry => {
      if (!dateGroups[entry.date]) {
        dateGroups[entry.date] = { 'Fixed': 0, 'Not Fixed': 0 };
      }
      const status = entry.repaired === 'Fixed' ? 'Fixed' : 'Not Fixed';
      dateGroups[entry.date][status]++;
    });

    const sortedDates = Object.keys(dateGroups).sort();

    return {
      labels: sortedDates,
      datasets: [
        {
          label: 'Fixed',
          data: sortedDates.map(date => dateGroups[date]['Fixed']),
          backgroundColor: COLORS['Fixed'],
          borderColor: COLORS['Fixed'],
          borderWidth: 2,
          fill: false
        },
        {
          label: 'Not Fixed',
          data: sortedDates.map(date => dateGroups[date]['Not Fixed']),
          backgroundColor: COLORS['Not Fixed'],
          borderColor: COLORS['Not Fixed'],
          borderWidth: 2,
          fill: false
        }
      ]
    };
  };

  const generateAvgHeadsDownChart = () => {
    // Group entries by date and line to count unique heads down per line per day
    const dateLineHeads = {};
    filteredEntries.forEach(entry => {
      const key = `${entry.date}-${entry.line}`;
      if (!dateLineHeads[key]) {
        dateLineHeads[key] = {
          date: entry.date,
          line: entry.line,
          heads: new Set()
        };
      }
      dateLineHeads[key].heads.add(entry.head);
    });

    // Group by date and calculate average heads down per line
    const dateAverages = {};
    Object.values(dateLineHeads).forEach(({ date, heads }) => {
      if (!dateAverages[date]) {
        dateAverages[date] = { totalHeads: 0, lineCount: 0 };
      }
      dateAverages[date].totalHeads += heads.size;
      dateAverages[date].lineCount += 1;
    });

    const sortedDates = Object.keys(dateAverages).sort();

    return {
      labels: sortedDates,
      datasets: [{
        label: 'Avg Heads Down Per Day',
        data: sortedDates.map(date => {
          const avg = dateAverages[date].totalHeads / dateAverages[date].lineCount;
          return parseFloat(avg.toFixed(2));
        }),
        backgroundColor: '#3b82f6',
        borderColor: '#2563eb',
        borderWidth: 2,
        fill: false
      }]
    };
  };

  const generateErrorTypeBreakdownChart = () => {
    const typeCounts = {};
    ISSUE_TYPES.forEach(type => typeCounts[type] = 0);

    filteredEntries.forEach(entry => {
      if (ISSUE_TYPES.includes(entry.issue)) {
        typeCounts[entry.issue]++;
      }
    });

    const sortedTypes = ISSUE_TYPES.filter(type => typeCounts[type] > 0);

    return {
      labels: sortedTypes,
      datasets: [{
        label: 'Error Count',
        data: sortedTypes.map(type => typeCounts[type]),
        backgroundColor: sortedTypes.map(type => COLORS[type]),
        borderColor: sortedTypes.map(type => COLORS[type]),
        borderWidth: 1
      }]
    };
  };

  const getChartData = () => {
    switch (chartType) {
      case 'issues-by-type':
        return generateIssuesByTypeChart();
      case 'error-type-breakdown':
        return generateErrorTypeBreakdownChart();
      case 'issues-per-head':
        return generateIssuesPerHeadChart();
      case 'issues-per-line':
        return generateIssuesPerLineChart();
      case 'fixed-vs-not-fixed':
        return generateFixedVsNotFixedChart();
      case 'avg-heads-down':
        return generateAvgHeadsDownChart();
      default:
        return { labels: [], datasets: [] };
    }
  };

  const chartData = getChartData();
  const ChartComponent = (chartType === 'fixed-vs-not-fixed' || chartType === 'avg-heads-down') ? Line : Bar;

  const isDarkMode = document.documentElement.classList.contains('dark');
  const textColor = isDarkMode ? '#e5e7eb' : '#1f2937';
  const gridColor = isDarkMode ? '#4b5563' : '#e5e7eb';

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: textColor
        }
      },
      title: {
        display: true,
        text: CHART_TYPES.find(t => t.value === chartType)?.label || 'Head Issues Chart',
        font: { size: 16 },
        color: textColor
      },
      tooltip: {
        mode: 'index',
        intersect: false
      }
    },
    scales: {
      x: {
        stacked: chartType === 'issues-by-type',
        grid: {
          display: false,
          color: gridColor
        },
        ticks: {
          color: textColor
        }
      },
      y: {
        stacked: chartType === 'issues-by-type',
        beginAtZero: true,
        ticks: {
          stepSize: 1,
          color: textColor
        },
        grid: {
          color: gridColor
        }
      }
    }
  };

  return (
    <Navigation>
      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md max-w-7xl mx-auto">
        <div className="mb-5 flex justify-between items-center flex-wrap gap-4">
          <h1 className="m-0 text-2xl font-semibold dark:text-gray-100">Head Issues Analysis</h1>
          <button
            onClick={() => navigate('/logger')}
            className="px-4 py-2 bg-gray-600 dark:bg-gray-700 text-white border-none rounded-md cursor-pointer hover:bg-gray-700 dark:hover:bg-gray-600"
          >
            ← Back to Logger
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-700 p-5 rounded-lg shadow mb-5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            {/* Chart Type */}
            <div>
              <label className="block mb-1 text-sm font-medium dark:text-gray-200">
                Chart Type
              </label>
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value)}
                className="w-full p-2 border dark:border-gray-600 dark:bg-gray-600 dark:text-gray-200 rounded-md text-sm"
              >
                {CHART_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            {/* Start Date */}
            <div>
              <label className="block mb-1 text-sm font-medium dark:text-gray-200">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-2 border dark:border-gray-600 dark:bg-gray-600 dark:text-gray-200 rounded-md text-sm"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block mb-1 text-sm font-medium dark:text-gray-200">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full p-2 border dark:border-gray-600 dark:bg-gray-600 dark:text-gray-200 rounded-md text-sm"
              />
            </div>

            {/* Line Filter */}
            <div>
              <label className="block mb-1 text-sm font-medium dark:text-gray-200">
                Line
              </label>
              <select
                value={selectedLine}
                onChange={(e) => setSelectedLine(e.target.value)}
                className="w-full p-2 border dark:border-gray-600 dark:bg-gray-600 dark:text-gray-200 rounded-md text-sm"
              >
                {lines.map(line => (
                  <option key={line} value={line}>{line === 'all' ? 'All Lines' : line}</option>
                ))}
              </select>
            </div>

            {/* Head Filter */}
            <div>
              <label className="block mb-1 text-sm font-medium dark:text-gray-200">
                Head
              </label>
              <select
                value={selectedHead}
                onChange={(e) => setSelectedHead(e.target.value)}
                className="w-full p-2 border dark:border-gray-600 dark:bg-gray-600 dark:text-gray-200 rounded-md text-sm"
              >
                {heads.map(head => (
                  <option key={head} value={head}>{head === 'all' ? 'All Heads' : `Head ${head}`}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex justify-between items-start flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Total Issues: {filteredEntries.length}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
                {ISSUE_TYPES.map(type => (
                  errorTypeBreakdown[type] > 0 && (
                    <div key={type} className="flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-sm"
                        style={{ backgroundColor: COLORS[type] }}
                      ></span>
                      <span>{type}: {errorTypeBreakdown[type]}</span>
                    </div>
                  )
                ))}
              </div>
            </div>
            <button
              onClick={resetFilters}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white text-sm font-medium border-none rounded-md cursor-pointer hover:bg-blue-700 dark:hover:bg-blue-600"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white dark:bg-gray-700 p-5 rounded-lg shadow h-[500px]">
          {loading ? (
            <div className="flex items-center justify-center h-full dark:text-gray-200">
              Loading data...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-500 dark:text-red-400">
              {error}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 dark:text-gray-400">
              No data available for the selected filters
            </div>
          ) : (
            <ChartComponent data={chartData} options={chartOptions} />
          )}
        </div>
      </div>
    </Navigation>
  );
}
