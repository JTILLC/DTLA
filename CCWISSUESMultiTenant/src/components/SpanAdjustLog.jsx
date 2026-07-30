// src/components/SpanAdjustLog.jsx
//
// Records that a span adjustment was performed on a line: when, by whom, the
// weight readings at that moment, and a separate confirmation step.
//
// The weights are SNAPSHOTTED into the log entry rather than referenced. The
// live line keeps being edited — weights get cleared, heads change — so a
// pointer would show today's numbers against a months-old adjustment. The whole
// point of the log is what the readings were when the work was done.
//
// Same component serves the original app and the customer fork; `role` marks
// who performed it so the history distinguishes JTI from plant staff.
import { useEffect, useState } from 'react';
import { ClipboardCheck, Check, Trash2 } from 'lucide-react';
import {
  LOG_SPAN, subscribeLog, addLogEntry, updateLogEntry, deleteLogEntry,
  sinceLabel, dueStatus, addDays,
} from '../services/logs.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';

export default function SpanAdjustLog({
  workspaceId,
  customerId,
  line,
  performedByName,
  role = 'jti',          // 'jti' | 'customer'
  readOnly = false,
  visitId = null,
}) {
  const toast = useToast();
  const dialog = useDialog();
  const [entries, setEntries] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState(false);
  // Days until the next adjustment is due. 30 is the normal cycle; a blank
  // value means "don't schedule one".
  const [intervalDays, setIntervalDays] = useState('30');

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_SPAN, setEntries);
  }, [workspaceId, customerId]);

  // Only this line's adjustments — a plant has dozens of lines and mixing them
  // would make "when was this last done" unanswerable.
  const lineEntries = entries.filter((e) => e.lineTitle === line?.title);
  const last = lineEntries[0] || null;
  // The schedule lives on the newest entry for this line.
  const due = dueStatus(last?.nextDueAt);

  const save = async () => {
    if (!customerId) return toast.error('Select a customer first');
    const heads = (line?.heads || []).map((h, i) => ({
      head: h.id || i + 1,
      currentWeight: Number(h.currentWeight) || 0,
      spanWeight: Number(h.spanWeight) || 0,
      // Round again on the way in: entries written before the source fix, or
      // imported data, can still carry float noise.
      difference: Math.round((Number(h.weightDifference) || 0) * 10) / 10,
    }));
    if (!heads.length) return toast.error('This line has no heads to record');

    setSaving(true);
    try {
      await addLogEntry(workspaceId, customerId, LOG_SPAN, {
        lineTitle: line?.title || '',
        lineId: line?.id ?? null,
        model: line?.model || '',
        serialNumber: line?.serialNumber || '',
        targetWeight: line?.targetWeight || '',
        spanCalWeight: line?.spanCalWeight || '',
        performedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        role,
        visitId,
        notes: notes.trim(),
        heads,
        confirmed: false,
        intervalDays: intervalDays === '' ? null : Number(intervalDays),
        nextDueAt: intervalDays === '' ? null : addDays(null, Number(intervalDays)),
      });
      setNotes('');
      toast.success('Span adjustment logged');
    } catch (err) {
      console.error('Span log save failed:', err);
      toast.error('Could not save to the log: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const confirm = async (entry) => {
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

  const remove = async (entry) => {
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

  return (
    <div className="card mt-3">
      <div className="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div className="d-flex align-items-center gap-2">
          <ClipboardCheck size={16} />
          <strong>Span Adjustment Log</strong>
          <span className="badge bg-secondary">{lineEntries.length}</span>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="small text-muted">
            Last: {last ? sinceLabel(last.performedAt) : 'never'}
          </span>
          {due.state !== 'none' && (
            <span
              className={
                'badge ' +
                (due.state === 'overdue' ? 'bg-danger'
                  : due.state === 'due' ? 'bg-warning text-dark'
                  : due.state === 'soon' ? 'bg-warning text-dark'
                  : 'bg-success')
              }
              title={last?.nextDueAt ? `Next due ${new Date(last.nextDueAt).toLocaleDateString()}` : ''}
            >
              {due.label}
            </span>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'History'}
          </button>
        </div>
      </div>

      <div className="card-body">
        {!readOnly && (
          <div className="d-flex flex-column gap-2 mb-2">
            <input
              type="text"
              className="form-control"
              placeholder="Notes for this adjustment (optional)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <label className="small text-muted mb-0" htmlFor={`span-interval-${line?.id}`}>
                Next one due in
              </label>
              <div className="input-group input-group-sm" style={{ width: 'auto' }}>
                <input
                  id={`span-interval-${line?.id}`}
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
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !customerId}
            >
              {saving ? 'Saving…' : 'Log span adjustment for this line'}
            </button>
            <small className="text-muted">
              Records today&apos;s date, who performed it, and the current/span weights
              for all {line?.heads?.length || 0} heads exactly as they are now.
            </small>
          </div>
        )}

        {open && (
          lineEntries.length === 0 ? (
            <div className="text-muted small">No span adjustments logged for this line yet.</div>
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
                        by {e.performedBy || 'Unknown'}
                        {e.role === 'customer' ? ' (plant)' : ' (JTI)'}
                      </div>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      {e.confirmed ? (
                        <span className="badge bg-success" title={`Confirmed by ${e.confirmedBy || 'unknown'}`}>
                          ✓ Confirmed
                        </span>
                      ) : (
                        !readOnly && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-success"
                            onClick={() => confirm(e)}
                          >
                            <Check size={14} /> Confirm
                          </button>
                        )
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => remove(e)}
                          aria-label="Delete entry"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {e.notes && <div className="small mt-1">{e.notes}</div>}
                  {e.nextDueAt && (
                    <div className="small text-muted mt-1">
                      Next due {new Date(e.nextDueAt).toLocaleDateString()}
                      {e.intervalDays ? ` (${e.intervalDays}-day cycle)` : ''}
                    </div>
                  )}

                  {/* Weights as they were at the time of the adjustment. */}
                  {Array.isArray(e.heads) && e.heads.length > 0 && (
                    <details className="mt-2">
                      <summary className="small text-muted" style={{ cursor: 'pointer' }}>
                        Weights recorded ({e.heads.length} heads)
                      </summary>
                      <div className="table-responsive mt-1">
                        <table className="table table-sm mb-0">
                          <thead>
                            <tr>
                              <th>Head</th>
                              <th>Current</th>
                              <th>Span</th>
                              <th>Diff</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.heads.map((h) => (
                              <tr key={h.head}>
                                <td>{h.head}</td>
                                <td>{h.currentWeight}</td>
                                <td>{h.spanWeight}</td>
                                <td>{(Math.round((Number(h.difference) || 0) * 10) / 10).toFixed(1)}</td>
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
          )
        )}
      </div>
    </div>
  );
}
