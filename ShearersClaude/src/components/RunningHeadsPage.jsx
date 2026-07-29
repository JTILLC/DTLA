// src/components/RunningHeadsPage.jsx
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDates } from '../context/DatesContext'; // if you’re using DatesContext
import { HEADS_PER_LINE } from '../constants';
// If you don't use DatesContext, this will still work via props: ({ data, dates })

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
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Running Heads</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Lines marked running · tap a line to open it</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Date</label>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="field w-auto py-2"
          >
            {(dates || []).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {(!selectedDate || runningLines.length === 0) ? (
        <div className="card p-10 text-center text-gray-500 dark:text-gray-400">
          {selectedDate ? 'No lines marked Running for this date.' : 'Please select a date.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {runningLines.map(({ line, heads, offlineCount, fixedCount, notFixedCount }) => (
            <button
              key={line}
              className="card p-4 text-left hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all"
              onClick={() => goToLine(line)}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{line}</h3>
                <div className="flex flex-wrap gap-1.5">
                  <span className="pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Offline {offlineCount}</span>
                  <span className="pill bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">Fixed {fixedCount}</span>
                  <span className="pill bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">Not Fixed {notFixedCount}</span>
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
                      className={`h-9 rounded-lg flex items-center justify-center text-white text-sm font-semibold ${headColor(h)}`}
                      title={`Head ${h.head} • ${statusText} • ${issueText}`}
                    >
                      {h.head}
                    </div>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
