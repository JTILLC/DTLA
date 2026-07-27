import { AlertCircle, CheckCircle, AlertTriangle, Info } from 'lucide-react';

const VisitDashboard = ({ lines, onSelectLine }) => {
  // Helper to calculate line status
  const getLineStatus = (line) => {
    const offlineHeads = line.heads.filter(h => h.status === 'offline');
    const headsWithIssues = line.heads.filter(h => {
      const issues = h.issues || [];
      return issues.length > 0 || (h.error && h.error !== 'None');
    });

    if (offlineHeads.length === 0 && headsWithIssues.length === 0) {
      return { status: 'good', color: 'success', icon: CheckCircle };
    }

    // Check if all issues are fixed
    const allFixed = headsWithIssues.every(h => {
      const issues = h.issues || [];
      if (issues.length === 0 && h.error && h.error !== 'None') {
        return h.fixed === 'fixed';
      }
      return issues.every(iss => iss.fixed === 'fixed');
    });

    // Check if some have active_with_issues status
    const someActiveWithIssues = headsWithIssues.some(h => {
      const issues = h.issues || [];
      if (issues.length === 0 && h.error && h.error !== 'None') {
        return h.fixed === 'active_with_issues';
      }
      return issues.some(iss => iss.fixed === 'active_with_issues');
    });

    // An offline head with no fixed resolution (incl. one with no issue logged)
    // keeps the line DOWN — don't let a vacuous allFixed show it as green/fixed.
    const anyOfflineUnfixed = offlineHeads.some(h => {
      const issues = h.issues || [];
      if (issues.length === 0) return !(h.error && h.error !== 'None' && h.fixed === 'fixed');
      return !issues.every(iss => iss.fixed === 'fixed');
    });

    if (anyOfflineUnfixed && !someActiveWithIssues) {
      return { status: 'offline', color: 'danger', icon: AlertCircle };
    }
    if (allFixed && !anyOfflineUnfixed) {
      return { status: 'fixed', color: 'warning', icon: AlertTriangle };
    }
    if (someActiveWithIssues) {
      return { status: 'active_issues', color: 'info', icon: Info };
    }
    if (offlineHeads.length > 0) {
      return { status: 'offline', color: 'danger', icon: AlertCircle };
    }
    return { status: 'issues', color: 'danger', icon: AlertCircle };
  };

  // Count stats for a line
  const getLineStats = (line) => {
    const total = line.heads.length;
    const offline = line.heads.filter(h => h.status === 'offline').length;
    const withIssues = line.heads.filter(h => {
      const issues = h.issues || [];
      return issues.length > 0 || (h.error && h.error !== 'None');
    }).length;

    return { total, offline, withIssues };
  };

  // Calculate overall stats
  const totalLines = lines.length;
  const linesWithIssues = lines.filter(l => {
    const { status } = getLineStatus(l);
    return status !== 'good';
  }).length;
  const totalHeads = lines.reduce((sum, l) => sum + l.heads.length, 0);
  const totalOffline = lines.reduce((sum, l) =>
    sum + l.heads.filter(h => h.status === 'offline').length, 0
  );

  // An offline head counts as "repaired" when all of its logged issues are marked fixed.
  const isHeadRepaired = (h) => {
    const issues = h.issues || [];
    if (issues.length === 0 && h.error && h.error !== 'None') {
      return h.fixed === 'fixed';
    }
    return issues.length > 0 && issues.every(iss => iss.fixed === 'fixed');
  };
  const totalRepaired = lines.reduce((sum, l) =>
    sum + l.heads.filter(h => h.status === 'offline' && isHeadRepaired(h)).length, 0
  );

  // Addressed but not fully fixed: put back active while some issues remain.
  const isHeadActiveWithIssues = (h) => {
    if (isHeadRepaired(h)) return false;
    const issues = h.issues || [];
    if (issues.length === 0 && h.error && h.error !== 'None') {
      return h.fixed === 'active_with_issues';
    }
    return issues.some(iss => iss.fixed === 'active_with_issues');
  };
  const totalActiveWithIssues = lines.reduce((sum, l) =>
    sum + l.heads.filter(h => h.status === 'offline' && isHeadActiveWithIssues(h)).length, 0
  );

  return (
    <div className="visit-dashboard">
      {/* Summary Stats */}
      <div className="dashboard-summary">
        <div className="stat-card">
          <div className="stat-value">{totalLines}</div>
          <div className="stat-label">Total Lines</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalHeads}</div>
          <div className="stat-label">Total Heads</div>
        </div>
        <div className="stat-card stat-danger">
          <div className="stat-value">{totalOffline}</div>
          <div className="stat-label">Offline Heads</div>
          {/* Colours come from theme tokens so they stay legible on the white
              light-mode card as well as the dark one. */}
          {totalOffline > 0 && (
            <div className="stat-sublabel">
              <span className="stat-sub-good">{totalRepaired} of {totalOffline} repaired</span>
              {totalActiveWithIssues > 0 && (
                <span className="stat-sub-info"> · {totalActiveWithIssues} active w/ issues</span>
              )}
            </div>
          )}
        </div>
        <div className="stat-card stat-warning">
          <div className="stat-value">{linesWithIssues}</div>
          <div className="stat-label">Lines with Issues</div>
        </div>
      </div>

      {/* Lines Grid */}
      <h5 className="mt-4 mb-3">Equipment Lines</h5>
      <div className="lines-grid">
        {lines.map((line) => {
          const { status, color, icon: Icon } = getLineStatus(line);
          const { total, offline, withIssues } = getLineStats(line);

          return (
            <div
              key={line.id}
              className={`line-card line-card-${color}`}
              onClick={() => onSelectLine(line)}
            >
              <div className="line-card-header">
                <Icon size={20} className={`text-${color}`} />
                <h6 className="mb-0">{line.title}</h6>
              </div>

              <div className="line-card-body">
                <div className="line-stats">
                  <span>{total} heads</span>
                  {offline > 0 && (
                    <span className="text-danger">{offline} offline</span>
                  )}
                  {withIssues > 0 && offline === 0 && (
                    <span className="text-warning">{withIssues} with issues</span>
                  )}
                </div>

                {line.notes && (
                  <p className="line-card-notes text-muted small mb-0 mt-2">
                    {line.notes.length > 60 ? line.notes.substring(0, 60) + '...' : line.notes}
                  </p>
                )}
              </div>

              <div className="line-card-footer">
                <span className={`badge bg-${color}`}>
                  {status === 'good' ? 'All Good' :
                    status === 'fixed' ? 'Issues Fixed' :
                      status === 'active_issues' ? 'Active w/ Issues' :
                        'Needs Attention'}
                </span>
                <span className="text-muted small">Click for details</span>
              </div>
            </div>
          );
        })}
      </div>

      {lines.length === 0 && (
        <div className="text-center py-5 text-muted">
          <p>No equipment lines found in this visit.</p>
        </div>
      )}
    </div>
  );
};

export default VisitDashboard;
