import React, { useState } from 'react';
import { buildHeadIssueHistory } from '../utils/headHistory';

const OfflineHeadsDashboard = ({ lines, allVisits, currentVisitName, allVisitsForHistory, currentVisitId }) => {
  const [expandedHistory, setExpandedHistory] = useState({});
  // Migrate old single-error format to new multi-issue format
  const migrateHeadData = (head) => {
    if (head.issues && Array.isArray(head.issues)) {
      return head;
    }
    const migratedHead = { ...head, issues: [] };
    if (head.error && head.error !== 'None') {
      migratedHead.issues.push({
        type: head.error,
        fixed: head.fixed || 'na',
        notes: head.notes || ''
      });
    }
    return migratedHead;
  };

  const getFixedStatusLabel = (status) => {
    switch (status) {
      case 'active_with_issues': return 'Active w/ Issues';
      case 'na': return 'N/A';
      case 'fixed': return 'Fixed';
      case 'not_fixed': return 'Not Fixed';
      default: return status;
    }
  };

  const getIssueColor = (fixed) => {
    switch (fixed) {
      case 'fixed': return '#ffc107';
      case 'active_with_issues': return '#17a2b8';
      default: return '#dc3545';
    }
  };

  const getHeadRowColor = (head) => {
    const issues = head.issues || [];
    if (issues.length === 0 && head.error && head.error !== 'None') {
      return head.fixed === 'fixed' ? '#fff3cd' :
             head.fixed === 'active_with_issues' ? '#d1ecf1' : '#f8d7da';
    }
    if (issues.length === 0) return '#f8d7da';
    const allFixed = issues.every(iss => iss.fixed === 'fixed');
    const someActiveWithIssues = issues.some(iss => iss.fixed === 'active_with_issues');
    if (allFixed) return '#fff3cd';
    if (someActiveWithIssues) return '#d1ecf1';
    return '#f8d7da';
  };

  // Render a single visit's offline heads
  const renderVisitOfflineHeads = (visitLines, visitName, visitDate) => {
    const migratedLines = visitLines.map(line => ({
      ...line,
      heads: line.heads.map(migrateHeadData)
    }));

    const offlineHeadsExist = migratedLines.some(line =>
      line.heads.some(head => head.status === 'offline')
    );

    if (!offlineHeadsExist) {
      return (
        <div key={visitName} className="mb-4 text-center py-3 text-success">
          <small>No offline heads in this visit</small>
        </div>
      );
    }

    return migratedLines.map(line => {
      const offlineHeads = line.heads
        .map((head, i) => ({ ...head, index: head.id || i + 1 }))
        .filter(head => head.status === 'offline');

      if (offlineHeads.length === 0) return null;

      return (
        <div key={`${visitName}-${line.id}`} className="mb-4">
          <h6 className="text-primary">{line.title}</h6>
          {line.notes && (
            <p className="text-muted small mb-2">
              <strong>Line Notes:</strong> {line.notes}
            </p>
          )}

          <div className="table-responsive">
            <table className="table table-bordered">
              <thead className="table-primary">
                <tr>
                  <th style={{ width: '80px' }}>Head #</th>
                  <th>Issues</th>
                  <th style={{ width: '30%' }}>Head Notes</th>
                </tr>
              </thead>
              <tbody>
                {offlineHeads.map(head => {
                  const issues = head.issues || [];
                  const hasOldFormat = issues.length === 0 && head.error && head.error !== 'None';
                  const historyKey = `${line.title}-${head.index}`;
                  const history = buildHeadIssueHistory(line.title, head.index, allVisitsForHistory, currentVisitId);
                  const isHistoryExpanded = expandedHistory[historyKey];

                  return (
                    <React.Fragment key={head.index}>
                    <tr style={{ backgroundColor: getHeadRowColor(head) }}>
                      <td style={{ fontWeight: 'bold', fontSize: '1.1em' }}>
                        {head.index}
                      </td>
                      <td>
                        {hasOldFormat ? (
                          <div style={{
                            padding: '6px 10px',
                            backgroundColor: getIssueColor(head.fixed),
                            borderRadius: '4px',
                            color: head.fixed === 'fixed' ? '#000' : '#fff'
                          }}>
                            <strong>{head.error}</strong>
                            <span style={{ marginLeft: '10px', fontStyle: 'italic' }}>
                              ({getFixedStatusLabel(head.fixed)})
                            </span>
                          </div>
                        ) : issues.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {issues.map((issue, idx) => (
                              <div key={idx} style={{
                                padding: '6px 10px',
                                backgroundColor: getIssueColor(issue.fixed),
                                borderRadius: '4px',
                                color: issue.fixed === 'fixed' ? '#000' : '#fff'
                              }}>
                                <div>
                                  <strong>{issue.type}</strong>
                                  <span style={{ marginLeft: '10px', fontStyle: 'italic' }}>
                                    ({getFixedStatusLabel(issue.fixed)})
                                  </span>
                                </div>
                                {issue.notes && (
                                  <div style={{ fontSize: '0.9em', marginTop: '4px', opacity: 0.9 }}>
                                    {issue.notes}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted fst-italic">No issues logged</span>
                        )}
                      </td>
                      <td>{head.notes || <span className="text-muted">—</span>}</td>
                    </tr>
                    {history.length > 0 && (
                      <tr>
                        <td colSpan="3" style={{ padding: '4px 8px', backgroundColor: '#f0f0f5' }}>
                          <button
                            onClick={() => setExpandedHistory(prev => ({ ...prev, [historyKey]: !prev[historyKey] }))}
                            style={{
                              background: 'none',
                              border: '1px solid #ccc',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              padding: '2px 8px'
                            }}
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
        </div>
      );
    });
  };

  // If showing all visits
  if (allVisits && allVisits.length > 0) {
    const visitsWithOfflineHeads = allVisits.filter(visit =>
      visit.lines?.some(line =>
        line.heads?.some(head => head.status === 'offline')
      )
    );

    return (
      <div className="offline-dashboard">
        <h5 className="mb-4">Offline Heads - All Visits</h5>
        <p className="text-muted small mb-4">
          Showing offline heads from {allVisits.length} visits
          {visitsWithOfflineHeads.length < allVisits.length && (
            <span> ({visitsWithOfflineHeads.length} with issues)</span>
          )}
        </p>

        {visitsWithOfflineHeads.length === 0 ? (
          <div className="text-center py-5 text-success">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-3">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <h6>All heads are online!</h6>
            <p className="text-muted">No offline heads found across all visits.</p>
          </div>
        ) : (
          visitsWithOfflineHeads.map(visit => (
            <div key={visit.id} className="visit-section mb-5">
              <div className="visit-header d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                <h5 className="mb-0">
                  {visit.name || 'Unnamed Visit'}
                </h5>
                <span className="badge bg-secondary">
                  {new Date(visit.date).toLocaleDateString()}
                </span>
              </div>
              {renderVisitOfflineHeads(visit.lines || [], visit.name, visit.date)}
            </div>
          ))
        )}
      </div>
    );
  }

  // Single visit view (original behavior)
  const migratedLines = lines.map(line => ({
    ...line,
    heads: line.heads.map(migrateHeadData)
  }));

  const offlineHeadsExist = migratedLines.some(line =>
    line.heads.some(head => head.status === 'offline')
  );

  return (
    <div className="offline-dashboard">
      <h5 className="mb-4">
        Offline Heads Summary
        {currentVisitName && <small className="text-muted ms-2">- {currentVisitName}</small>}
      </h5>

      {renderVisitOfflineHeads(lines, currentVisitName, null)}

      {!offlineHeadsExist && (
        <div className="text-center py-5 text-success">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-3">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <h6>All heads are online!</h6>
          <p className="text-muted">No offline heads found in this visit.</p>
        </div>
      )}
    </div>
  );
};

export default OfflineHeadsDashboard;
