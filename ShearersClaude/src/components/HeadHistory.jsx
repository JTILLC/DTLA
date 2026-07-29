// src/components/HeadHistory.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import PhotoThumbs from './PhotoThumbs';
import { getDatabase, ref, get, update } from 'firebase/database';
import { app } from '../firebaseConfig';
import { firebaseKeyForEntry } from '../utils/historyKeys';
import { useToast } from '../context/ToastContext';

const database = getDatabase(app);

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

const isValidEntry = (e) => e && typeof e === 'object' && e.date && e.line && ('head' in e || e.notes);
const normalizeEntry = (e) => ({
  date: (e.date ?? '').trim(),
  line: (e.line ?? '').trim(),
  head: e.head === '' || e.head === undefined || e.head === null ? '' : String(e.head).trim(),
  issue: (e.issue ?? (e.head ? 'None' : '')).trim(),
  repaired: (e.repaired ?? (e.head ? 'Not Fixed' : '')).trim(),
  notes: (e.notes ?? '').trim(),
  // Preserve photos: this function rebuilds the entry from an explicit field
  // list, so anything not named here is silently dropped on read.
  ...(Array.isArray(e.photos) && e.photos.length ? { photos: e.photos.filter((p) => p && p.url) } : {})
});

export default function HeadHistory() {
  const toast = useToast();
  const [entries, setEntries] = useState({}); // { id: entry }
  // Last snapshot loaded from the cloud — used to compute a minimal diff on
  // Save so we only write changed/added/removed keys instead of overwriting
  // the whole node (which clobbered other devices' concurrent additions).
  const cloudBaselineRef = useRef({});
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
        if (!cancelled) setAuthReady(true);
      } catch (e) {
        console.warn('Auth check failed:', e);
        if (!cancelled) {
          setAuthReady(true);
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
            cloudBaselineRef.current = {};
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
          cloudBaselineRef.current = incoming;
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
          toast.error('No valid entries found in file.');
          e.target.value = '';
          return;
        }

        // merge into existing entries (non-destructive)
        setEntries((prev) => ({ ...prev, ...incoming }));
        toast.success(`Imported ${count} entries to local history (not yet saved to cloud).`);
      } catch (err) {
        toast.error('Import failed: ' + err.message);
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
  // Saves a minimal diff vs the last-loaded cloud snapshot: changed/added
  // entries are written, deleted entries are set to null. Untouched keys are
  // left alone, so concurrent additions from other devices aren't clobbered.
  const handleSaveToCloud = async () => {
    try {
      const baseline = cloudBaselineRef.current || {};
      const updates = {};

      // Added or changed
      for (const [id, e] of Object.entries(entries)) {
        if (!(id in baseline) || JSON.stringify(baseline[id]) !== JSON.stringify(e)) {
          updates[id] = e;
        }
      }
      // Deleted locally → remove from cloud
      for (const id of Object.keys(baseline)) {
        if (!(id in entries)) updates[id] = null;
      }

      const changeCount = Object.keys(updates).length;
      if (changeCount === 0) {
        toast.info('No changes to save.');
        return;
      }

      await update(getHistoryRef(), updates);
      cloudBaselineRef.current = { ...entries };
      toast.success(`Saved ${changeCount} change${changeCount === 1 ? '' : 's'} to cloud.`);
      setDbError('');
    } catch (e) {
      console.warn('Save to cloud failed:', e);
      setDbError('Save failed (permission/network).');
      toast.error('Save failed: ' + e.message);
    }
  };

  const handleRefreshFromCloud = async () => {
    if (!confirm('Load from cloud and replace the in-memory list? (This will NOT delete cloud data.)')) return;
    try {
      setLoading(true);
      const snap = await get(getHistoryRef());
      if (!snap.exists()) {
        setEntries({});
        cloudBaselineRef.current = {};
        toast.info('No cloud history found.');
        return;
      }
      const val = snap.val();
      const incoming = Array.isArray(val)
        ? Object.fromEntries(val.filter(Boolean).map((e) => [firebaseKeyForEntry(e), normalizeEntry(e)]))
        : Object.fromEntries(Object.entries(val || {}).map(([id, raw]) => [id, normalizeEntry(raw)]));
      setEntries(incoming);
      cloudBaselineRef.current = incoming;
      setDbError('');
      toast.success(`Loaded ${Object.keys(incoming).length} entries from cloud.`);
    } catch (e) {
      console.warn('Refresh failed:', e);
      setDbError('Refresh failed (permission/network).');
      toast.error('Refresh failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------- Add (modals) ----------
  const submitHeadModal = () => {
    const cleaned = normalizeEntry(newHeadEntry);
    if (!cleaned.date || !cleaned.line || !cleaned.head) {
      toast.error('Please fill Date, Line, and Head.');
      return;
    }
    const id = firebaseKeyForEntry(cleaned);
    setEntries((prev) => ({ ...prev, [id]: cleaned }));
    setShowHeadModal(false);
  };

  const submitMachineModal = () => {
    const cleaned = normalizeEntry({ ...newMachineNote, head: '' });
    if (!cleaned.date || !cleaned.line || !cleaned.notes) {
      toast.error('Please fill Date, Line, and Notes.');
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
        toast.error('Please fill Date, Line, and Notes for a machine note.');
      } else {
        toast.error('Please fill Date, Line, and Head.');
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
  const statusPill = (r, isMachineNote) => {
    if (isMachineNote) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    if (r.issue && r.issue.includes('WDU Replacement')) return 'bg-purple-600 text-white';
    if (r.repaired === 'Fixed') return 'bg-orange-500 text-orange-950';
    return 'bg-red-600 text-white';
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Head History</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track head issues and machine notes across visits</p>
      </div>

      {dbError && (
        <div className="text-sm text-yellow-800 dark:text-yellow-200 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg px-3 py-2">
          {dbError}
        </div>
      )}

      {/* Toolbar / actions */}
      <div className="card p-4 flex flex-wrap items-center gap-2">
        <button onClick={handleSaveToCloud} disabled={!authReady} className="btn-primary">Save to Cloud</button>
        <button onClick={handleRefreshFromCloud} className="btn-secondary">{loading ? 'Loading…' : 'Refresh from Cloud'}</button>
        <label htmlFor="import-json" className="btn-secondary cursor-pointer">Import JSON</label>
        <input id="import-json" type="file" accept=".json" hidden onChange={handleImport} />
        <button onClick={handleExport} className="btn-secondary">Export JSON</button>
        <button className="btn-secondary" onClick={() => setShowHeadModal(true)}>+ Add Head Entry</button>
        <button className="btn-secondary" onClick={() => setShowMachineModal(true)}>+ Add Machine Note</button>

        {/* Card/Table view toggle (segmented control) */}
        <div className="inline-flex p-0.5 rounded-lg bg-gray-100 dark:bg-gray-700 ml-auto">
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'table'
                ? 'bg-white dark:bg-gray-800 shadow-sm text-gray-900 dark:text-gray-100'
                : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'cards'
                ? 'bg-white dark:bg-gray-800 shadow-sm text-gray-900 dark:text-gray-100'
                : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            Cards
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <input
          type="text"
          placeholder="Search…"
          className="field"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="field w-auto"
            value={filters.date}
            onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))}
          />
          <select
            className="field w-auto"
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
            className="field w-24"
            value={filters.head}
            onChange={(e) => setFilters((f) => ({ ...f, head: e.target.value }))}
          />
          <select
            className="field w-auto"
            value={filters.issue}
            onChange={(e) => setFilters((f) => ({ ...f, issue: e.target.value }))}
          >
            <option value="">All Issues</option>
            {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <select
            className="field w-auto"
            value={filters.repaired}
            onChange={(e) => setFilters((f) => ({ ...f, repaired: e.target.value }))}
          >
            <option value="">Repaired: Any</option>
            {REPAIRED_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>

          <label className="flex items-center gap-2 ml-1">
            <input
              type="checkbox"
              checked={machineOnly}
              onChange={(e) => setMachineOnly(e.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">Machine notes only</span>
          </label>

          <button
            className="btn-ghost ml-auto"
            onClick={() => { setFilters({ date: '', line: '', head: '', issue: '', repaired: '' }); setGlobalSearch(''); setMachineOnly(false); }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Table or Cards */}
      {rows.length === 0 ? (
        <div className="card p-10 text-center text-gray-500 dark:text-gray-400">No history to display.</div>
      ) : viewMode === 'table' ? (
        <div className="card p-4 overflow-x-auto">
          <table className="w-full border-collapse min-w-max">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/60">
                {['Date','Line','Head','Issue','Repaired','Notes','Photos','Actions'].map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isMachineNote = (r.head ?? '') === '';
                return (
                  <tr key={r.id} className="border-b border-gray-200/70 dark:border-gray-700">
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">{r.line}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{isMachineNote ? '—' : r.head}</td>
                    <td className="px-3 py-2">
                      {isMachineNote ? (
                        <span className="pill bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">Machine Note</span>
                      ) : (
                        <span className={`pill ${statusPill(r, isMachineNote)}`}>{r.issue || 'None'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isMachineNote ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span className={`pill ${r.repaired === 'Fixed' ? 'bg-orange-500 text-orange-950' : 'bg-red-600 text-white'}`}>{r.repaired || 'Not Fixed'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-md whitespace-normal">{r.notes || (isMachineNote ? '(Machine Note)' : '—')}</td>
                    <td className="px-3 py-2">
                      {r.photos && r.photos.length ? <PhotoThumbs photos={r.photos} /> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          className="btn-secondary px-3 py-1.5 text-xs"
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
                          className="btn-danger px-3 py-1.5 text-xs"
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
            return (
              <div key={r.id} className="card p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-semibold text-lg text-gray-900 dark:text-gray-100">{r.date}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{r.line}</div>
                  </div>
                  {isMachineNote ? (
                    <span className="pill bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">Machine Note</span>
                  ) : (
                    <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">#{r.head}</div>
                  )}
                </div>

                {isMachineNote ? (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Machine Note:</div>
                    <div className="text-sm text-gray-800 dark:text-gray-200 italic">{r.notes || '(No notes)'}</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <span className={`pill ${statusPill(r, isMachineNote)}`}>{r.issue || 'None'}</span>
                      <span className={`pill ${r.repaired === 'Fixed' ? 'bg-orange-500 text-orange-950' : 'bg-red-600 text-white'}`}>{r.repaired || 'Not Fixed'}</span>
                    </div>
                    {r.notes && (
                      <div>
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Notes:</span>
                        <div className="text-sm text-gray-800 dark:text-gray-200">{r.notes}</div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <button
                    className="btn-secondary flex-1"
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
                    className="btn-danger flex-1"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4">
          <div className="card max-w-lg w-full p-4 space-y-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Head Entry</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Date</label>
                <input type="date" className="field"
                  value={newHeadEntry.date}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, date: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Line</label>
                <select className="field"
                  value={newHeadEntry.line}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, line: e.target.value }))}>
                  {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Head #</label>
                <input type="number" min="1" className="field"
                  value={newHeadEntry.head}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, head: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Repaired</label>
                <select className="field"
                  value={newHeadEntry.repaired}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, repaired: e.target.value }))}>
                  {REPAIRED_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Issue</label>
                <select className="field"
                  value={newHeadEntry.issue}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, issue: e.target.value }))}>
                  {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Notes</label>
                <textarea rows={3} className="field"
                  value={newHeadEntry.notes}
                  onChange={(e) => setNewHeadEntry((s) => ({ ...s, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setShowHeadModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={submitHeadModal}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Machine Note Modal */}
      {showMachineModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4">
          <div className="card max-w-lg w-full p-4 space-y-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Machine Note</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Date</label>
                <input type="date" className="field"
                  value={newMachineNote.date}
                  onChange={(e) => setNewMachineNote((s) => ({ ...s, date: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Line</label>
                <select className="field"
                  value={newMachineNote.line}
                  onChange={(e) => setNewMachineNote((s) => ({ ...s, line: e.target.value }))}>
                  {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Notes</label>
                <textarea rows={4} className="field"
                  value={newMachineNote.notes}
                  onChange={(e) => setNewMachineNote((s) => ({ ...s, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setShowMachineModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={submitMachineModal}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editId && editingData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4">
          <div className="card max-w-lg w-full p-4 space-y-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit Entry</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Date</label>
                <input
                  type="date"
                  className="field"
                  value={editingData.date}
                  onChange={(e) => setEditingData((s) => ({ ...s, date: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Line</label>
                <select
                  className="field"
                  value={editingData.line}
                  onChange={(e) => setEditingData((s) => ({ ...s, line: e.target.value }))}
                >
                  {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>

              {editingData.head === '' ? (
                <>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Notes</label>
                    <textarea
                      rows={4}
                      className="field"
                      value={editingData.notes}
                      onChange={(e) => setEditingData((s) => ({ ...s, notes: e.target.value }))}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Head #</label>
                    <input
                      type="number"
                      min="1"
                      className="field"
                      value={editingData.head}
                      onChange={(e) => setEditingData((s) => ({ ...s, head: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Repaired</label>
                    <select
                      className="field"
                      value={editingData.repaired}
                      onChange={(e) => setEditingData((s) => ({ ...s, repaired: e.target.value }))}
                    >
                      {REPAIRED_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Issue</label>
                    <select
                      className="field"
                      value={editingData.issue}
                      onChange={(e) => setEditingData((s) => ({ ...s, issue: e.target.value }))}
                    >
                      {ISSUE_TYPES.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-200">Notes</label>
                    <textarea
                      rows={3}
                      className="field"
                      value={editingData.notes}
                      onChange={(e) => setEditingData((s) => ({ ...s, notes: e.target.value }))}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
              <button className="btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
