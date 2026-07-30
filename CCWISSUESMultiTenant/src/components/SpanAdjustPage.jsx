// src/components/SpanAdjustPage.jsx
//
// Span adjustment as its own screen, scoped to CUSTOMER → LINE rather than to a
// visit.
//
// Why it isn't inside a visit: a span adjustment is a recurring maintenance task
// on its own ~30-day clock, done by whoever is on shift. Nesting it under a visit
// meant an operator had to care which visit was open to record something that has
// nothing to do with a visit — and weights entered in one visit were invisible in
// the next, which is exactly when you want to see what the readings were last
// time.
//
// This screen keeps weights in local state seeded from the most recent LOG entry
// for the line, and writes only to the log. The log is therefore the single
// source of truth for span readings; there is no second copy to disagree with it.
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, ChevronLeft, Check, Trash2 } from 'lucide-react';
import {
  LOG_SPAN, subscribeLog, addLogEntry, updateLogEntry, deleteLogEntry,
  sinceLabel, dueStatus, addDays,
} from '../services/logs.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const LAST_LINE_KEY = 'ccw-span-last-line';

export default function SpanAdjustPage({
  workspaceId,
  customerId,
  customerName,
  visits = [],
  performedByName,
  role = 'jti',
}) {
  const toast = useToast();
  const dialog = useDialog();
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState(null);   // line title
  const [rows, setRows] = useState([]);             // [{head, currentWeight, spanWeight}]
  const [notes, setNotes] = useState('');
  const [intervalDays, setIntervalDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_SPAN, setEntries);
  }, [workspaceId, customerId]);

  // Lines come from the customer's visits — the only place a line definition
  // exists. Union across visits (newest first) so a line still appears even if
  // it wasn't touched on the most recent visit.
  const lines = useMemo(() => {
    const seen = new Map();
    [...visits]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .forEach((v) => {
        (v.lines || []).forEach((l) => {
          if (l?.title && !seen.has(l.title)) {
            seen.set(l.title, { title: l.title, heads: (l.heads || []).length, model: l.model || '' });
          }
        });
      });
    return [...seen.values()];
  }, [visits]);

  const latestFor = (title) => entries.find((e) => e.lineTitle === title) || null;

  // Restore the last line worked on — fewer taps on a plant floor. The header
  // always names the selected line so it can't be logged against by accident.
  useEffect(() => {
    if (selected || lines.length === 0) return;
    try {
      const saved = localStorage.getItem(LAST_LINE_KEY);
      if (saved && lines.some((l) => l.title === saved)) setSelected(saved);
    } catch { /* storage unavailable */ }
  }, [lines, selected]);

  // Seed the weight rows whenever the line changes: last logged readings if we
  // have them, otherwise a blank row per head.
  useEffect(() => {
    if (!selected) { setRows([]); return; }
    const line = lines.find((l) => l.title === selected);
    const last = latestFor(selected);
    const headCount = line?.heads || last?.heads?.length || 0;
    const next = Array.from({ length: headCount }, (_, i) => {
      const prev = last?.heads?.find((h) => Number(h.head) === i + 1);
      return {
        head: i + 1,
        // Current weight is what you measure TODAY — always start blank so a
        // stale reading can't be logged unchanged by accident.
        currentWeight: '',
        // Span (target) weight carries forward; it rarely changes between cycles.
        spanWeight: prev?.spanWeight ?? '',
      };
    });
    setRows(next);
    setNotes('');
    try { localStorage.setItem(LAST_LINE_KEY, selected); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, lines.length, entries.length]);

  const setRow = (idx, field, value) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const setAllSpan = (value) =>
    setRows((prev) => prev.map((r) => ({ ...r, spanWeight: value })));

  const save = async () => {
    if (!selected) return toast.error('Pick a line first');
    const measured = rows.filter((r) => String(r.currentWeight).trim() !== '');
    if (measured.length === 0) {
      return toast.error('Enter at least one current weight before logging');
    }
    setSaving(true);
    try {
      const heads = rows.map((r) => {
        const cw = Number(r.currentWeight) || 0;
        const sw = Number(r.spanWeight) || 0;
        return { head: r.head, currentWeight: cw, spanWeight: sw, difference: round1(sw - cw) };
      });
      const line = lines.find((l) => l.title === selected);
      await addLogEntry(workspaceId, customerId, LOG_SPAN, {
        lineTitle: selected,
        model: line?.model || '',
        performedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        role,
        notes: notes.trim(),
        heads,
        confirmed: false,
        intervalDays: intervalDays === '' ? null : Number(intervalDays),
        nextDueAt: intervalDays === '' ? null : addDays(null, Number(intervalDays)),
      });
      setNotes('');
      setRows((prev) => prev.map((r) => ({ ...r, currentWeight: '' })));
      toast.success(`Span adjustment logged for ${selected}`);
    } catch (err) {
      console.error('Span log save failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const confirmEntry = async (entry) => {
    try {
      await updateLogEntry(workspaceId, customerId, LOG_SPAN, entry.id, {
        confirmed: true,
        confirmedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        confirmedAt: new Date().toISOString(),
      });
      toast.success('Confirmed');
    } catch (err) {
      toast.error('Could not confirm: ' + (err?.message || 'unknown error'));
    }
  };

  const removeEntry = async (entry) => {
    const ok = await dialog.confirm(
      `Delete the span adjustment logged ${new Date(entry.performedAt).toLocaleString()}?`,
      { title: 'Delete log entry', confirmText: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    try {
      await deleteLogEntry(workspaceId, customerId, LOG_SPAN, entry.id);
      toast.success('Entry deleted');
    } catch (err) {
      toast.error('Could not delete: ' + (err?.message || 'unknown error'));
    }
  };

  if (!customerId) {
    return <div className="text-muted p-3">Select a customer to record span adjustments.</div>;
  }

  // ---- Overview: every line's due state at a glance -----------------------
  // The point of a schedule is noticing what's overdue without hunting line by
  // line, so overdue sorts to the top.
  if (!selected) {
    const overview = lines
      .map((l) => {
        const last = latestFor(l.title);
        return { ...l, last, due: dueStatus(last?.nextDueAt) };
      })
      .sort((a, b) => {
        const rank = { overdue: 0, due: 1, soon: 2, ok: 3, none: 4 };
        const d = rank[a.due.state] - rank[b.due.state];
        return d !== 0 ? d : a.title.localeCompare(b.title, undefined, { numeric: true });
      });

    return (
      <div>
        <h5 className="d-flex align-items-center gap-2 mb-3">
          <ClipboardCheck size={18} /> Span Adjustments{customerName ? ` — ${customerName}` : ''}
        </h5>
        {overview.length === 0 ? (
          <div className="text-muted">No lines found for this customer yet.</div>
        ) : (
          <div className="list-group">
            {overview.map((l) => (
              <button
                key={l.title}
                type="button"
                className="list-group-item list-group-item-action d-flex justify-content-between align-items-center flex-wrap gap-2"
                onClick={() => setSelected(l.title)}
              >
                <div className="text-start">
                  <div className="fw-semibold">{l.title}</div>
                  <div className="small text-muted">
                    {l.heads} heads · last {l.last ? sinceLabel(l.last.performedAt) : 'never'}
                  </div>
                </div>
                <span
                  className={
                    'badge ' +
                    (l.due.state === 'overdue' ? 'bg-danger'
                      : l.due.state === 'due' || l.due.state === 'soon' ? 'bg-warning text-dark'
                      : l.due.state === 'ok' ? 'bg-success'
                      : 'bg-secondary')
                  }
                >
                  {l.due.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- One line: enter weights and log ------------------------------------
  const last = latestFor(selected);
  const due = dueStatus(last?.nextDueAt);
  const lineEntries = entries.filter((e) => e.lineTitle === selected);

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSelected(null)}>
          <ChevronLeft size={16} /> All lines
        </button>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="small text-muted">Last: {last ? sinceLabel(last.performedAt) : 'never'}</span>
          {due.state !== 'none' && (
            <span
              className={
                'badge ' +
                (due.state === 'overdue' ? 'bg-danger'
                  : due.state === 'due' || due.state === 'soon' ? 'bg-warning text-dark'
                  : 'bg-success')
              }
            >
              {due.label}
            </span>
          )}
        </div>
      </div>

      <h5 className="mb-3">{selected}</h5>

      <div className="card mb-3">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
            <div className="input-group input-group-sm" style={{ width: 'auto' }}>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                className="form-control"
                style={{ maxWidth: '100px' }}
                placeholder="Span wt"
                onChange={(e) => setAllSpan(e.target.value)}
              />
              <span className="input-group-text">g</span>
              <span className="input-group-text">set all</span>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline-warning"
              onClick={() => setRows((prev) => prev.map((r) => ({ ...r, currentWeight: '' })))}
            >
              Clear current
            </button>
          </div>

          <div className="table-responsive">
            <table className="table table-sm mobile-cards mb-0">
              <thead>
                <tr>
                  <th>Head</th>
                  <th>Current</th>
                  <th>Span</th>
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const diff = round1((Number(r.spanWeight) || 0) - (Number(r.currentWeight) || 0));
                  const measured = String(r.currentWeight).trim() !== '';
                  return (
                    <tr key={r.head}>
                      <td data-label="Head"><strong>{r.head}</strong></td>
                      <td data-label="Current">
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          className="form-control form-control-sm"
                          value={r.currentWeight}
                          placeholder="—"
                          onChange={(e) => setRow(i, 'currentWeight', e.target.value)}
                        />
                      </td>
                      <td data-label="Span">
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          className="form-control form-control-sm"
                          value={r.spanWeight}
                          placeholder="—"
                          onChange={(e) => setRow(i, 'spanWeight', e.target.value)}
                        />
                      </td>
                      <td data-label="Diff">{measured ? diff.toFixed(1) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body d-flex flex-column gap-2">
          <input
            type="text"
            className="form-control"
            placeholder="Notes for this adjustment (optional)…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <label className="small text-muted mb-0" htmlFor="span-page-interval">Next one due in</label>
            <div className="input-group input-group-sm" style={{ width: 'auto' }}>
              <input
                id="span-page-interval"
                type="number"
                min="0"
                inputMode="numeric"
                className="form-control"
                style={{ maxWidth: '80px' }}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                placeholder="30"
              />
              <span className="input-group-text">days</span>
            </div>
            {intervalDays !== '' && (
              <span className="small text-muted">
                → {new Date(addDays(null, Number(intervalDays))).toLocaleDateString()}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : `Log span adjustment for ${selected}`}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <strong>History</strong>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Hide' : `Show (${lineEntries.length})`}
          </button>
        </div>
        {showHistory && (
          <div className="card-body">
            {lineEntries.length === 0 ? (
              <div className="text-muted small">Nothing logged for this line yet.</div>
            ) : (
              <div className="d-flex flex-column gap-2">
                {lineEntries.map((e) => (
                  <div key={e.id} className="border rounded p-2">
                    <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                      <div>
                        <div className="fw-semibold">
                          {new Date(e.performedAt).toLocaleString([], {
                            year: 'numeric', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </div>
                        <div className="small text-muted">
                          by {e.performedBy || 'Unknown'}{e.role === 'customer' ? ' (plant)' : ' (JTI)'}
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        {e.confirmed ? (
                          <span className="badge bg-success">✓ Confirmed</span>
                        ) : (
                          <button type="button" className="btn btn-sm btn-outline-success" onClick={() => confirmEntry(e)}>
                            <Check size={14} /> Confirm
                          </button>
                        )}
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeEntry(e)} aria-label="Delete entry">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {e.notes && <div className="small mt-1">{e.notes}</div>}
                    {e.nextDueAt && (
                      <div className="small text-muted mt-1">
                        Next due {new Date(e.nextDueAt).toLocaleDateString()}
                        {e.intervalDays ? ` (${e.intervalDays}-day cycle)` : ''}
                      </div>
                    )}
                    {Array.isArray(e.heads) && e.heads.length > 0 && (
                      <details className="mt-2">
                        <summary className="small text-muted" style={{ cursor: 'pointer' }}>
                          Weights ({e.heads.length} heads)
                        </summary>
                        <div className="table-responsive mt-1">
                          <table className="table table-sm mb-0">
                            <thead>
                              <tr><th>Head</th><th>Current</th><th>Span</th><th>Diff</th></tr>
                            </thead>
                            <tbody>
                              {e.heads.map((h) => (
                                <tr key={h.head}>
                                  <td>{h.head}</td>
                                  <td>{h.currentWeight}</td>
                                  <td>{h.spanWeight}</td>
                                  <td>{round1(h.difference).toFixed(1)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
