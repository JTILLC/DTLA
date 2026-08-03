// shared/components/ImportLinesDialog.jsx
//
// "Bring JTI's lines into this log."
//
// A plant's lines are carried from their previous log, so the first log has
// none and a site JTI has serviced for years starts blank. This copies the
// equipment layout out of a JTI visit and into the log that is open now.
//
// It says what it will do BEFORE doing it — which lines are new, which the log
// already has and will be left alone — because "import" with no preview is how
// somebody ends up with two "Line 3"s and a history split between them.
import { useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import { planImport, openIssueCount } from '../utils/importLines.js';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';

const when = (v) => (v?.date ? new Date(v.date).toLocaleDateString() : 'no date');

export default function ImportLinesDialog({ visits = [], existingLines = [], onImport, onClose }) {
  useBodyScrollLock(true);
  const [selectedId, setSelectedId] = useState(visits[0]?.id || '');
  const [busy, setBusy] = useState(false);

  const visit = visits.find((v) => v.id === selectedId) || null;
  const plan = useMemo(
    () => planImport(existingLines, visit?.lines || []),
    [existingLines, visit],
  );
  const inherited = openIssueCount(plan.toAdd);

  const run = async () => {
    setBusy(true);
    try {
      await onImport(plan.toAdd);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="modal-backdrop fade show" onClick={onClose} />
      <div className="modal fade show d-block" tabIndex="-1" role="dialog" aria-modal="true">
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Add lines from a JTI visit</h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
            </div>

            <div className="modal-body">
              {visits.length === 0 ? (
                <p className="text-secondary mb-0">JTI has no visits on record for this plant yet.</p>
              ) : (
                <>
                  <label className="form-label" htmlFor="import-visit">Take the lines from</label>
                  <select
                    id="import-visit"
                    className="form-select mb-3"
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    {visits.map((v) => (
                      <option key={v.id} value={v.id}>
                        {when(v)} — {v.name || 'Service visit'} ({(v.lines || []).length} line{(v.lines || []).length === 1 ? '' : 's'})
                      </option>
                    ))}
                  </select>

                  {plan.toAdd.length === 0 ? (
                    <p className="mb-0">
                      {plan.skipped.length
                        ? <>This log already has every line from that visit — nothing to add.</>
                        : <>That visit has no lines on it.</>}
                    </p>
                  ) : (
                    <>
                      <p className="mb-1">
                        Adding <strong>{plan.toAdd.length} line{plan.toAdd.length === 1 ? '' : 's'}</strong>:
                      </p>
                      <ul className="mb-3">
                        {plan.toAdd.map((l) => (
                          <li key={l.title}>
                            {l.title} <span className="text-secondary">· {(l.heads || []).length} heads</span>
                          </li>
                        ))}
                      </ul>
                      {inherited > 0 && (
                        <p className="small text-secondary">
                          {inherited} head{inherited === 1 ? '' : 's'} come across still marked as having a
                          problem, as JTI last recorded them. Clear them as you check them.
                        </p>
                      )}
                      <p className="small text-secondary mb-0">
                        Photos and JTI&apos;s work-order links are not copied.
                      </p>
                    </>
                  )}

                  {plan.skipped.length > 0 && (
                    <p className="small text-secondary mt-3 mb-0">
                      Already in this log, left untouched: {plan.skipped.join(', ')}.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
                <X size={16} /> Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={run}
                disabled={busy || plan.toAdd.length === 0}
              >
                <Download size={16} /> {busy ? 'Adding…' : `Add ${plan.toAdd.length || ''} line${plan.toAdd.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
