import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getShareData, getVisitData, subscribeToVisit, getAllVisits, getSpecificVisit } from '../services/firebase';
import Header from './Header';
import VisitDashboard from './VisitDashboard';
import LineDetail from './LineDetail';
import OfflineHeadsDashboard from './OfflineHeadsDashboard';
import FactoryView from './FactoryView';
import MaintenanceLogs from './MaintenanceLogs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LayoutGrid, AlertCircle, Factory, ClipboardList } from 'lucide-react';

// "Updated 2 min ago" reads as a live signal in a way an absolute timestamp
// doesn't — the customer can tell at a glance whether the data is fresh.
const relativeTime = (iso) => {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
};

const CustomerViewer = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [visit, setVisit] = useState(null);
  const [allVisits, setAllVisits] = useState([]);
  const [selectedVisitId, setSelectedVisitId] = useState(null);
  // The live subscription always watches the *shared* visit. Track the visit
  // the user is actually viewing so a background update to the shared visit
  // can't swap the display out from under them after they switch visits.
  const selectedVisitIdRef = useRef(null);
  const [selectedLine, setSelectedLine] = useState(null);
  const [viewMode, setViewMode] = useState('lines'); // 'lines' or 'dashboard'
  const [showAllVisits, setShowAllVisits] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Re-render once a minute so the footer's "updated N min ago" stays honest.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

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
      selectedVisitIdRef.current = shareResult.data.visitId;

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
        // Only apply if the user is still viewing the shared visit — otherwise a
        // live update would yank them off the visit they switched to.
        if (update.success && update.visit?.id === selectedVisitIdRef.current) {
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
    selectedVisitIdRef.current = visitId;
    setSelectedLine(null); // Reset line selection

    const result = await getSpecificVisit(shareData, visitId);
    if (result.success) {
      setVisit(result.visit);
    }
  };

  const handlePrint = async () => {
    if (!visit || !visit.lines) return;

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
      heads: (line.heads || []).map(migrateHeadData)
    }));

    const headHasIssues = (head) => {
      const issues = head.issues || [];
      return head.status !== 'active' || issues.length > 0;
    };

    const getIssuesText = (head) => {
      const issues = head.issues || [];
      return issues.length > 0 ? issues.map(iss => iss.type).join(', ') : 'None';
    };

    const getFixedLabel = (status) => {
      switch(status) {
        case 'fixed': return 'Fixed';
        case 'not_fixed': return 'Not Fixed';
        case 'active_with_issues': return 'Active w/ Issues';
        default: return 'N/A';
      }
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

    // Pre-load logo as base64 to avoid CORS issues
    let logoData = null;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'https://i.imgur.com/GQRZTtW.png';
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      logoData = canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('Could not load logo for PDF:', e);
    }

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageHeight = doc.internal.pageSize.height;
    const margin = 14;

    const addHeader = (startY) => {
      if (logoData) {
        doc.addImage(logoData, 'PNG', margin, 10, 30, 15);
      }
      return startY;
    };

    const checkPageBreak = (currentY, needed) => {
      if (currentY + needed > pageHeight - 20) {
        doc.addPage();
        addHeader(10);
        return 35;
      }
      return currentY;
    };

    // Page 1 header
    addHeader(10);
    doc.setFontSize(16);
    doc.text('Equipment Status Report', 105, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Customer: ${customer?.name || shareData?.customerName || 'N/A'}`, 105, 28, { align: 'center' });
    if (visit.name) {
      doc.text(`Visit: ${visit.name}`, 105, 34, { align: 'center' });
    }

    let y = 45;

    // Lines with issues first, then lines without
    const linesWithIssues = migratedLines.filter(line =>
      line.heads.some(h => headHasIssues(h))
    );
    const linesWithoutIssues = migratedLines.filter(line =>
      !line.heads.some(h => headHasIssues(h))
    );
    const sortedLines = [...linesWithIssues, ...linesWithoutIssues];

    sortedLines.forEach((line) => {
      const issueHeads = line.heads.filter(h => headHasIssues(h));
      const offlineHeads = line.heads.filter(h => h.status === 'offline');
      const hasIssues = issueHeads.length > 0;

      y = checkPageBreak(y, 40);

      // Line title
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text(line.title, margin, y);
      doc.setFont(undefined, 'normal');
      y += 6;

      // Line details (model, job number, serial, running)
      if (line.model || line.jobNumber || line.serialNumber) {
        doc.setFontSize(9);
        doc.setTextColor(100);
        const details = [
          line.model && `Model: ${line.model}`,
          line.jobNumber && `Job #: ${line.jobNumber}`,
          line.serialNumber && `S/N: ${line.serialNumber}`,
          `Running: ${line.running ? 'Yes' : 'No'}`
        ].filter(Boolean).join('  |  ');
        doc.text(details, margin, y);
        doc.setTextColor(0);
        y += 5;
      }

      // Line / machine notes
      if (line.notes && line.notes.trim()) {
        y = checkPageBreak(y, 15);
        doc.setFontSize(10);
        const noteLines = doc.splitTextToSize(`Machine Notes: ${line.notes}`, 182);
        doc.text(noteLines, margin, y);
        y += noteLines.length * 4 + 4;
      }

      // Issues table
      if (hasIssues) {
        const headData = issueHeads.map(head => {
          const issues = head.issues || [];
          const headNum = head.id != null ? head.id : (head.index != null ? head.index + 1 : '?');
          // Combine head notes and per-issue notes
          const allNotes = [];
          if (head.notes && head.notes.trim()) allNotes.push(head.notes.trim());
          issues.forEach(iss => {
            if (iss.notes && iss.notes.trim()) {
              allNotes.push(`${iss.type}: ${iss.notes.trim()}`);
            }
          });

          return [
            headNum,
            head.status,
            getIssuesText(head),
            getHeadFixedStatus(head),
            allNotes.join('\n') || ''
          ];
        });

        autoTable(doc, {
          startY: y,
          head: [['Head #', 'Status', 'Issues', 'Fixed', 'Notes']],
          body: headData,
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
          headStyles: { fillColor: [0, 102, 204], textColor: 255, fontStyle: 'bold' },
          columnStyles: {
            0: { halign: 'center', cellWidth: 18 },
            1: { halign: 'center', cellWidth: 22 },
            2: { halign: 'left', cellWidth: 38 },
            3: { halign: 'center', cellWidth: 25 },
            4: { halign: 'left', cellWidth: 60 }
          },
          margin: { left: margin, right: margin },
        });
        y = doc.lastAutoTable.finalY + 6;
      } else {
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text('No issues found', margin, y);
        doc.setTextColor(0);
        y += 8;
      }

      // Offline heads summary (if any offline heads not already shown in issues)
      const offlineOnly = offlineHeads.filter(h => {
        const issues = h.issues || [];
        return issues.length === 0;
      });
      if (offlineOnly.length > 0) {
        y = checkPageBreak(y, 10);
        doc.setFontSize(9);
        doc.setTextColor(150, 0, 0);
        const offlineNums = offlineOnly.map(h => h.id != null ? h.id : (h.index != null ? h.index + 1 : '?'));
        doc.text(`Offline Heads (no issues logged): ${offlineNums.join(', ')}`, margin, y);
        doc.setTextColor(0);
        y += 6;
      }

      y += 5;
    });

    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    window.open(blobUrl, '_blank');
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
        // The report's object path is derivable from the ids, so legacy visits
        // that only stored a URL resolve through the broker too.
        serviceReportPath={
          shareData?.userId && shareData?.customerId && selectedVisitId
            ? `service-reports/${shareData.userId}/${shareData.customerId}/${selectedVisitId}.pdf`
            : null
        }
        shareToken={token}
      />

      {/* Visit selector and view toggle */}
      <div className="view-controls">
        <div className="container-fluid">
          <div className="view-controls-row">
            {/* Visit Selector */}
            <div className="d-flex align-items-center gap-2 view-visit-picker">
              <label className="small text-muted mb-0" htmlFor="visit-select">Visit:</label>
              <select
                id="visit-select"
                value={selectedVisitId || ''}
                onChange={(e) => handleVisitChange(e.target.value)}
                className="form-select form-select-sm"
              >
                {allVisits.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name || 'Unnamed'}
                  </option>
                ))}
              </select>
              {allVisits.length > 1 && (
                <span className="badge bg-secondary flex-shrink-0">{allVisits.length} visits</span>
              )}
            </div>

            {/* View Toggle — full labels on desktop, short ones on phones */}
            <div className="d-flex align-items-center gap-2 view-mode-group">
              <div className="btn-group view-mode-toggle" role="group" aria-label="Choose a view">
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'lines' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => { setViewMode('lines'); setSelectedLine(null); }}
                >
                  <LayoutGrid size={16} className="me-1" />
                  <span className="label-full">Lines Overview</span>
                  <span className="label-short">Lines</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'dashboard' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => { setViewMode('dashboard'); setSelectedLine(null); }}
                >
                  <AlertCircle size={16} className="me-1" />
                  <span className="label-full">Offline Heads</span>
                  <span className="label-short">Offline</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'factory' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => { setViewMode('factory'); setSelectedLine(null); }}
                >
                  <Factory size={16} className="me-1" />
                  <span className="label-full">Factory View</span>
                  <span className="label-short">Factory</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'logs' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => { setViewMode('logs'); setSelectedLine(null); }}
                >
                  <ClipboardList size={16} className="me-1" />
                  <span className="label-full">Maintenance Logs</span>
                  <span className="label-short">Logs</span>
                </button>
              </div>

              {viewMode === 'dashboard' && allVisits.length > 1 && (
                <button
                  className={`btn btn-sm flex-shrink-0 ${showAllVisits ? 'btn-warning' : 'btn-outline-warning'}`}
                  onClick={() => setShowAllVisits(!showAllVisits)}
                >
                  {showAllVisits ? 'Viewing All Visits' : 'View All Visits'}
                </button>
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
          ) : viewMode === 'logs' ? (
            <MaintenanceLogs shareData={shareData} />
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
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <small className="text-muted" title={visit?.date ? new Date(visit.date).toLocaleString() : ''}>
              Updated {relativeTime(visit?.date)}
            </small>
            <small className="text-muted">
              Shared by JTI Service · updates live
            </small>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default CustomerViewer;
