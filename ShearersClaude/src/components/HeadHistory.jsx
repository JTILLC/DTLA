// src/components/HeadHistory.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDatabase, ref, get, update, set } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { app } from '../firebaseConfig';

const database = getDatabase(app);
const auth = getAuth(app);

// --- Cloud paths (namespaced) ---
const DB_ROOT = 'jti-downtime';
const HEADHISTORY_PATH = `${DB_ROOT}/head-history`;  // <— Head History lives here
const getHistoryRef = () => ref(database, HEADHISTORY_PATH);

const ISSUE_TYPES = [
  'None',
  'Chute',
  'Operator',
  'Load Cell',
  'Detached Head',
  'Stepper Motor Error',
  'Hopper Issues',
  'Installed Wrong',
  'Other'
];

const REPAIRED_TYPES = ['Not Fixed', 'Fixed'];

// Canonical string for hashing + keying
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

const isValidEntry = (e) => e && typeof e === 'object' && e.date && e.line && ('head' in e || e.notes);
const normalizeEntry = (e) => ({
  date: (e.date ?? '').trim(),
  line: (e.line ?? '').trim(),
  head: e.head === '' || e.head === undefined || e.head === null ? '' : String(e.head).trim(),
  issue: (e.issue ?? (e.head ? 'None' : '')).trim(),
  repaired: (e.repaired ?? (e.head ? 'Not Fixed' : '')).trim(),
  notes: (e.notes ?? '').trim()
});

export default function HeadHistory() {
  const [entries, setEntries] = useState({}); // { id: entry }
  const [authReady, setAuthReady] = useState(false);
  const [dbError, setDbError] = useState('');
  const [loading, setLoading] = useState(false);

  // filters + search
  const [globalSearch, setGlobalSearch] = useState('');
  const [filters, setFilters] = useState({
    date: '',
    line: '',
    head: '',
    issue: '',
    repaired: ''
  });
  const [machineOnly, setMachineOnly] = useState(false);

  // modals
  const [showHeadModal, setShowHeadModal] = useState(false);
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editingData, setEditingData] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    // Default to table on desktop, cards on mobile
    return window.innerWidth <= 768 ? 'cards' : 'table';
  });

  const [newHeadEntry, setNewHeadEntry] = useState({
    date: '',
    line: 'Line 1',
    head: '',
    issue: 'None',
    repaired: 'Not Fixed',
    notes: ''
  });

  const [newMachineNote, setNewMachineNote] = useState({
    date: '',
    line: 'Line 1',
    notes: ''
  });

  // ---------- Auth first ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
        if (!cancelled) setAuthReady(true);
      } catch (e) {
        console.warn('Anonymous auth failed:', e);
        if (!cancelled) {
          setAuthReady(true); // allow local work anyway
          setDbError('Anonymous auth failed; cloud features may be limited.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- Load from cloud on mount (non-destructive) ----------
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await get(getHistoryRef());
        if (!snap.exists()) {
          if (!cancelled) {
            setEntries({});
            setDbError('');
          }
          return;
        }
        const val = snap.val();
        // Ensure {id: entry}
        const incoming = Array.isArray(val)
          ? Object.fromEntries(val.filter(Boolean).map((e) => [firebaseKeyForEntry(e), normalizeEntry(e)]))
          : Object.fromEntries(Object.entries(val || {}).map(([id, raw]) => [id, normalizeEntry(raw)]));
        if (!cancelled) {
          setEntries(incoming);
          setDbError('');
        }
      } catch (e) {
        console.warn('Load head-history failed:', e);
        if (!cancelled) setDbError('Cannot read Head History (permission denied or network).');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authReady]);

  // ---------- Derived table rows (NEWEST FIRST) ----------
  const rows = useMemo(() => {
    const arr = Object.entries(entries).map(([id, e]) => ({ id, ...e }));

    const f = (r) => {
      if (machineOnly && (r.head ?? '') !== '') return false; // only machine notes
      if (filters.date && r.date !== filters.date) return false;
      if (filters.line && r.line !== filters.line) return false;
      if (filters.head && String(r.head ?? '') !== String(filters.head)) return false;
      if (filters.issue && (r.issue ?? '') !== filters.issue) return false;
      if (filters.repaired && (r.repaired ?? '') !== filters.repaired) return false;
      if (globalSearch.trim()) {
        const term = globalSearch.toLowerCase();
        const blob = `${r.date} ${r.line} ${r.head ?? ''} ${r.issue ?? ''} ${r.repaired ?? ''} ${r.notes ?? ''}`.toLowerCase();
        if (!blob.includes(term)) return false;
      }
      return true;
    };

    // Sort: date DESC (newest first), then line asc, then head asc
    return arr
      .filter(f)
      .sort((a, b) => {
        const d = new Date(b.date) - new Date(a.date); // DESC
        if (d !== 0) return d;
        const la = parseInt((a.line || '').replace('Line ', ''), 10) || 0;
        const lb = parseInt((b.line || '').replace('Line ', ''), 10) || 0;
        if (la !== lb) return la - lb;
        const ha = parseInt(a.head || '0', 10) || 0;
        const hb = parseInt(b.head || '0', 10) || 0;
        return ha - hb;
      });
  }, [entries, filters, globalSearch, machineOnly]);

  // ---------- Import / Export ----------
  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);

        let incoming = {};
        if (Array.isArray(payload)) {
          payload.forEach((raw) => {
            if (!isValidEntry(raw)) return; // skip invalid
            const id = firebaseKeyForEntry(raw);
            incoming[id] = normalizeEntry(raw);
          });
        } else if (payload && typeof payload === 'object') {
          const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
          Object.entries(root).forEach(([id, raw]) => {
            if (!isValidEntry(raw)) return;
            const finalId = id || firebaseKeyForEntry(raw);
            incoming[finalId] = normalizeEntry(raw);
          });
        } else {
          throw new Error('Unrecognized JSON format.');
        }

        const count = Object.keys(incoming).length;
        if (!count) {
          alert('No valid entries found in file.');
          e.target.value = '';
          return;
        }

        // merge into existing entries (non-destructive)
        setEntries((prev) => ({ ...prev, ...incoming }));
        alert(`Imported ${count} entries to local history (not yet saved to cloud).`);
      } catch (err) {
        alert('Import failed: ' + err.message);
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleExport = () => {
    const out = entries; // { id: entry }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'head-history.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Cloud Save / Refresh ----------
  const handleSaveToCloud = async () => {
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      await set(getHistoryRef(), entries);
      alert(`Saved ${Object.keys(entries).length} entries to cloud.`);
      setDbError('');
    } catch (e) {
      console.warn('Save to cloud failed:', e);
      setDbError('Save failed (permission/network).');
      alert('Save failed: ' + e.message);
    }
  };

  const handleRefreshFromCloud = async () => {
    if (!confirm('Load from cloud and replace the in-memory list? (This will NOT delete cloud data.)')) return;
    try {
      setLoading(true);
      const snap = await get(getHistoryRef());
      if (!snap.exists()) {
        setEntries({});
        alert('No cloud history found.');
        return;
      }
      const val = snap.val();
      const incoming = Array.isArray(val)
        ? Object.fromEntries(val.filter(Boolean).map((e) => [firebaseKeyForEntry(e), normalizeEntry(e)]))
        : Object.fromEntries(Object.entries(val || {}).map(([id, raw]) => [id, normalizeEntry(raw)]));
      setEntries(incoming);
      setDbError('');
      alert(`Loaded ${Object.keys(incoming).length} entries from cloud.`);
    } catch (e) {
      console.warn('Refresh failed:', e);
      setDbError('Refresh failed (permission/network).');
      alert('Refresh failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------- Add (modals) ----------
  const submitHeadModal = () => {
    const cleaned = normalizeEntry(newHeadEntry);
    if (!cleaned.date || !cleaned.line || !cleaned.head) {
      alert('Please fill Date, Line, and Head.');
      return;
    }
    const id = firebaseKeyForEntry(cleaned);
    setEntries((prev) => ({ ...prev, [id]: cleaned }));
    setShowHeadModal(false);
  };

  const submitMachineModal = () => {
    const cleaned = normalizeEntry({ ...newMachineNote, head: '' });
    if (!cleaned.date || !cleaned.line || !cleaned.notes) {
      alert('Please fill Date, Line, and Notes.');
      return;
    }
    const id = firebaseKeyForEntry(cleaned); // MN_<hash>
    setEntries((prev) => ({ ...prev, [id]: cleaned }));
    setShowMachineModal(false);
  };

  // ---------- Edit / Delete ----------
  const startEdit = (row) => {
    setEditId(row.id);
    setEditingData({
      date: row.date,
      line: row.line,
      head: row.head ?? '',
      issue: row.head ? (row.issue || 'None') : '',
      repaired: row.head ? (row.repaired || 'Not Fixed') : '',
      notes: row.notes || ''
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditingData(null);
  };

  const saveEdit = () => {
    if (!editingData) return;
    const cleaned = normalizeEntry(editingData);
    if (!cleaned.date || !cleaned.line || (cleaned.head === '' ? !cleaned.notes : false)) {
      if (cleaned.head === '') {
        alert('Please fill Date, Line, and Notes for a machine note.');
      } else {
        alert('Please fill Date, Line, and Head.');
      }
      return;
    }
    const newId = firebaseKeyForEntry(cleaned);
    setEntries((prev) => {
      const next = { ...prev };
      delete next[editId];
      next[newId] = cleaned;
      return next;
    });
    cancelEdit();
  };

  const deleteEntry = (id) => {
    if (!confirm('Delete this entry from local list? (Save to push changes to cloud)')) return;
    setEntries((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // ---------- UI ----------
  return (
    <div className="max-w-6xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md md:p-4 sm:p-2">
      <h2 className="text-2xl font-semibold text-center mb-2 text-gray-900 dark:text-gray-100 sm:text-xl">Head History</h2>

      {dbError && (
        <div className="mb-3 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
          {dbError}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex gap-2 flex-wrap">
          <Link to="/logger" className="px-4 py-2 bg-blue-500 text-white rounded sm:px-2 sm:py-1">Back to Logger</Link>
          <Link to="/summary" className="px-4 py-2 bg-indigo-600 text-white rounded sm:px-2 sm:py-1">Back to Summary</Link>

          {/* Card/Table view toggle */}
          <div className="flex gap-1 border dark:border-gray-600 rounded">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 rounded text-sm transition-colors ${
                viewMode === 'table'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-2 rounded text-sm transition-colors ${
                viewMode === 'cards'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Cards
            </button>
          </div>
        </div>

        <input
          type="text"
          placeholder="Search…"
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-1 w-full sm:w-72"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />

        <div className="flex gap-2 flex-wrap">
          <label htmlFor="import-json" className="px-3 py-2 bg-green-600 text-white rounded text-sm cursor-pointer">Import JSON</label>
          <input id="import-json" type="file" accept=".json" hidden onChange={handleImport} />
          <button onClick={handleExport} className="px-3 py-2 bg-sky-600 text-white rounded text-sm">Export JSON</button>
          <button onClick={handleSaveToCloud} disabled={!authReady} className="px-3 py-2 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">Save</button>
          <button onClick={handleRefreshFromCloud} className="px-3 py-2 bg-cyan-600 text-white rounded text-sm">{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="date"
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
          value={filters.date}
          onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))}
        />
        <select
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
          value={filters.line}
          onChange={(e) => setFilters((f) => ({ ...f, line: e.target.value }))}
        >
          <option value="">All Lines</option>
          {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input
          type="number"
          min="1"
          placeholder="Head #"
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 w-24"
          value={filters.head}
          onChange={(e) => setFilters((f) => ({ ...f, head: e.target.value }))}
        />
        <select
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
          value={filters.issue}
          onChange={(e) => setFilters((f) => ({ ...f, issue: e.target.value }))}
        >
          <option value="">All Issues</option>
          {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select
          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
          value={filters.repaired}
          onChange={(e) => setFilters((f) => ({ ...f, repaired: e.target.value }))}
        >
          <option value="">Repaired: Any</option>
          {REPAIRED_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <label className="flex items-center gap-2 ml-2">
          <input
            type="checkbox"
            checked={machineOnly}
            onChange={(e) => setMachineOnly(e.target.checked)}
          />
          <span className="text-sm dark:text-gray-200">Machine notes only</span>
        </label>

        <button
          className="ml-auto px-3 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 rounded text-sm"
          onClick={() => { setFilters({ date: '', line: '', head: '', issue: '', repaired: '' }); setGlobalSearch(''); setMachineOnly(false); }}
        >
          Clear Filters
        </button>
      </div>

      {/* Add buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button className="px-3 py-2 bg-purple-600 text-white rounded text-sm" onClick={() => setShowHeadModal(true)}>
          + Add Head Entry
        </button>
        <button className="px-3 py-2 bg-amber-600 text-white rounded text-sm" onClick={() => setShowMachineModal(true)}>
          + Add Machine Note
        </button>
      </div>

      {/* Table or Cards */}
      {rows.length === 0 ? (
        <p className="text-center text-gray-600 dark:text-gray-400 sm:text-sm">No history to display.</p>
      ) : viewMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full table-auto border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                {['Date','Line','Head','Issue','Repaired','Notes','Actions'].map((c) => (
                  <th key={c} className="p-2 text-center border dark:border-gray-600 dark:text-gray-100 sm:p-1 sm:text-sm">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isMachineNote = (r.head ?? '') === '';
                const rowClass = isMachineNote
                  ? 'bg-yellow-200 dark:bg-yellow-400'
                  : (r.issue && r.issue.includes('WDU Replacement'))
                  ? 'bg-purple-300 dark:bg-purple-700'
                  : (r.repaired === 'Fixed' ? 'bg-orange-200 dark:bg-orange-600' : 'bg-red-200 dark:bg-red-700');

                return (
                  <tr key={r.id} className={rowClass}>
                    <td className="p-2 text-center border dark:border-gray-600 sm:p-1 sm:text-sm">{r.date}</td>
                    <td className="p-2 text-center border dark:border-gray-600 sm:p-1 sm:text-sm">{r.line}</td>
                    <td className="p-2 text-center border dark:border-gray-600 sm:p-1 sm:text-sm">{isMachineNote ? '—' : r.head}</td>
                    <td className="p-2 text-center border dark:border-gray-600 sm:p-1 sm:text-sm">{isMachineNote ? '—' : (r.issue || 'None')}</td>
                    <td className="p-2 text-center border dark:border-gray-600 sm:p-1 sm:text-sm">{isMachineNote ? '—' : (r.repaired || 'Not Fixed')}</td>
                    <td className="p-2 border dark:border-gray-600 sm:p-1 sm:text-sm max-w-md whitespace-normal">{r.notes || (isMachineNote ? '(Machine Note)' : '—')}</td>
                    <td className="p-2 text-center border dark:border-gray-600 sm:p-1 sm:text-sm">
                      <div className="flex justify-center gap-2">
                        <button
                          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs"
                          onClick={() => {
                            setEditId(r.id);
                            setEditingData({
                              date: r.date,
                              line: r.line,
                              head: r.head ?? '',
                              issue: r.head ? (r.issue || 'None') : '',
                              repaired: r.head ? (r.repaired || 'Not Fixed') : '',
                              notes: r.notes || ''
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs"
                          onClick={() => deleteEntry(r.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((r) => {
            const isMachineNote = (r.head ?? '') === '';
            const cardClass = isMachineNote
              ? 'bg-yellow-200 dark:bg-yellow-400 border-yellow-300 dark:border-yellow-500'
              : (r.issue && r.issue.includes('WDU Replacement'))
              ? 'bg-purple-300 dark:bg-purple-700 border-purple-300 dark:border-purple-600'
              : (r.repaired === 'Fixed' ? 'bg-orange-200 dark:bg-orange-600 border-orange-300 dark:border-orange-500' : 'bg-red-200 dark:bg-red-700 border-red-300 dark:border-red-600');

            return (
              <div key={r.id} className={`p-4 rounded-lg border-2 ${cardClass}`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-semibold text-lg dark:text-gray-100">{r.date}</div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">{r.line}</div>
                  </div>
                  {!isMachineNote && (
                    <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">#{r.head}</div>
                  )}
                </div>

                {isMachineNote ? (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Machine Note:</div>
                    <div className="text-sm text-gray-800 dark:text-gray-200 italic">{r.notes || '(No notes)'}</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Issue:</span>
                        <div className="text-sm dark:text-gray-100">{r.issue || 'None'}</div>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Repaired:</span>
                        <div className="text-sm dark:text-gray-100">{r.repaired || 'Not Fixed'}</div>
                      </div>
                    </div>
                    {r.notes && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Notes:</span>
                        <div className="text-sm text-gray-800 dark:text-gray-200">{r.notes}</div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-300 dark:border-gray-600">
                  <button
                    className="flex-1 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                    onClick={() => {
                      setEditId(r.id);
                      setEditingData({
                        date: r.date,
                        line: r.line,
                        head: r.head ?? '',
                        issue: r.head ? (r.issue || 'None') : '',
                        repaired: r.head ? (r.repaired || 'Not Fixed') : '',
                        notes: r.notes || ''
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="flex-1 px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-sm"
                    onClick={() => deleteEntry(r.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Head Entry Modal */}
      {showHeadModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-3 dark:text-gray-100">Add Head Entry</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Date</label>
                <input type="date" className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newHeadEntry.date}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, date: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Line</label>
                <select className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newHeadEntry.line}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, line: e.target.value }))}>
                  {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Head #</label>
                <input type="number" min="1" className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newHeadEntry.head}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, head: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Repaired</label>
                <select className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newHeadEntry.repaired}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, repaired: e.target.value }))}>
                  {REPAIRED_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Issue</label>
                <select className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newHeadEntry.issue}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, issue: e.target.value }))}>
                  {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Notes</label>
                <textarea rows={3} className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newHeadEntry.notes}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-200 rounded" onClick={() => setShowHeadModal(false)}>Cancel</button>
              <button className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded" onClick={submitHeadModal}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Machine Note Modal */}
      {showMachineModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-3 dark:text-gray-100">Add Machine Note</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Date</label>
                <input type="date" className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newMachineNote.date}
                  onChange={(e) => setNewMachineNote((s) => ({ ...s, date: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Line</label>
                <select className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newMachineNote.line}
                  onChange={(e) => setNewMachineNote((s) => ({ ...s, line: e.target.value }))}>
                  {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Notes</label>
                <textarea rows={4} className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={newMachineNote.notes}
                  onChange={(e) => setNewMachineNote((s) => ({ ...s, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-200 rounded" onClick={() => setShowMachineModal(false)}>Cancel</button>
              <button className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded" onClick={submitMachineModal}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editId && editingData && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-3 dark:text-gray-100">Edit Entry</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Date</label>
                <input
                  type="date"
                  className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={editingData.date}
                  onChange={(e) => setEditingData((s) => ({ ...s, date: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Line</label>
                <select
                  className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                  value={editingData.line}
                  onChange={(e) => setEditingData((s) => ({ ...s, line: e.target.value }))}
                >
                  {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>

              {editingData.head === '' ? (
                <>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 dark:text-gray-200">Notes</label>
                    <textarea
                      rows={4}
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                      value={editingData.notes}
                      onChange={(e) => setEditingData((s) => ({ ...s, notes: e.target.value }))}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-200">Head #</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                      value={editingData.head}
                      onChange={(e) => setEditingData((s) => ({ ...s, head: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-200">Repaired</label>
                    <select
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                      value={editingData.repaired}
                      onChange={(e) => setEditingData((s) => ({ ...s, repaired: e.target.value }))}
                    >
                      {REPAIRED_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 dark:text-gray-200">Issue</label>
                    <select
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                      value={editingData.issue}
                      onChange={(e) => setEditingData((s) => ({ ...s, issue: e.target.value }))}
                    >
                      {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 dark:text-gray-200">Notes</label>
                    <textarea
                      rows={3}
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1"
                      value={editingData.notes}
                      onChange={(e) => setEditingData((s) => ({ ...s, notes: e.target.value }))}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-200 rounded" onClick={cancelEdit}>Cancel</button>
              <button className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
