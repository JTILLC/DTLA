// src/components/shared/SharedLogger.jsx
import React, { useState, useMemo } from 'react';
import { sortAsc } from '../../utils/stintDays';

const HEADS_PER_LINE = 14;

const makeDefaultHeads = () =>
  Array.from({ length: HEADS_PER_LINE }, (_, i) => ({
    head: i + 1,
    offline: 'Active',
    issues: [],
    notes: ''
  }));


// Read-only photo thumbnails for the customer's shared view. Opens full size in
// a new tab; there's no login here, so no upload or delete.
const SharedPhotos = ({ photos }) => {
  const list = (photos || []).filter((p) => p?.url);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {list.map((p, i) => (
        <a key={p.path || i} href={p.url} target="_blank" rel="noopener noreferrer" title="View photo">
          <img
            src={p.url}
            alt={`Photo ${i + 1}`}
            loading="lazy"
            className="w-12 h-12 object-cover rounded border border-gray-300 dark:border-gray-600 block"
          />
        </a>
      ))}
    </div>
  );
};

export default function SharedLogger({ data = {}, dates = [] }) {
  const [currentDay, setCurrentDay] = useState(dates[0] || '');
  const [currentLine, setCurrentLine] = useState('Line 1');
  const [expandedDays, setExpandedDays] = useState(() => new Set([dates[0]]));

  // Chronological display order (oldest first)
  const orderedDates = useMemo(() => sortAsc(dates), [dates]);

  const getDayData = (date) => data?.[date] || {};

  const entryFor = (date) =>
    (getDayData(date)[currentLine]) || { heads: makeDefaultHeads(), machineNotes: '', running: false };

  const getRowClass = (h) => {
    if (h.offline === 'Active') return 'bg-green-200 dark:bg-green-700';
    const issues = h.issues || [];
    if (issues.some(iss => iss.type === 'WDU Replacement')) {
      return 'bg-purple-300 dark:bg-purple-700';
    }
    if (issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed')) {
      return 'bg-orange-200 dark:bg-orange-600';
    }
    return 'bg-red-200 dark:bg-red-700';
  };

  const toggleDay = (date) => {
    setExpandedDays((prev) => {
      const n = new Set(prev);
      n.has(date) ? n.delete(date) : n.add(date);
      return n;
    });
    setCurrentDay(date);
  };

  const allLines = Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`);
  const currentLineIdx = allLines.indexOf(currentLine);
  const prevLine = () => setCurrentLine(allLines[Math.max(0, currentLineIdx - 1)]);
  const nextLine = () => setCurrentLine(allLines[Math.min(allLines.length - 1, currentLineIdx + 1)]);

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md md:p-4 sm:p-2">
      <h2 className="text-2xl font-semibold text-center mb-4 text-gray-900 dark:text-gray-100 sm:text-xl">
        Downtime Logger (Read Only)
      </h2>

      {/* Quick Head View */}
      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Quick Head View - {currentLine} ({currentDay})
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={prevLine}
              disabled={currentLineIdx <= 0}
              className="px-3 py-1 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <button
              onClick={nextLine}
              disabled={currentLineIdx >= allLines.length - 1}
              className="px-3 py-1 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2 mb-4">
          {Array.from({ length: HEADS_PER_LINE }, (_, i) => {
            const currentEntry = entryFor(currentDay);
            const currentHeads = currentEntry.heads || makeDefaultHeads();
            const head = currentHeads[i];
            const isActive = head.offline === 'Active';
            const issues = head.issues || [];
            const hasWDU = issues.some(iss => iss.type === 'WDU Replacement');
            const allFixed = issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
            const headNum = i + 1;

            let displayText = 'Active';
            let bgColor = 'bg-green-500';

            if (!isActive) {
              if (hasWDU) {
                displayText = 'WDU';
                bgColor = 'bg-purple-500';
              } else if (allFixed) {
                displayText = 'Fixed';
                bgColor = 'bg-orange-500';
              } else {
                displayText = 'Offline';
                bgColor = 'bg-red-500';
              }
            }

            return (
              <div
                key={i}
                className={`px-3 py-2 rounded border border-gray-300 dark:border-gray-600 ${bgColor} text-white text-center`}
                title={`Head ${headNum} - ${displayText}`}
              >
                <div className="font-bold text-lg">{headNum}</div>
              </div>
            );
          })}
        </div>

        {/* Color Legend */}
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span className="dark:text-gray-200">Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span className="dark:text-gray-200">Offline</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-500 rounded"></div>
            <span className="dark:text-gray-200">Fixed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-purple-500 rounded"></div>
            <span className="dark:text-gray-200">WDU</span>
          </div>
        </div>
      </div>

      {/* Day cards — Day 1 → Day N */}
      <div className="space-y-2">
        {orderedDates.map((date) => {
          const isExpanded = expandedDays.has(date);
          const dayData = getDayData(date);
          const entry = dayData[currentLine] || { heads: makeDefaultHeads(), machineNotes: '', running: false };
          const { heads, machineNotes, running } = entry;

          return (
            <div key={date} className="border dark:border-gray-600 rounded-lg overflow-hidden">
              {/* Header */}
              <button
                onClick={() => toggleDay(date)}
                className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <span className="font-medium dark:text-gray-100">{date}</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${running ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400'}`}>
                    {running ? 'Running' : 'Not Running'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    {Object.keys(dayData).filter((l) => dayData[l]?.running).length} active lines
                  </span>
                  <svg className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Body */}
              {isExpanded && (
                <div className="p-4 bg-white dark:bg-gray-800 space-y-4">
                  {/* Line selector */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium dark:text-gray-100">Line:</span>
                    <button
                      onClick={prevLine}
                      disabled={currentLineIdx <= 0}
                      className="px-3 py-1 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ← Prev
                    </button>
                    <select
                      value={currentLine}
                      onChange={(e) => setCurrentLine(e.target.value)}
                      className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded"
                    >
                      {allLines.map((line) => (
                        <option key={line} value={line}>{line}</option>
                      ))}
                    </select>
                    <button
                      onClick={nextLine}
                      disabled={currentLineIdx >= allLines.length - 1}
                      className="px-3 py-1 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next →
                    </button>
                  </div>

                  {/* Heads table */}
                  <div className="overflow-x-auto">
                    <table className="w-full table-auto border-collapse min-w-max">
                      <thead>
                        <tr className="bg-gray-100 dark:bg-gray-700">
                          {['Head', 'Status', 'Issues', 'Notes'].map((c) => (
                            <th key={c} className="p-2 text-center border dark:border-gray-600 dark:text-gray-100">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(heads || makeDefaultHeads()).map((h, idx) => {
                          const issues = h.issues || [];
                          const rowBg = getRowClass(h);

                          return (
                            <tr key={idx} className={rowBg}>
                              <td className="p-2 text-center border dark:border-gray-600 font-semibold">{h.head}</td>
                              <td className="p-2 text-center border dark:border-gray-600">
                                <span className={`px-3 py-1 rounded text-white text-sm ${h.offline === 'Active' ? 'bg-green-500' : 'bg-red-500'}`}>
                                  {h.offline}
                                </span>
                              </td>
                              <td className="p-2 border dark:border-gray-600">
                                {issues.length > 0 ? (
                                  <ul className="space-y-1">
                                    {issues.map((iss, issIdx) => (
                                      <li key={issIdx} className="text-sm">
                                        <span className="font-medium">{iss.type}</span>
                                        {iss.replacementReason && <span className="text-gray-600 dark:text-gray-400"> ({iss.replacementReason})</span>}
                                        <span className={`ml-2 px-2 py-0.5 rounded text-xs ${iss.repaired === 'Fixed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                                          {iss.repaired}
                                        </span>
                                        <SharedPhotos photos={iss.photos} />
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-gray-400 text-sm">No issues</span>
                                )}
                              </td>
                              <td className="p-2 border dark:border-gray-600 text-sm">{h.notes || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Machine notes */}
                  {machineNotes && (
                    <div>
                      <label className="block mb-1 font-medium dark:text-gray-100">Machine Notes:</label>
                      <div className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded bg-gray-50">
                        {machineNotes}
                        <SharedPhotos photos={entry.notePhotos} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
