// src/components/MaintenanceLogs.jsx
//
// Read-only view of the customer-level maintenance logs for the share link:
// span adjustments, circuit board replacements, and PM submissions.
//
// These live under the customer rather than inside a visit, because the useful
// question is "when was this last done", which spans visits. The viewer reads
// the same collections the field apps write, so nothing is duplicated.
import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../services/firebase';

const SECTIONS = [
  { key: 'spanLog', title: 'Span Adjustments', empty: 'No span adjustments recorded yet.' },
  { key: 'boardLog', title: 'Parts / Board Replacements', empty: 'No board replacements recorded yet.' },
  { key: 'pmLog', title: 'Preventative Maintenance', empty: 'No PM checks submitted yet.' },
];

const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString([], {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—';

// Mirrors dueStatus in the field apps' services/logs.js. Whole-day comparison
// so "due today" doesn't flip to overdue partway through the day.
const dueStatus = (iso) => {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(due); d.setHours(0, 0, 0, 0);
  const days = Math.round((d - t) / 86400000);
  if (days < 0) return { cls: 'bg-danger', label: `Overdue by ${-days} day${days === -1 ? '' : 's'}` };
  if (days === 0) return { cls: 'bg-warning text-dark', label: 'Due today' };
  if (days <= 7) return { cls: 'bg-warning text-dark', label: `Due in ${days} day${days === 1 ? '' : 's'}` };
  return { cls: 'bg-success', label: `Due ${new Date(due).toLocaleDateString()}` };
};

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

export default function MaintenanceLogs({ shareData }) {
  const [logs, setLogs] = useState({ spanLog: [], boardLog: [], pmLog: [] });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!shareData?.userId || !shareData?.customerId) { setLoading(false); return; }
      const next = { spanLog: [], boardLog: [], pmLog: [] };
      await Promise.all(
        SECTIONS.map(async ({ key }) => {
          try {
            const q = query(
              collection(db, 'user_files', shareData.userId, 'customers', shareData.customerId, key),
              orderBy('performedAt', 'desc'),
              limit(100)
            );
            const snap = await getDocs(q);
            next[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch (err) {
            // A missing collection is normal before the first entry exists.
            console.warn(`Could not load ${key}:`, err?.message || err);
          }
        })
      );
      if (!cancelled) { setLogs(next); setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [shareData]);

  if (loading) {
    return (
      <div className="text-center py-4 text-muted">
        <div className="spinner-border spinner-border-sm me-2" role="status" />
        Loading maintenance logs…
      </div>
    );
  }

  return (
    <div className="maintenance-logs">
      {SECTIONS.map(({ key, title, empty }) => {
        const entries = logs[key] || [];
        const last = entries[0];
        return (
          <div key={key} className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <strong>{title}</strong>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="small text-muted">
                  {entries.length > 0 ? `Last: ${sinceLabel(last.performedAt)}` : 'Never'}
                </span>
                {last?.nextDueAt && dueStatus(last.nextDueAt) && (
                  <span className={`badge ${dueStatus(last.nextDueAt).cls}`}>
                    {dueStatus(last.nextDueAt).label}
                  </span>
                )}
              </div>
            </div>
            <div className="card-body">
              {entries.length === 0 ? (
                <div className="text-muted small">{empty}</div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {entries.map((e) => {
                    const open = expanded[e.id];
                    return (
                      <div key={e.id} className="border rounded p-2">
                        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                          <div>
                            <div className="fw-semibold">{fmt(e.performedAt)}</div>
                            <div className="small text-muted">
                              {e.lineTitle ? `${e.lineTitle} · ` : ''}
                              by {e.performedBy || 'Unknown'}
                              {e.role === 'customer' ? ' (plant)' : e.role === 'jti' ? ' (JTI)' : ''}
                            </div>
                          </div>
                          <div className="d-flex align-items-center gap-2">
                            {typeof e.issueCount === 'number' && (
                              e.issueCount > 0
                                ? <span className="badge bg-danger">{e.issueCount} issue{e.issueCount === 1 ? '' : 's'}</span>
                                : <span className="badge bg-success">All OK</span>
                            )}
                            {e.confirmed && <span className="badge bg-success">✓ Confirmed</span>}
                          </div>
                        </div>

                        {e.notes && <div className="small mt-1">{e.notes}</div>}
                        {e.nextDueAt && (
                          <div className="small text-muted mt-1">
                            Next due {new Date(e.nextDueAt).toLocaleDateString()}
                            {e.intervalDays ? ` (${e.intervalDays}-day cycle)` : ''}
                          </div>
                        )}

                        {/* Span: recorded weights. Board: what was replaced. */}
                        {(Array.isArray(e.heads) && e.heads.length > 0) && (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-link px-0"
                              onClick={() => setExpanded((p) => ({ ...p, [e.id]: !p[e.id] }))}
                            >
                              {open ? 'Hide' : 'Show'} weights ({e.heads.length} heads)
                            </button>
                            {open && (
                              <div className="table-responsive">
                                <table className="table table-sm mb-0">
                                  <thead>
                                    <tr><th>Head</th><th>Current</th><th>Span</th><th>Diff</th></tr>
                                  </thead>
                                  <tbody>
                                    {e.heads.map((h) => (
                                      <tr key={h.head}>
                                        <td>{h.head}</td><td>{h.currentWeight}</td>
                                        <td>{h.spanWeight}</td><td>{(Math.round((Number(h.difference) || 0) * 10) / 10).toFixed(1)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )}

                        {/* Board replacements. Keyed off boardType rather than
                            headNumber — a main control or power supply board
                            isn't head-specific, and keying off the head meant
                            those entries rendered nothing at all. */}
                        {e.boardType && (
                          <div className="small mt-1">
                            <strong>{e.boardType}</strong>
                            {e.headNumber != null ? ` · Head ${e.headNumber}` : ' · machine board'}
                            {e.partNumber ? ` · part ${e.partNumber}` : ''}
                            {e.serialRemoved ? ` · out ${e.serialRemoved}` : ''}
                            {e.serialInstalled ? ` · in ${e.serialInstalled}` : ''}
                          </div>
                        )}
                        {e.reason && <div className="small mt-1"><em>{e.reason}</em></div>}

                        {Array.isArray(e.items) && e.items.length > 0 && (
                          <ul className="small mt-1 mb-0 ps-3">
                            {e.items.map((it, i) => (
                              <li key={i} className={it.result === 'issue' ? 'text-danger' : ''}>
                                {it.label}: <strong>{it.value || it.result || '—'}</strong>
                                {it.note ? ` — ${it.note}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
