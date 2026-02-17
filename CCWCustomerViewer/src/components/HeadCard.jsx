import { useState } from 'react';
import IssueList from './IssueList';
import { buildHeadIssueHistory } from '../utils/headHistory';

const HeadCard = ({ head, headNumber, allVisits, currentVisitId, lineTitle }) => {
  const [showHistory, setShowHistory] = useState(false);
  // Migrate old format to new format if needed
  const issues = head.issues && Array.isArray(head.issues)
    ? head.issues
    : head.error && head.error !== 'None'
      ? [{ type: head.error, fixed: head.fixed || 'na', notes: head.notes || '' }]
      : [];

  const isOffline = head.status === 'offline';
  const hasIssues = issues.length > 0;
  const allFixed = hasIssues && issues.every(iss => iss.fixed === 'fixed');
  const someActiveWithIssues = hasIssues && issues.some(iss => iss.fixed === 'active_with_issues');

  // Determine card color
  let cardClass = 'head-card';
  if (isOffline) {
    if (allFixed) {
      cardClass += ' head-fixed';
    } else if (someActiveWithIssues) {
      cardClass += ' head-active-issues';
    } else {
      cardClass += ' head-offline';
    }
  } else if (hasIssues) {
    if (allFixed) {
      cardClass += ' head-fixed';
    } else if (someActiveWithIssues) {
      cardClass += ' head-active-issues';
    } else {
      cardClass += ' head-has-issues';
    }
  } else {
    cardClass += ' head-active';
  }

  return (
    <div className={cardClass}>
      <div className="head-header">
        <span className="head-number">Head #{headNumber}</span>
        <span className={`badge ${isOffline ? 'bg-danger' : 'bg-success'}`}>
          {isOffline ? 'Offline' : 'Active'}
        </span>
      </div>

      {hasIssues && (
        <div className="head-issues">
          <IssueList issues={issues} />
        </div>
      )}

      {head.notes && (
        <div className="head-notes">
          <small className="text-muted">Notes:</small>
          <p className="mb-0">{head.notes}</p>
        </div>
      )}

      {!hasIssues && !head.notes && (
        <div className="head-ok">
          <span className="text-success">No issues</span>
        </div>
      )}

      {/* Past Issues History */}
      {isOffline && (() => {
        const history = buildHeadIssueHistory(lineTitle, headNumber, allVisits, currentVisitId);
        if (history.length === 0) return null;
        return (
          <div className="head-history" style={{ marginTop: '8px', borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: '6px' }}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8rem',
                color: 'inherit',
                padding: '2px 0',
                fontWeight: 'bold'
              }}
            >
              {showHistory ? '▼' : '▶'} Past Issues ({history.length})
            </button>
            {showHistory && (
              <div style={{ marginTop: '4px', fontSize: '0.82rem' }}>
                {history.map((entry, hIdx) => (
                  <div key={hIdx} style={{ marginBottom: '4px' }}>
                    <strong>{new Date(entry.date).toLocaleDateString()}:</strong>{' '}
                    {entry.issues.length > 0 ? entry.issues.map((iss, iIdx) => (
                      <span
                        key={iIdx}
                        style={{
                          display: 'inline-block',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          marginLeft: '4px',
                          fontSize: '0.78rem',
                          fontWeight: 'bold',
                          color: '#000',
                          backgroundColor: iss.fixed === 'fixed' ? 'orange' :
                            iss.fixed === 'active_with_issues' ? 'lightblue' : 'lightcoral'
                        }}
                      >
                        {iss.type} - {iss.fixed === 'fixed' ? 'Fixed' : iss.fixed === 'active_with_issues' ? 'Active w/ Issues' : 'Not Fixed'}
                      </span>
                    )) : <span style={{ opacity: 0.7 }}>Offline (no issues logged)</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default HeadCard;
