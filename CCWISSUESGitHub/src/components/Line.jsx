import React, { useState, useEffect } from 'react';
import SpanAdjust from './SpanAdjust.jsx';
import { buildHeadIssueHistory } from '../utils/headHelpers.js';

const issueTypes = [
  'None', 'Chute', 'Operator', 'Load Cell', 'Detached Head', 'Stepper Motor Error',
  'Hopper Issues', 'Installed Wrong', 'Radial Feeder', 'Booster Hopper Issues', 'Other'
];

// Migrate old single-error format to new multi-issue format
const migrateHeadData = (head) => {
  // If already has issues array, return as-is
  if (head.issues && Array.isArray(head.issues)) {
    return head;
  }

  // Convert old format to new format
  const migratedHead = {
    ...head,
    issues: []
  };

  // If there was an old error field and it wasn't "None", convert it
  if (head.error && head.error !== 'None') {
    migratedHead.issues.push({
      type: head.error,
      fixed: head.fixed || 'na',
      notes: head.notes || ''
    });
    // Clear old fields to avoid confusion
    migratedHead.error = 'None';
    migratedHead.notes = '';
  }

  return migratedHead;
};

const Line = ({ line, updateLine, removeLine, resetLine, isVisible, exportLineToPDF, isDark, visits, currentVisitId }) => {
  const [expandedHistory, setExpandedHistory] = useState({});
  // Migrate heads on initial load
  const migratedLine = {
    ...line,
    heads: line.heads.map(migrateHeadData)
  };

  const [localLine, setLocalLine] = useState(migratedLine);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showActiveHeads, setShowActiveHeads] = useState(false);
  const [showLineDetails, setShowLineDetails] = useState(false);

  useEffect(() => {
    console.debug('Line component updated with new prop:', line);
    // Migrate heads when prop changes
    const migrated = {
      ...line,
      heads: line.heads.map(migrateHeadData)
    };
    setLocalLine(migrated);
  }, [line]);

  const handleChange = (e) => {
    console.debug(`Line field changed: ${e.target.name}=${e.target.value}`);
    const updated = { ...localLine, [e.target.name]: e.target.value };
    setLocalLine(updated);
    updateLine(updated);
  };

  const handleCheckbox = (e) => {
    console.debug(`Checkbox changed: ${e.target.name}=${e.target.checked}`);
    const updated = { ...localLine, [e.target.name]: e.target.checked };
    setLocalLine(updated);
    updateLine(updated);
  };

  const handleHeadChange = (index, field, value) => {
    console.debug(`Head ${index + 1} changed: ${field}=${value}`);
    const updatedHeads = localLine.heads.map((h, j) => j === index ? { ...h, [field]: value } : h);
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  const toggleSpanAdjust = (e) => {
    const checked = e.target.checked;
    console.debug(`Toggling span adjust for line ${line.id}: ${checked}`);
    if (!checked) {
      if (window.confirm("Are you sure you want to hide and clear Span Adjust data?")) {
        const updatedHeads = localLine.heads.map(head => ({
          ...head,
          currentWeight: 0,
          spanWeight: 0,
          weightDifference: 0,
        }));
        const updated = { ...localLine, showSpanAdjust: false, heads: updatedHeads };
        setLocalLine(updated);
        updateLine(updated);
      } else {
        e.target.checked = true;
      }
    } else {
      const updated = { ...localLine, showSpanAdjust: true };
      setLocalLine(updated);
      updateLine(updated);
    }
  };

  const updateHeadWeight = (index, field, value) => {
    console.debug(`Updating weight for head ${index + 1}: ${field}=${value}`);
    const updatedHeads = localLine.heads.map((h, j) => j === index ? {
      ...h,
      [field]: parseFloat(value) || 0,
      weightDifference: (field === 'spanWeight' ? parseFloat(value) || 0 : h.spanWeight) - (field === 'currentWeight' ? parseFloat(value) || 0 : h.currentWeight)
    } : h);
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

  const quickToggleHead = (index, isOffline) => {
    const updatedHeads = localLine.heads.map((h, j) =>
      j === index ? { ...h, status: isOffline ? 'offline' : 'active' } : h
    );
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
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
          issues: [...issues, { type: 'Chute', fixed: 'not_fixed', notes: '' }]
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
  const toggleFixedStatus = (headIndex, issueIndex) => {
    const statusOrder = ['not_fixed', 'fixed', 'active_with_issues'];
    const updatedHeads = localLine.heads.map((h, j) => {
      if (j === headIndex) {
        const issues = [...(h.issues || [])];
        const currentStatus = issues[issueIndex].fixed;
        const currentIdx = statusOrder.indexOf(currentStatus);
        const nextIdx = (currentIdx + 1) % statusOrder.length;
        issues[issueIndex] = { ...issues[issueIndex], fixed: statusOrder[nextIdx] };
        return { ...h, issues };
      }
      return h;
    });
    const updated = { ...localLine, heads: updatedHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

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
  const changeHeadCount = (newCount) => {
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
      if (!window.confirm(`This will remove ${currentCount - count} head(s) from the end. Continue?`)) return;
      newHeads = localLine.heads.slice(0, count);
    } else {
      return; // No change
    }

    const updated = { ...localLine, heads: newHeads };
    setLocalLine(updated);
    updateLine(updated);
  };

  console.log('Rendering Line component - id:', line.id, 'isVisible:', isVisible, 'localLine:', localLine);

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
      {showLineDetails && (
        <div className="line-fields">
          <label>Model:</label>
          <input type="text" name="model" value={localLine.model} onChange={handleChange} />
          <label>Job Number:</label>
          <input type="text" name="jobNumber" value={localLine.jobNumber} onChange={handleChange} />
          <label>Serial Number:</label>
          <input type="text" name="serialNumber" value={localLine.serialNumber} onChange={handleChange} />
          <label>Head Count:</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
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

            // Determine button color based on status and issues
            let btnClass = 'btn-success'; // Default green for active
            let titleText = 'Click to set Offline';

            if (head.status === 'offline') {
              if (allFixed) {
                btnClass = 'btn-warning'; // Orange - all issues fixed
                titleText = 'All issues fixed';
              } else if (someActiveWithIssues) {
                btnClass = 'btn-info'; // Blue - some active with issues
                titleText = 'Active with issues';
              } else {
                btnClass = 'btn-danger'; // Red for offline with unfixed issues
                titleText = 'Click to set Active';
              }
            } else if (hasIssues) {
              // Active but has issues logged
              btnClass = 'btn-info';
              titleText = 'Active with issues logged';
            }

            return (
              <button
                key={i}
                onClick={() => quickToggleHead(i, head.status === 'active')}
                className={`btn btn-sm ${btnClass}`}
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
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <small className="text-muted d-block mt-2" style={{ textAlign: 'center', maxWidth: '700px', margin: '0.5rem auto 0' }}>
          <span className="badge bg-success me-1">Green</span> Active
          <span className="badge bg-danger ms-2 me-1">Red</span> Offline (Not Fixed)
          <span className="badge bg-warning text-dark ms-2 me-1">Orange</span> All Issues Fixed
          <span className="badge bg-info text-dark ms-2 me-1">Blue</span> Active with Issues
        </small>
      </div>

      {/* Offline Heads Section */}
      {offlineHeads.length > 0 && (
        <div className="mb-3">
          <h6 className="text-danger"><strong>Offline Heads ({offlineHeads.length})</strong></h6>
          <table>
            <thead>
              <tr>
                <th>Head #</th>
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
                    style={{
                      backgroundColor:
                        allFixed ? 'orange' :
                        hasActiveWithIssues ? 'lightblue' :
                        'lightcoral',
                    }}
                  >
                    <td data-label="Head #" style={{ verticalAlign: 'top', fontWeight: 'bold' }}>{head.index + 1}</td>
                    <td data-label="Status" style={{ verticalAlign: 'top' }}>
                      <select value={head.status} onChange={(e) => handleHeadChange(head.index, 'status', e.target.value)}>
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
                          </div>
                        ))}
                        <button
                          onClick={() => addIssue(head.index)}
                          className="btn btn-sm btn-primary"
                          style={{ alignSelf: 'flex-start' }}
                        >
                          + Add Issue
                        </button>
                      </div>
                    </td>
                    <td data-label="Head Notes" style={{ verticalAlign: 'top' }}>
                      <input
                        type="text"
                        placeholder="General head notes..."
                        value={head.notes}
                        onChange={(e) => handleHeadChange(head.index, 'notes', e.target.value)}
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
            <table>
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

                  return (
                    <tr
                      key={head.index}
                      style={{
                        backgroundColor: hasIssuesOrNotes ? 'lightblue' : '#28a745',
                      }}
                    >
                      <td data-label="Head #" style={{ verticalAlign: 'top', fontWeight: 'bold' }}>{head.index + 1}</td>
                      <td data-label="Status" style={{ verticalAlign: 'top' }}>
                        <select value={head.status} onChange={(e) => handleHeadChange(head.index, 'status', e.target.value)}>
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
                            </div>
                          ))}
                          <button
                            onClick={() => addIssue(head.index)}
                            className="btn btn-sm btn-outline-primary"
                            style={{ alignSelf: 'flex-start' }}
                          >
                            + Add Issue
                          </button>
                        </div>
                      </td>
                      <td data-label="Head Notes" style={{ verticalAlign: 'top' }}>
                        <input
                          type="text"
                          placeholder="General head notes..."
                          value={head.notes}
                          onChange={(e) => handleHeadChange(head.index, 'notes', e.target.value)}
                        />
                      </td>
                    </tr>
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
        <SpanAdjust heads={localLine.heads} updateHeadWeight={(i, field, value) => updateHeadWeight(i, field, value)} />
      )}
      <div className="notes-container">
        <label><strong>Notes:</strong></label>
        <textarea name="notes" rows="4" value={localLine.notes} onChange={handleChange} />
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
        <button onClick={exportLineToPDF} className="btn btn-success">
          Export Line PDF
        </button>
        <button onClick={resetLine} className="btn btn-warning">
          Reset Line
        </button>
        <button onClick={removeLine} className="btn btn-danger">
          Remove Line
        </button>
      </div>
      </div>
    </div>
  );
};

export default Line;
