import { useMemo, useState } from 'react';
import { migrateLineHeads, getFixedStatusLabel } from '../utils/headHelpers.js';

const Dashboard = ({ lines, setShowDashboardView }) => {
  const migratedLines = useMemo(() => lines.map(migrateLineHeads), [lines]);
  const [viewer, setViewer] = useState(null);

  // Read-only photo thumbnails (issue or head photos); tap to view full screen.
  const Thumbs = ({ photos }) => (
    Array.isArray(photos) && photos.length > 0 ? (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
        {photos.map((p, i) => (p?.url ? (
          <img
            key={p.path || i}
            src={p.url}
            alt={`Photo ${i + 1}`}
            loading="lazy"
            onClick={() => setViewer(p.url)}
            title="Tap to view"
            style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.25)', cursor: 'pointer', display: 'block' }}
          />
        ) : null))}
      </div>
    ) : null
  );

  // Get background color based on issue status
  const getIssueColor = (fixed) => {
    switch(fixed) {
      case 'fixed': return 'orange';
      case 'active_with_issues': return 'lightblue';
      default: return 'lightcoral';
    }
  };

  // Get row color based on all issues for a head
  const getHeadRowColor = (head) => {
    const issues = head.issues || [];
    // If using old format with single error
    if (issues.length === 0 && head.error && head.error !== 'None') {
      return head.fixed === 'fixed' ? 'orange' :
             head.fixed === 'active_with_issues' ? 'lightblue' : 'lightcoral';
    }
    // New format with issues array
    if (issues.length === 0) return 'lightcoral';
    const allFixed = issues.every(iss => iss.fixed === 'fixed');
    const someActiveWithIssues = issues.some(iss => iss.fixed === 'active_with_issues');
    if (allFixed) return 'orange';
    if (someActiveWithIssues) return 'lightblue';
    return 'lightcoral';
  };

  const hasActiveWithIssues = (head) => {
    const issues = head.issues || [];
    if (issues.length === 0) {
      return head.error && head.error !== 'None' && head.fixed === 'active_with_issues';
    }
    return issues.some(iss => iss.fixed === 'active_with_issues');
  };

  const shouldShowInDashboard = (head) => head.status === 'offline' || hasActiveWithIssues(head);

  const dashboardHeadsExist = migratedLines.some(line => line.heads.some(shouldShowInDashboard));

  return (
    <div className="dashboard" style={{ display: 'block' }}>
      <button onClick={() => setShowDashboardView(false)} style={{ marginBottom: '10px' }}>Back to Form</button>
      <h3>Dashboard: Offline and Active Heads With Issues</h3>
      {migratedLines.map(line => {
        const dashboardHeads = line.heads.map((head, i) => ({ ...head, index: i + 1 })).filter(shouldShowInDashboard);
        if (dashboardHeads.length === 0) return null;
        return (
          <div key={line.id}>
            <h4>{line.title}</h4>
            {line.notes && <p><strong>Line Notes:</strong> {line.notes}</p>}
            <table>
              <thead>
                <tr>
                  <th>Head #</th>
                  <th>Issues</th>
                  <th>Head Notes</th>
                </tr>
              </thead>
              <tbody>
                {dashboardHeads.map(head => {
                  const issues = head.issues || [];
                  // Support old format with single error field
                  const hasOldFormat = issues.length === 0 && head.error && head.error !== 'None';

                  return (
                    <tr key={head.index} style={{ backgroundColor: getHeadRowColor(head) }}>
                      <td style={{ verticalAlign: 'top', fontWeight: 'bold', fontSize: '1.1em' }}>
                        {head.index}
                      </td>
                      <td style={{ verticalAlign: 'top' }}>
                        {hasOldFormat ? (
                          // Old format - single error
                          <div style={{
                            padding: '6px 10px',
                            backgroundColor: getIssueColor(head.fixed),
                            borderRadius: '4px',
                            marginBottom: '4px'
                          }}>
                            <strong>{head.error}</strong>
                            <span style={{ marginLeft: '10px', fontStyle: 'italic' }}>
                              ({getFixedStatusLabel(head.fixed)})
                            </span>
                          </div>
                        ) : issues.length > 0 ? (
                          // New format - multiple issues
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {issues.map((issue, idx) => (
                              <div key={idx} style={{
                                padding: '6px 10px',
                                backgroundColor: getIssueColor(issue.fixed),
                                borderRadius: '4px',
                                border: '1px solid rgba(0,0,0,0.1)'
                              }}>
                                <div>
                                  <strong>{issue.type}</strong>
                                  <span style={{ marginLeft: '10px', fontStyle: 'italic' }}>
                                    ({getFixedStatusLabel(issue.fixed)})
                                  </span>
                                </div>
                                {issue.notes && (
                                  <div style={{ fontSize: '0.9em', marginTop: '4px', color: '#555' }}>
                                    {issue.notes}
                                  </div>
                                )}
                                <Thumbs photos={issue.photos} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: '#666', fontStyle: 'italic' }}>No issues logged</span>
                        )}
                      </td>
                      <td style={{ verticalAlign: 'top' }}>
                        {head.notes || <span style={{ color: '#999' }}>—</span>}
                        <Thumbs photos={head.photos} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {!dashboardHeadsExist && <p>No offline or active-with-issues heads.</p>}
      <button onClick={() => setShowDashboardView(false)}>Back to Form</button>
      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
          <img src={viewer} alt="Photo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          <button type="button" onClick={() => setViewer(null)} aria-label="Close" style={{ position: 'absolute', top: '14px', right: '14px', width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)', color: '#111', fontSize: '20px', fontWeight: 'bold', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
};

export default Dashboard;