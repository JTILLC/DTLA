// src/components/SpanAdjustPage.jsx
//
// Span adjustment log for the Shearers plant.
//
// Shearers heads carry no weight fields — this app logs downtime, not
// calibration — so the readings live entirely in the log rather than on the
// line. That turns out to be the right shape anyway: a span adjustment is a
// recurring task on its own ~30-day clock, not part of a day's downtime record.
//
// Stored at jti-downtime/span-log. That node inherits the parent's
// `auth != null` rule with no public-read carve-out, so unlike the logger data
// it is NOT visible in the customer's shared view — which matches "just me for
// now".
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDatabase, ref, onValue, update, remove as rtdbRemove } from 'firebase/database';
import { app } from '../firebaseConfig';
import { HEADS_PER_LINE, SECTIONS } from '../constants';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { withEditStamp, editSummary } from '@shared/utils/editTrail.js';
import WeightScanner from './WeightScanner';

const database = getDatabase(app);
const SPAN_PATH = 'jti-downtime/span-log';
const LAST_LINE_KEY = 'shearersSpanLastLine';

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

const sinceLabel = (iso) => {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (Number.isNaN(days)) return 'unknown';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const m = Math.floor(days / 30);
  return m === 1 ? '1 month ago' : `${m} months ago`;
};

// Whole-day comparison so "due today" doesn't flip to overdue at lunchtime.
const dueStatus = (iso) => {
  if (!iso) return { state: 'none', label: 'Not scheduled' };
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return { state: 'none', label: 'Not scheduled' };
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(due); d.setHours(0, 0, 0, 0);
  const days = Math.round((d - t) / 86400000);
  if (days < 0) return { state: 'overdue', label: `Overdue ${-days}d` };
  if (days === 0) return { state: 'due', label: 'Due today' };
  if (days <= 7) return { state: 'soon', label: `Due in ${days}d` };
  return { state: 'ok', label: `Due ${new Date(due).toLocaleDateString()}` };
};

const ALL_LINES = SECTIONS.flatMap((s) => s.lines);

export default function SpanAdjustPage() {
  const toast = useToast();
  // The login is the identity here — each person signs in as themselves.
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState(null);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState('');
  const [intervalDays, setIntervalDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  // Heads whose current weight came from a photo rather than a keypress.
  // Marked in the list so an operator knows which to sanity-check, and
  // cleared the moment one is typed over.
  const [scanned, setScanned] = useState(() => new Set());
  // Bumped after each successful log. Together with the line title it keys the
  // scanner, so the retained photo is dropped once it has served its purpose
  // rather than following you to the next line.
  const [logSeq, setLogSeq] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const r = ref(database, SPAN_PATH);
    const unsub = onValue(r, (snap) => {
      const val = snap.val() || {};
      const list = Object.entries(val).map(([id, e]) => ({ id, ...e }));
      list.sort((a, b) => new Date(b.performedAt || 0) - new Date(a.performedAt || 0));
      setEntries(list);
    }, (err) => console.error('span-log read failed:', err));
    return () => unsub();
  }, []);

  const latestFor = (line) => entries.find((e) => e.lineTitle === line) || null;

  // Runs at most ONCE. Without the ref guard, pressing "All lines" (which sets
  // selected to null) re-runs this and immediately re-selects the saved line,
  // making the overview unreachable.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || selected) return;
    restoredRef.current = true;
    try {
      const saved = localStorage.getItem(LAST_LINE_KEY);
      if (saved && ALL_LINES.includes(saved)) setSelected(saved);
    } catch { /* storage unavailable */ }
  }, [selected]);

  // Span weights carry forward from the last adjustment; current weights always
  // start blank so a stale reading can't be re-logged unchanged.
  useEffect(() => {
    if (!selected) { setRows([]); return; }
    const last = latestFor(selected);
    setRows(Array.from({ length: HEADS_PER_LINE }, (_, i) => {
      const prev = last?.heads?.find((h) => Number(h.head) === i + 1);
      return { head: i + 1, currentWeight: '', spanWeight: prev?.spanWeight ?? '' };
    }));
    setNotes('');
    setScanned(new Set());
    try { localStorage.setItem(LAST_LINE_KEY, selected); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, entries.length]);

  const setRow = (i, field, value) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const clearCurrent = () => {
    setRows((prev) => prev.map((r) => ({ ...r, currentWeight: '' })));
    setScanned(new Set());
  };

  // A scan fills the fields; it does not log anything. Heads the reader
  // couldn't make out keep whatever is already in them, so a partial scan
  // tops up a partly-typed column instead of wiping it.
  const applyScan = (byHead) => {
    setRows((prev) => prev.map((r) => (
      byHead.has(r.head) ? { ...r, currentWeight: String(byHead.get(r.head)) } : r
    )));
    setScanned(new Set(byHead.keys()));
  };

  const save = async () => {
    if (!selected) return toast.error('Pick a line first');
    if (rows.every((r) => String(r.currentWeight).trim() === '')) {
      return toast.error('Enter at least one current weight');
    }
    setSaving(true);
    try {
      const id = `span_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const performedAt = new Date().toISOString();
      const nextDueAt = intervalDays === ''
        ? null
        : new Date(Date.now() + Number(intervalDays) * 86400000).toISOString();
      const heads = rows.map((r) => {
        const cw = Number(r.currentWeight) || 0;
        const sw = Number(r.spanWeight) || 0;
        return { head: r.head, currentWeight: cw, spanWeight: sw, difference: round1(sw - cw) };
      });
      // update() with a child key rather than set() on the parent, so a write
      // can never clobber the rest of the log.
      await update(ref(database, SPAN_PATH), {
        [id]: {
          performedAt,
          lineTitle: selected,
          heads,
          notes: notes.trim(),
          intervalDays: intervalDays === '' ? null : Number(intervalDays),
          nextDueAt,
        },
      });
      clearCurrent();
      setLogSeq((n) => n + 1);
      setNotes('');
      toast.success(`Span adjustment logged for ${selected}`);
    } catch (err) {
      console.error('span log save failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Weights get mistyped. Correcting one keeps when the adjustment was actually
  // performed; deleting and re-logging would not.
  const openEdit = (entry) => setEditing({
    id: entry.id,
    entry,
    notes: entry.notes || '',
    heads: (entry.heads || []).map((h) => ({
      head: h.head, currentWeight: h.currentWeight ?? '', spanWeight: h.spanWeight ?? '',
    })),
  });

  const saveEdit = async () => {
    if (!editing) return;
    if (!window.confirm('Save changes to this entry? The change is recorded against you.')) return;
    try {
      const heads = editing.heads.map((r) => {
        const cw = Number(r.currentWeight) || 0;
        const sw = Number(r.spanWeight) || 0;
        return { head: r.head, currentWeight: cw, spanWeight: sw, difference: round1(sw - cw) };
      });
      await update(ref(database, `${SPAN_PATH}/${editing.id}`), withEditStamp(
        { heads, notes: editing.notes.trim() }, editing.entry, user?.email || ''
      ));
      toast.success('Entry updated');
      setEditing(null);
    } catch (err) {
      console.error('span edit failed:', err);
      toast.error('Could not update: ' + (err?.message || 'unknown error'));
    }
  };

  const removeEntry = async (entry) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete the span adjustment logged ${new Date(entry.performedAt).toLocaleDateString()}?`)) return;
    try {
      await rtdbRemove(ref(database, `${SPAN_PATH}/${entry.id}`));
      toast.success('Entry deleted');
    } catch (err) {
      toast.error('Could not delete: ' + (err?.message || 'unknown error'));
    }
  };

  // ---- Overview -----------------------------------------------------------
  const overview = useMemo(() => {
    // Only lines that have ever been adjusted, plus a picker for the rest —
    // 39 lines with "never" against each would be noise.
    const withHistory = ALL_LINES
      .map((line) => ({ line, last: latestFor(line) }))
      .filter((x) => x.last)
      .map((x) => ({ ...x, due: dueStatus(x.last.nextDueAt) }));
    const rank = { overdue: 0, due: 1, soon: 2, ok: 3, none: 4 };
    withHistory.sort((a, b) => {
      const d = rank[a.due.state] - rank[b.due.state];
      return d !== 0 ? d : a.line.localeCompare(b.line, undefined, { numeric: true });
    });
    return withHistory;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  if (!selected) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold dark:text-gray-100">Span Adjustments</h2>

        <div className="card p-4">
          <label className="block text-sm font-semibold mb-1 dark:text-gray-200" htmlFor="span-line">
            Pick a line
          </label>
          <select
            id="span-line"
            className="field w-full"
            value=""
            onChange={(e) => e.target.value && setSelected(e.target.value)}
          >
            <option value="">Select a line…</option>
            {ALL_LINES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        {overview.length > 0 && (
          <div className="card p-4">
            <h3 className="font-semibold mb-2 dark:text-gray-100">Previously adjusted</h3>
            <div className="space-y-2">
              {overview.map(({ line, last, due }) => (
                <button
                  key={line}
                  type="button"
                  onClick={() => setSelected(line)}
                  className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-600 p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <div>
                    <div className="font-semibold dark:text-gray-100">{line}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      last {sinceLabel(last.performedAt)}
                    </div>
                  </div>
                  <span
                    className={
                      'pill ' +
                      (due.state === 'overdue' ? 'bg-red-600 text-white'
                        : due.state === 'due' || due.state === 'soon' ? 'bg-orange-500 text-orange-950'
                        : due.state === 'ok' ? 'bg-green-600 text-white'
                        : 'bg-gray-400 text-white')
                    }
                  >
                    {due.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- One line -----------------------------------------------------------
  const last = latestFor(selected);
  const due = dueStatus(last?.nextDueAt);
  const lineEntries = entries.filter((e) => e.lineTitle === selected);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
          ← All lines
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            last {last ? sinceLabel(last.performedAt) : 'never'}
          </span>
          {due.state !== 'none' && (
            <span
              className={
                'pill ' +
                (due.state === 'overdue' ? 'bg-red-600 text-white'
                  : due.state === 'due' || due.state === 'soon' ? 'bg-orange-500 text-orange-950'
                  : 'bg-green-600 text-white')
              }
            >
              {due.label}
            </span>
          )}
        </div>
      </div>

      <h2 className="text-xl font-bold dark:text-gray-100">{selected}</h2>

      <div className="card p-4">
        <WeightScanner key={`${selected}-${logSeq}`} expectedHeads={rows.length} onApply={applyScan} />

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="number"
            step="any"
            inputMode="decimal"
            className="field w-28"
            placeholder="Span wt"
            onChange={(e) => setRows((prev) => prev.map((r) => ({ ...r, spanWeight: e.target.value })))}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">set all span weights</span>
          <button
            type="button"
            className="btn-secondary ml-auto"
            onClick={clearCurrent}
          >
            Clear current
          </button>
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => {
            const measured = String(r.currentWeight).trim() !== '';
            const diff = round1((Number(r.spanWeight) || 0) - (Number(r.currentWeight) || 0));
            return (
              <div key={r.head} className="flex items-center gap-2">
                <span className="w-10 shrink-0 font-bold dark:text-gray-100">{r.head}</span>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  className={'field flex-1 min-w-0' + (scanned.has(r.head) ? ' ring-2 ring-indigo-500' : '')}
                  placeholder="current"
                  value={r.currentWeight}
                  title={scanned.has(r.head) ? 'Read from the scanned photo — check it' : undefined}
                  onChange={(e) => {
                    setRow(i, 'currentWeight', e.target.value);
                    // Typed over: it's the operator's number now.
                    if (scanned.has(r.head)) {
                      setScanned((prev) => {
                        const next = new Set(prev);
                        next.delete(r.head);
                        return next;
                      });
                    }
                  }}
                />
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  className="field flex-1 min-w-0"
                  placeholder="span"
                  value={r.spanWeight}
                  onChange={(e) => setRow(i, 'spanWeight', e.target.value)}
                />
                <span className={'w-14 shrink-0 text-right text-sm ' + (measured ? 'dark:text-gray-100' : 'text-gray-400')}>
                  {measured ? diff.toFixed(1) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-4 space-y-2">
        <input
          type="text"
          className="field w-full"
          placeholder="Notes (optional)…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm text-gray-500 dark:text-gray-400" htmlFor="span-interval">Next due in</label>
          <input
            id="span-interval"
            type="number"
            min="0"
            inputMode="numeric"
            className="field w-20"
            value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)}
          />
          <span className="text-sm text-gray-500 dark:text-gray-400">days</span>
        </div>
        <button type="button" className="btn-primary w-full" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : `Log span adjustment for ${selected}`}
        </button>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold dark:text-gray-100">History ({lineEntries.length})</h3>
          <button type="button" className="btn-ghost" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Hide' : 'Show'}
          </button>
        </div>
        {showHistory && (
          lineEntries.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Nothing logged for this line yet.</p>
          ) : (
            <div className="space-y-2 mt-2">
              {lineEntries.map((e) => (
                <div key={e.id} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3">
                  <div className="flex justify-between items-start gap-2 flex-wrap">
                    <div>
                      <div className="font-semibold dark:text-gray-100">
                        {new Date(e.performedAt).toLocaleString([], {
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                      {e.nextDueAt && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          next due {new Date(e.nextDueAt).toLocaleDateString()}
                          {e.intervalDays ? ` (${e.intervalDays}-day cycle)` : ''}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" className="btn-secondary" onClick={() => openEdit(e)}>Edit</button>
                      <button type="button" className="btn-danger !px-3 !py-1.5" onClick={() => removeEntry(e)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  {editSummary(e) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">✎ {editSummary(e)}</p>
                  )}
                  {editing?.id === e.id && (
                    <div className="border border-gray-200 dark:border-gray-700 rounded p-2 mt-2">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        Correcting this entry. When it was performed is kept; the
                        change is recorded separately.
                      </p>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {editing.heads.map((r, i) => (
                          <div key={r.head} className="flex items-center gap-2">
                            <span className="w-8 shrink-0 text-sm dark:text-gray-100">{r.head}</span>
                            <input
                              type="number" step="any" inputMode="decimal"
                              className="field flex-1 min-w-0" placeholder="current"
                              value={r.currentWeight}
                              onChange={(ev) => setEditing((d) => ({
                                ...d,
                                heads: d.heads.map((x, j) => (j === i ? { ...x, currentWeight: ev.target.value } : x)),
                              }))}
                            />
                            <input
                              type="number" step="any" inputMode="decimal"
                              className="field flex-1 min-w-0" placeholder="span"
                              value={r.spanWeight}
                              onChange={(ev) => setEditing((d) => ({
                                ...d,
                                heads: d.heads.map((x, j) => (j === i ? { ...x, spanWeight: ev.target.value } : x)),
                              }))}
                            />
                          </div>
                        ))}
                      </div>
                      <input
                        type="text" className="field w-full mt-2" placeholder="Notes"
                        value={editing.notes}
                        onChange={(ev) => setEditing((d) => ({ ...d, notes: ev.target.value }))}
                      />
                      <div className="flex gap-2 mt-2">
                        <button type="button" className="btn-primary" onClick={saveEdit}>Save changes</button>
                        <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {e.notes && <p className="text-sm mt-1 dark:text-gray-200">{e.notes}</p>}
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
                      Weights ({(e.heads || []).length} heads)
                    </summary>
                    <div className="mt-1 text-sm dark:text-gray-200">
                      {(e.heads || []).map((h) => (
                        <div key={h.head} className="flex justify-between border-b border-gray-100 dark:border-gray-700 py-0.5">
                          <span>Head {h.head}</span>
                          <span>{h.currentWeight} / {h.spanWeight}</span>
                          <span className="w-14 text-right">{round1(h.difference).toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
