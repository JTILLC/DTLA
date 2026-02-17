import { ArrowLeft } from 'lucide-react';
import HeadCard from './HeadCard';

const LineDetail = ({ line, onBack, allVisits, currentVisitId }) => {
  // Count stats
  const totalHeads = line.heads.length;
  const offlineHeads = line.heads.filter(h => h.status === 'offline').length;
  const activeHeads = totalHeads - offlineHeads;

  // Count fixed
  const fixedHeads = line.heads.filter(h => {
    const issues = h.issues || [];
    if (issues.length === 0 && h.error && h.error !== 'None') {
      return h.fixed === 'fixed';
    }
    return issues.length > 0 && issues.every(iss => iss.fixed === 'fixed');
  }).length;

  return (
    <div className="line-detail">
      <div className="line-detail-header">
        <button onClick={onBack} className="btn btn-outline-secondary btn-sm">
          <ArrowLeft size={16} /> Back to Dashboard
        </button>

        <div className="line-info mt-3">
          <h2 className="h4 mb-2">{line.title}</h2>

          <div className="d-flex gap-3 flex-wrap mb-3">
            <span className="badge bg-success">{activeHeads} Active</span>
            <span className="badge bg-danger">{offlineHeads} Offline</span>
            {fixedHeads > 0 && (
              <span className="badge bg-warning text-dark">{fixedHeads} Fixed</span>
            )}
            <span className="badge bg-secondary">{totalHeads} Total</span>
          </div>

          {line.model && (
            <p className="mb-1"><strong>Model:</strong> {line.model}</p>
          )}
          {line.jobNumber && (
            <p className="mb-1"><strong>Job #:</strong> {line.jobNumber}</p>
          )}
          {line.serialNumber && (
            <p className="mb-1"><strong>Serial #:</strong> {line.serialNumber}</p>
          )}
          {line.running !== undefined && (
            <p className="mb-1">
              <strong>Running:</strong>{' '}
              <span className={line.running ? 'text-success' : 'text-danger'}>
                {line.running ? 'Yes' : 'No'}
              </span>
            </p>
          )}
        </div>

        {line.notes && (
          <div className="line-notes-section">
            <h6>Line Notes</h6>
            <p className="mb-0">{line.notes}</p>
          </div>
        )}
      </div>

      <div className="heads-grid">
        {line.heads.map((head, index) => (
          <HeadCard
            key={head.id || index}
            head={head}
            headNumber={head.id || index + 1}
            allVisits={allVisits}
            currentVisitId={currentVisitId}
            lineTitle={line.title}
          />
        ))}
      </div>
    </div>
  );
};

export default LineDetail;
