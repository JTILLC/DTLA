// src/components/HeadIssueModal.jsx
// Pops up when a head is disabled from the Quick Head Toggle so the issue can be
// entered right there — no scrolling to the offline-heads table. Reuses the Line's
// existing issue handlers, so edits flow through the normal autosave.
import IssuePhotos from './IssuePhotos.jsx';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';

const HeadIssueModal = ({
  head, lineTitle, isDark, issueTypes, getFixedLabel, onClose,
  addIssue, updateIssue, removeIssue, toggleFixedStatus, onHeadChange,
  photosDisabled, photoPathBase, visitDocPath,
}) => {
  useBodyScrollLock(!!head);
  if (!head) return null;
  const idx = head.index;
  const headNo = head.id || idx + 1;
  const issues = head.issues || [];

  return (
    // This is the screen a tech uses most in the field: full-screen sheet on a
    // phone, and scrollable so the header and the Done button stay put instead
    // of living at the end of a long scroll.
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="modal-dialog modal-dialog-centered"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Head {headNo}{lineTitle ? ` — ${lineTitle}` : ''}</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>
          <div className="modal-body">
            <div className="mb-3 d-flex align-items-center gap-2 flex-wrap">
              <strong className="me-1">Status:</strong>
              <button
                type="button"
                className={`btn btn-sm ${head.status === 'offline' ? 'btn-danger' : 'btn-outline-danger'}`}
                onClick={() => onHeadChange(idx, 'status', 'offline')}
              >Offline</button>
              <button
                type="button"
                className={`btn btn-sm ${head.status === 'active' ? 'btn-success' : 'btn-outline-success'}`}
                onClick={() => onHeadChange(idx, 'status', 'active')}
              >Active</button>
            </div>

            {/* Head-level photos — snap a picture of the head itself, no issue required. */}
            <div className="mb-3">
              <label className="form-label"><strong>Photos of this head</strong></label>
              <IssuePhotos
                photos={head.photos}
                onChange={(next) => onHeadChange(idx, 'photos', next)}
                pathBase={`${photoPathBase(headNo)}/head`}
                docPath={visitDocPath}
                disabled={photosDisabled}
                disabledReason="Save the visit first before adding photos"
                isDark={isDark}
              />
            </div>

            <label className="form-label"><strong>Issues</strong></label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {issues.length === 0 && (
                <div className="text-muted small">No issues yet — add one to explain what's wrong.</div>
              )}
              {issues.map((issue, issIdx) => (
                <div key={issIdx} style={{ padding: '8px', backgroundColor: isDark ? '#333' : '#f8f9fa', borderRadius: '4px', border: '1px solid #ddd' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={issue.type}
                      onChange={(e) => updateIssue(idx, issIdx, 'type', e.target.value)}
                      style={{ flex: 1, minWidth: '120px' }}
                    >
                      {issueTypes.filter(t => t !== 'None').map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => toggleFixedStatus(idx, issIdx)}
                      className="btn btn-sm"
                      style={{
                        backgroundColor: issue.fixed === 'fixed' ? 'orange' : issue.fixed === 'active_with_issues' ? 'lightblue' : 'lightcoral',
                        fontWeight: 'bold', color: '#000', minWidth: '110px',
                      }}
                      title="Click to toggle status"
                    >
                      {getFixedLabel(issue.fixed)}
                    </button>
                    <button type="button" onClick={() => removeIssue(idx, issIdx)} className="btn btn-sm btn-danger" title="Remove this issue">✕</button>
                  </div>
                  <input
                    type="text"
                    className="form-control form-control-sm mt-2"
                    placeholder="Notes for this issue (optional)…"
                    value={issue.notes || ''}
                    onChange={(e) => updateIssue(idx, issIdx, 'notes', e.target.value)}
                  />
                  <IssuePhotos
                    photos={issue.photos}
                    onChange={(next) => updateIssue(idx, issIdx, 'photos', next)}
                    pathBase={photoPathBase(headNo)}
                    docPath={visitDocPath}
                    disabled={photosDisabled}
                    disabledReason="Save the visit first before adding photos"
                    isDark={isDark}
                  />
                </div>
              ))}
              <button type="button" onClick={() => addIssue(idx)} className="btn btn-sm btn-primary" style={{ alignSelf: 'flex-start' }}>+ Add Issue</button>
            </div>

            <div className="mt-3">
              <label className="form-label"><strong>Head Notes</strong></label>
              <input
                type="text"
                className="form-control"
                placeholder="General head notes…"
                value={head.notes || ''}
                onChange={(e) => onHeadChange(idx, 'notes', e.target.value)}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeadIssueModal;
