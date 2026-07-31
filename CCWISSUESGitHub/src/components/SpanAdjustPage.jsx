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
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, ChevronLeft, Check, Trash2 } from 'lucide-react';
import {
  LOG_SPAN, subscribeLog, addLogEntry, updateLogEntry, deleteLogEntry,
  sinceLabel, dueStatus, addDays,
} from '../services/logs.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';
import WeightScanner from './WeightScanner.jsx';
import CrewLine from './CrewLine.jsx';
import CrewChip from './CrewChip.jsx';
import PinPrompt from './PinPrompt.jsx';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import { subscribeCrew } from '../services/logs.js';
import { useLineCrew, crewStamp } from '../utils/useLineCrew.js';

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
  const lineCrew = useLineCrew(workspaceId, customerId);
  // Crewing says who was ON the line; this says who actually filed the entry.
  // An entry logged at 2am otherwise inherits whoever was crewed at 6am.
  const { person: actor, remember: rememberActor } = useVerifiedPerson(customerId);
  const [crewPeople, setCrewPeople] = useState([]);
  const [pendingSave, setPendingSave] = useState(null);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeCrew(workspaceId, customerId, setCrewPeople);
  }, [workspaceId, customerId]);

  // A plant that has not set PINs keeps logging, unattributed. This records who
  // filed something; it must never become a lock on recording work at all.
  const withActor = (run) => {
    const anyPin = crewPeople.some((p) => p.pinHash);
    if (actor || !anyPin) return run(actor?.name || '');
    setPendingSave(() => run);
  };
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState(null);   // line title
  const [rows, setRows] = useState([]);             // [{head, currentWeight, spanWeight}]
  const [notes, setNotes] = useState('');
  const [intervalDays, setIntervalDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Heads whose current weight came from a photo rather than a keypress. Marked
  // in the table so an operator knows which numbers to sanity-check, and cleared
  // the moment one is typed over.
  const [scanned, setScanned] = useState(() => new Set());
  // Bumped after each successful log. Together with the line title it keys the
  // scanner, so the retained photo is dropped once it has served its purpose
  // rather than following you to the next line.
  const [logSeq, setLogSeq] = useState(0);

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
  // Runs at most ONCE. `selected` has to stay in the deps for the initial
  // restore to fire after lines load, but without the ref guard, pressing
  // "All lines" (which sets selected to null) re-runs this and immediately
  // re-selects the saved line — making the overview unreachable.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || selected || lines.length === 0) return;
    restoredRef.current = true;
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
    setScanned(new Set());
    try { localStorage.setItem(LAST_LINE_KEY, selected); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, lines.length, entries.length]);

  const setRow = (idx, field, value) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const setAllSpan = (value) =>
    setRows((prev) => prev.map((r) => ({ ...r, spanWeight: value })));

  const clearCurrent = () => {
    setRows((prev) => prev.map((r) => ({ ...r, currentWeight: '' })));
    setScanned(new Set());
  };

  // A scan fills the fields; it does not log anything. Heads the reader couldn't
  // make out keep whatever is already in them, so a partial scan tops up a
  // partly-typed column instead of wiping it.
  const applyScan = (byHead) => {
    setRows((prev) => prev.map((r) => (
      byHead.has(r.head) ? { ...r, currentWeight: String(byHead.get(r.head)) } : r
    )));
    setScanned(new Set(byHead.keys()));
  };

  const save = () => withActor(async (filedBy) => {
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
        ...crewStamp(lineCrew.forLine(selected), lineCrew.shiftId),
        // Who filed it, proven — distinct from the crew, which is context.
        actionBy: filedBy,
        actionByVerified: !!filedBy,
        notes: notes.trim(),
        heads,
        confirmed: false,
        intervalDays: intervalDays === '' ? null : Number(intervalDays),
        nextDueAt: intervalDays === '' ? null : addDays(null, Number(intervalDays)),
      });
      setNotes('');
      clearCurrent();
      setLogSeq((n) => n + 1);
      toast.success(`Span adjustment logged for ${selected}`);
    } catch (err) {
      console.error('Span log save failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  });

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
              onClick={clearCurrent}
            >
              Clear current
            </button>
          </div>

          <WeightScanner key={`${selected}-${logSeq}`} expectedHeads={rows.length} onApply={applyScan} />

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
                          className={'form-control form-control-sm' + (scanned.has(r.head) ? ' border-primary' : '')}
                          value={r.currentWeight}
                          placeholder="—"
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
          <CrewChip lineCrew={lineCrew} lineTitle={selected} />
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
                        <CrewLine entry={e} />
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
      {pendingSave && (
        <PinPrompt
          customerId={customerId}
          people={crewPeople}
          title="Who is logging this?"
          message="The entry is recorded against you."
          onVerified={(p) => {
            rememberActor(p);
            const run = pendingSave;
            setPendingSave(null);
            run(p.name);
          }}
          onCancel={() => setPendingSave(null)}
        />
      )}

      {dialog.DialogComponent}
    </div>
  );
}
