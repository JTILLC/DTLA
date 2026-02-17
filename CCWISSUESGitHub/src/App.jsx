import { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, useSearchParams } from 'react-router-dom';

import GlobalForm from './components/GlobalForm.jsx';
import Line from './components/Line.jsx';
import Dashboard from './components/Dashboard.jsx';
import FactoryLayout from './components/FactoryLayout/FactoryLayout.jsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Tabs, Tab } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Save, CloudUpload, CloudDownload, Copy, RefreshCw, Trash2, Edit3, Plus, Download, Upload, FileText, History, Settings, Eye, HelpCircle, Factory, List, Share2 } from 'lucide-react';
import ShareModal from './components/ShareModal.jsx';
import ServiceReportUpload from './components/ServiceReportUpload.jsx';

// Shared utilities and constants
import { FIREBASE_CONFIG, DEFAULT_HEAD_COUNT, PDF_CONFIG, FIXED_STATUS } from './config/constants';
import {
  migrateHeadData,
  migrateLineHeads,
  headHasIssues,
  getFixedStatusLabel,
  getIssuesText,
  getHeadFixedStatus,
  createDefaultHeads
} from './utils/headHelpers';
import { useDialog, AddLineDialog } from './components/DialogSystem.jsx';

import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

// Offline support
import OfflineIndicator from './components/OfflineIndicator.jsx';
import offlineQueue from './utils/offlineQueue';
import syncManager from './utils/syncManager';

try {
  firebase.initializeApp(FIREBASE_CONFIG);

  // Enable Firestore offline persistence
  firebase.firestore().enablePersistence({ synchronizeTabs: true })
    .then(() => {
      console.log('Firestore offline persistence enabled');
    })
    .catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn('Persistence failed: Multiple tabs open');
      } else if (err.code === 'unimplemented') {
        console.warn('Persistence not supported in this browser');
      }
    });

  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
} catch (err) {
  console.error('Firebase init error:', err);
}

// Creates a new line with the given name and head count - called after dialog input
const createLine = (lineName, headCount, setLines, setActiveLineId, lines) => {
  const newLine = {
    id: Date.now(),
    title: lineName.trim(),
    model: '',
    jobNumber: '',
    serialNumber: '',
    running: false,
    notes: '',
    heads: createDefaultHeads(headCount),
    showSpanAdjust: false,
  };
  setLines([...lines, newLine]);
  setActiveLineId(newLine.id);
};

// Removes a line - confirmation should be done via dialog before calling
const removeLine = (id, setLines, setActiveLineId, activeLineId, lines) => {
  setLines(lines.filter(l => l.id !== id));
  if (activeLineId === id) {
    const remaining = lines.filter(l => l.id !== id);
    setActiveLineId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
  }
};

const promptForSignIn = async (setSession) => {
  const email = prompt('Enter your email:');
  const password = prompt('Enter your password:');
  if (!email || !password) return false;
  try {
    const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    setSession(cred.user);
    alert('Signed in successfully!');
    return true;
  } catch (e) {
    alert(`Sign-in failed: ${e.message}`);
    return false;
  }
};

const updateLine = (id, updatedLine, setLines, lines) => {
  setLines(lines.map(l => (l.id === id ? { ...updatedLine } : l)));
};

// Resets a line to default - confirmation should be done via dialog before calling
const resetLine = (line, setLines, lines) => {
  const resetLineData = {
    ...line,
    notes: '',
    heads: createDefaultHeads(line.heads.length),
  };
  setLines(lines.map(l => (l.id === line.id ? resetLineData : l)));
};

const showLine = (id, setShowDashboardView, setActiveLineId) => {
  setShowDashboardView(false);
  setActiveLineId(id);
};

// Sign-in is now handled via modal form instead of prompt() for iOS compatibility

const exportDashboardToPDF = (lines, globalData) => {
  if (lines.length === 0) return alert('No data to export');
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageHeight = doc.internal.pageSize.height;

  // Migrate all lines using shared utility
  const migratedLines = lines.map(migrateLineHeads);

  // Add JTI logo top-left
  const logoUrl = PDF_CONFIG.logoUrl;
  doc.addImage(logoUrl, 'PNG', 14, 10, 30, 15);

  // Title
  doc.setFontSize(16);
  doc.text('Ishida Dashboard Report', 105, 20, { align: 'center' });
  let y = 35;

  // Separate lines with issues and without
  const linesWithIssues = migratedLines.filter(line =>
    line.heads.some(head => headHasIssues(head))
  );
  const linesWithoutIssues = migratedLines.filter(line =>
    !line.heads.some(head => headHasIssues(head))
  );

  const allLines = [...linesWithIssues, ...linesWithoutIssues];

  allLines.forEach((line, lineIndex) => {
    const isLastLine = lineIndex === allLines.length - 1;
    const hasNotes = line.notes && line.notes.trim();
    const issueHeads = line.heads.filter(head => headHasIssues(head));
    const hasIssues = issueHeads.length > 0;

    // Estimate height
    let estimatedHeight = 6; // line name
    if (hasNotes) {
      const text = `Line Notes: ${line.notes}`;
      const lines = doc.splitTextToSize(text, 190);
      estimatedHeight += lines.length * 4 + 5;
    }
    if (hasIssues) {
      estimatedHeight += 15 + (issueHeads.length * 5); // table header + rows
    } else {
      estimatedHeight += 10; // "No issues"
    }

    // Check if we need a new page
    if (y + estimatedHeight > pageHeight - 20 && !isLastLine) {
      doc.addPage();
      doc.addImage(logoUrl, 'PNG', 14, 10, 30, 15);
      doc.setFontSize(16);
      doc.text('Ishida Dashboard Report', 105, 20, { align: 'center' });
      y = 35;
    }

    // Line name
    doc.setFontSize(12);
    doc.text(line.title, 14, y);
    y += 6;

    // Line notes
    if (hasNotes) {
      doc.setFontSize(10);
      const text = `Line Notes: ${line.notes}`;
      const lines = doc.splitTextToSize(text, 182);
      doc.text(lines, 14, y);
      y += lines.length * 4 + 5;
    }

    if (hasIssues) {
      const headData = issueHeads.map(head => [
        head.id,
        head.status,
        getIssuesText(head),
        getFixedStatusLabel(getHeadFixedStatus(head)),
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
      doc.text('No issues were found', 14, y);
      y += 10;
    }

    // Add spacing between lines
    if (!isLastLine) {
      y += 5;
    }
  });

  doc.save(`${globalData.customer || 'ishida'}-dashboard.pdf`);
};

const exportLineToPDF = (line, globalData) => {
  if (!line) return alert('No line data to export');
  const doc = new jsPDF('p', 'mm', 'a4');

  // Migrate line to new format
  const migratedLine = migrateLineHeads(line);

  // Add JTI logo top-left
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight);

  // Title
  doc.setFontSize(PDF_CONFIG.titleFontSize);
  doc.text('Ishida Line Report', 105, 20, { align: 'center' });
  doc.setFontSize(PDF_CONFIG.bodyFontSize);
  doc.text(`Customer: ${globalData.customer || 'N/A'}`, 105, 28, { align: 'center' });
  let y = 35;

  // Line name
  doc.setFontSize(14);
  doc.text(migratedLine.title, PDF_CONFIG.margin, y);
  y += 8;

  // Line details
  doc.setFontSize(PDF_CONFIG.bodyFontSize);
  doc.text(`Model: ${migratedLine.model || 'N/A'}`, PDF_CONFIG.margin, y);
  y += 6;
  doc.text(`Job Number: ${migratedLine.jobNumber || 'N/A'}`, PDF_CONFIG.margin, y);
  y += 6;
  doc.text(`Serial Number: ${migratedLine.serialNumber || 'N/A'}`, PDF_CONFIG.margin, y);
  y += 6;
  doc.text(`Running: ${migratedLine.running ? 'Yes' : 'No'}`, PDF_CONFIG.margin, y);
  y += 10;

  // Line notes
  if (migratedLine.notes && migratedLine.notes.trim()) {
    doc.setFontSize(PDF_CONFIG.bodyFontSize);
    const text = `Line Notes: ${migratedLine.notes}`;
    const textLines = doc.splitTextToSize(text, 182);
    doc.text(textLines, PDF_CONFIG.margin, y);
    y += textLines.length * 4 + 5;
  }

  // Issue heads using shared utility
  const issueHeads = migratedLine.heads.filter(headHasIssues);

  if (issueHeads.length > 0) {
    doc.setFontSize(PDF_CONFIG.subtitleFontSize);
    doc.text('Issues:', PDF_CONFIG.margin, y);
    y += 6;

    const headData = issueHeads.map(head => [
      head.id,
      head.status,
      getIssuesText(head),
      getFixedStatusLabel(getHeadFixedStatus(head)),
      head.notes || ''
    ]);

    doc.autoTable({
      startY: y,
      head: [['Head #', 'Status', 'Error', 'Fixed', 'Notes']],
      body: headData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [0, 102, 204], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { halign: 'center', cellWidth: 18 },
        1: { halign: 'center', cellWidth: 25 },
        2: { halign: 'left', cellWidth: 40 },
        3: { halign: 'center', cellWidth: 20 },
        4: { halign: 'left', cellWidth: 70 }
      },
      margin: { left: 14, right: 14 },
    });
  } else {
    doc.setFontSize(10);
    doc.text('No issues were found', 14, y);
  }

  doc.save(`${globalData.customer || 'ishida'}-${line.title.replace(/[^a-z0-9]/gi, '-')}.pdf`);
};

const exportLineHistoryToPDF = (lineHistory, customerName, lineTitle) => {
  if (lineHistory.length === 0) return alert('No history to export');
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageHeight = doc.internal.pageSize.height;

  // Add JTI logo top-left
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight);

  // Title
  doc.setFontSize(PDF_CONFIG.titleFontSize);
  doc.text(`Issue History Report - ${lineTitle}`, 105, 20, { align: 'center' });
  doc.setFontSize(PDF_CONFIG.bodyFontSize);
  doc.text(`Customer: ${customerName}`, 105, 28, { align: 'center' });
  let y = 35;

  // Helper to format fixed status
  const formatFixed = (fixed) => {
    switch(fixed) {
      case 'fixed': return 'Fixed';
      case 'active_with_issues': return 'Active w/ Issues';
      case 'not_fixed': return 'Not Fixed';
      default: return fixed || 'N/A';
    }
  };

  lineHistory.forEach((head, headIndex) => {
    const isLastHead = headIndex === lineHistory.length - 1;
    const visitEntries = head.visitEntries || head.issues || []; // Support both old and new format
    const estimatedHeight = 15 + (visitEntries.length * 8);

    // Check if we need a new page
    if (y + estimatedHeight > pageHeight - 20 && !isLastHead) {
      doc.addPage();
      doc.addImage(logoUrl, 'PNG', 14, 10, 30, 15);
      doc.setFontSize(16);
      doc.text(`Issue History Report - ${lineTitle}`, 105, 20, { align: 'center' });
      doc.setFontSize(10);
      doc.text(`Customer: ${customerName}`, 105, 28, { align: 'center' });
      y = 35;
    }

    // Head title - include line title when viewing all lines
    doc.setFontSize(12);
    const headTitle = lineTitle === 'All-Lines' && head.lineTitle
      ? `${head.lineTitle} - Head #${head.headId}`
      : `Head #${head.headId}`;
    doc.text(headTitle, 14, y);
    y += 6;

    // Build table data - each visit entry becomes a row
    const headData = visitEntries.map(entry => {
      // Handle new format with multiple issues
      if (entry.issues && Array.isArray(entry.issues)) {
        const issuesText = entry.issues.map(iss =>
          `${iss.type} (${formatFixed(iss.fixed)})${iss.notes ? ': ' + iss.notes : ''}`
        ).join('\n');
        return [
          entry.visitName,
          entry.status,
          issuesText || '-',
          entry.headNotes || '-'
        ];
      }
      // Handle old format with single error
      return [
        entry.visitName,
        entry.status,
        `${entry.error || '-'} (${formatFixed(entry.fixed)})`,
        entry.notes || '-'
      ];
    });

    doc.autoTable({
      startY: y,
      head: [['Visit', 'Status', 'Issues', 'Head Notes']],
      body: headData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [0, 102, 204], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { halign: 'left', cellWidth: 35 },
        1: { halign: 'center', cellWidth: 20 },
        2: { halign: 'left', cellWidth: 80 },
        3: { halign: 'left', cellWidth: 45 }
      },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;

    // Add spacing between heads
    if (!isLastHead) {
      y += 5;
    }
  });

  doc.save(`${customerName}-${lineTitle}-history.pdf`);
};

const IssueHistory = ({ customers, visits, onExportPDF }) => {
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedLine, setSelectedLine] = useState('');
  const [history, setHistory] = useState([]);

  const analyzeHistory = () => {
    if (!selectedCustomer || !selectedLine) return;

    const customer = customers.find(c => c.id === selectedCustomer);
    if (!customer) return;

    const customerVisits = visits.filter(v => v.customerId === selectedCustomer);
    const headHistory = {};

    customerVisits.forEach(visit => {
      // If "All Lines" selected, process all lines; otherwise just the selected line
      const linesToProcess = selectedLine === '__ALL__'
        ? visit.lines
        : visit.lines.filter(l => l.title === selectedLine);

      linesToProcess.forEach(line => {
        line.heads.forEach(head => {
          const headIssues = head.issues || [];
          // Check if head has any issues (new format) or old format data
          const hasOldFormatIssue = head.error && head.error !== 'None';
          const hasNewFormatIssues = headIssues.length > 0;
          const hasNotes = head.notes && head.notes.trim() !== '';
          const isOffline = head.status !== 'active';

          if (isOffline || hasOldFormatIssue || hasNewFormatIssues || hasNotes) {
            // Create a unique key combining line and head for "All Lines" view
            const historyKey = selectedLine === '__ALL__'
              ? `${line.title}__${head.id}`
              : head.id.toString();

            if (!headHistory[historyKey]) {
              headHistory[historyKey] = {
                lineTitle: line.title,
                headId: head.id,
                visitEntries: []
              };
            }

            // Build list of issues for this visit
            const issuesList = [];

            // Add issues from new format
            if (hasNewFormatIssues) {
              headIssues.forEach(iss => {
                issuesList.push({
                  type: iss.type,
                  fixed: iss.fixed,
                  notes: iss.notes || ''
                });
              });
            }
            // Add issue from old format if no new format issues
            else if (hasOldFormatIssue) {
              issuesList.push({
                type: head.error,
                fixed: head.fixed,
                notes: ''
              });
            }

            headHistory[historyKey].visitEntries.push({
              visitName: visit.name || `Visit ${new Date(visit.date).toLocaleDateString()}`,
              visitDate: visit.date,
              status: head.status,
              issues: issuesList,
              headNotes: head.notes || ''
            });
          }
        });
      });
    });

    const result = Object.values(headHistory).map(entry => ({
      lineTitle: entry.lineTitle,
      headId: entry.headId,
      visitEntries: entry.visitEntries.sort((a, b) => new Date(b.visitDate || 0) - new Date(a.visitDate || 0))
    }));

    // Sort by line title then head ID
    result.sort((a, b) => {
      if (a.lineTitle !== b.lineTitle) return a.lineTitle.localeCompare(b.lineTitle);
      return a.headId - b.headId;
    });

    setHistory(result);
  };

  useEffect(() => {
    if (selectedCustomer && selectedLine) {
      analyzeHistory();
    }
  }, [selectedCustomer, selectedLine]);

  return (
    <div className="p-4 bg-light rounded">
      <h5 className="mb-3">Issue History</h5>
      
      <div className="d-flex gap-3 mb-3 flex-wrap">
        <select 
          value={selectedCustomer} 
          onChange={(e) => { setSelectedCustomer(e.target.value); setSelectedLine(''); }}
          className="form-select form-select-sm"
          style={{ minWidth: '180px' }}
        >
          <option value="">-- Select Customer --</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {selectedCustomer && (
          <select 
            value={selectedLine} 
            onChange={(e) => setSelectedLine(e.target.value)}
            className="form-select form-select-sm"
            style={{ minWidth: '180px' }}
          >
            <option value="">-- Select Line --</option>
            <option value="__ALL__">All Lines</option>
            {(() => {
              const lines = new Set();
              visits.filter(v => v.customerId === selectedCustomer).forEach(v => {
                v.lines.forEach(l => lines.add(l.title));
              });
              return Array.from(lines).sort().map(line => (
                <option key={line} value={line}>{line}</option>
              ));
            })()}
          </select>
        )}

        {selectedLine && history.length > 0 && (
          <button
            onClick={() => onExportPDF(history, customers.find(c => c.id === selectedCustomer)?.name || 'Unknown', selectedLine === '__ALL__' ? 'All-Lines' : selectedLine)}
            className="btn btn-success btn-sm"
          >
            Export History PDF
          </button>
        )}
      </div>

      {history.length > 0 ? (
        <div>
          <h6>Issue History for {selectedLine === '__ALL__' ? 'All Lines' : selectedLine}</h6>
          {history.map((head, idx) => (
            <div key={`${head.lineTitle}-${head.headId}-${idx}`} className="mb-4 bg-white p-3 rounded shadow-sm">
              <h6 className="text-primary">
                {selectedLine === '__ALL__' ? `${head.lineTitle} - ` : ''}Head #{head.headId}
              </h6>
              <table className="table table-sm table-bordered">
                <thead className="table-primary">
                  <tr>
                    <th>Visit</th>
                    <th>Status</th>
                    <th>Issues</th>
                    <th>Head Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {head.visitEntries.map((entry, i) => (
                    <tr key={i}>
                      <td style={{ verticalAlign: 'top' }}>{entry.visitName}</td>
                      <td style={{ verticalAlign: 'top' }}>
                        <span className={`badge ${entry.status === 'offline' ? 'bg-danger' : 'bg-success'}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td style={{ verticalAlign: 'top' }}>
                        {entry.issues.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {entry.issues.map((iss, j) => (
                              <div key={j} style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                backgroundColor: iss.fixed === 'fixed' ? '#ffc107' :
                                  iss.fixed === 'active_with_issues' ? '#17a2b8' : '#dc3545',
                                color: iss.fixed === 'fixed' ? '#000' : '#fff',
                                fontSize: '0.85em'
                              }}>
                                <strong>{iss.type}</strong>
                                <span style={{ marginLeft: '8px', opacity: 0.9 }}>
                                  ({iss.fixed === 'fixed' ? 'Fixed' :
                                    iss.fixed === 'active_with_issues' ? 'Active w/ Issues' : 'Not Fixed'})
                                </span>
                                {iss.notes && <div style={{ marginTop: '2px', fontStyle: 'italic' }}>{iss.notes}</div>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: '#999' }}>-</span>
                        )}
                      </td>
                      <td style={{ verticalAlign: 'top' }}>{entry.headNotes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : selectedLine ? (
        <p className="text-muted">No issues found for {selectedLine === '__ALL__' ? 'All Lines' : selectedLine}</p>
      ) : null}
    </div>
  );
};

const AppContent = () => {
  const [searchParams] = useSearchParams();

  const [globalData, setGlobalData] = useState({ customer: '', address: '', cityState: '', headCount: '14' });
  const [lines, setLines] = useState([]);
  const [showDashboardView, setShowDashboardView] = useState(false);
  const [activeLineId, setActiveLineId] = useState(null);
  const [session, setSession] = useState(null);
  const [renderKey, setRenderKey] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Dialog system for proper modals instead of window.prompt/alert
  const dialog = useDialog();
  const [showAddLineDialog, setShowAddLineDialog] = useState(false);

  // Dark mode state - defaults to dark
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('ccwissues-theme');
    if (saved) return saved === 'dark';
    return true; // Default to dark mode
  });

  // Apply theme on mount and when isDark changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('ccwissues-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleDarkMode = () => {
    setIsDark(!isDark);
  };

  const [customers, setCustomers] = useState([]);
  const [currentCustomer, setCurrentCustomer] = useState(null);
  const [visits, setVisits] = useState([]);
  const [showVisitList, setShowVisitList] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', address: '', cityState: '', headCount: '14' });
  const [currentVisitName, setCurrentVisitName] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showDeletePanel, setShowDeletePanel] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState('');
  const [visitToDelete, setVisitToDelete] = useState('');
  const [visitToEdit, setVisitToEdit] = useState(null);
  const [editTimestamp, setEditTimestamp] = useState('');
  const [currentVisitId, setCurrentVisitId] = useState(null);
  const [serviceReportUrl, setServiceReportUrl] = useState(null);
  const [showActionButtons, setShowActionButtons] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [deepLinkProcessed, setDeepLinkProcessed] = useState(false);
  const [showLinesModal, setShowLinesModal] = useState(false);
  const [activeTab, setActiveTab] = useState('current');
  const [showShareModal, setShowShareModal] = useState(false);
  const fileInputRef = useRef(null);

  // Handler for adding a new line via dialog
  const handleAddLine = (lineName, headCount) => {
    createLine(lineName, headCount, setLines, setActiveLineId, lines);
  };

  // Handler for removing a line with confirmation
  const handleRemoveLine = async (id) => {
    const line = lines.find(l => l.id === id);
    const confirmed = await dialog.confirm(
      `Are you sure you want to remove "${line?.title || 'this line'}"?`,
      { title: 'Remove Line', variant: 'danger', confirmText: 'Remove' }
    );
    if (confirmed) {
      removeLine(id, setLines, setActiveLineId, activeLineId, lines);
    }
  };

  // Handler for resetting a line with confirmation
  const handleResetLine = async (line) => {
    const confirmed = await dialog.confirm(
      `Reset "${line.title}" to default? All data for this line will be cleared.`,
      { title: 'Reset Line', variant: 'warning', confirmText: 'Reset' }
    );
    if (confirmed) {
      resetLine(line, setLines, lines);
    }
  };

  // Use session state instead of firebase.auth().currentUser to avoid timing issues
  const user = session;

  // Deep link handler - load visit by ID from URL parameter
  const loadVisitByDeepLink = async (visitId, customerId, lineName, headName) => {
    if (!user) return;

    try {
      // Helper function to load data and navigate to line
      const loadAndNavigate = (data, custProfile, custId) => {
        setCurrentCustomer({ id: custId, ...custProfile });
        setGlobalData({
          customer: custProfile.name,
          address: custProfile.address || '',
          cityState: custProfile.cityState || '',
          headCount: (custProfile.headCount || '14').toString(),
        });

        const loadedLines = data.lines.map(line => ({
          ...line,
          heads: line.heads.map((head, i) => ({ ...head, id: head.id || i + 1 }))
        }));
        setLines(loadedLines);

        // Find and select the matching line if lineName provided
        let targetLineId = loadedLines.length > 0 ? loadedLines[0].id : null;
        if (lineName && loadedLines.length > 0) {
          const matchingLine = loadedLines.find(line =>
            line.title === lineName ||
            line.title?.toLowerCase() === lineName.toLowerCase()
          );
          if (matchingLine) {
            targetLineId = matchingLine.id;
            console.log(`Navigating to line: ${matchingLine.title}`);
          }
        }

        setActiveLineId(targetLineId);
        setShowDashboardView(false); // Make sure we're viewing the line, not dashboard
        setCurrentVisitName(data.name || '');
        setCurrentVisitId(visitId);
        setServiceReportUrl(data.serviceReportUrl || null);
        setRenderKey(Date.now());

        // If head is specified, scroll to it after a short delay
        if (headName) {
          setTimeout(() => {
            const headElement = document.querySelector(`[data-head-id="${headName}"]`);
            if (headElement) {
              headElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              headElement.style.animation = 'pulse 1s ease-in-out 3';
            }
          }, 500);
        }

        console.log(`Deep linked to visit: ${data.name || visitId}${lineName ? `, line: ${lineName}` : ''}${headName ? `, head: ${headName}` : ''}`);
      };

      // If we have a customerId, load directly
      if (customerId) {
        const docRef = firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(customerId)
          .collection('visits')
          .doc(visitId);

        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = docSnap.data();

          // Get customer profile
          const custDoc = await firebase
            .firestore()
            .collection('user_files')
            .doc(user.uid)
            .collection('customers')
            .doc(customerId)
            .get();

          if (custDoc.exists) {
            const custProfile = custDoc.data().profile;
            loadAndNavigate(data, custProfile, customerId);
            return;
          }
        }
      }

      // Otherwise search all customers for the visit
      const customerSnap = await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .get();

      for (const custDoc of customerSnap.docs) {
        const visitDoc = await firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(custDoc.id)
          .collection('visits')
          .doc(visitId)
          .get();

        if (visitDoc.exists) {
          const data = visitDoc.data();
          const custProfile = custDoc.data().profile;
          loadAndNavigate(data, custProfile, custDoc.id);
          return;
        }
      }

      console.error('Visit not found:', visitId);
    } catch (error) {
      console.error('Deep link load failed:', error);
    }
  };

  // Handle deep link on mount
  useEffect(() => {
    if (!user || deepLinkProcessed) return;

    const visitId = searchParams.get('id') || searchParams.get('visitId');
    const customerId = searchParams.get('customer') || searchParams.get('customerId');
    const lineName = searchParams.get('line');
    const headName = searchParams.get('head');

    if (visitId) {
      console.log('Deep linking to visit:', visitId, lineName ? `line: ${lineName}` : '', headName ? `head: ${headName}` : '');
      loadVisitByDeepLink(visitId, customerId, lineName, headName);
      setDeepLinkProcessed(true);
    }
  }, [user, searchParams, deepLinkProcessed]);

  const loadVisit = async (visitId) => {
    if (!user || !currentCustomer) return alert('Select a customer first');
    const doc = await firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .doc(currentCustomer.id)
      .collection('visits')
      .doc(visitId)
      .get();
    if (doc.exists) {
      const data = doc.data();
      const loadedLines = data.lines.map(line => ({
        ...line,
        heads: line.heads.map((head, i) => ({ ...head, id: head.id || i + 1 }))
      }));
      setGlobalData(data.globalData);
      setLines(loadedLines);
      setActiveLineId(loadedLines.length > 0 ? loadedLines[0].id : null);
      setCurrentVisitName(data.name || '');
      setCurrentVisitId(visitId);
      setServiceReportUrl(data.serviceReportUrl || null);
      setRenderKey(Date.now());
      alert('Visit loaded!');
    } else {
      alert('Visit not found');
    }
  };

  const clearStorage = async () => {
    if (!window.confirm('Are you sure you want to clear all local data? This will reset everything.')) return;
    
    localStorage.clear();
    
    setLines([]);
    setGlobalData({ customer: '', address: '', cityState: '', headCount: '14' });
    setCurrentVisitName('');
    setActiveLineId(null);
    setCurrentCustomer(null);
    setCustomers([]);
    setVisits([]);
    setCurrentVisitId(null);
    setServiceReportUrl(null);
    
    alert('Local storage cleared! All data reset.');
  };

  const deleteCustomerFromCloud = async (custId) => {
    if (!window.confirm(`Delete customer "${customers.find(c => c.id === custId)?.name}" and all its visits?`)) return;
    try {
      const visitSnap = await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(custId)
        .collection('visits')
        .get();
      
      const batch = firebase.firestore().batch();
      visitSnap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(custId)
        .delete();

      localStorage.removeItem(`ishida_${custId}`);
      alert('Customer and all visits deleted from cloud');
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete customer');
    }
  };

  const deleteVisitFromCloud = async (custId, visitId) => {
    if (!window.confirm(`Delete this visit?`)) return;
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(custId)
        .collection('visits')
        .doc(visitId)
        .delete();
      alert('Visit deleted from cloud');
      if (currentCustomer?.id === custId) {
        await loadVisits(custId);
        if (currentVisitId === visitId) {
          setCurrentVisitId(null);
        }
      }
    } catch (err) {
      console.error('Delete visit error:', err);
      alert('Failed to delete visit');
    }
  };

  const updateVisitTimestamp = async () => {
    if (!visitToEdit) return;
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection('visits')
        .doc(visitToEdit.id)
        .update({ date: new Date(editTimestamp).toISOString() });
      alert('Timestamp updated');
      setVisitToEdit(null);
      setEditTimestamp('');
      await loadVisits(currentCustomer.id);
    } catch (err) {
      alert('Failed to update timestamp');
    }
  };

  const saveToCloud = async (override = false) => {
    if (!user || !currentCustomer) return alert('Select a customer first');

    // Different confirmation messages for new vs override
    if (override) {
      if (!currentVisitId) {
        return alert('No visit loaded to override. Use "New" to create a new visit first.');
      }
      const confirmMsg = `⚠️ OVERRIDE CURRENT VISIT?\n\nThis will replace the existing visit "${currentVisitName || 'Unnamed'}" in the cloud with your current changes.\n\nCustomer: ${currentCustomer.name}\nVisit: ${currentVisitName || 'Unnamed'}\nLines: ${lines.length}\n\nThis action cannot be undone. Continue?`;
      if (!window.confirm(confirmMsg)) return;
    } else {
      if (!window.confirm(`Save as NEW visit to cloud?\n\nCustomer: ${currentCustomer.name}\nVisit Name: ${currentVisitName || 'Unnamed'}\nLines: ${lines.length}`)) return;
    }

    const payload = {
      date: new Date().toISOString(),
      name: currentVisitName,
      globalData,
      lines: lines.map(line => ({
        ...line,
        heads: line.heads.map(head => ({ ...head, id: head.id }))
      })),
      // Preserve serviceReportUrl if it exists
      ...(serviceReportUrl && { serviceReportUrl }),
    };

    try {
      if (override && currentVisitId) {
        await firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(currentCustomer.id)
          .collection('visits')
          .doc(currentVisitId)
          .set(payload);
        alert(`✓ Visit "${currentVisitName || 'Unnamed'}" overridden successfully!`);
      } else {
        const visitId = `visit_${Date.now()}`;
        await firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(currentCustomer.id)
          .collection('visits')
          .doc(visitId)
          .set(payload);
        setCurrentVisitId(visitId);
        alert(`✓ New visit "${currentVisitName || 'Unnamed'}" saved to cloud!`);
      }
      await loadVisits(currentCustomer.id);
    } catch (err) {
      console.error('Save to cloud error:', err);
      alert('Failed to save to cloud: ' + err.message);
      localStorage.setItem(`offline_${currentCustomer.id}_${Date.now()}`, JSON.stringify(payload));
    }
  };

  const duplicateVisit = async () => {
    if (!currentVisitId) return alert('No visit to duplicate');
    if (!window.confirm('Duplicate current visit?')) return;

    const visitId = `visit_${Date.now()}`;
    const payload = {
      date: new Date().toISOString(),
      name: `${currentVisitName} (Copy)`,
      globalData,
      lines: lines.map(line => ({
        ...line,
        heads: line.heads.map(head => ({ ...head, id: head.id }))
      })),
    };

    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection('visits')
        .doc(visitId)
        .set(payload);
      setCurrentVisitId(visitId);
      setCurrentVisitName(payload.name);
      alert('Visit duplicated!');
      await loadVisits(currentCustomer.id);
    } catch (err) {
      alert('Failed to duplicate visit');
    }
  };

  const saveAllToCloud = async () => {
    if (!user) return alert('Sign in first');
    if (!window.confirm('Save ALL local data to cloud? This will upload any unsaved visits.')) return;

    try {
      let savedCount = 0;

      // Go through each customer and save their local data to cloud
      for (const customer of customers) {
        const localKey = `ishida_${customer.id}`;
        const localData = localStorage.getItem(localKey);

        if (localData) {
          try {
            const parsed = JSON.parse(localData);
            if (parsed.lines && parsed.lines.length > 0) {
              // Create a new visit from local data
              const visitId = `visit_${Date.now()}_${customer.id}`;
              const payload = {
                date: new Date().toISOString(),
                name: parsed.currentVisitName || `Synced ${new Date().toLocaleDateString()}`,
                globalData: parsed.globalData || {},
                lines: parsed.lines.map(line => ({
                  ...line,
                  heads: line.heads.map(head => ({ ...head, id: head.id }))
                })),
              };

              await firebase
                .firestore()
                .collection('user_files')
                .doc(user.uid)
                .collection('customers')
                .doc(customer.id)
                .collection('visits')
                .doc(visitId)
                .set(payload);

              savedCount++;
              console.log(`Saved local data for ${customer.name} as visit ${visitId}`);
            }
          } catch (e) {
            console.error(`Error parsing local data for ${customer.id}:`, e);
          }
        }
      }

      if (savedCount > 0) {
        alert(`Saved ${savedCount} customer visit(s) to cloud!`);
      } else {
        alert('No local data to save. Use the "New" button to save individual visits.');
      }
    } catch (err) {
      console.error('Save all to cloud error:', err);
      alert('Failed to save all to cloud');
    }
  };

  const loadAllFromCloud = async () => {
    if (!user) return alert('Sign in first');
    if (!window.confirm('Load ALL customers and visits from cloud? This will overwrite local data.')) return;

    try {
      console.log('Loading from cloud for user:', user.uid, user.email);

      const customerSnap = await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .get();

      // Map customers correctly - extract profile data
      const loadedCustomers = customerSnap.docs.map(d => ({
        id: d.id,
        ...d.data().profile
      }));
      console.log('Loaded customers from cloud:', loadedCustomers);

      // Load all visits
      const allVisits = [];
      for (const doc of customerSnap.docs) {
        const custId = doc.id;
        const visitSnap = await firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(custId)
          .collection('visits')
          .get();
        allVisits.push(...visitSnap.docs.map(d => ({ id: d.id, customerId: custId, ...d.data() })));
      }

      // Sort visits by date (newest first)
      allVisits.sort((a, b) => new Date(b.date) - new Date(a.date));
      console.log('Loaded visits from cloud:', allVisits.length);

      // DON'T clear localStorage - preserve local data as backup
      // Just update the in-memory state with cloud data

      setCustomers(loadedCustomers);
      setVisits(allVisits);
      setCurrentCustomer(null);
      setLines([]);
      setCurrentVisitName('');
      setCurrentVisitId(null);

      alert(`Loaded ${loadedCustomers.length} customers and ${allVisits.length} visits from cloud!`);
    } catch (err) {
      console.error('Load all from cloud error:', err);
      alert('Failed to load all from cloud: ' + err.message);
    }
  };

  useEffect(() => {
    const unsub = firebase.auth().onAuthStateChanged(async (u) => {
      if (!u) {
        const ok = await promptForSignIn(setSession);
        if (!ok) alert('Sign-in required');
        // Don't setSession(null) here - promptForSignIn already set the session
        // Firebase will fire onAuthStateChanged again with the new user
        setLoading(false);
        return;
      }
      setSession(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Unregister any existing service workers (removed for simpler updates)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister();
          console.log('[SW] Service Worker unregistered');
        });
      });
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    console.log('Setting up live customer listener for UID:', user.uid);
    const unsub = firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .onSnapshot((snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data().profile }));
        console.log('CUSTOMERS UPDATED:', list);
        setCustomers(list);
      });
    return () => unsub();
  }, [user]);

  const refreshCustomers = async () => {
    if (!user) return;
    const snap = await firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data().profile }));
    console.log('REFRESHED CUSTOMERS:', list);
    setCustomers(list);
  };

  const upsertCustomer = async (profile) => {
    const name = profile.name.trim();
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const custRef = firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .doc(key);

    const snap = await custRef.get();
    if (snap.exists) {
      const existing = snap.data().profile;
      await custRef.update({
        profile: {
          ...existing,
          address: profile.address || existing.address || '',
          cityState: profile.cityState || existing.cityState || '',
          headCount: profile.headCount || existing.headCount,
        },
      });
    } else {
      await custRef.set({ profile });
    }
    console.log('Customer upserted:', key);
    return key;
  };

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    if (!user || !newCustomer.name.trim()) return;

    try {
      await upsertCustomer(newCustomer);
      await refreshCustomers();
      setNewCustomer({ name: '', address: '', cityState: '', headCount: '14' });
      setShowAddCustomer(false);
    } catch (err) {
      alert('Failed to add customer');
    }
  };

  const handleImportLegacy = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.json')) {
      alert('Please select a valid .json file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const { globalData: gd, lines: importedLines } = data;

        if (!gd?.customer) throw new Error('No customer name in file');

        const profile = {
          name: gd.customer.trim(),
          address: gd.address?.trim() || '',
          cityState: gd.cityState?.trim() || '',
          headCount: parseInt(gd.headCount) || 14,
        };

        console.log('Importing:', profile);

        const customerId = await upsertCustomer(profile);
        console.log('Customer ID:', customerId);

        const visitId = `visit_${Date.now()}`;
        await firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(customerId)
          .collection('visits')
          .doc(visitId)
          .set({
            date: new Date().toISOString(),
            name: '',
            globalData: gd,
            lines: importedLines.map(line => ({
              ...line,
              heads: line.heads.map((head, i) => ({ ...head, id: head.id || i + 1 }))
            })),
          });

        setTimeout(() => {
          setRenderKey(Date.now());
        }, 100);

        const custSnap = await firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(customerId)
          .get();
        if (custSnap.exists) {
          const cust = { id: customerId, ...custSnap.data().profile };
          console.log('Customer fetched:', cust);
          setCurrentCustomer(cust);
          setGlobalData({
            customer: cust.name,
            address: cust.address,
            cityState: cust.cityState,
            headCount: cust.headCount.toString(),
          });
          const loadedLines = importedLines.map(line => ({
            ...line,
            heads: line.heads.map((head, i) => ({ ...head, id: head.id || i + 1 }))
          }));
          setLines(loadedLines);
          setActiveLineId(loadedLines.length > 0 ? loadedLines[0].id : null);
          setCurrentVisitName('');
          setCurrentVisitId(visitId);
        }

        alert(`Imported "${profile.name}" – new visit saved!`);
      } catch (err) {
        console.error('Import error:', err);
        alert(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
    fileInputRef.current.value = '';
  };

  const handleSelectCustomer = (custId) => {
    const cust = customers.find(c => c.id === custId);
    if (!cust) return;
    console.log('Selected:', cust);
    setCurrentCustomer(cust);
    setGlobalData({
      customer: cust.name,
      address: cust.address,
      cityState: cust.cityState,
      headCount: cust.headCount.toString(),
    });
    setLines([]);
    setShowVisitList(false);
    setCurrentVisitName('');
    setCurrentVisitId(null);
  };

  const loadVisits = async (custId) => {
    if (!user) return;
    const snap = await firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .doc(custId)
      .collection('visits')
      .orderBy('date', 'desc')
      .get();
    const list = snap.docs.map(d => ({ id: d.id, customerId: custId, ...d.data() }));
    setVisits(list);
  };

  const deleteVisit = async (visitId) => {
    if (!window.confirm('Delete this visit?')) return;
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection('visits')
        .doc(visitId)
        .delete();
      alert('Visit deleted');
      await loadVisits(currentCustomer.id);
      if (currentVisitId === visitId) {
        setCurrentVisitId(null);
      }
    } catch (err) {
      alert('Failed to delete visit');
    }
  };

  const loadFromCloud = async () => {
    if (!user || !currentCustomer) return alert('Select a customer first');
    if (!window.confirm('Load latest visit from cloud?')) return;

    const snap = await firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .doc(currentCustomer.id)
      .collection('visits')
      .orderBy('date', 'desc')
      .limit(1)
      .get();

    if (snap.empty) return alert('No cloud data');

    const doc = snap.docs[0];
    const data = doc.data();
    const loadedLines = data.lines.map(line => ({
      ...line,
      heads: line.heads.map((head, i) => ({ ...head, id: head.id || i + 1 }))
    }));
    setGlobalData(data.globalData);
    setLines(loadedLines);
    setActiveLineId(loadedLines.length > 0 ? loadedLines[0].id : null);
    setCurrentVisitName(data.name || '');
    setCurrentVisitId(doc.id);
    setRenderKey(Date.now());

    localStorage.setItem(`ishida_${currentCustomer.id}`, JSON.stringify({ 
      lines: loadedLines, 
      visits: [data],
      currentVisitName: data.name || '',
      currentVisitId: doc.id
    }));

    alert('Loaded from cloud!');
  };

  const saveAllData = async () => {
    if (!user) return alert('Sign in first');
    if (!window.confirm('Export all data?')) return;
    const allData = { customers: [], visits: [] };
    const customerSnap = await firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .get();
    allData.customers = customerSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (const doc of customerSnap.docs) {
      const custId = doc.id;
      const visitSnap = await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(custId)
        .collection('visits')
        .get();
      allData.visits = allData.visits.concat(visitSnap.docs.map(d => ({ id: d.id, customerId: custId, ...d.data() })));
    }
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    saveAs(blob, 'all-ishida-data.json');
    alert('All data exported!');
  };

  const loadAllData = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm('Import all data? This will overwrite existing data.')) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const allData = JSON.parse(ev.target.result);
        if (!user) return alert('Sign in first');
        for (const custData of allData.customers) {
          const key = custData.profile.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
          await firebase
            .firestore()
            .collection('user_files')
            .doc(user.uid)
            .collection('customers')
            .doc(key)
            .set(custData);
          for (const visitData of allData.visits.filter(v => v.customerId === custData.id)) {
            await firebase
              .firestore()
              .collection('user_files')
              .doc(user.uid)
              .collection('customers')
              .doc(key)
              .collection('visits')
              .doc(visitData.id)
              .set(visitData);
          }
        }
        alert('All data imported!');
        await refreshCustomers();
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Auto-save to localStorage
  useEffect(() => {
    if (!currentCustomer || lines.length === 0) return;
    const timer = setTimeout(() => {
      setIsSaving(true);
      const data = {
        lines,
        globalData,
        currentVisitName,
        currentVisitId
      };
      localStorage.setItem(`ishida_${currentCustomer.id}`, JSON.stringify(data));
      setIsSaving(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [lines, globalData, currentVisitName, currentCustomer, currentVisitId]);

  // Load from localStorage on customer change (but not during deep link)
  useEffect(() => {
    if (!currentCustomer) return;

    // Skip localStorage loading if we just did a deep link
    // (deep link already set the correct data)
    if (deepLinkProcessed) {
      console.log('Skipping localStorage load - deep link already loaded data');
      return;
    }

    const saved = localStorage.getItem(`ishida_${currentCustomer.id}`);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setLines(data.lines || []);
        setGlobalData(data.globalData || globalData);
        setCurrentVisitName(data.currentVisitName || '');
        setCurrentVisitId(data.currentVisitId || null);
        setActiveLineId(data.lines?.length > 0 ? data.lines[0].id : null);
      } catch (e) {
        console.error('Failed to load from localStorage', e);
      }
    }
  }, [currentCustomer, deepLinkProcessed]);

  // Load all visits for history
  useEffect(() => {
    if (user) {
      const loadAllVisits = async () => {
        const allVisits = [];
        const customerSnap = await firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .get();
        for (const custDoc of customerSnap.docs) {
          const visitSnap = await firebase
            .firestore()
            .collection('user_files')
            .doc(user.uid)
            .collection('customers')
            .doc(custDoc.id)
            .collection('visits')
            .get();
          allVisits.push(...visitSnap.docs.map(d => ({ id: d.id, customerId: custDoc.id, ...d.data() })));
        }
        setVisits(allVisits);
      };
      loadAllVisits();
    }
  }, [user]);

  if (loading) return <div className="text-center p-5">Loading...</div>;

  return (
    <div className="container-fluid p-0">
      {/* Offline status indicator */}
      <OfflineIndicator />

      <style>{`
        .control-bar {
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
          padding: 12px;
          max-height: 400px;
          overflow-y: auto;
          overflow-x: hidden;
          position: sticky;
          top: 0;
          z-index: 1000;
        }
        .control-bar .d-flex {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        .control-bar .btn-sm {
          font-size: 0.75rem;
          padding: 0.25rem 0.4rem;
        }
        .control-bar .btn-sm svg {
          width: 14px;
          height: 14px;
        }
        .saving {
          margin-left: 12px;
          color: #28a745;
          font-weight: 500;
          animation: pulse 1.5s infinite;
        }
        [data-theme="dark"] .saving {
          color: #5cb85c;
        }
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        .nav-button {
          font-size: 0.85rem;
          padding: 0.25rem 0.5rem;
        }
        .tab-content {
          padding: 10px 20px;
        }
        .dropdown-menu {
          min-width: 180px;
        }
      `}</style>

      <div className="control-bar">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <label className="mb-0"><strong>Customer:</strong></label>
          <select
            value={currentCustomer?.id || ''}
            onChange={(e) => handleSelectCustomer(e.target.value)}
            className="form-select form-select-sm"
            style={{ minWidth: '180px' }}
          >
            <option value="">-- Select Customer --</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.headCount} heads)
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowActionButtons(!showActionButtons)}
            className={`btn btn-outline-secondary btn-sm ${showActionButtons ? 'active' : ''}`}
          >
            <Settings className="w-4 h-4" /> {showActionButtons ? 'Hide' : 'Settings'}
          </button>

          {showActionButtons && (
            <>
              <button
                onClick={toggleDarkMode}
                className="btn btn-outline-secondary btn-sm"
                title="Toggle Dark/Light Mode"
              >
                {isDark ? '☀️' : '🌙'} {isDark ? 'Light' : 'Dark'}
              </button>

              <button
                onClick={() => setShowHelp(!showHelp)}
                className="btn btn-outline-secondary btn-sm"
                title="Help"
              >
                <HelpCircle className="w-4 h-4" /> Help
              </button>

              <button onClick={() => setShowAddCustomer(true)} className="btn btn-outline-primary btn-sm">
                <Plus className="w-4 h-4" /> Add
              </button>

              <button onClick={() => saveToCloud(false)} className="btn btn-outline-success btn-sm">
                <Save className="w-4 h-4" /> New
              </button>

              {currentVisitId && (
                <button onClick={() => saveToCloud(true)} className="btn btn-outline-warning btn-sm">
                  <RefreshCw className="w-4 h-4" /> Override
                </button>
              )}

              {currentVisitId && (
                <button onClick={duplicateVisit} className="btn btn-outline-info btn-sm">
                  <Copy className="w-4 h-4" /> Duplicate
                </button>
              )}

              {currentVisitId && currentCustomer && (
                <button onClick={() => setShowShareModal(true)} className="btn btn-outline-primary btn-sm">
                  <Share2 className="w-4 h-4" /> Share
                </button>
              )}

              <button onClick={saveAllToCloud} className="btn btn-outline-success btn-sm">
                <CloudUpload className="w-4 h-4" /> All to Cloud
              </button>

              <button onClick={loadAllFromCloud} className="btn btn-outline-primary btn-sm">
                <CloudDownload className="w-4 h-4" /> All from Cloud
              </button>

              <div className="btn-group">
                <button className="btn btn-outline-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                  <Download className="w-4 h-4" /> Export
                </button>
                <ul className="dropdown-menu">
                  <li>
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => exportDashboardToPDF(lines, globalData)}>
                      <FileText className="w-4 h-4" /> Dashboard PDF
                    </button>
                  </li>
                  <li>
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={saveAllData}>
                      <FileText className="w-4 h-4" /> All Data JSON
                    </button>
                  </li>
                </ul>
              </div>

              <button onClick={() => fileInputRef.current.click()} className="btn btn-outline-secondary btn-sm">
                <Upload className="w-4 h-4" /> Import
              </button>

              <button onClick={() => setShowDeletePanel(!showDeletePanel)} className="btn btn-outline-danger btn-sm">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}

          {isSaving && <span className="saving">Saving locally...</span>}
        </div>
      </div>

      {showAddCustomer && (
        <div className="p-3 bg-light border-bottom">
          <form onSubmit={handleAddCustomer} className="row g-2">
            <div className="col-md-3">
              <input placeholder="Name *" value={newCustomer.name} onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })} required className="form-control form-control-sm" />
            </div>
            <div className="col-md-3">
              <input placeholder="Address" value={newCustomer.address} onChange={e => setNewCustomer({ ...newCustomer, address: e.target.value })} className="form-control form-control-sm" />
            </div>
            <div className="col-md-3">
              <input placeholder="City, State" value={newCustomer.cityState} onChange={e => setNewCustomer({ ...newCustomer, cityState: e.target.value })} className="form-control form-control-sm" />
            </div>
            <div className="col-md-1">
              <input type="number" placeholder="Heads" value={newCustomer.headCount} onChange={e => setNewCustomer({ ...newCustomer, headCount: e.target.value })} min="1" className="form-control form-control-sm" />
            </div>
            <div className="col-md-2 d-flex gap-1">
              <button type="submit" className="btn btn-primary btn-sm">Save</button>
              <button type="button" onClick={() => setShowAddCustomer(false)} className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {showDeletePanel && (
        <div className="p-3 bg-warning bg-opacity-10 border-bottom">
          <div className="d-flex justify-content-between align-items-start mb-2">
            <h6 className="mb-0">Delete Options</h6>
            <button onClick={() => setShowDeletePanel(false)} className="btn btn-sm btn-outline-secondary">Close</button>
          </div>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label"><strong>Delete Customer:</strong></label>
              <div className="d-flex gap-2">
                <select value={customerToDelete} onChange={(e) => setCustomerToDelete(e.target.value)} className="form-select form-select-sm">
                  <option value="">-- Select --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {customerToDelete && (
                  <button onClick={() => { deleteCustomerFromCloud(customerToDelete); setCustomerToDelete(''); }} className="btn btn-danger btn-sm">Delete</button>
                )}
              </div>
            </div>
            {currentCustomer && (
              <div className="col-md-6">
                <label className="form-label"><strong>Delete Visit:</strong></label>
                <div className="d-flex gap-2">
                  <select value={visitToDelete} onChange={(e) => setVisitToDelete(e.target.value)} className="form-select form-select-sm">
                    <option value="">-- Select --</option>
                    {visits.filter(v => v.customerId === currentCustomer.id).slice(0, 5).map(v => (
                      <option key={v.id} value={v.id}>
                        {v.name ? `${v.name} - ` : ''}{new Date(v.date).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                  {visitToDelete && (
                    <button onClick={() => { deleteVisitFromCloud(currentCustomer.id, visitToDelete); setVisitToDelete(''); }} className="btn btn-danger btn-sm">Delete</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showHelp && (
        <div className="p-3 bg-info bg-opacity-10 border-bottom" style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <div className="d-flex justify-content-between align-items-start mb-3">
            <h5 className="mb-0">Help Guide</h5>
            <button onClick={() => setShowHelp(false)} className="btn btn-sm btn-outline-secondary">Close</button>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>How to Run the App</strong></h6>
            <ol className="small">
              <li>Select or add a customer from the dropdown menu</li>
              <li>Enter a visit name (optional) to identify this session</li>
              <li>Click "Add Line" to create a new production line</li>
              <li>Configure heads, track issues, and add notes for each line</li>
              <li>Save your work to the cloud using the "New" button in Settings</li>
              <li>Export to PDF or JSON for reporting and backup</li>
            </ol>
          </div>

          <div className="mb-3">
            <h6 className="text-primary mb-2"><strong>Button Descriptions</strong></h6>

            <div className="mb-2">
              <strong className="text-secondary">Settings Button:</strong>
              <p className="small mb-1">Shows/hides all action buttons for managing customers, visits, and data.</p>
            </div>

            <div className="mb-2">
              <strong className="text-success">Add Button:</strong>
              <p className="small mb-1">Create a new customer with name, address, city/state, and default head count.</p>
            </div>

            <div className="mb-2">
              <strong className="text-success">New Button:</strong>
              <p className="small mb-1">Save the current visit to the cloud as a new entry.</p>
            </div>

            <div className="mb-2">
              <strong className="text-warning">Override Button:</strong>
              <p className="small mb-1">Update the currently loaded visit with your changes.</p>
            </div>

            <div className="mb-2">
              <strong className="text-info">Duplicate Button:</strong>
              <p className="small mb-1">Create a copy of the current visit as a new entry.</p>
            </div>

            <div className="mb-2">
              <strong className="text-success">All to Cloud Button:</strong>
              <p className="small mb-1">Upload all customers and visits to the cloud for backup.</p>
            </div>

            <div className="mb-2">
              <strong className="text-primary">All from Cloud Button:</strong>
              <p className="small mb-1">Download all your data from the cloud to this device.</p>
            </div>

            <div className="mb-2">
              <strong className="text-secondary">Export Menu:</strong>
              <p className="small mb-1">Export dashboard as PDF or export all data as JSON file.</p>
            </div>

            <div className="mb-2">
              <strong className="text-secondary">Import Button:</strong>
              <p className="small mb-1">Import previously exported JSON data file.</p>
            </div>

            <div className="mb-2">
              <strong className="text-danger">Delete Button:</strong>
              <p className="small mb-1">Open panel to delete customers or visits from the cloud.</p>
            </div>

            <div className="mb-2">
              <strong className="text-primary">Add Line Button:</strong>
              <p className="small mb-1">Create a new production line with custom name and head count.</p>
            </div>

            <div className="mb-2">
              <strong className="text-secondary">Prev/Next Buttons:</strong>
              <p className="small mb-1">Navigate between lines without using the dropdown.</p>
            </div>

            <div className="mb-2">
              <strong className="text-secondary">Show/Hide Details:</strong>
              <p className="small mb-1">Toggle visibility of model, job number, and serial number fields.</p>
            </div>

            <div className="mb-2">
              <strong className="text-secondary">Rename Button:</strong>
              <p className="small mb-1">Change the name of the current line.</p>
            </div>

            <div className="mb-2">
              <strong className="text-success">Export Line PDF:</strong>
              <p className="small mb-1">Export the current line details to a PDF file.</p>
            </div>

            <div className="mb-2">
              <strong className="text-warning">Reset Line:</strong>
              <p className="small mb-1">Clear all data for this line and reset heads to default.</p>
            </div>

            <div className="mb-2">
              <strong className="text-danger">Remove Line:</strong>
              <p className="small mb-1">Permanently delete this line from the visit.</p>
            </div>
          </div>

          <div className="mb-2">
            <h6 className="text-primary mb-2"><strong>Quick Tips</strong></h6>
            <ul className="small">
              <li>Use the Quick Head Toggle buttons to quickly mark heads as Active/Offline</li>
              <li>Green heads are active, red are offline, orange are fixed</li>
              <li>Data is automatically saved to local storage as you work</li>
              <li>Use Past Visits tab to load previous sessions</li>
              <li>Issue History shows all heads with problems across visits</li>
            </ul>
          </div>
        </div>
      )}

      <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k)} className="mb-1 border-bottom">
        <Tab eventKey="current" title="Current Visit">
          <div className="tab-content p-3">
            {currentCustomer && (
              <div className="mb-3">
                <div className="row">
                  <div className="col-md-6 mb-2">
                    <label className="form-label"><strong>Visit Name:</strong></label>
                    <input
                      type="text"
                      value={currentVisitName}
                      onChange={(e) => setCurrentVisitName(e.target.value)}
                      placeholder="Enter visit name (optional)"
                      className="form-control"
                    />
                  </div>
                  <div className="col-md-6 mb-2">
                    <ServiceReportUpload
                      userId={user?.uid}
                      customerId={currentCustomer?.id}
                      visitId={currentVisitId}
                      currentReportUrl={serviceReportUrl}
                      onReportUploaded={(url) => setServiceReportUrl(url)}
                    />
                  </div>
                </div>
              </div>
            )}

            <GlobalForm
              key={`gf-${lines.length}-${JSON.stringify(globalData)}`}
              globalData={globalData}
              setGlobalData={setGlobalData}
              addLine={() => setShowAddLineDialog(true)}
              lines={lines}
              activeLineId={activeLineId}
              onPrevious={() => {
                const currentIndex = lines.findIndex(l => l.id === activeLineId);
                if (currentIndex > 0) {
                  setActiveLineId(lines[currentIndex - 1].id);
                  setShowDashboardView(false);
                }
              }}
              onNext={() => {
                const currentIndex = lines.findIndex(l => l.id === activeLineId);
                if (currentIndex < lines.length - 1) {
                  setActiveLineId(lines[currentIndex + 1].id);
                  setShowDashboardView(false);
                }
              }}
            />

            <div className="d-flex flex-wrap gap-2 my-3 align-items-center">
              <select
                value={activeLineId || ''}
                onChange={(e) => {
                  const lineId = parseInt(e.target.value);
                  if (lineId) {
                    showLine(lineId, setShowDashboardView, setActiveLineId);
                  }
                }}
                className="form-select form-select-sm"
                style={{ width: 'auto', minWidth: '150px' }}
              >
                <option value="">-- Select Line --</option>
                {lines.map(line => (
                  <option key={line.id} value={line.id}>
                    {line.title}
                  </option>
                ))}
              </select>

              {lines.length > 0 && (
                <>
                  <button
                    onClick={() => setShowLinesModal(true)}
                    className="btn btn-sm btn-outline-primary"
                    title="Show all lines"
                  >
                    <List className="w-4 h-4" /> Lines
                  </button>
                  <button
                    onClick={() => setShowDashboardView(true)}
                    className="btn btn-sm btn-outline-secondary"
                    title="View Dashboard"
                  >
                    <Eye className="w-4 h-4" /> Dashboard
                  </button>
                </>
              )}
            </div>

            {showDashboardView ? (
              <Dashboard key={`dash-${lines.length}`} lines={lines} setShowDashboardView={setShowDashboardView} />
            ) : (
              <div>
                {lines.map(line => (
                  <Line
                    key={line.id}
                    line={line}
                    updateLine={updated => updateLine(line.id, updated, setLines, lines)}
                    removeLine={() => handleRemoveLine(line.id)}
                    resetLine={() => handleResetLine(line)}
                    isVisible={line.id === activeLineId}
                    exportLineToPDF={() => exportLineToPDF(line, globalData)}
                    isDark={isDark}
                    visits={visits}
                    currentVisitId={currentVisitId}
                  />
                ))}
              </div>
            )}
          </div>
        </Tab>

        <Tab eventKey="visits" title="Past Visits">
          <div className="tab-content p-3">
            {currentCustomer && (
              <>
                <button onClick={async () => { setShowVisitList(true); await loadVisits(currentCustomer.id); }} className="btn btn-outline-primary btn-sm mb-3">
                  <History className="w-4 h-4" /> Load Past Visits
                </button>
                {showVisitList && visits.length > 0 && (
                  <div className="row row-cols-1 row-cols-md-2 g-3">
                    {visits.slice(0, 10).map(v => (
                      <div key={v.id} className="col">
                        <div className="card h-100">
                          <div className="card-body d-flex justify-content-between align-items-center">
                            <div>
                              <h6 className="card-title mb-1 d-flex align-items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                {v.name ? `${v.name}` : 'Unnamed Visit'}
                                {v.serviceReportUrl && (
                                  <span className="badge bg-success d-inline-flex align-items-center gap-1" title="Service Report Attached">
                                    <FileText size={12} /> PDF
                                  </span>
                                )}
                              </h6>
                              <small className="text-muted">
                                {new Date(v.date).toLocaleString()}
                              </small>
                            </div>
                            <div className="btn-group">
                              <button onClick={() => loadVisit(v.id)} className="btn btn-sm btn-outline-primary">
                                Load
                              </button>
                              <button 
                                onClick={() => {
                                  setVisitToEdit(v);
                                  setEditTimestamp(new Date(v.date).toISOString().slice(0, 16));
                                }} 
                                className="btn btn-sm btn-outline-secondary"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button onClick={() => deleteVisit(v.id)} className="btn btn-sm btn-outline-danger">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Tab>

        <Tab eventKey="history" title="Issue History">
          <div className="tab-content p-3">
            <IssueHistory customers={customers} visits={visits} onExportPDF={exportLineHistoryToPDF} />
          </div>
        </Tab>

        <Tab eventKey="layout" title={<><Factory size={16} className="me-1" /> Factory Layout</>}>
          <div className="tab-content p-3">
            <FactoryLayout
              lines={lines}
              currentCustomer={currentCustomer}
              currentVisitId={currentVisitId}
              user={user}
              onNavigateToLine={(lineId) => {
                setActiveLineId(lineId);
                setShowDashboardView(false);
                setActiveTab('current');
              }}
            />
          </div>
        </Tab>
      </Tabs>

      {visitToEdit && (
        <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1050 }}>
          <div className="card shadow">
            <div className="card-body">
              <h6 className="card-title">Edit Visit Timestamp</h6>
              <div className="d-flex gap-2 align-items-center">
                <input 
                  type="datetime-local" 
                  value={editTimestamp} 
                  onChange={(e) => setEditTimestamp(e.target.value)}
                  className="form-control form-control-sm"
                />
                <button onClick={updateVisitTimestamp} className="btn btn-primary btn-sm">Update</button>
                <button onClick={() => { setVisitToEdit(null); setEditTimestamp(''); }} className="btn btn-secondary btn-sm">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lines Modal */}
      {showLinesModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowLinesModal(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className={`modal-content ${isDark ? 'bg-dark text-light' : ''}`}>
              <div className="modal-header">
                <h5 className="modal-title">Select Line</h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowLinesModal(false)}></button>
              </div>
              <div className="modal-body">
                {lines.length === 0 ? (
                  <p className="text-muted">No lines added yet.</p>
                ) : (
                  <div className="d-grid gap-2">
                    {lines.map(line => {
                      const offlineHeads = line.heads.filter(h => h.status === 'offline');
                      const offlineCount = offlineHeads.length;
                      const fixedOfflineHeads = offlineHeads.filter(h => {
                        const issues = h.issues || [];
                        // Check new format (issues array) or old format (fixed on head)
                        if (issues.length > 0) {
                          return issues.every(iss => iss.fixed === 'fixed');
                        }
                        // Old format - check h.fixed directly
                        return h.fixed === 'fixed';
                      });
                      const repairedCount = fixedOfflineHeads.length;
                      const hasIssues = line.heads.some(h => {
                        const issues = h.issues || [];
                        return issues.length > 0 || (h.error && h.error !== 'None');
                      });

                      let btnClass = 'btn-success'; // All good
                      let btnStyle = {};
                      if (offlineCount > 0) {
                        const allFixed = repairedCount === offlineCount;
                        const someFixed = repairedCount > 0 && repairedCount < offlineCount;

                        if (allFixed) {
                          btnClass = 'btn-warning'; // Yellow - all offline heads fixed
                        } else if (someFixed) {
                          btnClass = ''; // Orange - some fixed, some not
                          btnStyle = { backgroundColor: '#fd7e14', borderColor: '#fd7e14', color: 'white' };
                        } else {
                          btnClass = 'btn-danger'; // Red - none fixed
                        }
                      } else if (hasIssues) {
                        btnClass = 'btn-info';
                      }

                      return (
                        <button
                          key={line.id}
                          onClick={() => {
                            setActiveLineId(line.id);
                            setShowDashboardView(false);
                            setShowLinesModal(false);
                          }}
                          className={`btn ${btnClass} ${line.id === activeLineId ? 'active' : ''}`}
                          style={{
                            textAlign: 'left',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            ...btnStyle
                          }}
                        >
                          <span style={{ fontWeight: 'bold', color: 'white', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>{line.title}</span>
                          <span>
                            {repairedCount > 0 && (
                              <span className="badge bg-warning text-dark me-1">{repairedCount} repaired</span>
                            )}
                            {offlineCount > 0 ? (
                              <span className="badge bg-dark text-white">{line.heads.length - offlineCount + repairedCount}/{line.heads.length}</span>
                            ) : (
                              <span className="badge bg-dark text-white">{line.heads.length} heads</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowLinesModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportLegacy} className="d-none" />

      {/* Share Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        customerId={currentCustomer?.id}
        customerName={currentCustomer?.name}
        visitId={currentVisitId}
        visitName={currentVisitName}
        userId={user?.uid}
      />

      {/* Add Line Dialog */}
      <AddLineDialog
        isOpen={showAddLineDialog}
        onClose={() => setShowAddLineDialog(false)}
        onAdd={handleAddLine}
        defaultHeadCount={parseInt(globalData.headCount) || DEFAULT_HEAD_COUNT}
      />

      {/* Dialog System (confirm/alert/prompt dialogs and toasts) */}
      {dialog.DialogComponent}
    </div>
  );
};

// Wrap in Router for deep linking support
const App = () => (
  <Router>
    <AppContent />
  </Router>
);

export default App;