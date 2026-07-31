import React, { useState, useEffect } from 'react';
import { subscribeCrew } from '../services/logs.js';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import PinPrompt from './PinPrompt.jsx';
import SpanAdjust from './SpanAdjust.jsx';
import SpanCalPreview from './SpanCalPreview.jsx';
import Audit from './Audit.jsx';
import CombinedExport from './CombinedExport.jsx';
import IssuePhotos from './IssuePhotos.jsx';
import RedZoneSync from './RedZoneSync.jsx';
import HeadIssueModal from './HeadIssueModal.jsx';
import SpanAdjustLog from './SpanAdjustLog.jsx';
import { useDialog } from './DialogSystem.jsx';
import { buildHeadIssueHistory, migrateHeadData as migrateHeadDataShared } from '../utils/headHelpers.js';

const issueTypes = [
  'None', 'Chute', 'Operator', 'Load Cell', 'Detached Head', 'Stepper Motor Error',
  'Hopper Issues', 'Installed Wrong', 'Radial Feeder', 'Booster Hopper Issues', 'Other'
];

// Migrate + clear legacy error/notes after moving them into the issues array,
// so the head-level notes field doesn't duplicate the first issue's notes.
const migrateHead = (head) => {
  const needsLegacyClear = !Array.isArray(head.issues) && head.error && head.error !== 'None';
  const migrated = migrateHeadDataShared(head);
  if (!needsLegacyClear) return migrated;
  return { ...migrated, error: 'None', notes: '' };
};

const migrateLine = (line) => ({ ...line, heads: line.heads.map(migrateHead) });

const Line = ({ line, updateLine, removeLine, resetLine, isVisible, exportLineToPDF, buildSpanCalibrationPDF, buildCombinedPDF, globalData, isDark, visits, currentVisitId, userId, customerId, visitId, performedByName, logRole = 'jti' }) => {
  // Who is at this device, proven once with a PIN. Taking a head offline is the
  // action most worth attributing: it stops product, and "who turned this off?"
  // is the first question asked the next morning.
  const { person: actor, remember: rememberActor } = useVerifiedPerson(customerId);
  const [crewPeople, setCrewPeople] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);   // () => void

  useEffect(() => {
    if (!userId || !customerId) return undefined;
    return subscribeCrew(userId, customerId, setCrewPeople);
  }, [userId, customerId]);

  // Run an attributable action, asking who is here if we do not already know.
  // A plant with no PINs set keeps working unattributed rather than being
  // locked out of its own machines — the feature must not become a gate.
  const attributed = (run) => {
    const anyPin = crewPeople.some((p) => p.pinHash);
    if (actor || !anyPin) return run(actor?.name || '');
    setPendingAction(() => run);
  };
  const dialog = useDialog();
  const photosDisabled = !userId || !customerId || !visitId;
  const photoPathBase = (headId) =>
    `issue-photos/${userId}/${customerId}/${visitId}/${line.id}/head-${headId}`;
  // Where a queued (offline) photo's URL gets written back once it uploads.
  const visitDocPath =
    userId && customerId && visitId
      ? `user_files/${userId}/customers/${customerId}/visits/${visitId}`
      : null;
  const [expandedHistory, setExpandedHistory] = useState({});
  const [localLine, setLocalLine] = useState(() => migrateLine(line));
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showActiveHeads, setShowActiveHeads] = useState(false);
  const [showLineDetails, setShowLineDetails] = useState(false);
  const [showSpanPreview, setShowSpanPreview] = useState(false);
  const [showCombined, setShowCombined] = useState(false);

  const updateAudit = (label, field, value) => {
    const prevAudit = localLine.audit || {};
    const prevRow = prevAudit[label] || {};
    const updated = { ...localLine, audit: { ...prevAudit, [label]: { ...prevRow, [field]: value } } };
    setLocalLine(updated);
    updateLine(updated);
  };

  const updateAuditNotes = (value) => {
    const updated = { ...localLine, auditNotes: value };
    setLocalLine(updated);
    updateLine(updated);
  };

  useEffect(() => {
    setLocalLine(migrateLine(line));
  }, [line]);

  const handleChange = (e) => {
    const updated = { ...localLine, [e.target.name]: e.target.value };
    setLocalLine(updated);
    updateLine(updated);
  };

  const handleCheckbox = (e) => {
    const updated = { ...localLine, [e.target.name]: e.target.checked };
    setLocalLine(updated);
    updateLine(updated);
  };

  const handleHeadChange = (index, field, value, who) => {
    const updatedHeads = localLine.heads.map((h, j) => j === index
      ? {
          ...h,
          [field]: value,
          // Only a status change is attributed — notes and issue text are edits,
          // not the act of stopping or restarting a head.
          ...(field === 'status'
            ? { statusBy: who || '', statusAt: new Date().toISOString(), statusAction: value }
            : {}),
        }
      : h);
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  // Merge several fields onto one head at once (used by RedZone sync so a single
  // update carries the work-order id/status/timestamp rather than three writes).
  const updateHeadFields = (index, fields) => {
    const updatedHeads = localLine.heads.map((h, j) => j === index ? { ...h, ...fields } : h);
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  // Toggling Span Adjust off now just hides it — the weights are kept.
  const toggleSpanAdjust = (e) => {
    const updated = { ...localLine, showSpanAdjust: e.target.checked };
    setLocalLine(updated);
    updateLine(updated);
  };

  // Weights are entered to one decimal, so differences are meaningful to one
  // decimal too. Rounding here rather than only at render keeps the stored
  // value clean for the span log, PDFs and exports alike.
  const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

  const updateHeadWeight = (index, field, value) => {
    const updatedHeads = localLine.heads.map((h, j) => j === index ? {
      ...h,
      [field]: parseFloat(value) || 0,
      weightDifference: round1(
        (field === 'spanWeight' ? parseFloat(value) || 0 : h.spanWeight)
        - (field === 'currentWeight' ? parseFloat(value) || 0 : h.currentWeight)
      )
    } : h);
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  // Span Adjust bulk helpers.
  const [spanAllValue, setSpanAllValue] = useState('');
  const clearSpanCurrentWeights = () => {
    const updatedHeads = localLine.heads.map(h => ({
      ...h, currentWeight: 0, weightDifference: round1((h.spanWeight || 0) - 0),
    }));
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };
  const applyAllSpanWeights = () => {
    const val = parseFloat(spanAllValue);
    if (isNaN(val)) return;
    const updatedHeads = localLine.heads.map(h => ({
      ...h, spanWeight: val, weightDifference: round1(val - (h.currentWeight || 0)),
    }));
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  const handleTitleChange = (e) => {
    const updated = { ...localLine, title: e.target.value };
    setLocalLine(updated);
    updateLine(updated);
  };

  const toggleEditTitle = () => {
    setIsEditingTitle(!isEditingTitle);
  };

  const quickToggleHead = (index, isOffline) => attributed((who) => {
    const at = new Date().toISOString();
    const updatedHeads = localLine.heads.map((h, j) =>
      j === index
        ? {
            ...h,
            status: isOffline ? 'offline' : 'active',
            // Stamped on the head, not in a side log: whoever opens this line
            // next sees who took it off without going looking.
            statusBy: who,
            statusAt: at,
            statusAction: isOffline ? 'offline' : 'active',
          }
        : h
    );
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  });

  // Which head the issue modal is showing (index into localLine.heads), or null.
  const [issueModalHead, setIssueModalHead] = useState(null);

  // Tapping a head in the Quick Head Toggle: if it's active, disable it (and seed
  // a first issue) then open the modal so the issue can be entered right there;
  // if it's already offline, just open the modal to review/edit or re-activate.
  const openHeadModal = (index) => {
    const head = localLine.heads[index];
    if (head.status === 'active') {
      quickToggleHead(index, true); // disable it (turns red)
    }
    setIssueModalHead(index);
  };

  // Separate heads by status
  const offlineHeads = localLine.heads.map((head, i) => ({ ...head, index: i })).filter(head => head.status === 'offline');
  const activeHeads = localLine.heads.map((head, i) => ({ ...head, index: i })).filter(head => head.status === 'active');
  const hasIssues = offlineHeads.length > 0 || localLine.heads.some(h => {
    const issues = h.issues || [];
    return issues.length > 0 || h.error !== 'None' || h.notes.trim() !== '' || h.fixed !== 'na';
  });

  // Add issue to a head
  const addIssue = (headIndex) => {
    const updatedHeads = localLine.heads.map((h, j) => {
      if (j === headIndex) {
        const issues = h.issues || [];
        return {
          ...h,
          issues: [...issues, { type: 'Chute', fixed: 'not_fixed', notes: '', photos: [] }]
        };
      }
      return h;
    });
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  // Update an issue
  const updateIssue = (headIndex, issueIndex, field, value) => {
    const updatedHeads = localLine.heads.map((h, j) => {
      if (j === headIndex) {
        const issues = [...(h.issues || [])];
        issues[issueIndex] = { ...issues[issueIndex], [field]: value };
        return { ...h, issues };
      }
      return h;
    });
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  // Remove an issue
  const removeIssue = (headIndex, issueIndex) => {
    const updatedHeads = localLine.heads.map((h, j) => {
      if (j === headIndex) {
        const issues = (h.issues || []).filter((_, idx) => idx !== issueIndex);
        return { ...h, issues };
      }
      return h;
    });
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  // Toggle fixed status: not_fixed -> fixed -> active_with_issues -> not_fixed
  const toggleFixedStatus = (headIndex, issueIndex) => attributed((whoFixed) => {
    const statusOrder = ['not_fixed', 'fixed', 'active_with_issues'];
    const updatedHeads = localLine.heads.map((h, j) => {
      if (j === headIndex) {
        const issues = [...(h.issues || [])];
        const currentStatus = issues[issueIndex].fixed;
        const currentIdx = statusOrder.indexOf(currentStatus);
        const nextIdx = (currentIdx + 1) % statusOrder.length;
        issues[issueIndex] = {
          ...issues[issueIndex],
          fixed: statusOrder[nextIdx],
          fixedBy: whoFixed,
          fixedAt: new Date().toISOString(),
        };
        return { ...h, issues };
      }
      return h;
    });
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  });

  // Get label for fixed status
  const getFixedLabel = (status) => {
    switch(status) {
      case 'fixed': return 'Fixed';
      case 'active_with_issues': return 'Active w/ Issues';
      default: return 'Not Fixed';
    }
  };

  // Active heads always start collapsed - user can expand if needed

  // Change head count for the line
  const changeHeadCount = async (newCount) => {
    const count = parseInt(newCount);
    if (isNaN(count) || count < 1) return;

    const currentCount = localLine.heads.length;
    let newHeads;

    if (count > currentCount) {
      // Add new heads
      newHeads = [
        ...localLine.heads,
        ...Array.from({ length: count - currentCount }, (_, i) => ({
          id: currentCount + i + 1,
          status: 'active',
          error: 'None',
          notes: '',
          fixed: 'na',
          issues: [],
          currentWeight: 0,
          spanWeight: 0,
          weightDifference: 0,
        }))
      ];
    } else if (count < currentCount) {
      // Remove heads from the end
      const confirmed = await dialog.confirm(`This will remove ${currentCount - count} head(s) from the end. Continue?`, {
        title: 'Remove Heads',
        confirmText: 'Continue',
        variant: 'warning'
      });
      if (!confirmed) return;
      newHeads = localLine.heads.slice(0, count);
    } else {
      return; // No change
    }

    const updated = { ...localLine, heads: newHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  return (
    <div className="machine-section" style={{ display: isVisible ? 'block' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        {isEditingTitle ? (
          <div style={{ flex: 1 }}>
            <input
              type="text"
              value={localLine.title}
              onChange={handleTitleChange}
              onBlur={toggleEditTitle}
              autoFocus
              className="text-2xl font-bold mb-2"
              style={{ width: '300px' }}
            />
            <button onClick={toggleEditTitle} className="btn btn-sm btn-success ms-2">Save Title</button>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold mb-0">
              {localLine.title}
            </h2>
            <div style={{ display: 'flex', gap: '5px' }}>
              <button onClick={() => setShowLineDetails(!showLineDetails)} className="btn btn-sm btn-outline-secondary line-action-btn">
                {showLineDetails ? 'Hide Details' : 'Show Details'}
              </button>
              <button onClick={toggleEditTitle} className="btn btn-sm btn-outline-secondary line-action-btn">
                Rename
              </button>
            </div>
          </>
        )}
      </div>

      <div>
      {/* htmlFor/id pairs so tapping a label focuses its input on touch. */}
      {showLineDetails && (
        <div className="line-fields">
          <label htmlFor={`line-${localLine.id}-model`}>Model:</label>
          <input id={`line-${localLine.id}-model`} type="text" name="model" value={localLine.model} onChange={handleChange} />
          <label htmlFor={`line-${localLine.id}-job`}>Job Number:</label>
          <input id={`line-${localLine.id}-job`} type="text" name="jobNumber" value={localLine.jobNumber} onChange={handleChange} />
          <label htmlFor={`line-${localLine.id}-serial`}>Serial Number:</label>
          <input id={`line-${localLine.id}-serial`} type="text" name="serialNumber" value={localLine.serialNumber} onChange={handleChange} />
          <label htmlFor={`line-${localLine.id}-headcount`}>Head Count:</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              id={`line-${localLine.id}-headcount`}
              type="number"
              min="1"
              max="50"
              value={localLine.heads.length}
              onChange={(e) => changeHeadCount(e.target.value)}
              style={{ width: '80px' }}
            />
            <span style={{ fontSize: '0.85em', color: '#666' }}>
              (Currently {localLine.heads.length} heads)
            </span>
          </div>
        </div>
      )}
      <div className="machine-running">
        <label>
          <input type="checkbox" name="running" checked={localLine.running} onChange={handleCheckbox} /> Line Running?
        </label>
      </div>

      {/* Quick Head Toggle */}
      <div className="quick-head-toggle mb-3 p-3" style={{ background: isDark ? '#2a2a2a' : '#f8f9fa', borderRadius: '8px' }}>
        <h6 className="mb-2"><strong>Quick Head Toggle</strong></h6>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '10px',
          maxWidth: '700px',
          margin: '0 auto'
        }}>
          {localLine.heads.map((head, i) => {
            const issues = head.issues || [];
            const hasIssues = issues.length > 0;
            const allFixed = hasIssues && issues.every(iss => iss.fixed === 'fixed');
            const someActiveWithIssues = hasIssues && issues.some(iss => iss.fixed === 'active_with_issues');

            // Determine button colour based on status and issues. `glyph` carries
            // the same information non-visually — colour alone is unreadable in
            // bright plant lighting and for colour-blind users.
            let btnClass = 'btn-success'; // Default green for active
            let titleText = 'Click to set Offline';
            let glyph = '';               // active + clean needs no marker

            if (head.status === 'offline') {
              if (allFixed) {
                btnClass = 'btn-warning'; // Orange - all issues fixed
                titleText = 'All issues fixed';
                glyph = '✓';
              } else if (someActiveWithIssues) {
                btnClass = 'btn-info'; // Blue - some active with issues
                titleText = 'Active with issues';
                glyph = '!';
              } else {
                btnClass = 'btn-danger'; // Red for offline with unfixed issues
                titleText = 'Click to set Active';
                glyph = '✕';
              }
            } else if (hasIssues) {
              // Active but has issues logged
              btnClass = 'btn-info';
              titleText = 'Active with issues logged';
              glyph = '!';
            }

            return (
              <button
                key={i}
                onClick={() => openHeadModal(i)}
                className={`btn btn-sm head-tile ${btnClass}`}
                style={{
                  aspectRatio: '1',
                  fontWeight: 'bold',
                  padding: '8px',
                  fontSize: '1.1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '0',
                  width: '100%'
                }}
                title={`Head ${i + 1}: ${titleText}${hasIssues ? ` (${issues.length} issue${issues.length > 1 ? 's' : ''})` : ''}`}
                aria-label={`Head ${i + 1}: ${titleText}${hasIssues ? `, ${issues.length} issue${issues.length > 1 ? 's' : ''}` : ''}`}
              >
                {glyph && <span className="head-tile-glyph" aria-hidden="true">{glyph}</span>}
                {i + 1}
                {issues.length > 0 && (
                  <span className="head-tile-count" aria-hidden="true">{issues.length}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="head-legend text-muted">
          <span><span className="badge bg-success">Green</span> Active</span>
          <span><span className="badge bg-danger">✕ Red</span> Offline (Not Fixed)</span>
          <span><span className="badge bg-warning text-dark">✓ Orange</span> All Issues Fixed</span>
          <span><span className="badge bg-info text-dark">! Blue</span> Active with Issues</span>
        </div>
      </div>

      {/* Offline Heads Section */}
      {offlineHeads.length > 0 && (
        <div className="mb-3">
          <h6 className="text-danger"><strong>Offline Heads ({offlineHeads.length})</strong></h6>
          <table className="mobile-cards">
            <thead>
              <tr>
                <th>Head #</th>
                <th>Taken off by</th>
                <th>Status</th>
                <th>Issues</th>
                <th>Head Notes</th>
              </tr>
            </thead>
            <tbody>
              {offlineHeads.map((head) => {
                const issues = head.issues || [];
                const allFixed = issues.length > 0 && issues.every(iss => iss.fixed === 'fixed');
                const hasActiveWithIssues = issues.some(iss => iss.fixed === 'active_with_issues');
                const history = buildHeadIssueHistory(localLine.title, head.id || head.index + 1, visits, currentVisitId);
                const historyKey = `${head.index}`;
                const isHistoryExpanded = expandedHistory[historyKey];

                return (
                  <React.Fragment key={head.index}>
                  <tr
                    className={
                      allFixed ? 'head-row--fixed' :
                      hasActiveWithIssues ? 'head-row--attn' :
                      'head-row--offline'
                    }
                  >
                    <td data-label="Head #" style={{ verticalAlign: 'top', fontWeight: 'bold' }}>{head.index + 1}</td>
                    <td data-label="Taken off by" style={{ verticalAlign: 'top' }}>
                      {head.statusBy ? (
                        <span className="small">
                          {head.statusBy}
                          {head.statusAt && (
                            <span className="d-block text-muted">
                              {new Date(head.statusAt).toLocaleString([], {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="small text-muted">—</span>
                      )}
                    </td>
                    <td data-label="Status" style={{ verticalAlign: 'top' }}>
                      <select value={head.status} onChange={(e) => attributed((who) => handleHeadChange(head.index, 'status', e.target.value, who))}>
                        <option value="active">Active</option>
                        <option value="offline">Offline</option>
                      </select>
                    </td>
                    <td data-label="Issues" style={{ verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {issues.map((issue, issIdx) => (
                          <div key={issIdx} style={{
                            padding: '8px',
                            backgroundColor: isDark ? '#333' : '#f8f9fa',
                            borderRadius: '4px',
                            border: '1px solid #ddd'
                          }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <select
                                value={issue.type}
                                onChange={(e) => updateIssue(head.index, issIdx, 'type', e.target.value)}
                                style={{ flex: 1, minWidth: '120px' }}
                              >
                                {issueTypes.filter(t => t !== 'None').map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => toggleFixedStatus(head.index, issIdx)}
                                className="btn btn-sm"
                                style={{
                                  backgroundColor: issue.fixed === 'fixed' ? 'orange' :
                                    issue.fixed === 'active_with_issues' ? 'lightblue' : 'lightcoral',
                                  fontWeight: 'bold',
                                  color: '#000',
                                  minWidth: '110px'
                                }}
                                title={issue.fixedBy
                                  ? `${getFixedLabel(issue.fixed)} — marked by ${issue.fixedBy}${issue.fixedAt ? ' on ' + new Date(issue.fixedAt).toLocaleString() : ''}`
                                  : 'Click to toggle status'}
                              >
                                {getFixedLabel(issue.fixed)}
                              </button>
                              {issue.fixedBy && (
                                <div className="small text-muted mt-1">
                                  by {issue.fixedBy}
                                </div>
                              )}
                              <button
                                onClick={() => removeIssue(head.index, issIdx)}
                                className="btn btn-sm btn-danger"
                                title="Remove this issue"
                              >
                                ✕
                              </button>
                            </div>
                            <IssuePhotos
                              photos={issue.photos}
                              onChange={(next) => updateIssue(head.index, issIdx, 'photos', next)}
                              pathBase={photoPathBase(head.id || head.index + 1)}
                              docPath={visitDocPath}
                              disabled={photosDisabled}
                              disabledReason="Save the visit first before adding photos"
                              isDark={isDark}
                            />
                          </div>
                        ))}
                        <button
                          onClick={() => addIssue(head.index)}
                          className="btn btn-sm btn-primary"
                          style={{ alignSelf: 'flex-start' }}
                        >
                          + Add Issue
                        </button>
                        {issues.length > 0 && (
                          <RedZoneSync
                            head={head}
                            line={localLine}
                            globalData={globalData}
                            customerId={customerId}
                            visitId={visitId}
                            onChange={(fields) => updateHeadFields(head.index, fields)}
                            disabled={photosDisabled}
                            disabledReason="Save the visit first before sending to RedZone"
                          />
                        )}
                      </div>
                    </td>
                    <td data-label="Head Notes" style={{ verticalAlign: 'top' }}>
                      <input
                        type="text"
                        placeholder="General head notes..."
                        value={head.notes}
                        onChange={(e) => handleHeadChange(head.index, 'notes', e.target.value)}
                      />
                      <IssuePhotos
                        photos={head.photos}
                        onChange={(next) => handleHeadChange(head.index, 'photos', next)}
                        pathBase={`${photoPathBase(head.id || head.index + 1)}/head`}
                        docPath={visitDocPath}
                        disabled={photosDisabled}
                        disabledReason="Save the visit first before adding photos"
                        isDark={isDark}
                      />
                    </td>
                  </tr>
                  {history.length > 0 && (
                    <tr>
                      <td colSpan="4" style={{ padding: '4px 8px', backgroundColor: isDark ? '#1a1a2e' : '#f0f0f5' }}>
                        <button
                          onClick={() => setExpandedHistory(prev => ({ ...prev, [historyKey]: !prev[historyKey] }))}
                          className="btn btn-sm btn-outline-secondary"
                          style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                        >
                          {isHistoryExpanded ? '▼' : '▶'} Past Issues ({history.length})
                        </button>
                        {isHistoryExpanded && (
                          <div style={{ marginTop: '6px', paddingLeft: '8px' }}>
                            {history.map((entry, hIdx) => (
                              <div key={hIdx} style={{ marginBottom: '4px', fontSize: '0.85rem' }}>
                                <strong>{new Date(entry.date).toLocaleDateString()}:</strong>{' '}
                                {entry.issues.length > 0 ? entry.issues.map((iss, iIdx) => (
                                  <span
                                    key={iIdx}
                                    style={{
                                      display: 'inline-block',
                                      padding: '1px 6px',
                                      borderRadius: '3px',
                                      marginLeft: '4px',
                                      fontSize: '0.8rem',
                                      fontWeight: 'bold',
                                      color: '#000',
                                      backgroundColor: iss.fixed === 'fixed' ? 'orange' :
                                        iss.fixed === 'active_with_issues' ? 'lightblue' : 'lightcoral'
                                    }}
                                  >
                                    {iss.type} - {iss.fixed === 'fixed' ? 'Fixed' : iss.fixed === 'active_with_issues' ? 'Active w/ Issues' : 'Not Fixed'}
                                  </span>
                                )) : <span className="text-muted">Offline (no issues logged)</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Active Heads Section - Collapsible */}
      {activeHeads.length > 0 && (
        <div className="mb-3">
          <h6
            className="cursor-pointer mb-2"
            style={{ cursor: 'pointer', fontWeight: 'bold', color: '#28a745', userSelect: 'none' }}
            onClick={() => setShowActiveHeads(!showActiveHeads)}
          >
            Active Heads ({activeHeads.length}) {showActiveHeads ? '▼' : '▶'}
          </h6>
          {showActiveHeads && (
            <table className="mobile-cards">
              <thead>
                <tr>
                  <th>Head #</th>
                  <th>Status</th>
                  <th>Issues</th>
                  <th>Head Notes</th>
                </tr>
              </thead>
              <tbody>
                {activeHeads.map((head) => {
                  const issues = head.issues || [];
                  const hasIssuesOrNotes = issues.length > 0 || head.notes.trim() !== '';
                  const history = buildHeadIssueHistory(localLine.title, head.id || head.index + 1, visits, currentVisitId);
                  const historyKey = `active-${head.index}`;
                  const isHistoryExpanded = expandedHistory[historyKey];

                  return (
                    <React.Fragment key={head.index}>
                    <tr className={hasIssuesOrNotes ? 'head-row--attn' : 'head-row--ok'}>
                      <td data-label="Head #" style={{ verticalAlign: 'top', fontWeight: 'bold' }}>{head.index + 1}</td>
                      <td data-label="Status" style={{ verticalAlign: 'top' }}>
                        <select value={head.status} onChange={(e) => attributed((who) => handleHeadChange(head.index, 'status', e.target.value, who))}>
                          <option value="active">Active</option>
                          <option value="offline">Offline</option>
                        </select>
                      </td>
                      <td data-label="Issues" style={{ verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {issues.map((issue, issIdx) => (
                            <div key={issIdx} style={{
                              padding: '8px',
                              backgroundColor: isDark ? '#333' : '#f8f9fa',
                              borderRadius: '4px',
                              border: '1px solid #ddd'
                            }}>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <select
                                  value={issue.type}
                                  onChange={(e) => updateIssue(head.index, issIdx, 'type', e.target.value)}
                                  style={{ flex: 1, minWidth: '120px' }}
                                >
                                  {issueTypes.filter(t => t !== 'None').map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => toggleFixedStatus(head.index, issIdx)}
                                  className="btn btn-sm"
                                  style={{
                                    backgroundColor: issue.fixed === 'fixed' ? 'orange' :
                                      issue.fixed === 'active_with_issues' ? 'lightblue' : 'lightcoral',
                                    fontWeight: 'bold',
                                    color: '#000',
                                    minWidth: '110px'
                                  }}
                                  title="Click to toggle status"
                                >
                                  {getFixedLabel(issue.fixed)}
                                </button>
                                <button
                                  onClick={() => removeIssue(head.index, issIdx)}
                                  className="btn btn-sm btn-danger"
                                  title="Remove this issue"
                                >
                                  ✕
                                </button>
                              </div>
                              <IssuePhotos
                                photos={issue.photos}
                                onChange={(next) => updateIssue(head.index, issIdx, 'photos', next)}
                                pathBase={photoPathBase(head.id || head.index + 1)}
                                docPath={visitDocPath}
                                disabled={photosDisabled}
                                disabledReason="Save the visit first before adding photos"
                                isDark={isDark}
                              />
                            </div>
                          ))}
                          <button
                            onClick={() => addIssue(head.index)}
                            className="btn btn-sm btn-outline-primary"
                            style={{ alignSelf: 'flex-start' }}
                          >
                            + Add Issue
                          </button>
                          {issues.length > 0 && (
                            <RedZoneSync
                              head={head}
                              line={localLine}
                              globalData={globalData}
                              customerId={customerId}
                              visitId={visitId}
                              onChange={(fields) => updateHeadFields(head.index, fields)}
                              disabled={photosDisabled}
                              disabledReason="Save the visit first before sending to RedZone"
                            />
                          )}
                        </div>
                      </td>
                      <td data-label="Head Notes" style={{ verticalAlign: 'top' }}>
                        <input
                          type="text"
                          placeholder="General head notes..."
                          value={head.notes}
                          onChange={(e) => handleHeadChange(head.index, 'notes', e.target.value)}
                        />
                        <IssuePhotos
                          photos={head.photos}
                          onChange={(next) => handleHeadChange(head.index, 'photos', next)}
                          pathBase={`${photoPathBase(head.id || head.index + 1)}/head`}
                          docPath={visitDocPath}
                          disabled={photosDisabled}
                          disabledReason="Save the visit first before adding photos"
                          isDark={isDark}
                        />
                      </td>
                    </tr>
                    {history.length > 0 && (
                      <tr>
                        <td colSpan="4" style={{ padding: '4px 8px', backgroundColor: isDark ? '#1a1a2e' : '#f0f0f5' }}>
                          <button
                            onClick={() => setExpandedHistory(prev => ({ ...prev, [historyKey]: !prev[historyKey] }))}
                            className="btn btn-sm btn-outline-secondary"
                            style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                          >
                            {isHistoryExpanded ? '▼' : '▶'} Past Issues ({history.length})
                          </button>
                          {isHistoryExpanded && (
                            <div style={{ marginTop: '6px', paddingLeft: '8px' }}>
                              {history.map((entry, hIdx) => (
                                <div key={hIdx} style={{ marginBottom: '4px', fontSize: '0.85rem' }}>
                                  <strong>{new Date(entry.date).toLocaleDateString()}:</strong>{' '}
                                  {entry.issues.length > 0 ? entry.issues.map((iss, iIdx) => (
                                    <span
                                      key={iIdx}
                                      style={{
                                        display: 'inline-block',
                                        padding: '1px 6px',
                                        borderRadius: '3px',
                                        marginLeft: '4px',
                                        fontSize: '0.8rem',
                                        fontWeight: 'bold',
                                        color: '#000',
                                        backgroundColor: iss.fixed === 'fixed' ? 'orange' :
                                          iss.fixed === 'active_with_issues' ? 'lightblue' : 'lightcoral'
                                      }}
                                    >
                                      {iss.type} - {iss.fixed === 'fixed' ? 'Fixed' : iss.fixed === 'active_with_issues' ? 'Active w/ Issues' : 'Not Fixed'}
                                    </span>
                                  )) : <span className="text-muted">Offline (no issues logged)</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <label>
        <input type="checkbox" checked={localLine.showSpanAdjust} onChange={toggleSpanAdjust} /> Span Adjust
      </label>
      {localLine.showSpanAdjust && (
        <>
          <SpanAdjust heads={localLine.heads} updateHeadWeight={(i, field, value) => updateHeadWeight(i, field, value)} />
          <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
            <button type="button" onClick={clearSpanCurrentWeights} className="btn btn-sm btn-outline-warning">
              Clear Current Weights
            </button>
            <div className="input-group input-group-sm" style={{ width: 'auto' }}>
              <input
                type="number"
                className="form-control"
                placeholder="e.g. 200"
                value={spanAllValue}
                onChange={(e) => setSpanAllValue(e.target.value)}
                style={{ maxWidth: '90px' }}
              />
              <span className="input-group-text">g</span>
              <button type="button" onClick={applyAllSpanWeights} className="btn btn-outline-primary">
                Set All Span Weights
              </button>
            </div>
          </div>
          <button onClick={() => setShowSpanPreview(true)} className="btn btn-primary" style={{ marginTop: '10px' }}>
            Span Calibration PDF…
          </button>

          <SpanAdjustLog
            workspaceId={userId}
            customerId={customerId}
            line={localLine}
            performedByName={performedByName}
            role={logRole}
            visitId={visitId}
          />
        </>
      )}
      {showSpanPreview && (
        <SpanCalPreview
          line={localLine}
          globalData={globalData}
          buildPdf={buildSpanCalibrationPDF}
          onClose={() => setShowSpanPreview(false)}
          onSave={(merged) => { setLocalLine(merged); updateLine(merged); }}
        />
      )}

      <label>
        <input type="checkbox" name="showAudit" checked={!!localLine.showAudit} onChange={handleCheckbox} /> Audit
      </label>
      {localLine.showAudit && (
        <Audit
          audit={localLine.audit}
          onChange={updateAudit}
          notes={localLine.auditNotes || ''}
          onNotesChange={updateAuditNotes}
        />
      )}
      <div className="notes-container">
        <label><strong>Notes:</strong></label>
        <textarea name="notes" rows="4" value={localLine.notes} onChange={handleChange} />
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
        <button onClick={() => exportLineToPDF(line)} className="btn btn-success">
          Export Line PDF
        </button>
        <button onClick={() => setShowCombined(true)} className="btn btn-primary">
          Export PDF…
        </button>
        <button onClick={() => resetLine(line)} className="btn btn-warning">
          Reset Line
        </button>
        <button onClick={() => removeLine(line.id)} className="btn btn-danger">
          Remove Line
        </button>
      </div>
      {showCombined && (
        <CombinedExport line={localLine} buildPdf={buildCombinedPDF} onClose={() => setShowCombined(false)} />
      )}
      </div>
      <HeadIssueModal
        head={issueModalHead != null && localLine.heads[issueModalHead]
          ? { ...localLine.heads[issueModalHead], index: issueModalHead }
          : null}
        lineTitle={localLine.title}
        isDark={isDark}
        issueTypes={issueTypes}
        getFixedLabel={getFixedLabel}
        onClose={() => setIssueModalHead(null)}
        addIssue={addIssue}
        updateIssue={updateIssue}
        removeIssue={removeIssue}
        toggleFixedStatus={toggleFixedStatus}
        onHeadChange={handleHeadChange}
        photosDisabled={photosDisabled}
        photoPathBase={photoPathBase}
        visitDocPath={visitDocPath}
      />

      {pendingAction && (
        <PinPrompt
          customerId={customerId}
          people={crewPeople}
          title="Who is making this change?"
          message="Taking a head offline or marking it fixed is recorded against you."
          onVerified={(p) => {
            rememberActor(p);
            const run = pendingAction;
            setPendingAction(null);
            run(p.name);
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}
      {dialog.DialogComponent}
    </div>
  );
};

export default React.memo(Line);
