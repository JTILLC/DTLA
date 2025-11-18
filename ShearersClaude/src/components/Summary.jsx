import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getDatabase, ref, get, set } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { app } from '../firebaseConfig';
import { useDates } from '../context/DatesContext';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const database = getDatabase(app);
const auth = getAuth(app);

// History path (namespaced)
const HISTORY_PATH = 'jti-downtime/head-history';
const getHistoryRef = () => ref(database, HISTORY_PATH);

// ---- Key helpers (shared with HeadHistory) ----
const canonicalString = (e) => {
  const date = (e.date ?? '').trim();
  const line = (e.line ?? '').trim();
  const head = e.head === '' || e.head === undefined || e.head === null ? '' : String(e.head).trim();
  const issue = (e.issue ?? '').trim();
  const repaired = (e.repaired ?? '').trim();
  const notes = (e.notes ?? '').trim();
  if (!head) return `MN|${date}|${line}|${notes}`;
  return `H|${date}|${line}|${head}|${issue}|${repaired}|${notes}`;
};
const hashHex = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
};
const firebaseKeyForEntry = (e) => {
  const c = canonicalString(e);
  const type = c.startsWith('MN|') ? 'MN' : 'H';
  return `${type}_${hashHex(c)}`;
};
const isHeadDown = (h) => (String(h?.offline ?? '').toLowerCase() || 'active') !== 'active';

export default function Summary({ data }) {
  const { dates } = useDates();
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [authReady, setAuthReady] = useState(false);
  const [dbError, setDbError] = useState('');

  // For Past Failures
  const [historyCounts, setHistoryCounts] = useState(new Map());
  const [historyList, setHistoryList] = useState([]); // full list for modal filtering
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalItems, setModalItems] = useState([]);

  // Ensure anonymous auth before DB calls
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!auth.currentUser) await signInAnonymously(auth);
        if (!cancelled) setAuthReady(true);
      } catch (e) {
        if (!cancelled) {
          setAuthReady(true);
          setDbError('Auth failed (anonymous). Some cloud features may be disabled.');
          console.error('Anonymous auth failed:', e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load head-history counts + keep a cached list so the modal can show items
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await get(getHistoryRef());
        if (!snap.exists()) {
          if (!cancelled) {
            setHistoryCounts(new Map());
            setHistoryList([]);
          }
          return;
        }
        const val = snap.val();
        const arr = Array.isArray(val) ? val.filter(Boolean) : Object.values(val || {});

        // build counts per "Line X-Head Y"
        const map = new Map();
        arr.forEach((e) => {
          if (e?.line && e?.head != null && e.head !== '') {
            const key = `${e.line}-Head ${e.head}`;
            map.set(key, (map.get(key) || 0) + 1);
          }
        });

        if (!cancelled) {
          setHistoryCounts(map);
          setHistoryList(
            arr
              .filter(e => e && e.date)
              .sort((a, b) => new Date(b.date) - new Date(a.date)) // newest first for modal
          );
          setDbError('');
        }
      } catch (e) {
        console.warn('Head History read failed:', e);
        if (!cancelled) {
          setHistoryCounts(new Map());
          setHistoryList([]);
          setDbError('Cannot read Head History (permission denied). Past Failures will show as 0.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authReady]);

  // Build 5-day rows (running lines only)
  const rows = useMemo(() => {
    const result = [];
    (dates || []).forEach((date) => {
      const dayData = data?.[date] || {};
      Object.keys(dayData).forEach((line) => {
        const entry = dayData[line] || {};
        const running = !!entry.running;

        if (running) {
          (entry.heads || []).filter(isHeadDown).forEach((h) => {
            result.push({
              key: `${date}|${line}|${h.head}|H`,
              date,
              line,
              head: h.head,
              issue: h.issue || 'None',
              notes: h.notes || '',
              repaired: h.repaired || 'Not Fixed',
              running: 'Yes',
              _exportable: { date, line, head: h.head, issue: h.issue || 'None', repaired: h.repaired || 'Not Fixed', notes: h.notes || '' },
            });
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
            _exportable: { date, line, head: '', issue: '', repaired: '', notes: `Machine note: ${entry.machineNotes.trim()}` },
          });
        }
      });
    });

    // Oldest -> Newest (unchanged). Flip if you want.
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
  }, [data, dates, globalSearch]);

  const selectAll = () => setSelectedKeys(new Set(rows.map((r) => r.key)));
  const clearSelection = () => setSelectedKeys(new Set());

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text('Downtime Summary (5-day window)', 14, 20);
    doc.autoTable({
      startY: 30,
      head: [['', 'Date', 'Line', 'Head', 'Issue', 'Notes', 'Repaired', 'Running', 'Past Failures']],
      body: rows.map((r) => {
        const pastKey = r.head ? `${r.line}-Head ${r.head}` : '';
        const past = r.head ? (historyCounts.get(pastKey) || 0) : '-';
        const mark = selectedKeys.has(r.key) ? '✓' : '';
        return [mark, r.date, r.line, r.head || '—', r.issue || '—', r.notes || '—', r.repaired || '—', r.running, past];
      }),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [66, 66, 66] },
    });
    doc.save('downtime-summary.pdf');
  };

  // Add selected to head-history (merge + set)
  const addSelectedToHeadHistory = useCallback(async () => {
    const toAdd = rows
      .filter((r) => selectedKeys.has(r.key))
      .map((r) => r._exportable);

    if (!toAdd.length) {
      alert('No rows selected.');
      return;
    }

    try {
      if (!auth.currentUser) await signInAnonymously(auth);

      const snap = await get(getHistoryRef());
      const existing = snap.exists() ? snap.val() : {};
      const merged = { ...(existing || {}) };

      toAdd.forEach((e) => {
        merged[firebaseKeyForEntry(e)] = e;
      });

      await set(getHistoryRef(), merged);
      alert(`Added ${toAdd.length} entr${toAdd.length === 1 ? 'y' : 'ies'} to Head History`);
      setDbError('');
    } catch (e) {
      console.warn('Add to Head History failed:', e);
      if (String(e?.message || '').toLowerCase().includes('permission')) {
        alert('Cannot write to Head History (permission denied).');
        setDbError('Cannot write to Head History (permission denied).');
      } else {
        alert('Failed to add to Head History: ' + e.message);
        setDbError('Failed to add to Head History.');
      }
    }
  }, [rows, selectedKeys]);

  // Open modal with all failures for a given (line, head)
  const openPastFailures = (line, head) => {
    const key = `${line}-Head ${head}`;
    const count = historyCounts.get(key) || 0;
    if (!count) return;

    const items = historyList
      .filter(e => e.line === line && String(e.head) === String(head))
      .sort((a, b) => new Date(b.date) - new Date(a.date)); // newest first

    setModalTitle(`${line} — Head ${head} • Past Failures (${items.length})`);
    setModalItems(items);
    setModalOpen(true);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white rounded-lg shadow-md md:p-4 sm:p-2">
      <h2 className="text-2xl font-semibold text-center mb-2 sm:text-xl">Summary</h2>

      {dbError && (
        <div className="mb-3 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
          {dbError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-2">
        <div className="flex gap-2 flex-wrap">
          <Link to="/logger" className="px-4 py-2 bg-blue-500 text-white rounded sm:px-2 sm:py-1">Back to Logger</Link>
          <Link to="/head-history" className="px-4 py-2 bg-teal-600 text-white rounded sm:px-2 sm:py-1">View Head History</Link>
        </div>

        <input
          type="text"
          placeholder="Search rows…"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
          className="border rounded px-3 py-1 w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        <div className="flex gap-2">
          <button onClick={exportToPDF} className="px-4 py-2 bg-green-600 text-white rounded sm:px-2 sm:py-1">Export PDF</button>
          <button onClick={addSelectedToHeadHistory} disabled={!authReady} className="px-3 py-2 bg-indigo-600 text-white rounded text-sm disabled:opacity-50">
            Add Selected to Head History
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-gray-600 sm:text-sm">No downtime rows in the current 5-day window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-auto border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-100">
                {['', 'Date', 'Line', 'Head', 'Issue', 'Notes', 'Repaired', 'Running', 'Past Failures'].map((c) => (
                  <th key={c} className="p-2 text-center border sm:p-1 sm:text-sm">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const checked = selectedKeys.has(r.key);
                const pastKey = r.head ? `${r.line}-Head ${r.head}` : '';
                const past = r.head ? (historyCounts.get(pastKey) || 0) : '-';
                const rowClass =
                  r.head === ''
                    ? 'bg-yellow-50'
                    : r.repaired === 'Fixed'
                    ? 'bg-orange-200'
                    : 'bg-red-200';

                return (
                  <tr key={r.key} className={rowClass}>
                    <td className="p-2 text-center border">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedKeys((s) => {
                            const n = new Set(s);
                            n.has(r.key) ? n.delete(r.key) : n.add(r.key);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="p-2 text-center border sm:p-1 sm:text-sm">{r.date}</td>
                    <td className="p-2 text-center border sm:p-1 sm:text-sm">{r.line}</td>
                    <td className="p-2 text-center border sm:p-1 sm:text-sm">{r.head || '—'}</td>
                    <td className="p-2 text-center border sm:p-1 sm:text-sm">{r.issue || '—'}</td>
                    <td className="p-2 border sm:p-1 sm:text-sm max-w-xs whitespace-normal">{r.notes || '—'}</td>
                    <td className="p-2 text-center border sm:p-1 sm:text-sm">{r.repaired || '—'}</td>
                    <td className="p-2 text-center border sm:p-1 sm:text-sm">{r.running}</td>
                    <td className="p-2 text-center border sm:p-1 sm:text-sm">
                      {r.head ? (
                        (historyCounts.get(`${r.line}-Head ${r.head}`) || 0) > 0 ? (
                          <button
                            onClick={() => openPastFailures(r.line, r.head)}
                            className="underline text-blue-700 hover:text-blue-900"
                            title="Show past failures"
                          >
                            {historyCounts.get(`${r.line}-Head ${r.head}`)}
                          </button>
                        ) : (
                          '0'
                        )
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Past Failures Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">{modalTitle}</h3>
              <button onClick={() => setModalOpen(false)} className="px-2 py-1 rounded hover:bg-gray-100">✕</button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-auto">
              {modalItems.length === 0 ? (
                <p className="text-sm text-gray-600">No entries.</p>
              ) : (
                <table className="w-full table-auto border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-sm">
                      <th className="border p-2">Date</th>
                      <th className="border p-2">Issue</th>
                      <th className="border p-2">Repaired</th>
                      <th className="border p-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalItems.map((e, i) => (
                      <tr key={i} className="text-sm">
                        <td className="border p-2 text-center">{e.date}</td>
                        <td className="border p-2 text-center">{e.issue || 'None'}</td>
                        <td className="border p-2 text-center">{e.repaired || 'Not Fixed'}</td>
                        <td className="border p-2">{e.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-3 border-t text-right">
              <button onClick={() => setModalOpen(false)} className="px-3 py-1 bg-blue-600 text-white rounded">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
