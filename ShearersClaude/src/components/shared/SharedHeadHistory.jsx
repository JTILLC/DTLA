// src/components/shared/SharedHeadHistory.jsx
import React, { useState, useEffect } from 'react';
import PhotoThumbs from '../PhotoThumbs';
import { getDatabase, ref, get } from 'firebase/database';
import { app } from '../../firebaseConfig';

const database = getDatabase(app);
const HISTORY_PATH = 'jti-downtime/head-history';

export default function SharedHeadHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState(() => window.innerWidth <= 768 ? 'cards' : 'table');

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const snapshot = await get(ref(database, HISTORY_PATH));
        if (snapshot.exists()) {
          const val = snapshot.val();
          const arr = Array.isArray(val) ? val.filter(Boolean) : Object.values(val || {});
          setHistory(arr.sort((a, b) => new Date(b.date) - new Date(a.date)));
        }
        setLoading(false);
      } catch (err) {
        console.error('Failed to load history:', err);
        setError('Failed to load head history.');
        setLoading(false);
      }
    };
    loadHistory();
  }, []);

  const filteredHistory = search.trim()
    ? history.filter((e) =>
        Object.values(e).some((v) => String(v).toLowerCase().includes(search.toLowerCase()))
      )
    : history;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-2xl font-semibold text-center mb-4 dark:text-gray-100">Head History (Read Only)</h2>

      <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-2">
        <input
          type="text"
          placeholder="Search history..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded px-3 py-2 w-full sm:w-64"
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

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Showing {filteredHistory.length} of {history.length} entries
      </p>

      {filteredHistory.length === 0 ? (
        <p className="text-center text-gray-600 dark:text-gray-400 py-8">No history entries found.</p>
      ) : viewMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full table-auto border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                {['Date', 'Line', 'Head', 'Issue', 'Repaired', 'Notes', 'Photos'].map((c) => (
                  <th key={c} className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map((e, i) => {
                const isMachineNote = !e.head;
                const rowClass = isMachineNote
                  ? 'bg-yellow-200 dark:bg-yellow-400'
                  : (e.issue && e.issue.includes('WDU Replacement'))
                  ? 'bg-purple-300 dark:bg-purple-700'
                  : e.repaired === 'Fixed'
                  ? 'bg-orange-200 dark:bg-orange-600'
                  : 'bg-red-200 dark:bg-red-700';

                return (
                  <tr key={i} className={rowClass}>
                    <td className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">{e.date}</td>
                    <td className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">{e.line}</td>
                    <td className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">{e.head || '—'}</td>
                    <td className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">{e.issue || '—'}</td>
                    <td className="p-2 text-center border dark:border-gray-600 dark:text-gray-200">{e.repaired || '—'}</td>
                    <td className="p-2 border dark:border-gray-600 dark:text-gray-200 max-w-xs whitespace-normal">{e.notes || '—'}</td>
                    <td className="p-2 border dark:border-gray-600">
                      {e.photos && e.photos.length ? <PhotoThumbs photos={e.photos} /> : <span className="text-gray-500">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredHistory.map((e, i) => {
            const isMachineNote = !e.head;
            const cardClass = isMachineNote
              ? 'bg-yellow-200 dark:bg-yellow-400 border-yellow-300 dark:border-yellow-500'
              : (e.issue && e.issue.includes('WDU Replacement'))
              ? 'bg-purple-300 dark:bg-purple-700 border-purple-300 dark:border-purple-600'
              : e.repaired === 'Fixed'
              ? 'bg-orange-200 dark:bg-orange-600 border-orange-300 dark:border-orange-500'
              : 'bg-red-200 dark:bg-red-700 border-red-300 dark:border-red-600';

            return (
              <div key={i} className={`${cardClass} border dark:border-gray-600 rounded-lg p-4`}>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="font-semibold dark:text-gray-300">Date:</span> <span className="dark:text-gray-200">{e.date}</span></div>
                  <div><span className="font-semibold dark:text-gray-300">Line:</span> <span className="dark:text-gray-200">{e.line}</span></div>
                  <div><span className="font-semibold dark:text-gray-300">Head:</span> <span className="dark:text-gray-200">{e.head || '—'}</span></div>
                  <div><span className="font-semibold dark:text-gray-300">Issue:</span> <span className="dark:text-gray-200">{e.issue || '—'}</span></div>
                  <div><span className="font-semibold dark:text-gray-300">Repaired:</span> <span className="dark:text-gray-200">{e.repaired || '—'}</span></div>
                  <div className="col-span-2">
                    <span className="font-semibold dark:text-gray-300">Notes:</span> <span className="dark:text-gray-200">{e.notes || '—'}</span>
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
