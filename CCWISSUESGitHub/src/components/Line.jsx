import { useState, useEffect } from 'react';
import SpanAdjust from './SpanAdjust.jsx';

const Line = ({ line, updateLine, removeLine, resetLine, isVisible, exportLineToPDF, isDark }) => {
  const [localLine, setLocalLine] = useState(line);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showActiveHeads, setShowActiveHeads] = useState(false);
  const [showLineDetails, setShowLineDetails] = useState(false);

  useEffect(() => {
    console.debug('Line component updated with new prop:', line);
    setLocalLine(line); // Sync localLine with prop
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
  const hasIssues = offlineHeads.length > 0 || localLine.heads.some(h => h.error !== 'None' || h.notes.trim() !== '' || h.fixed !== 'na');

  // Auto-collapse active heads if no issues
  useEffect(() => {
    setShowActiveHeads(hasIssues);
  }, [hasIssues]);

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
            // Determine button color based on status and fixed state
            let btnClass = 'btn-success'; // Default green for active
            if (head.fixed === 'fixed') {
              btnClass = 'btn-warning'; // Orange for fixed
            } else if (head.fixed === 'active_with_issues') {
              btnClass = 'btn-info'; // Blue-green for active with issues
            } else if (head.status === 'offline') {
              btnClass = 'btn-danger'; // Red for offline
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
                title={`Head ${i + 1}: ${head.fixed === 'fixed' ? 'Fixed' : head.status === 'offline' ? 'Click to set Active' : 'Click to set Offline'}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <small className="text-muted d-block mt-2" style={{ textAlign: 'center', maxWidth: '700px', margin: '0.5rem auto 0' }}>
          <span className="badge bg-success me-1">Green</span> Active
          <span className="badge bg-danger ms-2 me-1">Red</span> Offline
          <span className="badge bg-warning text-dark ms-2 me-1">Orange</span> Fixed
          <span className="badge bg-info text-dark ms-2 me-1">Blue-Green</span> Active with Issues
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
                <th>Error</th>
                <th>Notes</th>
                <th>Fixed</th>
              </tr>
            </thead>
            <tbody>
              {offlineHeads.map((head) => (
                <tr
                  key={head.index}
                  style={{
                    backgroundColor:
                      head.fixed === 'fixed' ? 'orange' :
                      head.fixed === 'active_with_issues' ? 'lightblue' :
                      'lightcoral', // Red for offline (not fixed)
                  }}
                >
                  <td data-label="Head #">{head.index + 1}</td>
                  <td data-label="Status">
                    <select value={head.status} onChange={(e) => handleHeadChange(head.index, 'status', e.target.value)}>
                      <option value="active">Active</option>
                      <option value="offline">Offline</option>
                    </select>
                  </td>
                  <td data-label="Error">
                    <select value={head.error} onChange={(e) => handleHeadChange(head.index, 'error', e.target.value)}>
                      <option value="None">None</option>
                      <option value="Chute">Chute</option>
                      <option value="Operator">Operator</option>
                      <option value="Load Cell">Load Cell</option>
                      <option value="Detached Head">Detached Head</option>
                      <option value="Stepper Motor Error">Stepper Motor Error</option>
                      <option value="Hopper Issues">Hopper Issues</option>
                      <option value="Installed Wrong">Installed Wrong</option>
                      <option value="Radial Feeder">Radial Feeder</option>
                      <option value="Booster Hopper Issues">Booster Hopper Issues</option>
                      <option value="Other">Other</option>
                    </select>
                  </td>
                  <td data-label="Notes">
                    <input type="text" value={head.notes} onChange={(e) => handleHeadChange(head.index, 'notes', e.target.value)} />
                  </td>
                  <td data-label="Fixed">
                    <select value={head.fixed} onChange={(e) => handleHeadChange(head.index, 'fixed', e.target.value)}>
                      <option value="na">N/A</option>
                      <option value="not_fixed">Not Fixed</option>
                      <option value="fixed">Fixed</option>
                      <option value="active_with_issues">Active with Issues</option>
                    </select>
                  </td>
                </tr>
              ))}
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
                  <th>Error</th>
                  <th>Notes</th>
                  <th>Fixed</th>
                </tr>
              </thead>
              <tbody>
                {activeHeads.map((head) => (
                  <tr
                    key={head.index}
                    style={{
                      backgroundColor:
                        head.fixed === 'fixed' ? 'orange' :
                        head.fixed === 'active_with_issues' ? 'lightblue' : // Blue-green for active with issues
                        '#28a745', // Bootstrap success button green - matches quick toggle
                    }}
                  >
                    <td data-label="Head #">{head.index + 1}</td>
                    <td data-label="Status">
                      <select value={head.status} onChange={(e) => handleHeadChange(head.index, 'status', e.target.value)}>
                        <option value="active">Active</option>
                        <option value="offline">Offline</option>
                      </select>
                    </td>
                    <td data-label="Error">
                      <select value={head.error} onChange={(e) => handleHeadChange(head.index, 'error', e.target.value)}>
                        <option value="None">None</option>
                        <option value="Chute">Chute</option>
                        <option value="Operator">Operator</option>
                        <option value="Load Cell">Load Cell</option>
                        <option value="Detached Head">Detached Head</option>
                        <option value="Stepper Motor Error">Stepper Motor Error</option>
                        <option value="Hopper Issues">Hopper Issues</option>
                        <option value="Installed Wrong">Installed Wrong</option>
                        <option value="Radial Feeder">Radial Feeder</option>
                        <option value="Booster Hopper Issues">Booster Hopper Issues</option>
                        <option value="Other">Other</option>
                      </select>
                    </td>
                    <td data-label="Notes">
                      <input type="text" value={head.notes} onChange={(e) => handleHeadChange(head.index, 'notes', e.target.value)} />
                    </td>
                    <td data-label="Fixed">
                      <select value={head.fixed} onChange={(e) => handleHeadChange(head.index, 'fixed', e.target.value)}>
                        <option value="na">N/A</option>
                        <option value="not_fixed">Not Fixed</option>
                        <option value="fixed">Fixed</option>
                        <option value="active_with_issues">Active with Issues</option>
                      </select>
                    </td>
                  </tr>
                ))}
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
