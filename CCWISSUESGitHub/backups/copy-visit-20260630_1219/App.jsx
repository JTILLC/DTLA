import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { BrowserRouter as Router, useSearchParams } from 'react-router-dom';

import GlobalForm from './components/GlobalForm.jsx';
import Line from './components/Line.jsx';
import Dashboard from './components/Dashboard.jsx';
import FactoryLayout from './components/FactoryLayout/FactoryLayout.jsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
// jspdf-autotable v5 dropped the doc.autoTable() prototype method; use the functional API.
// Interop-safe across Vite's default-export resolution.
import autoTableLib from 'jspdf-autotable';
const autoTable = typeof autoTableLib === 'function' ? autoTableLib : autoTableLib.default;
import { Tabs, Tab } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Save, CloudUpload, CloudDownload, Copy, RefreshCw, Trash2, Edit3, Plus, Download, Upload, FileText, History, Settings, Eye, HelpCircle, Factory, List, Share2 } from 'lucide-react';
import ShareModal from './components/ShareModal.jsx';
import ServiceReportUpload from './components/ServiceReportUpload.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import { ToastProvider, AlertShim, useToast } from './components/Toast.jsx';
import VisitsSidebar from './components/VisitsSidebar.jsx';

// Shared utilities and constants
import { FIREBASE_CONFIG, DEFAULT_HEAD_COUNT, PDF_CONFIG, FIXED_STATUS, AUDIT_SECTIONS } from './config/constants';
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
    // Span calibration certificate fields (entered in the Span Calibration preview)
    customerContact: '',
    spanCalWeight: '',
    targetWeight: '',
    avgWeight100: '',
    stdDev100: '',
    // Machine audit
    showAudit: false,
    audit: {},
    auditNotes: '',
  };
  setLines([...lines, newLine]);
  setActiveLineId(newLine.id);
};

const showLine = (id, setShowDashboardView, setActiveLineId) => {
  setShowDashboardView(false);
  setActiveLineId(id);
};

// Sign-in is now handled via modal form instead of prompt() for iOS compatibility

const exportDashboardToPDF = (lines, globalData) => {
  if (lines.length === 0) return alert('No data to export');
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
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
      autoTable(doc, {
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

// Renders the line report onto the current page of `doc` (so it can be merged with other sections)
const renderLineReport = (doc, line, globalData) => {
  const gd = globalData || {};
  // Migrate line to new format
  const migratedLine = migrateLineHeads(line);

  // Add JTI logo top-left
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight);

  // Title
  doc.setFontSize(PDF_CONFIG.titleFontSize);
  doc.text('Ishida Line Report', 105, 20, { align: 'center' });
  doc.setFontSize(PDF_CONFIG.bodyFontSize);
  doc.text(`Customer: ${gd.customer || 'N/A'}`, 105, 28, { align: 'center' });
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

    autoTable(doc, {
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
};

const exportLineToPDF = (line, globalData) => {
  if (!line) return alert('No line data to export');
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  renderLineReport(doc, line, globalData);
  doc.save(`${(globalData?.customer) || 'ishida'}-${line.title.replace(/[^a-z0-9]/gi, '-')}.pdf`);
};

// Combination Weigher Span Calibration Certificate — mirrors the printed JTI template.
// Renders onto the current page of `doc` so it can be merged with other sections.
const renderSpanCalibration = (doc, line, globalData, opts = {}) => {
  if (!line || !Array.isArray(line.heads)) return;
  const showFooter = opts.footer !== false; // combined export hides the disclaimer/signature footer
  const migratedLine = migrateLineHeads(line);
  const gd = globalData || {};

  const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setFullYear(dueDate.getFullYear() + 1);
  dueDate.setDate(dueDate.getDate() - 1); // valid for one year (matches template: e.g. 7/1 -> 6/30 next year)

  // Header: logo (left) + title, then company / phone / email / location stacked
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Combination Weigher Span Calibration Certificate', 50, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Joshua Todd Industries', 50, 21);
  doc.text('(623) 300-6445', 50, 27);
  doc.text('josh@jtiaz.com', 50, 33);
  doc.text('Gilbert, AZ', 50, 39);

  // Info block: left = machine, right = customer. Every entered value sits on an underline.
  doc.setFontSize(10);
  const leftX = 14, rightX = 110;
  const infoRow = (yy, lLabel, lValue, rLabel, rValue) => {
    doc.text(lLabel, leftX, yy);
    doc.text(String(lValue || ''), leftX + 40, yy);
    doc.line(leftX + 40, yy + 1.5, leftX + 95, yy + 1.5);
    doc.text(rLabel, rightX, yy);
    doc.text(String(rValue || ''), rightX + 35, yy);
    doc.line(rightX + 35, yy + 1.5, 198, yy + 1.5);
  };
  const customerName = line.customerName || gd.customer || '';
  const customerLocation = line.customerLocation || gd.cityState || gd.address || '';
  let y = 48;
  infoRow(y, 'Model Information', migratedLine.model, 'Customer Name', customerName); y += 7;
  infoRow(y, 'Job Number', migratedLine.jobNumber, 'Customer Location', customerLocation); y += 7;
  infoRow(y, 'Serial Number', migratedLine.serialNumber, 'Customer Contact', migratedLine.customerContact); y += 10;

  // Per-head weights — two side-by-side tables so up to ~32 heads fit on one page
  const tableStartY = y;
  const heads = migratedLine.heads;
  const half = Math.ceil(heads.length / 2);
  const rowsFor = (start, end) => heads.slice(start, end).map((h, i) => {
    const before = Number(h.currentWeight ?? 0);
    const after = Number(h.spanWeight ?? 0);
    return [start + i + 1, String(h.currentWeight ?? 0), String(h.spanWeight ?? 0), (after - before).toFixed(2)];
  });
  const tableOpts = (leftMargin, body) => ({
    startY: tableStartY,
    body,
    head: [['#', 'Before Calibration Weight', 'After Calibration Weight', 'Difference']],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.2, halign: 'center' },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold', fontSize: 7 },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 28 }, 2: { cellWidth: 28 }, 3: { cellWidth: 22 } },
    margin: { left: leftMargin },
    tableWidth: 88,
  });
  autoTable(doc, tableOpts(14, rowsFor(0, half)));
  const finalY1 = doc.lastAutoTable?.finalY || tableStartY;
  let finalY2 = tableStartY;
  if (heads.length > half) {
    autoTable(doc, tableOpts(110, rowsFor(half, heads.length)));
    finalY2 = doc.lastAutoTable?.finalY || tableStartY;
  }
  const tablesBottom = Math.max(finalY1, finalY2);

  // Calibration test stats — below the tables (2 x 2 grid)
  doc.setFontSize(10);
  const placeStat = (x, yy, label, value) => {
    doc.text(label, x, yy);
    doc.text(String(value || ''), x + 55, yy);
    doc.line(x + 55, yy + 1.5, x + 80, yy + 1.5);
  };
  let stY = tablesBottom + 10;
  placeStat(14, stY, 'Span Calibration Weight', line.spanCalWeight);
  placeStat(110, stY, 'Average weight 100 cycles', line.avgWeight100);
  stY += 8;
  placeStat(14, stY, 'Target Weight for test', line.targetWeight);
  placeStat(110, stY, 'Standard Deviation 100 cycles', line.stdDev100);

  if (!showFooter) return; // combined export: stop after the stats (no disclaimer/signatures/dates)

  // Disclaimer + signatures (below the stats)
  let fy = stY + 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const disclaimer = 'During this span test and calibration, the weigher was calculating and weighing properly. Joshua Todd Industries is not responsible for any package weights after this test.';
  const dLines = doc.splitTextToSize(disclaimer, 180);
  doc.text(dLines, 105, fy, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  fy += dLines.length * 5 + 12;

  const dateStr = line.calDate || fmtDate(today);
  const dueStr = line.calDueDate || fmtDate(dueDate);
  const custSig = line._customerSig;   // PNG data URL (drawn or typed signature; not persisted)
  const calSig = line._calibratorSig;
  const addSig = (img, yy) => { if (img) { try { doc.addImage(img, 'PNG', 66, yy - 11, 48, 13); } catch { /* ignore */ } } };

  doc.setFontSize(10);
  doc.text('Customer Name (printed)', 14, fy);
  doc.text(String(line.signerName || ''), 66, fy);
  doc.line(64, fy + 1.5, 130, fy + 1.5); fy += 15;

  doc.text('Customer Signature', 14, fy); addSig(custSig, fy); doc.line(64, fy + 1.5, 120, fy + 1.5);
  doc.text('Date', 135, fy); doc.text(dateStr, 150, fy); doc.line(149, fy + 1.5, 195, fy + 1.5); fy += 16;

  doc.text('Calibrator Signature', 14, fy); addSig(calSig, fy); doc.line(64, fy + 1.5, 120, fy + 1.5);
  doc.text('Due Date', 135, fy); doc.text(dueStr, 155, fy); doc.line(154, fy + 1.5, 200, fy + 1.5);
};

const buildSpanCalibrationPDF = (line, globalData) => {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  renderSpanCalibration(doc, line, globalData);
  return doc;
};

// Machine Audit — checklist (Good / Bad / N-A + notes), grouped into sections.
// Renders onto the current page(s) of `doc`.
const renderAudit = (doc, line, globalData) => {
  const gd = globalData || {};
  const migratedLine = migrateLineHeads(line || { heads: [] });
  const audit = line?.audit || {};
  const pageH = doc.internal.pageSize.height;
  const customerName = line?.customerName || gd.customer || '';

  // Header
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('Combination Weigher Audit', 50, 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Customer: ${customerName}`, 50, 23);
  doc.text(`Model: ${migratedLine.model || ''}    Serial: ${migratedLine.serialNumber || ''}`, 50, 29);

  const colGood = 96, colBad = 116, colNA = 136, colNotes = 150;
  let y = 40;

  const checkbox = (x, yy, checked) => {
    doc.setLineWidth(0.3); doc.setDrawColor(0); doc.rect(x - 2, yy - 3.0, 4, 4);
    if (checked) { doc.setLineWidth(0.7); doc.line(x - 1.4, yy - 1.2, x - 0.3, yy - 0.1); doc.line(x - 0.3, yy - 0.1, x + 1.6, yy - 2.8); doc.setLineWidth(0.3); }
  };

  // Compact, fixed sizing (no page breaks) so the whole audit always fits on one page
  AUDIT_SECTIONS.forEach((section) => {
    doc.setFillColor(20, 20, 20); doc.rect(14, y - 4.2, 182, 6, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(section.title, 16, y);
    doc.text('Good', colGood, y, { align: 'center' });
    doc.text('Bad', colBad, y, { align: 'center' });
    doc.text('N/A', colNA, y, { align: 'center' });
    doc.text('Notes', colNotes, y);
    doc.setTextColor(0); doc.setFont('helvetica', 'normal');
    y += 6.5;
    doc.setFontSize(8);
    section.items.forEach((label) => {
      const row = audit[label] || {};
      const noteLines = row.note ? doc.splitTextToSize(String(row.note), 44) : [];
      const rowH = Math.max(5.5, noteLines.length * 3.8 + 1.7); // grows only when the note wraps
      doc.text(label, 16, y);
      checkbox(colGood, y, row.status === 'good');
      checkbox(colBad, y, row.status === 'bad');
      checkbox(colNA, y, row.status === 'na');
      let ny = y;
      noteLines.forEach((ln) => { doc.text(ln, colNotes, ny); ny += 3.8; });
      doc.setDrawColor(215); doc.line(14, y + rowH - 4, 196, y + rowH - 4); doc.setDrawColor(0);
      y += rowH;
    });
    y += 2;
  });

  // Audit notes — fit into whatever space remains so it never spills to a second page
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Audit Notes', 14, y); y += 6;
  doc.setFont('helvetica', 'normal');
  const notesText = String(line?.auditNotes || '').trim();
  if (notesText) {
    const lines = doc.splitTextToSize(notesText, 182);
    const avail = (pageH - 14) - y;
    const lh = lines.length ? Math.min(4.6, Math.max(3.0, avail / lines.length)) : 4.6;
    doc.setFontSize(lh < 4 ? 8 : 9);
    lines.forEach((ln) => { doc.text(ln, 14, y); y += lh; });
  } else {
    doc.setFontSize(9);
    for (let i = 0; i < 3; i++) { doc.setDrawColor(180); doc.line(14, y, 196, y); doc.setDrawColor(0); y += 6.5; }
  }
};

// Combined export: Line Report + Span Calibration + Audit, with any section excluded.
const buildCombinedPDF = (line, globalData, opts = {}) => {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  let first = true;
  const next = () => { if (!first) doc.addPage(); first = false; };
  if (opts.dashboard !== false) { next(); renderLineReport(doc, line, globalData); }
  if (opts.span !== false) { next(); renderSpanCalibration(doc, line, globalData, { footer: false }); }
  if (opts.audit !== false) { next(); renderAudit(doc, line, globalData); }
  if (first) { doc.setFontSize(12); doc.text('No sections selected.', 20, 20); }
  return doc;
};

const exportLineHistoryToPDF = (lineHistory, customerName, lineTitle) => {
  if (lineHistory.length === 0) return alert('No history to export');
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
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
      doc.addImage(PDF_CONFIG.logoUrl, 'PNG', 14, 10, 30, 15);
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

    autoTable(doc, {
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

  const history = useMemo(() => {
    if (!selectedCustomer || !selectedLine) return [];
    const customer = customers.find(c => c.id === selectedCustomer);
    if (!customer) return [];

    const customerVisits = visits.filter(v => v.customerId === selectedCustomer);
    const headHistory = {};

    customerVisits.forEach(visit => {
      const linesToProcess = selectedLine === '__ALL__'
        ? visit.lines
        : visit.lines.filter(l => l.title === selectedLine);

      linesToProcess.forEach(line => {
        line.heads.forEach(head => {
          const headIssues = head.issues || [];
          const hasOldFormatIssue = head.error && head.error !== 'None';
          const hasNewFormatIssues = headIssues.length > 0;
          const hasNotes = head.notes && head.notes.trim() !== '';
          const isOffline = head.status !== 'active';

          if (isOffline || hasOldFormatIssue || hasNewFormatIssues || hasNotes) {
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

            const issuesList = [];
            if (hasNewFormatIssues) {
              headIssues.forEach(iss => {
                issuesList.push({ type: iss.type, fixed: iss.fixed, notes: iss.notes || '' });
              });
            } else if (hasOldFormatIssue) {
              issuesList.push({ type: head.error, fixed: head.fixed, notes: '' });
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
      visitEntries: entry.visitEntries.sort(
        (a, b) => new Date(b.visitDate || 0) - new Date(a.visitDate || 0)
      )
    }));

    result.sort((a, b) => {
      if (a.lineTitle !== b.lineTitle) return a.lineTitle.localeCompare(b.lineTitle);
      return a.headId - b.headId;
    });

    return result;
  }, [selectedCustomer, selectedLine, customers, visits]);

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
              <div className="table-responsive">
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
  const toast = useToast();

  const [globalData, setGlobalData] = useState({ customer: '', address: '', cityState: '', headCount: '14' });
  const [lines, setLines] = useState([]);
  const [showDashboardView, setShowDashboardView] = useState(false);
  const [activeLineId, setActiveLineId] = useState(null);
  const [session, setSession] = useState(null);
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
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [deletedVisits, setDeletedVisits] = useState([]);
  const [customerToDelete, setCustomerToDelete] = useState('');
  const [visitToDelete, setVisitToDelete] = useState('');
  const [visitToEdit, setVisitToEdit] = useState(null);
  const [editTimestamp, setEditTimestamp] = useState('');
  const [currentVisitId, setCurrentVisitId] = useState(null);
  const [serviceReportUrl, setServiceReportUrl] = useState(null);
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

  // Stable callbacks for <Line> so React.memo can skip untouched lines.
  // linesRef lets handlers read the latest lines without re-creating on every state change.
  const linesRef = useRef(lines);
  useEffect(() => { linesRef.current = lines; }, [lines]);
  const globalDataRef = useRef(globalData);
  useEffect(() => { globalDataRef.current = globalData; }, [globalData]);

  const updateLineStable = useCallback((updated) => {
    setLines(prev => prev.map(l => l.id === updated.id ? updated : l));
  }, []);

  const handleRemoveLine = useCallback(async (id) => {
    const lineTitle = linesRef.current.find(l => l.id === id)?.title;
    const confirmed = await dialog.confirm(
      `Are you sure you want to remove "${lineTitle || 'this line'}"?`,
      { title: 'Remove Line', variant: 'danger', confirmText: 'Remove' }
    );
    if (!confirmed) return;
    setLines(prev => prev.filter(l => l.id !== id));
    setActiveLineId(prev => {
      if (prev !== id) return prev;
      const remaining = linesRef.current.filter(l => l.id !== id);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [dialog]);

  const handleResetLine = useCallback(async (line) => {
    const confirmed = await dialog.confirm(
      `Reset "${line.title}" to default? All data for this line will be cleared.`,
      { title: 'Reset Line', variant: 'warning', confirmText: 'Reset' }
    );
    if (!confirmed) return;
    setLines(prev => prev.map(l =>
      l.id === line.id ? { ...l, notes: '', heads: createDefaultHeads(l.heads.length) } : l
    ));
  }, [dialog]);

  const exportLineStable = useCallback((line) => {
    exportLineToPDF(line, globalDataRef.current);
  }, []);

  const buildSpanCalStable = useCallback(
    (line) => buildSpanCalibrationPDF(line, globalDataRef.current),
    []
  );

  const buildCombinedStable = useCallback(
    (line, opts) => buildCombinedPDF(line, globalDataRef.current, opts),
    []
  );

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
          }
        }

        setActiveLineId(targetLineId);
        setShowDashboardView(false); // Make sure we're viewing the line, not dashboard
        setCurrentVisitName(data.name || '');
        setCurrentVisitId(visitId);
        setServiceReportUrl(data.serviceReportUrl || null);

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
      loadVisitByDeepLink(visitId, customerId, lineName, headName);
      setDeepLinkProcessed(true);
    }
  }, [user, searchParams, deepLinkProcessed]);

  const loadVisit = async (visitId) => {
    if (!user || !currentCustomer) return alert('Select a customer first');
    // Resolve against the customerId tagged on the visit in the subscription list
    // (visit.customerId is stamped in the onSnapshot mapper). Falls back to the
    // currently-selected customer. This protects against race conditions where
    // the user clicks a visit from one customer while we're switching to another.
    const visitFromList = (visits || []).find(v => v.id === visitId);
    const effectiveCustomerId = visitFromList?.customerId || currentCustomer.id;
    const path = `user_files/${user.uid}/customers/${effectiveCustomerId}/visits/${visitId}`;
    console.log('[loadVisit] fetching', path);
    try {
      const doc = await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(effectiveCustomerId)
        .collection('visits')
        .doc(visitId)
        .get();
      if (doc.exists) {
        const data = doc.data();
        const loadedLines = (data.lines || []).map(line => ({
          ...line,
          heads: (line.heads || []).map((head, i) => ({ ...head, id: head.id || i + 1 }))
        }));
        setGlobalData(data.globalData || {});
        setLines(loadedLines);
        setActiveLineId(loadedLines.length > 0 ? loadedLines[0].id : null);
        setCurrentVisitName(data.name || '');
        setCurrentVisitId(visitId);
        setServiceReportUrl(data.serviceReportUrl || null);
        alert('Visit loaded!');
      } else {
        console.error('[loadVisit] not found at', path, { currentCustomerId: currentCustomer.id, visitFromList });
        alert(`Visit not found at: ${path}`);
      }
    } catch (err) {
      console.error('[loadVisit] error fetching', path, err);
      alert(`Failed to load visit: ${err?.message || err}`);
    }
  };

  const clearStorage = async () => {
    const ok = await dialog.confirm('Clear all local data? This will reset everything.', {
      title: 'Clear Local Data',
      variant: 'danger',
      confirmText: 'Clear',
    });
    if (!ok) return;

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
    const name = customers.find(c => c.id === custId)?.name || 'this customer';
    const ok = await dialog.confirm(`Delete customer "${name}" and all its visits?`, {
      title: 'Delete Customer',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!ok) return;
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
    const ok = await dialog.confirm('Move this visit to the recycle bin?', {
      title: 'Delete Visit',
      variant: 'warning',
      confirmText: 'Move to Recycle Bin',
    });
    if (!ok) return;
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(custId)
        .collection('visits')
        .doc(visitId)
        .update({ deleted: true, deletedAt: new Date().toISOString() });
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

  const loadDeletedVisits = async (custId) => {
    if (!user) return;
    const snap = await firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .doc(custId)
      .collection('visits')
      .where('deleted', '==', true)
      .get();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const toDelete = snap.docs.filter(d => {
      const deletedAt = d.data().deletedAt;
      return deletedAt && new Date(deletedAt) < thirtyDaysAgo;
    });

    if (toDelete.length > 0) {
      const batch = firebase.firestore().batch();
      toDelete.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    const list = snap.docs
      .filter(d => {
        const deletedAt = d.data().deletedAt;
        return !deletedAt || new Date(deletedAt) >= thirtyDaysAgo;
      })
      .map(d => ({ id: d.id, customerId: custId, ...d.data() }))
      .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    setDeletedVisits(list);
  };

  const restoreVisit = async (custId, visitId) => {
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(custId)
        .collection('visits')
        .doc(visitId)
        .update({ deleted: false, deletedAt: null });
      await loadDeletedVisits(custId);
      if (currentCustomer?.id === custId) {
        await loadVisits(custId);
      }
    } catch (err) {
      alert('Failed to restore visit');
    }
  };

  const permanentlyDeleteVisit = async (custId, visitId) => {
    const ok = await dialog.confirm('Permanently delete this visit? This cannot be undone.', {
      title: 'Permanently Delete',
      variant: 'danger',
      confirmText: 'Delete Forever',
    });
    if (!ok) return;
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
      await loadDeletedVisits(custId);
    } catch (err) {
      alert('Failed to permanently delete visit');
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
      const confirmMsg = `This will replace the existing visit "${currentVisitName || 'Unnamed'}" in the cloud with your current changes.\n\nCustomer: ${currentCustomer.name}\nVisit: ${currentVisitName || 'Unnamed'}\nLines: ${lines.length}\n\nThis action cannot be undone. Continue?`;
      const ok = await dialog.confirm(confirmMsg, {
        title: 'Override Current Visit',
        variant: 'warning',
        confirmText: 'Override',
      });
      if (!ok) return;
    } else {
      const ok = await dialog.confirm(
        `Save as NEW visit to cloud?\n\nCustomer: ${currentCustomer.name}\nVisit Name: ${currentVisitName || 'Unnamed'}\nLines: ${lines.length}`,
        { title: 'Save New Visit', confirmText: 'Save' }
      );
      if (!ok) return;
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
    const ok = await dialog.confirm('Duplicate current visit?', { title: 'Duplicate Visit', confirmText: 'Duplicate' });
    if (!ok) return;

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
    const ok = await dialog.confirm('Save ALL local data to cloud? This will upload any unsaved visits.', {
      title: 'Save All to Cloud',
      confirmText: 'Save All',
    });
    if (!ok) return;

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
    const ok = await dialog.confirm('Load ALL customers and visits from cloud? This will overwrite local data.', {
      title: 'Load All from Cloud',
      variant: 'warning',
      confirmText: 'Load All',
    });
    if (!ok) return;

    try {
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
    const unsub = firebase.auth().onAuthStateChanged((u) => {
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
        });
      });
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .onSnapshot((snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data().profile }));
        setCustomers(list);
      });
    return () => unsub();
  }, [user]);

  // Auto-resume last customer on first customers-loaded (skip if deep-link in progress)
  const autoResumedRef = useRef(false);
  const pendingVisitIdRef = useRef(null);
  useEffect(() => {
    if (autoResumedRef.current) return;
    if (!user || customers.length === 0 || currentCustomer) return;
    // Respect deep-link flows — if URL has ?customerId=, let that path drive
    const urlHasDeepLink = typeof window !== 'undefined' &&
      /[?&](customerId|visitId)=/.test(window.location.search);
    if (urlHasDeepLink) { autoResumedRef.current = true; return; }

    const lastCustId = localStorage.getItem('ccwissues-last-customer-id');
    const lastVisitId = localStorage.getItem('ccwissues-last-visit-id');
    const cust = lastCustId && customers.find(c => c.id === lastCustId);
    if (cust) {
      autoResumedRef.current = true;
      pendingVisitIdRef.current = lastVisitId || null;
      handleSelectCustomer(cust.id);
    } else {
      autoResumedRef.current = true;
    }
  }, [user, customers, currentCustomer]);

  // After customer is selected, flush any pending visit load (from auto-resume)
  useEffect(() => {
    if (currentCustomer?.id && pendingVisitIdRef.current) {
      const vid = pendingVisitIdRef.current;
      pendingVisitIdRef.current = null;
      loadVisit(vid);
    }
  }, [currentCustomer?.id]);

  // Persist last customer + visit so we can auto-resume next session
  useEffect(() => {
    if (currentCustomer?.id) {
      localStorage.setItem('ccwissues-last-customer-id', currentCustomer.id);
    }
  }, [currentCustomer?.id]);
  useEffect(() => {
    if (currentVisitId) {
      localStorage.setItem('ccwissues-last-visit-id', currentVisitId);
    } else {
      localStorage.removeItem('ccwissues-last-visit-id');
    }
  }, [currentVisitId]);

  // Real-time visits subscription — keeps the sidebar in sync across devices.
  // Replaces the earlier one-shot loadVisits(currentCustomer.id) call.
  useEffect(() => {
    if (!user || !currentCustomer?.id) {
      setVisits([]);
      return;
    }
    const subscribedCustomerId = currentCustomer.id;
    // Clear immediately so the old customer's visits don't flash in the UI
    // before the new subscription's first snapshot arrives.
    setVisits([]);
    const unsub = firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .doc(subscribedCustomerId)
      .collection('visits')
      .orderBy('date', 'desc')
      .onSnapshot((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, customerId: subscribedCustomerId, ...d.data() }))
          .filter((v) => !v.deleted);
        setVisits(list);
      });
    return () => unsub();
  }, [user, currentCustomer?.id]);

  // Live ref so the subscription callback (below) always compares against the
  // current visit name without re-subscribing on every keystroke.
  // linesRef and globalDataRef are already declared earlier in this component.
  const currentVisitNameRef = useRef(currentVisitName);
  useEffect(() => { currentVisitNameRef.current = currentVisitName; }, [currentVisitName]);

  // Real-time current-visit subscription — if another device saves this visit,
  // detect the change and show a toast prompting the user to reload. Never
  // auto-applies remote state (so local unsaved edits aren't silently clobbered).
  // Snapshots with hasPendingWrites (own local writes) are skipped.
  const cloudPromptToastIdRef = useRef(null);
  useEffect(() => {
    if (!user || !currentCustomer?.id || !currentVisitId) return;

    const dismissPrompt = () => {
      if (cloudPromptToastIdRef.current != null) {
        toast.dismiss(cloudPromptToastIdRef.current);
        cloudPromptToastIdRef.current = null;
      }
    };

    const unsub = firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .doc(currentCustomer.id)
      .collection('visits')
      .doc(currentVisitId)
      .onSnapshot((doc) => {
        if (!doc.exists) return;
        if (doc.metadata.hasPendingWrites) return; // local write in flight

        const remote = doc.data() || {};
        const remoteLines = (remote.lines || []).map((line) => ({
          ...line,
          heads: (line.heads || []).map((head, i) => ({ ...head, id: head.id || i + 1 })),
        }));

        // Compare remote to current local state (via refs). If same, it's our
        // own just-saved snapshot echoing back — dismiss any pending prompt.
        const sameLines = JSON.stringify(remoteLines) === JSON.stringify(linesRef.current);
        const sameGlobal = JSON.stringify(remote.globalData || {}) === JSON.stringify(globalDataRef.current);
        const sameName = (remote.name || '') === currentVisitNameRef.current;
        if (sameLines && sameGlobal && sameName) {
          dismissPrompt();
          return;
        }

        const applyRemote = () => {
          setGlobalData(remote.globalData || {});
          setLines(remoteLines);
          setCurrentVisitName(remote.name || '');
          setServiceReportUrl(remote.serviceReportUrl || null);
          dismissPrompt();
        };

        // Don't stack prompts; just replace the existing one
        if (cloudPromptToastIdRef.current != null) {
          toast.dismiss(cloudPromptToastIdRef.current);
        }

        const msg = (
          <div>
            <div>Cloud has newer data for this visit.</div>
            <button
              type="button"
              onClick={applyRemote}
              style={{
                marginTop: 6,
                padding: '4px 10px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                border: 0,
                borderRadius: 6,
                background: 'var(--brand)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        );
        cloudPromptToastIdRef.current = toast.info(msg, { duration: 0 });
      });

    return () => {
      unsub();
      dismissPrompt();
    };
  }, [user, currentCustomer?.id, currentVisitId, toast]);

  // Sidebar collapsed state — persisted
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ccwissues-sidebar-collapsed') === '1';
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('ccwissues-sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  };

  // Inline rename for a visit (used by sidebar)
  const renameVisit = async (visitId, newName) => {
    if (!user || !currentCustomer) return;
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection('visits')
        .doc(visitId)
        .update({ name: newName });
      await loadVisits(currentCustomer.id);
      if (visitId === currentVisitId) {
        setCurrentVisitName(newName);
      }
    } catch (err) {
      alert('Failed to rename visit');
    }
  };

  const refreshCustomers = async () => {
    if (!user) return;
    const snap = await firebase
      .firestore()
      .collection('user_files')
      .doc(user.uid)
      .collection('customers')
      .get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data().profile }));
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

        const customerId = await upsertCustomer(profile);

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

        const custSnap = await firebase
          .firestore()
          .collection('user_files')
          .doc(user.uid)
          .collection('customers')
          .doc(customerId)
          .get();
        if (custSnap.exists) {
          const cust = { id: customerId, ...custSnap.data().profile };
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
    const list = snap.docs
      .map(d => ({ id: d.id, customerId: custId, ...d.data() }))
      .filter(v => !v.deleted);
    setVisits(list);
  };

  const deleteVisit = async (visitId) => {
    const ok = await dialog.confirm('Move this visit to the recycle bin?', {
      title: 'Delete Visit',
      variant: 'warning',
      confirmText: 'Move to Recycle Bin',
    });
    if (!ok) return;
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection('visits')
        .doc(visitId)
        .update({ deleted: true, deletedAt: new Date().toISOString() });
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
    const ok = await dialog.confirm('Load latest visit from cloud?', { title: 'Load Latest Visit', confirmText: 'Load' });
    if (!ok) return;

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
    const ok = await dialog.confirm('Export all data?', { title: 'Export All Data', confirmText: 'Export' });
    if (!ok) return;
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
    const ok = await dialog.confirm('Import all data? This will overwrite existing data.', {
      title: 'Import All Data',
      variant: 'warning',
      confirmText: 'Import',
    });
    if (!ok) return;
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

  if (!user) {
    return <LoginScreen onLogin={async (email, password) => {
      const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
      setSession(cred.user);
    }} />;
  }

  return (
    <div className="container-fluid p-0">
      {/* Offline status indicator */}
      <OfflineIndicator />

      <style>{`
        .control-bar {
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
          padding: 6px 10px;
          position: sticky;
          top: 0;
          z-index: 1000;
          /* no overflow here — otherwise dropdown menus get clipped */
        }
        /* Single-row toolbar. We override Bootstrap's .flex-wrap utility
           (which uses !important) by targeting the class we apply ourselves. */
        .control-bar .toolbar-row {
          display: flex !important;
          flex-wrap: nowrap !important;
          gap: 6px;
          align-items: center;
          min-width: 0;
        }
        .control-bar .toolbar-row > * {
          flex: 0 0 auto;
        }
        /* Buttons shouldn't expand to fill row */
        .control-bar .toolbar-row .btn {
          width: auto !important;
          flex: 0 0 auto !important;
        }
        /* Select grows to take available width, shrinks if needed */
        .control-bar .form-select-sm {
          width: auto !important;
          flex: 1 1 160px !important;
          min-width: 130px;
          max-width: 260px;
        }
        .control-bar .btn-sm {
          font-size: 0.8125rem;
          padding: 0.3rem 0.55rem;
        }
        .control-bar .btn-sm svg {
          width: 14px;
          height: 14px;
        }
        .control-bar .btn-label {
          margin-left: 2px;
        }
        /* Overflow-menu dropdown — wider + anchor under the gear on the right */
        .control-bar .dropdown-menu {
          min-width: 240px;
          font-size: 0.9rem;
        }
        .control-bar .dropdown-menu .dropdown-item {
          padding: 0.55rem 0.85rem;
          white-space: nowrap;
        }
        /* Below 900px: drop text labels, keep icon-only buttons + tooltips */
        @media (max-width: 900px) {
          .control-bar {
            padding: 4px 8px;
          }
          .control-bar .toolbar-row {
            gap: 4px;
          }
          .control-bar .btn-label {
            display: none !important;
          }
          .control-bar .customer-label {
            display: none !important;
          }
          .control-bar .form-select-sm {
            min-width: 110px;
            max-width: 220px;
            font-size: 0.8125rem;
          }
          .control-bar .saving {
            font-size: 0.7rem;
            margin-left: 4px;
          }
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
        <div className="toolbar-row">
          <label className="mb-0 customer-label"><strong>Customer:</strong></label>
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

          {/* Primary actions — always visible */}
          {currentVisitId ? (
            <button onClick={() => saveToCloud(true)} className="btn btn-primary btn-sm" title="Save changes to the loaded visit">
              <Save className="w-4 h-4" /> <span className="btn-label">Save</span>
            </button>
          ) : (
            <button
              onClick={() => saveToCloud(false)}
              className="btn btn-primary btn-sm"
              title="Save as new visit"
              disabled={!currentCustomer}
            >
              <Save className="w-4 h-4" /> <span className="btn-label">Save New Visit</span>
            </button>
          )}

          {currentVisitId && (
            <button onClick={() => saveToCloud(false)} className="btn btn-outline-success btn-sm" title="Save as new visit">
              <Plus className="w-4 h-4" /> <span className="btn-label">New</span>
            </button>
          )}

          <button
            onClick={() => setShowShareModal(true)}
            className="btn btn-outline-primary btn-sm"
            disabled={!currentCustomer}
            title="Share"
          >
            <Share2 className="w-4 h-4" /> <span className="btn-label">Share</span>
          </button>

          <div className="btn-group">
            <button className="btn btn-outline-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Export">
              <Download className="w-4 h-4" /> <span className="btn-label">Export</span>
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

          {/* Spacer pushes saving indicator + overflow menu to the right */}
          <div className="ms-auto d-flex align-items-center gap-2">
            {isSaving && <span className="saving">Saving…</span>}

            {/* Overflow menu — less-frequent actions */}
            <div className="btn-group">
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                data-bs-toggle="dropdown"
                aria-expanded="false"
                aria-label="More actions"
                title="More actions"
              >
                <Settings className="w-4 h-4" />
              </button>
              <ul className="dropdown-menu dropdown-menu-end">
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowAddCustomer(true)}>
                    <Plus className="w-4 h-4" /> Add Customer
                  </button>
                </li>
                {currentVisitId && (
                  <li>
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={duplicateVisit}>
                      <Copy className="w-4 h-4" /> Duplicate Visit
                    </button>
                  </li>
                )}
                <li><hr className="dropdown-divider" /></li>
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={saveAllToCloud}>
                    <CloudUpload className="w-4 h-4" /> All to Cloud
                  </button>
                </li>
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={loadAllFromCloud}>
                    <CloudDownload className="w-4 h-4" /> All from Cloud
                  </button>
                </li>
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => fileInputRef.current.click()}>
                    <Upload className="w-4 h-4" /> Import JSON
                  </button>
                </li>
                <li><hr className="dropdown-divider" /></li>
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowDeletePanel(!showDeletePanel)}>
                    <Trash2 className="w-4 h-4" /> Delete Options
                  </button>
                </li>
                {currentCustomer && (
                  <li>
                    <button
                      className="dropdown-item d-flex align-items-center gap-2"
                      onClick={() => { setShowRecycleBin(!showRecycleBin); if (!showRecycleBin) loadDeletedVisits(currentCustomer.id); }}
                    >
                      <Trash2 className="w-4 h-4" /> Recycle Bin
                    </button>
                  </li>
                )}
                <li><hr className="dropdown-divider" /></li>
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={toggleDarkMode}>
                    {isDark ? '☀️ Light Mode' : '🌙 Dark Mode'}
                  </button>
                </li>
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowHelp(!showHelp)}>
                    <HelpCircle className="w-4 h-4" /> Help
                  </button>
                </li>
                <li><hr className="dropdown-divider" /></li>
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2 text-danger" onClick={() => firebase.auth().signOut()}>
                    Logout
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Context bar: active customer + loaded visit */}
      {(currentCustomer || currentVisitName) && (
        <div className="context-bar">
          {currentCustomer ? (
            <span className="pill pill-primary pill-dot" title="Active customer">
              {currentCustomer.name}
            </span>
          ) : (
            <span className="pill pill-muted">No customer selected</span>
          )}
          {currentVisitName && (
            <span className="pill pill-muted" title="Loaded visit">
              {currentVisitName}
            </span>
          )}
        </div>
      )}

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

      {showRecycleBin && currentCustomer && (
        <div className="p-3 border-bottom" style={{ background: 'var(--bs-secondary-bg, #f8f9fa)' }}>
          <div className="d-flex justify-content-between align-items-start mb-2">
            <h6 className="mb-0">🗑️ Recycle Bin — {currentCustomer.name}</h6>
            <button onClick={() => setShowRecycleBin(false)} className="btn btn-sm btn-outline-secondary">Close</button>
          </div>
          {deletedVisits.length === 0 ? (
            <p className="text-muted small mb-0">No deleted visits. Items auto-delete after 30 days.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-bordered mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Visit</th>
                    <th>Date</th>
                    <th>Deleted On</th>
                    <th>Expires</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deletedVisits.map(v => {
                    const deletedAt = new Date(v.deletedAt);
                    const expiresAt = new Date(deletedAt);
                    expiresAt.setDate(expiresAt.getDate() + 30);
                    const daysLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
                    return (
                      <tr key={v.id}>
                        <td>{v.name || '(no name)'}</td>
                        <td>{v.date ? new Date(v.date).toLocaleDateString() : '—'}</td>
                        <td>{deletedAt.toLocaleDateString()}</td>
                        <td>
                          <span className={`badge ${daysLeft <= 5 ? 'bg-danger' : 'bg-secondary'}`}>
                            {daysLeft}d left
                          </span>
                        </td>
                        <td>
                          <div className="d-flex gap-1">
                            <button
                              onClick={() => restoreVisit(currentCustomer.id, v.id)}
                              className="btn btn-sm btn-outline-success"
                            >
                              Restore
                            </button>
                            <button
                              onClick={() => permanentlyDeleteVisit(currentCustomer.id, v.id)}
                              className="btn btn-sm btn-outline-danger"
                            >
                              Delete Forever
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
              <li>Pick a customer from the dropdown (your last customer + visit auto-resume on reload).</li>
              <li>Click a visit in the <strong>left sidebar</strong> to switch to it, or hit <strong>+ New</strong> on the sidebar / in the toolbar to start a new one.</li>
              <li>Add lines and heads, track issues, add notes.</li>
              <li>Tap <strong>Save</strong> to push changes to the cloud (it replaces the loaded visit; use <strong>+ New</strong> to branch instead).</li>
              <li>Export to PDF or JSON from the <strong>Export</strong> menu.</li>
            </ol>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Top Toolbar</strong></h6>

            <div className="mb-2">
              <strong className="text-secondary">Customer dropdown:</strong>
              <p className="small mb-1">Switch between customers. Your selection is remembered between sessions.</p>
            </div>

            <div className="mb-2">
              <strong className="text-primary">Save (blue):</strong>
              <p className="small mb-1">When a visit is loaded, overrides that visit in the cloud with your current changes. When no visit is loaded, saves your work as a new visit.</p>
            </div>

            <div className="mb-2">
              <strong className="text-success">+ New (green outline):</strong>
              <p className="small mb-1">Saves the current state as a <em>new</em> cloud visit (without touching the loaded one). Same as the sidebar's New button.</p>
            </div>

            <div className="mb-2">
              <strong className="text-primary">Share:</strong>
              <p className="small mb-1">Generate a shareable link to the current customer / visit.</p>
            </div>

            <div className="mb-2">
              <strong className="text-secondary">Export ▾:</strong>
              <p className="small mb-1">Dashboard PDF or All Data JSON.</p>
            </div>

            <div className="mb-2">
              <strong className="text-secondary">⚙ Gear menu (right side):</strong>
              <p className="small mb-1">Less-frequent actions: Add Customer, Duplicate Visit, All to Cloud / All from Cloud, Import JSON, Delete Options, Recycle Bin, theme toggle, Help, Logout.</p>
            </div>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Visits Sidebar (left)</strong></h6>
            <ul className="small">
              <li><strong>Click</strong> a visit to switch to it.</li>
              <li><strong>Double-click</strong> the name or tap the pencil to rename inline.</li>
              <li>Trash icon moves the visit to the recycle bin (restorable from the ⚙ menu).</li>
              <li>Hit the ‹ chevron to collapse — on iPhone the toggle becomes a floating button at the bottom-left.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Cross-device sync</strong></h6>
            <ul className="small">
              <li>Save on one device and the sidebar on any other open device updates in real time.</li>
              <li>If you have the same visit loaded on another device and it gets saved elsewhere, you'll see a <em>"Cloud has newer data for this visit — Reload"</em> toast. Tap Reload to pull in those changes (your unsaved edits aren't overwritten unless you opt in).</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Lines &amp; Heads</strong></h6>
            <ul className="small">
              <li><strong>Add Line</strong> — create a new production line.</li>
              <li><strong>Prev / Next</strong> — step through lines without the dropdown.</li>
              <li><strong>Show/Hide Details</strong> — toggle model, serial, and job number fields.</li>
              <li><strong>Rename</strong>, <strong>Export Line PDF</strong>, <strong>Reset Line</strong>, <strong>Remove Line</strong> — per-line controls.</li>
              <li>Quick Head toggles flip a head between Active / Offline / Fixed colors (green / red / orange).</li>
            </ul>
          </div>

          <div className="mb-2">
            <h6 className="text-primary mb-2"><strong>Quick Tips</strong></h6>
            <ul className="small">
              <li>Local storage auto-saves as you work — the <em>Save</em> button is for pushing to the cloud.</li>
              <li>Past Visits tab duplicates the sidebar — the sidebar is usually faster.</li>
              <li>Issue History shows every head that's had problems across all of this customer's visits.</li>
            </ul>
          </div>
        </div>
      )}

      <div className={`workspace-shell ${!currentCustomer ? 'workspace-shell--no-sidebar' : ''} ${sidebarCollapsed ? 'workspace-shell--sidebar-collapsed' : ''}`}>
        {currentCustomer && (
          <VisitsSidebar
            visits={visits}
            currentVisitId={currentVisitId}
            customerName={currentCustomer.name}
            onSelect={loadVisit}
            onNewVisit={() => saveToCloud(false)}
            onRename={renameVisit}
            onDelete={deleteVisit}
            collapsed={sidebarCollapsed}
            onToggle={toggleSidebar}
          />
        )}
        <main className="workspace-main">
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
                    updateLine={updateLineStable}
                    removeLine={handleRemoveLine}
                    resetLine={handleResetLine}
                    isVisible={line.id === activeLineId}
                    exportLineToPDF={exportLineStable}
                    buildSpanCalibrationPDF={buildSpanCalStable}
                    buildCombinedPDF={buildCombinedStable}
                    globalData={globalData}
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
        </main>
      </div>

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
                        // Active with Issues is treated like fixed - head is running
                        if (issues.length > 0) {
                          return issues.every(iss => iss.fixed === 'fixed' || iss.fixed === 'active_with_issues');
                        }
                        return h.fixed === 'fixed' || h.fixed === 'active_with_issues';
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
    <ToastProvider>
      <AlertShim />
      <AppContent />
    </ToastProvider>
  </Router>
);

export default App;