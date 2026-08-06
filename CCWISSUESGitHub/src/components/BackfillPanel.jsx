// src/components/BackfillPanel.jsx
//
// "You billed for this job but never logged the visit."
//
// Sits under the visit list, because that is where you already are when you
// notice a machine's history has a gap. Each row is one invoiced service report
// with no visit against its number, showing the purpose and the write-up so the
// decision takes a couple of seconds.
//
// One at a time on purpose. Roughly one candidate in five should never become a
// visit — phone support, a packager job, metal-detector work — and a bulk
// "create all" would file weigher visits for machines nobody touched.
import { useState } from 'react';
import { FileText, Plus, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString();
};

export default function BackfillPanel({ candidates = [], loading, error, needsReconnect, onCreate, creatingId }) {
  const [openId, setOpenId] = useState(null);

  if (loading) {
    return (
      <div className="p-3 border-top text-secondary small">Checking the timesheet app for service reports…</div>
    );
  }

  // Said out loud rather than rendered as an empty list. An unreachable
  // timesheet app and a plant with nothing missing look identical otherwise,
  // and the wrong one of those is silently reassuring.
  if (error) {
    return (
      <div className="p-3 border-top">
        <div className="d-flex align-items-start gap-2 small text-warning">
          <AlertTriangle size={15} className="flex-shrink-0 mt-1" />
          <div>
            <strong>Couldn't check for missing visits.</strong>
            <div className="text-secondary">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  // Not an error and not "nothing to do" — this session simply never connected.
  if (needsReconnect) {
    return (
      <div className="p-3 border-top small text-secondary">
        Sign out and back in to check for service reports that were billed but never logged.
      </div>
    );
  }

  if (!candidates.length) return null;

  return (
    <div className="border-top">
      <div className="px-3 pt-3 pb-2">
        <div className="fw-bold small text-uppercase text-secondary" style={{ letterSpacing: '.05em' }}>
          Billed, never logged
        </div>
        <div className="small text-secondary">
          {candidates.length} service report{candidates.length === 1 ? '' : 's'} for this customer
          {candidates.length === 1 ? ' has' : ' have'} no visit. Open one to see what was written up.
        </div>
      </div>

      <div className="list-group list-group-flush">
        {candidates.map((c) => {
          const open = openId === c.norm;
          const busy = creatingId === c.norm;
          return (
            <div key={c.norm} className="list-group-item">
              <div className="d-flex align-items-start justify-content-between gap-2">
                <button
                  type="button"
                  className="btn btn-link p-0 text-start flex-grow-1 text-decoration-none"
                  onClick={() => setOpenId(open ? null : c.norm)}
                  aria-expanded={open}
                >
                  <div className="d-flex align-items-center gap-2">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="fw-bold">{c.number}</span>
                    <span className="text-secondary small">{fmt(c.date)}</span>
                    {c.dayCount > 1 && <span className="text-secondary small">· {c.dayCount} days</span>}
                    {/* A candidate with no write-up would make a visit that is a
                        date and nothing else — worth knowing before you click. */}
                    {!c.hasWork && (
                      <span className="badge bg-secondary-subtle text-secondary-emphasis">no write-up</span>
                    )}
                  </div>
                  {c.purpose && <div className="small text-secondary ms-4">{c.purpose}</div>}
                </button>

                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary text-nowrap"
                  onClick={() => onCreate(c)}
                  disabled={busy}
                >
                  {busy ? 'Creating…' : <><Plus size={13} /> Create visit</>}
                </button>
              </div>

              {open && (
                <div className="mt-2 ms-4 small">
                  {c.work.length === 0 ? (
                    <div className="text-secondary fst-italic">
                      Nothing was written up on this one. A visit from it would carry the number and the
                      date and nothing else.
                    </div>
                  ) : (
                    c.work.map((w, i) => (
                      <div key={i} className="mb-2">
                        <div className="fw-semibold text-secondary">{fmt(w.date)}</div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{w.text}</div>
                      </div>
                    ))
                  )}
                  <div className="text-secondary d-flex align-items-center gap-1 mt-2">
                    <FileText size={12} /> from the timesheet app · invoice {c.number}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
