import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getShareData, getVisitData, subscribeToVisit, getAllVisits, getSpecificVisit } from '../services/firebase';
import Header from './Header';
import VisitDashboard from './VisitDashboard';
import LineDetail from './LineDetail';
import OfflineHeadsDashboard from './OfflineHeadsDashboard';
import FactoryView from './FactoryView';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { LayoutGrid, AlertCircle, Factory } from 'lucide-react';

const CustomerViewer = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [visit, setVisit] = useState(null);
  const [allVisits, setAllVisits] = useState([]);
  const [selectedVisitId, setSelectedVisitId] = useState(null);
  const [selectedLine, setSelectedLine] = useState(null);
  const [viewMode, setViewMode] = useState('lines'); // 'lines' or 'dashboard'
  const [showAllVisits, setShowAllVisits] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setIsDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Load share and visit data
  useEffect(() => {
    let unsubscribe = null;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      // Get share data
      const shareResult = await getShareData(token);
      if (shareResult.error) {
        setError(shareResult.error);
        setLoading(false);
        return;
      }

      setShareData(shareResult.data);
      setSelectedVisitId(shareResult.data.visitId);

      // Get visit data
      const visitResult = await getVisitData(shareResult.data);
      if (visitResult.error) {
        setError(visitResult.error);
        setLoading(false);
        return;
      }

      setCustomer(visitResult.customer);
      setVisit({ id: shareResult.data.visitId, ...visitResult.visit });

      // Load all visits for the customer
      const allVisitsResult = await getAllVisits(shareResult.data);
      if (allVisitsResult.success) {
        setAllVisits(allVisitsResult.visits);
      }

      setLoading(false);

      // Subscribe to real-time updates
      unsubscribe = subscribeToVisit(shareResult.data, shareResult.data.visitId, (update) => {
        if (update.success) {
          setVisit(update.visit);
        }
      });
    };

    loadData();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [token]);

  // Handle visit change
  const handleVisitChange = async (visitId) => {
    if (!shareData || visitId === selectedVisitId) return;

    setSelectedVisitId(visitId);
    setSelectedLine(null); // Reset line selection

    const result = await getSpecificVisit(shareData, visitId);
    if (result.success) {
      setVisit(result.visit);
    }
  };

  const handlePrint = () => {
    if (!visit || !visit.lines) return;

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageHeight = doc.internal.pageSize.height;

    const migrateHeadData = (head) => {
      if (head.issues && Array.isArray(head.issues)) return head;
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

    const migratedLines = visit.lines.map(line => ({
      ...line,
      heads: line.heads.map(migrateHeadData)
    }));

    const headHasIssues = (head) => {
      const issues = head.issues || [];
      return head.status !== 'active' || issues.length > 0;
    };

    const getIssuesText = (head) => {
      const issues = head.issues || [];
      return issues.length > 0 ? issues.map(iss => iss.type).join(', ') : 'None';
    };

    const getHeadFixedStatus = (head) => {
      const issues = head.issues || [];
      if (issues.length === 0) return 'N/A';
      const allFixed = issues.every(iss => iss.fixed === 'fixed');
      const someActiveWithIssues = issues.some(iss => iss.fixed === 'active_with_issues');
      if (allFixed) return 'Fixed';
      if (someActiveWithIssues) return 'Active w/ Issues';
      return 'Not Fixed';
    };

    const logoUrl = 'https://i.imgur.com/GQRZTtW.png';
    doc.addImage(logoUrl, 'PNG', 14, 10, 30, 15);

    doc.setFontSize(16);
    doc.text('Equipment Status Report', 105, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Customer: ${customer?.name || 'N/A'}`, 105, 28, { align: 'center' });
    if (visit.name) {
      doc.text(`Visit: ${visit.name}`, 105, 34, { align: 'center' });
    }

    let y = 45;

    migratedLines.forEach((line) => {
      const issueHeads = line.heads.filter(head => headHasIssues(head));
      const hasIssues = issueHeads.length > 0;

      if (y + 40 > pageHeight - 20) {
        doc.addPage();
        doc.addImage(logoUrl, 'PNG', 14, 10, 30, 15);
        y = 35;
      }

      doc.setFontSize(12);
      doc.text(line.title, 14, y);
      y += 6;

      if (line.notes) {
        doc.setFontSize(10);
        const text = `Notes: ${line.notes}`;
        const lines = doc.splitTextToSize(text, 182);
        doc.text(lines, 14, y);
        y += lines.length * 4 + 5;
      }

      if (hasIssues) {
        const headData = issueHeads.map(head => [
          head.id,
          head.status,
          getIssuesText(head),
          getHeadFixedStatus(head),
          head.notes || ''
        ]);

        doc.autoTable({
          startY: y,
          head: [['Head #', 'Status', 'Issues', 'Fixed', 'Notes']],
          body: headData,
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [0, 102, 204], textColor: 255, fontStyle: 'bold' },
          columnStyles: {
            0: { halign: 'center', cellWidth: 18 },
            1: { halign: 'center', cellWidth: 25 },
            2: { halign: 'left', cellWidth: 40 },
            3: { halign: 'center', cellWidth: 25 },
            4: { halign: 'left', cellWidth: 65 }
          },
          margin: { left: 14, right: 14 },
        });
        y = doc.lastAutoTable.finalY + 8;
      } else {
        doc.setFontSize(10);
        doc.text('No issues found', 14, y);
        y += 10;
      }

      y += 5;
    });

    doc.save(`${customer?.name || 'equipment'}-report.pdf`);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="mt-3">Loading your equipment status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <div className="card mx-auto" style={{ maxWidth: '500px' }}>
          <div className="card-body text-center py-5">
            <div className="text-danger mb-3">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
            </div>
            <h3 className="h5 mb-3">Unable to Load</h3>
            <p className="text-muted">{error}</p>
            <a href="/" className="btn btn-primary mt-3">Go Home</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="customer-viewer">
      <Header
        customerName={customer?.name || shareData?.customerName}
        visitName={visit?.name}
        visitDate={visit?.date}
        isDark={isDark}
        onToggleDark={() => setIsDark(!isDark)}
        onPrint={handlePrint}
        serviceReportUrl={visit?.serviceReportUrl}
      />

      {/* Visit selector and view toggle */}
      <div className="view-controls">
        <div className="container-fluid">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            {/* Visit Selector */}
            <div className="d-flex align-items-center gap-2">
              <label className="small text-muted mb-0">Visit:</label>
              <select
                value={selectedVisitId || ''}
                onChange={(e) => handleVisitChange(e.target.value)}
                className="form-select form-select-sm"
                style={{ minWidth: '200px' }}
              >
                {allVisits.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name || 'Unnamed'} - {new Date(v.date).toLocaleDateString()}
                  </option>
                ))}
              </select>
              {allVisits.length > 1 && (
                <span className="badge bg-secondary">{allVisits.length} visits</span>
              )}
            </div>

            {/* View Toggle */}
            <div className="d-flex align-items-center gap-3">
              <div className="btn-group" role="group">
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'lines' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => { setViewMode('lines'); setSelectedLine(null); }}
                >
                  <LayoutGrid size={16} className="me-1" />
                  Lines Overview
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'dashboard' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => { setViewMode('dashboard'); setSelectedLine(null); }}
                >
                  <AlertCircle size={16} className="me-1" />
                  Offline Heads
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'factory' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => { setViewMode('factory'); setSelectedLine(null); }}
                >
                  <Factory size={16} className="me-1" />
                  Factory View
                </button>
              </div>

              {viewMode === 'dashboard' && allVisits.length > 1 && (
                <div className="form-check mb-0">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="showAllVisits"
                    checked={showAllVisits}
                    onChange={(e) => setShowAllVisits(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="showAllVisits">
                    All Visits
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="viewer-content">
        <div className="container-fluid py-3">
          {selectedLine ? (
            <LineDetail
              line={selectedLine}
              onBack={() => setSelectedLine(null)}
              allVisits={allVisits}
              currentVisitId={selectedVisitId}
            />
          ) : viewMode === 'dashboard' ? (
            <OfflineHeadsDashboard
              lines={visit?.lines || []}
              allVisits={showAllVisits ? allVisits : null}
              currentVisitName={visit?.name}
              allVisitsForHistory={allVisits}
              currentVisitId={selectedVisitId}
            />
          ) : viewMode === 'factory' ? (
            <FactoryView
              shareData={shareData}
              lines={visit?.lines || []}
              visitId={selectedVisitId}
              onSelectLine={setSelectedLine}
            />
          ) : (
            <VisitDashboard
              lines={visit?.lines || []}
              onSelectLine={setSelectedLine}
            />
          )}
        </div>
      </main>

      <footer className="viewer-footer">
        <div className="container-fluid">
          <div className="d-flex justify-content-between align-items-center">
            <small className="text-muted">
              Last updated: {visit?.date ? new Date(visit.date).toLocaleString() : 'N/A'}
            </small>
            <small className="text-muted">
              Real-time updates enabled
            </small>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default CustomerViewer;
