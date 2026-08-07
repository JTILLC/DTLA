// shared/components/HeadHistoryModal.jsx
//
// "Has this head done this before?" — asked at the head, answered on the spot.
//
// The history was already computed and already on screen, as a collapsible
// "Past Issues" row underneath each head. Three things were wrong with that:
// it sat at the BOTTOM of a head's row, so you found it only if you were
// already scrolling; expanding it shoved the table around underneath the
// fingers of somebody standing at a machine; and it showed issue types alone,
// dropping the note — which is the part a fitter actually wants ("Rebuilt WDU",
// "Bolt won't tighten").
//
// So it moves to a button on the head itself and opens over the top, the way
// the Shearers logger does it. Nothing is recomputed: same buildHeadIssueHistory,
// same entries, more of each one shown.
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';
import './line-issues.css';
import './head-history.css';

const stateClass = (fixed) => (
  fixed === 'fixed' ? 'line-issue-state--fixed'
    : fixed === 'active_with_issues' ? 'line-issue-state--attn'
    : 'line-issue-state--not_fixed'
);
const stateLabel = (fixed) => (
  fixed === 'fixed' ? 'Fixed'
    : fixed === 'active_with_issues' ? 'Active w/ issues'
    : 'Not fixed'
);

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

export default function HeadHistoryModal({ lineTitle, headNo, history = [], onClose }) {
  useBodyScrollLock(true);

  // Rendered into <body> rather than where it sits in the tree.
  //
  // It is a child of Line, and Line is inside the wrapper that goes
  // `pointer-events: none; opacity: .7` while a JTI visit is being read. That
  // wrapper is meant to stop edits, but it also dimmed this modal to 70% and
  // swallowed every click in it — including Close. Reading history is not
  // editing, so it does not belong inside the thing that blocks editing.
  //
  // A portal also settles the position: `fixed` resolves against the viewport
  // instead of any ancestor that happens to carry a transform or a filter,
  // which is what puts a modal off-screen on a phone.
  return createPortal(
    (<>
      <div className="modal-backdrop fade show" onClick={onClose} />
      <div className="modal fade show d-block" tabIndex="-1" role="dialog" aria-modal="true"
           aria-label={`History for head ${headNo}`}>
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {lineTitle ? `${lineTitle} — ` : ''}Head {headNo}
                <span className="hh-count">History ({history.length})</span>
              </h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
            </div>

            <div className="modal-body">
              {history.length === 0 ? (
                <p className="text-secondary mb-0">
                  Nothing recorded against this head before today.
                </p>
              ) : (
                <div className="hh-list">
                  {history.map((entry, i) => (
                    <div className="hh-entry" key={`${entry.visitId}-${i}`}>
                      <div className="hh-when">
                        <span className="hh-date">{when(entry.date)}</span>
                        <span className="hh-visit">{entry.visitName}</span>
                        {entry.status === 'offline' && <span className="hh-offline">offline</span>}
                      </div>

                      {entry.issues.length > 0 ? (
                        <div className="hh-issues">
                          {entry.issues.map((iss, j) => (
                            <span className={`line-issue-chip ${stateClass(iss.fixed)}`} key={j}>
                              {iss.type} — {stateLabel(iss.fixed)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="hh-issues"><span className="text-secondary small">Taken offline, no issue logged</span></div>
                      )}

                      {/* Per-issue notes and the head's own note. The reason
                          anybody opens this. */}
                      {entry.issues.filter((i2) => i2.notes).map((iss, j) => (
                        <p className="hh-note" key={`n${j}`}>“{iss.notes}”</p>
                      ))}
                      {entry.notes && <p className="hh-note">“{entry.notes}”</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </>),
    document.body,
  );
}
