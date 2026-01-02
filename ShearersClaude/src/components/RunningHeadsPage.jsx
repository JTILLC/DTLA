// src/components/RunningHeadsPage.jsx
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDates } from '../context/DatesContext'; // if you’re using DatesContext
// If you don't use DatesContext, this will still work via props: ({ data, dates })

const HEADS_PER_LINE = 14;

const makeDefaultHeads = () =>
  Array.from({ length: HEADS_PER_LINE }, (_, i) => ({
    head: i + 1,
    offline: 'Active',
    issue: 'None',
    repaired: 'Not Fixed',
    notes: ''
  }));

// color for a head
const headColor = (h) => {
  if ((h?.offline ?? 'Active') === 'Active') return 'bg-green-500';

  // offline - check if using new multi-issue format
  const issues = h.issues || [];
  if (issues.length > 0) {
    // Check for WDU
    if (issues.some(iss => iss.type === 'WDU Replacement')) {
      return 'bg-purple-500';
    }
    // Check if all issues are fixed
    if (issues.every(iss => iss.repaired === 'Fixed')) {
      return 'bg-orange-500';
    }
    return 'bg-red-500';
  }

  // Fallback to old single-issue format
  return (h?.repaired ?? 'Not Fixed') === 'Fixed' ? 'bg-orange-500' : 'bg-red-500';
};

export default function RunningHeadsPage({ data = {}, dates: propDates }) {
  // Prefer DatesContext if present; otherwise fall back to prop
  let datesCtx;
  try {
    datesCtx = useDates();
  } catch {
    datesCtx = null;
  }
  const dates = datesCtx?.dates ?? propDates ?? [];

  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => dates?.[0] || '');

  const lines = useMemo(() => Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`), []);
  const dayData = data?.[selectedDate] || {};

  // Only running lines for selected date
  const runningLines = useMemo(() => {
    return lines
      .map((line) => {
        const entry = dayData?.[line] || {};
        if (!entry?.running) return null;
        const heads = entry.heads && entry.heads.length ? entry.heads : makeDefaultHeads();
        const offline = heads.filter((h) => (h.offline ?? 'Active') !== 'Active');

        // Handle new multi-issue format for fixed count
        const fixed = offline.filter((h) => {
          const issues = h.issues || [];
          if (issues.length > 0) {
            // All issues must be fixed
            return issues.every(iss => iss.repaired === 'Fixed');
          }
          // Fallback to old format
          return (h.repaired ?? 'Not Fixed') === 'Fixed';
        });

        return {
          line,
          heads,
          offlineCount: offline.length,
          fixedCount: fixed.length,
          notFixedCount: offline.length - fixed.length
        };
      })
      .filter(Boolean);
  }, [lines, dayData]);

  const goToLine = (line) => {
    // Jump into MainLogger focused on this date + line
    navigate('/logger', { state: { selectedDate, selectedLine: line } });
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md md:p-4 sm:p-2">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-2xl font-semibold sm:text-xl dark:text-gray-100">Running Heads</h2>
        <div className="flex items-center gap-2">
          <label className="font-medium text-sm dark:text-gray-200">Date:</label>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded sm:p-1 sm:text-sm"
          >
            {(dates || []).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Top nav */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link to="/logger" className="px-4 py-2 bg-blue-500 text-white rounded sm:px-2 sm:py-1">Back to Logger</Link>
        <Link to="/summary" className="px-4 py-2 bg-emerald-600 text-white rounded sm:px-2 sm:py-1">Summary</Link>
        <Link to="/dashboard" className="px-4 py-2 bg-indigo-600 text-white rounded sm:px-2 sm:py-1">Dashboard</Link>
      </div>

      {(!selectedDate || runningLines.length === 0) ? (
        <p className="text-center text-gray-600 dark:text-gray-400 sm:text-sm">
          {selectedDate ? 'No lines marked Running for this date.' : 'Please select a date.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {runningLines.map(({ line, heads, offlineCount, fixedCount, notFixedCount }) => (
            <div
              key={line}
              className="border dark:border-gray-600 rounded-lg p-4 hover:shadow dark:hover:bg-gray-700 cursor-pointer transition"
              onClick={() => goToLine(line)}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-lg font-semibold dark:text-gray-100">{line}</h3>
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-1 rounded">Offline: <b>{offlineCount}</b></span>
                  <span className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2 py-1 rounded">Fixed: <b>{fixedCount}</b></span>
                  <span className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 px-2 py-1 rounded">Not Fixed: <b>{notFixedCount}</b></span>
                </div>
              </div>

              {/* 14 head dots (no extra tables) */}
              <div className="grid grid-cols-7 gap-2">
                {heads.slice(0, HEADS_PER_LINE).map((h) => {
                  const issues = h.issues || [];
                  const issueText = issues.length > 0
                    ? issues.map(iss => iss.type).join(', ')
                    : h.issue || 'None';
                  const statusText = h.offline === 'Active' ? 'Active' : (
                    issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed') ? 'Fixed' :
                    issues.length > 0 && issues.some(iss => iss.type === 'WDU Replacement') ? 'WDU' :
                    'Offline'
                  );

                  return (
                    <div
                      key={h.head}
                      className={`h-7 rounded-full flex items-center justify-center text-white text-xs ${headColor(h)}`}
                      title={`Head ${h.head} • ${statusText} • ${issueText}`}
                    >
                      {h.head}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* NOTE: intentionally removed any bottom summary/table you didn't request */}
    </div>
  );
}
