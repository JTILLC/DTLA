import PhotoStrip from './PhotoStrip';

const IssueList = ({ issues }) => {
  if (!issues || issues.length === 0) {
    return <span className="text-muted fst-italic">No issues logged</span>;
  }

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
      case 'fixed': return 'bg-warning text-dark';
      case 'active_with_issues': return 'bg-info text-dark';
      default: return 'bg-danger text-white';
    }
  };

  return (
    <div className="issue-list">
      {issues.map((issue, idx) => (
        <div key={idx} className={`issue-item ${getIssueColor(issue.fixed)}`}>
          <div className="d-flex justify-content-between align-items-start">
            <strong>{issue.type}</strong>
            <span className="badge bg-dark bg-opacity-25">
              {getFixedStatusLabel(issue.fixed)}
            </span>
          </div>
          {issue.notes && (
            <div className="issue-notes mt-1">
              {issue.notes}
            </div>
          )}
          <PhotoStrip photos={issue.photos} label="Issue photo" />
        </div>
      ))}
    </div>
  );
};

export default IssueList;
