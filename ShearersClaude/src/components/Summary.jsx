import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { getDatabase, ref, get, update } from 'firebase/database';
import { app } from '../firebaseConfig';
import { useDates } from '../context/DatesContext';
import { useToast } from '../context/ToastContext';
import { canonicalString, firebaseKeyForEntry } from '../utils/historyKeys';
import useModalDismiss from '../utils/useModalDismiss';
import PhotoThumbs from './PhotoThumbs';

const database = getDatabase(app);

// History path (namespaced)
const HISTORY_PATH = 'jti-downtime/head-history';
const getHistoryRef = () => ref(database, HISTORY_PATH);

const isHeadDown = (h) => (String(h?.offline ?? '').toLowerCase() || 'active') !== 'active';

export default function Summary({ data }) {
  const { dates } = useDates();
  const toast = useToast();

  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [authReady, setAuthReady] = useState(false);
  const [dbError, setDbError] = useState('');
  const [viewMode, setViewMode] = useState(() => {
    // Default to cards on mobile, table on desktop
    return window.innerWidth <= 768 ? 'cards' : 'table';
  });

  // For Past Failures
  const [historyCounts, setHistoryCounts] = useState(new Map());
  const [historyList, setHistoryList] = useState([]); // full list for modal filtering
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalItems, setModalItems] = useState([]);

  const closeModal = useCallback(() => setModalOpen(false), []);
  useModalDismiss(modalOpen, closeModal);

  // Auth is handled at the app level (email/password login)
  useEffect(() => {
    setAuthReady(true);
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

  // Build rows for ALL available dates (running lines only)
  const rows = useMemo(() => {
    const result = [];
    // Get all dates from data, sorted newest to oldest
    const allDates = Object.keys(data || {}).sort((a, b) => new Date(b) - new Date(a));
    allDates.forEach((date) => {
      const dayData = data?.[date] || {};
      Object.keys(dayData).forEach((line) => {
        const entry = dayData[line] || {};
        const running = !!entry.running;

        if (running) {
          (entry.heads || []).filter(isHeadDown).forEach((h) => {
            // Handle new multi-issue format
            let issuesArray = [];
            if (Array.isArray(h.issues) && h.issues.length > 0) {
              issuesArray = h.issues;
            } else if (h.issue && h.issue !== 'None') {
              // Fallback for old single-issue format
              issuesArray = [{ type: h.issue, repaired: h.repaired || 'Not Fixed', replacementReason: '' }];
            }

            // If head is offline but has no issues, show as "Undetermined"
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
                _exportable: {
                  date,
                  line,
                  head: h.head,
                  issue: 'Undetermined',
                  repaired: 'Not Fixed',
                  notes: h.notes || ''
                },
              });
            } else {
              // Create one row per issue
              issuesArray.forEach((iss, idx) => {
                const issueDisplay = iss.type === 'WDU Replacement' && iss.replacementReason
                  ? `${iss.type} (${iss.replacementReason})`
                  : iss.type;

                const issuePhotos = (iss.photos || []).filter((ph) => ph && ph.url);
                result.push({
                  key: `${date}|${line}|${h.head}|${idx}|H`,
                  date,
                  line,
                  head: h.head,
                  issue: issueDisplay,
                  notes: h.notes || '',
                  repaired: iss.repaired || 'Not Fixed',
                  running: 'Yes',
                  photos: issuePhotos,
                  _exportable: {
                    ...(issuePhotos.length ? { photos: issuePhotos } : {}),
                    date,
                    line,
                    head: h.head,
                    issue: issueDisplay,
                    repaired: iss.repaired || 'Not Fixed',
                    notes: h.notes || ''
                  },
                });
              });
            }
          });
        }

        if (running && entry.machineNotes && entry.machineNotes.trim()) {
          const notePhotos = (entry.notePhotos || []).filter((ph) => ph && ph.url);
          result.push({
            photos: notePhotos,
            key: `${date}|${line}|MN|M`,
            date,
            line,
            head: '',
            issue: '',
            notes: entry.machineNotes.trim(),
            repaired: '',
            running: 'Yes',
            _exportable: {
              ...(notePhotos.length ? { photos: notePhotos } : {}),
              date, line, head: '', issue: '', repaired: '', notes: `Machine note: ${entry.machineNotes.trim()}`,
            },
          });
        }
      });
    });

    // Newest -> Oldest: the most recent work day is what you want at the top.
    result.sort((a, b) => {
      const d = new Date(b.date) - new Date(a.date);
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

  const selectAll = () => setSelectedKeys(new Set(rows.map((r) => r.key)));
  const clearSelection = () => setSelectedKeys(new Set());

  const exportToPDF = async () => {
    // Load the PDF libraries on demand so they're not in the initial bundle.
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF();
    doc.text('Downtime Summary', 14, 20);
    autoTable(doc, {
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

  // Add selected to head-history. Writes only the specific child keys via
  // update() so concurrent additions from other devices aren't clobbered
  // (the old read-whole-node + set-whole-node was last-write-wins).
  const addSelectedToHeadHistory = useCallback(async () => {
    const toAdd = rows
      .filter((r) => selectedKeys.has(r.key))
      .map((r) => r._exportable);

    if (!toAdd.length) {
      toast.info('No rows selected.');
      return;
    }

    try {
      const updates = {};
      toAdd.forEach((e) => {
        updates[firebaseKeyForEntry(e)] = e;
      });

      await update(getHistoryRef(), updates);
      toast.success(`Added ${toAdd.length} entr${toAdd.length === 1 ? 'y' : 'ies'} to Head History`);
      setDbError('');
    } catch (e) {
      console.warn('Add to Head History failed:', e);
      if (String(e?.message || '').toLowerCase().includes('permission')) {
        toast.error('Cannot write to Head History (permission denied).');
        setDbError('Cannot write to Head History (permission denied).');
      } else {
        toast.error('Failed to add to Head History: ' + e.message);
        setDbError('Failed to add to Head History.');
      }
    }
  }, [rows, selectedKeys, toast]);

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

  // Presentational status meta (color coding only — derived from existing fields)
  const statusMeta = (r) =>
    r.head === ''
      ? { label: 'Machine Note', pill: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300', tint: 'bg-yellow-50 dark:bg-yellow-900/15' }
      : r.issue && r.issue.includes('WDU Replacement')
      ? { label: 'WDU', pill: 'bg-purple-600 text-white', tint: 'bg-purple-50 dark:bg-purple-900/15' }
      : r.repaired === 'Fixed'
      ? { label: 'Fixed', pill: 'bg-orange-500 text-orange-950', tint: 'bg-orange-50 dark:bg-orange-900/15' }
      : { label: 'Offline', pill: 'bg-red-600 text-white', tint: 'bg-red-50 dark:bg-red-900/15' };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Summary</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Downtime across all dates · running lines only</p>
      </div>

      {dbError && (
        <div className="text-sm text-yellow-800 dark:text-yellow-200 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg px-3 py-2">
          {dbError}
        </div>
      )}

      {/* Controls */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="text"
            placeholder="Search rows…"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="field sm:max-w-xs"
          />
          <div className="flex gap-2 sm:ml-auto">
            <button onClick={exportToPDF} className="btn-secondary flex-1 sm:flex-none">Export PDF</button>
            <button onClick={addSelectedToHeadHistory} disabled={!authReady} className="btn-primary flex-1 sm:flex-none disabled:opacity-50">
              Add Selected to History
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={selectAll} className="btn-secondary !px-3 !py-2 text-sm">
            Select All ({rows.length})
          </button>
          <button onClick={clearSelection} className="btn-ghost !px-3 !py-2 text-sm">
            Clear Selection
          </button>
          {selectedKeys.size > 0 && (
            <span className="pill bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {selectedKeys.size} selected
            </span>
          )}

          {/* View Toggle — hidden on mobile; mobile always uses the card layout */}
          <div className="hidden md:inline-flex ml-auto rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden" role="group">
            <button
              onClick={() => setViewMode('table')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'table'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-4 py-2 text-sm font-medium border-l border-gray-300 dark:border-gray-600 transition-colors ${
                viewMode === 'cards'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Cards
            </button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-gray-500 dark:text-gray-400">No downtime entries found.</div>
      ) : (
        <>
        {viewMode === 'table' && (
        <div className="card p-0 hidden md:block overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/60">
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">
                  <input
                    type="checkbox"
                    checked={selectedKeys.size === rows.length && rows.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedKeys(new Set(rows.map(r => r.key)));
                      } else {
                        setSelectedKeys(new Set());
                      }
                    }}
                    title="Select All"
                  />
                </th>
                {['Status', 'Date', 'Line', 'Head', 'Issue', 'Notes', 'Repaired', 'Running', 'Photos', 'Past Failures'].map((c) => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const checked = selectedKeys.has(r.key);
                const meta = statusMeta(r);

                return (
                  <tr key={r.key} className={`${meta.tint} border-b border-gray-200/70 dark:border-gray-700`}>
                    <td className="px-3 py-2 text-center">
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
                    <td className="px-3 py-2"><span className={`pill ${meta.pill}`}>{meta.label}</span></td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {r.date}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200">{r.line}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200">{r.head || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200">{r.issue || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 max-w-xs whitespace-normal">{r.notes || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200">{r.repaired || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200">{r.running}</td>
                    <td className="px-3 py-2">
                      {r.photos && r.photos.length ? <PhotoThumbs photos={r.photos} /> : <span className="text-gray-400 text-sm">—</span>}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200">
                      {r.head ? (
                        (historyCounts.get(`${r.line}-Head ${r.head}`) || 0) > 0 ? (
                          <button
                            onClick={() => openPastFailures(r.line, r.head)}
                            className="pill bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60"
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
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4${viewMode === 'table' ? ' md:hidden' : ''}`}>
          {rows.map((r) => {
            const checked = selectedKeys.has(r.key);
            const meta = statusMeta(r);

            return (
              <div key={r.key} className={`card p-4 ${meta.tint}`}>
                <div className="flex items-start gap-3">
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
                    className="mt-1 h-5 w-5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`pill ${meta.pill}`}>{meta.label}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {r.date}
                      </span>
                    </div>
                    {r.photos && r.photos.length > 0 && (
                      <div className="mb-2"><PhotoThumbs photos={r.photos} size={48} /></div>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm text-gray-700 dark:text-gray-200">
                      <div>
                        <span className="font-semibold text-gray-500 dark:text-gray-400">Line:</span> {r.line}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-500 dark:text-gray-400">Head:</span> {r.head || '—'}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-500 dark:text-gray-400">Issue:</span> {r.issue || '—'}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-500 dark:text-gray-400">Running:</span> {r.running}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-500 dark:text-gray-400">Repaired:</span> {r.repaired || '—'}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-500 dark:text-gray-400">Past:</span>{' '}
                        {r.head ? (
                          (historyCounts.get(`${r.line}-Head ${r.head}`) || 0) > 0 ? (
                            <button
                              onClick={() => openPastFailures(r.line, r.head)}
                              className="pill bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60"
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
                      </div>
                      <div className="col-span-2">
                        <span className="font-semibold text-gray-500 dark:text-gray-400">Notes:</span> {r.notes || '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* Past Failures Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4" onClick={closeModal}>
          <div className="card shadow-xl max-w-2xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{modalTitle}</h3>
              <button onClick={() => setModalOpen(false)} className="btn-ghost !px-3 !py-2" aria-label="Close">✕</button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-auto">
              {modalItems.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No entries.</p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/60">
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Issue</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Repaired</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalItems.map((e, i) => (
                      <tr key={i} className="border-b border-gray-200/70 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200">
                        <td className="px-3 py-2">{e.date}</td>
                        <td className="px-3 py-2">{e.issue || 'None'}</td>
                        <td className="px-3 py-2">{e.repaired || 'Not Fixed'}</td>
                        <td className="px-3 py-2">{e.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-right">
              <button onClick={() => setModalOpen(false)} className="btn-primary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
