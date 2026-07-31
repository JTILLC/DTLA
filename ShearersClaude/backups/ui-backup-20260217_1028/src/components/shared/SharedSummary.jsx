// src/components/shared/SharedSummary.jsx
import React, { useMemo, useState } from 'react';

const isHeadDown = (h) => (String(h?.offline ?? '').toLowerCase() || 'active') !== 'active';

export default function SharedSummary({ data = {}, dates = [] }) {
  const [globalSearch, setGlobalSearch] = useState('');
  const [viewMode, setViewMode] = useState(() => window.innerWidth <= 768 ? 'cards' : 'table');

  // Build rows for ALL available dates (running lines only)
  const rows = useMemo(() => {
    const result = [];
    const allDates = Object.keys(data || {}).sort((a, b) => new Date(b) - new Date(a));

    allDates.forEach((date) => {
      const dayData = data?.[date] || {};
      Object.keys(dayData).forEach((line) => {
        const entry = dayData[line] || {};
        const running = !!entry.running;

        if (running) {
          (entry.heads || []).filter(isHeadDown).forEach((h) => {
            let issuesArray = [];
            if (Array.isArray(h.issues) && h.issues.length > 0) {
              issuesArray = h.issues;
            } else if (h.issue && h.issue !== 'None') {
              issuesArray = [{ type: h.issue, repaired: h.repaired || 'Not Fixed', replacementReason: '' }];
            }

            if (issuesArray.length === 0) {
              result.push({
                key: `${date}|${line}|${h.head}|0|H`,
                date,
                line,
                head: h.head,
                issue: 'Undetermined',
                notes: h.notes || '',
                repaired: 'Not Fixed',
                running: 'Yes',
              });
            } else {
              issuesArray.forEach((iss, idx) => {
                const issueDisplay = iss.type === 'WDU Replacement' && iss.replacementReason
                  ? `${iss.type} (${iss.replacementReason})`
                  : iss.type;

                result.push({
                  key: `${date}|${line}|${h.head}|${idx}|H`,
                  date,
                  line,
                  head: h.head,
                  issue: issueDisplay,
                  notes: h.notes || '',
                  repaired: iss.repaired || 'Not Fixed',
                  running: 'Yes',
                });
              });
            }
          });
        }

        if (running && entry.machineNotes && entry.machineNotes.trim()) {
          result.push({
            key: `${date}|${line}|MN|M`,
            date,
            line,
            head: '',
            issue: '',
            notes: entry.machineNotes.trim(),
            repaired: '',
            running: 'Yes',
          });
        }
      });
    });

    result.sort((a, b) => {
      const d = new Date(a.date) - new Date(b.date);
      if (d !== 0) return d;
      const la = parseInt(a.line.replace('Line ', '') || '0', 10);
      const lb = parseInt(b.line.replace('Line ', '') || '0', 10);
      return la - lb;
    });

    if (globalSearch.trim()) {
      const term = globalSearch.toLowerCase();
      return result.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(term)));
    }
    return result;
  }, [data, globalSearch]);

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md md:p-4 sm:p-2">
      <h2 className="text-2xl font-semibold text-center mb-2 sm:text-xl dark:text-gray-100">Summary (Read Only)</h2>

      <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-2">
        <input
          type="text"
          placeholder="Search rows..."
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded px-3 py-1 w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        <div className="inline-flex rounded-md shadow-sm">
          <button
            onClick={() => setViewMode('table')}
            className={`px-4 py-2 text-sm font-medium border ${
              viewMode === 'table'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
            } rounded-l-lg`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className={`px-4 py-2 text-sm font-medium border-t border-b border-r ${
              viewMode === 'cards'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
            } rounded-r-lg`}
          >
            Cards
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-gray-600 dark:text-gray-400">No downtime entries found.</p>
      ) : viewMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full table-auto border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                {['Date', 'Line', 'Head', 'Issue', 'Notes', 'Repaired', 'Running'].map((c) => (
                  <th key={c} className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowClass =
                  r.head === ''
                    ? 'bg-yellow-200 dark:bg-yellow-400'
                    : r.issue && r.issue.includes('WDU Replacement')
                    ? 'bg-purple-300 dark:bg-purple-700'
                    : r.repaired === 'Fixed'
                    ? 'bg-orange-200 dark:bg-orange-600'
                    : 'bg-red-200 dark:bg-red-700';

                return (
                  <tr key={r.key} className={rowClass}>
                    <td className="p-2 text-center border dark:border-gray-600">{r.date}</td>
                    <td className="p-2 text-center border dark:border-gray-600">{r.line}</td>
                    <td className="p-2 text-center border dark:border-gray-600">{r.head || '—'}</td>
                    <td className="p-2 text-center border dark:border-gray-600">{r.issue || '—'}</td>
                    <td className="p-2 border dark:border-gray-600 max-w-xs whitespace-normal">{r.notes || '—'}</td>
                    <td className="p-2 text-center border dark:border-gray-600">{r.repaired || '—'}</td>
                    <td className="p-2 text-center border dark:border-gray-600">{r.running}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((r) => {
            const cardClass =
              r.head === ''
                ? 'bg-yellow-200 dark:bg-yellow-400'
                : r.issue && r.issue.includes('WDU Replacement')
                ? 'bg-purple-300 dark:bg-purple-700'
                : r.repaired === 'Fixed'
                ? 'bg-orange-200 dark:bg-orange-600'
                : 'bg-red-200 dark:bg-red-700';

            return (
              <div key={r.key} className={`${cardClass} border dark:border-gray-600 rounded-lg p-4 shadow-sm`}>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="font-semibold">Date:</span> {r.date}</div>
                  <div><span className="font-semibold">Line:</span> {r.line}</div>
                  <div><span className="font-semibold">Head:</span> {r.head || '—'}</div>
                  <div><span className="font-semibold">Issue:</span> {r.issue || '—'}</div>
                  <div><span className="font-semibold">Running:</span> {r.running}</div>
                  <div><span className="font-semibold">Repaired:</span> {r.repaired || '—'}</div>
                  <div className="col-span-2">
                    <span className="font-semibold">Notes:</span> {r.notes || '—'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
