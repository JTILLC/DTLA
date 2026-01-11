import { useEffect } from 'react';

const Dashboard = ({ lines, setShowDashboardView }) => {
  useEffect(() => {
    console.debug('Dashboard rendered with lines:', lines);
  }, [lines]);

  // Helper function to convert fixed status to readable text
  const getFixedStatusLabel = (status) => {
    switch(status) {
      case 'active_with_issues': return 'Active with Issues';
      case 'na': return 'N/A';
      case 'fixed': return 'Fixed';
      case 'not_fixed': return 'Not Fixed';
      default: return status;
    }
  };

  const offlineHeadsExist = lines.some(line => line.heads.some(head => head.status === 'offline'));

  return (
    <div className="dashboard" style={{ display: 'block' }}>
      <h3>Dashboard: Offline Heads</h3>
      {lines.map(line => {
        const offlineHeads = line.heads.map((head, i) => ({ ...head, index: i + 1 })).filter(head => head.status === 'offline');
        if (offlineHeads.length === 0) return null;
        console.debug('Offline heads for line', line.title, offlineHeads);
        return (
          <div key={line.id}>
            <h4>{line.title}</h4>
            {line.notes && <p><strong>Line Notes:</strong> {line.notes}</p>}
            <table>
              <thead>
                <tr>
                  <th>Head #</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Fixed</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {offlineHeads.map(head => (
                  <tr key={head.index} style={{
                    backgroundColor:
                      head.fixed === 'fixed' ? 'orange' :
                      head.fixed === 'active_with_issues' ? 'lightblue' :
                      'lightcoral' // Red for not fixed
                  }}>
                    <td>{head.index}</td>
                    <td>Offline</td>
                    <td>{head.error}</td>
                    <td>{getFixedStatusLabel(head.fixed)}</td>
                    <td>{head.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {!offlineHeadsExist && <p>No offline heads.</p>}
      <button onClick={() => setShowDashboardView(false)}>Back to Form</button>
    </div>
  );
};

export default Dashboard;