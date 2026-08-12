import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { BrowserRouter as Router, useSearchParams } from 'react-router-dom';

import GlobalForm from '@shared/components/GlobalForm.jsx';
import Line from '@shared/components/Line.jsx';
import Dashboard from '@shared/components/Dashboard.jsx';
// Heavy drag-drop canvas — only loaded when the Factory Layout tab is opened.
const FactoryLayout = lazy(() => import('./components/FactoryLayout/FactoryLayout.jsx'));
import { saveAs } from 'file-saver';
// jsPDF + jspdf-autotable (plus html2canvas) are ~600KB and only needed when
// generating a PDF, so they're loaded on demand via dynamic import instead of in
// the initial bundle. Module vars are populated by ensurePdfLibs() before any
// builder runs. (jspdf-autotable v5 dropped the doc.autoTable() prototype method;
// the functional API is resolved interop-safely below.)
let jsPDF = null;
let autoTable = null;
async function ensurePdfLibs() {
  if (jsPDF && autoTable) return;
  const [pdfMod, autoMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  jsPDF = pdfMod.default;
  const fn = autoMod.default;
  autoTable = typeof fn === 'function' ? fn : (fn?.default || fn);
}
import 'bootstrap/dist/css/bootstrap.min.css';
import { Save, CloudUpload, CloudDownload, Copy, RefreshCw, Trash2, Edit3, Plus, Download, Upload, FileText, History, Settings, Eye, HelpCircle, Factory, List, Share2, Hash, Lock } from 'lucide-react';
import ShareModal from '@shared/components/ShareModal.jsx';
import ServiceReportUpload from '@shared/components/ServiceReportUpload.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import { ToastProvider, AlertShim, useToast } from '@shared/components/Toast.jsx';
import VisitsSidebar from './components/VisitsSidebar.jsx';
import SetupLinesModal from '@shared/components/SetupLinesModal.jsx';
import UpdateBanner from '@shared/components/UpdateBanner.jsx';
import { mergeLinesArrays } from '@shared/utils/mergeLines.js';
import { shouldAdoptMerge } from '@shared/utils/mergeApply.js';
import BackfillPanel from './components/BackfillPanel.jsx';
import { timesheetDb, signInToTimesheet, isTimesheetSignedIn } from './config/timesheetApp.js';
import {
  findMissingVisits, buildVisitFromCandidate, customerKey,
} from '@shared/utils/serviceReportBackfill.js';
import BackfillSrModal from '@shared/components/BackfillSrModal.jsx';

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
} from '@shared/utils/headHelpers.js';
import { useDialog, AddLineDialog } from '@shared/components/DialogSystem.jsx';

import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

// Offline support
import OfflineIndicator from '@shared/components/OfflineIndicator.jsx';
import offlineQueue from '@shared/utils/offlineQueue.js';
import syncManager from '@shared/utils/syncManager.js';
import { useBodyScrollLock } from '@shared/utils/useBodyScrollLock.js';
import SpanAdjustPage from '@shared/components/SpanAdjustPage.jsx';
import BoardReplacementPage from '@shared/components/BoardReplacementPage.jsx';
import PmLogPage from '@shared/components/PmLogPage.jsx';
import CrewPage from '@shared/components/CrewPage.jsx';
import IssueHistory from '@shared/components/IssueHistory.jsx';
import PinSession from '@shared/components/PinSession.jsx';
import PrestartPage from '@shared/components/PrestartPage.jsx';
import ActivityPage from '@shared/components/ActivityPage.jsx';
import { useLineCrew, crewAge } from '@shared/utils/useLineCrew.js';
import { lineStatusKey, scaffoldLinesFrom } from '@shared/utils/headHelpers.js';
import { startPhotoSync, replacePendingPhoto } from '@shared/utils/photoSync.js';
import { usingBroker, fetchAuthedDataUrl } from '@shared/config/media.js';
import photoQueue from '@shared/utils/photoQueue.js';
import AppNav from '@shared/components/AppNav.jsx';
import OverviewPage from '@shared/components/OverviewPage.jsx';
import { sinceLabel } from '@shared/services/logs.js';
import AdminLoginsPanel from '@shared/components/AdminLoginsPanel.jsx';

try {
  firebase.initializeApp(FIREBASE_CONFIG);

  // Storage retries for TEN MINUTES by default before an upload errors, which on
  // a plant floor means a photo sits at 0% instead of falling through to the
  // offline queue. Fail fast so a stalled upload gets parked and retried on
  // reconnect — that path is strictly better than a spinner.
  firebase.storage().setMaxUploadRetryTime(20000);
  firebase.storage().setMaxOperationRetryTime(20000);

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
    // Proof-of-span-adjustment fields (entered in the Span Calibration preview)
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

// Load a remote image (Firebase Storage URL) into a JPEG data URL for jsPDF.
// Returns null if the image can't be loaded or the canvas is CORS-tainted,
// so a single unreachable photo never breaks the whole PDF.
const loadImageForPdf = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight });
      } catch (e) {
        console.warn('Could not embed photo (CORS?):', url, e);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });

// Decode a data: URL and re-encode it down to something sensible for print.
// Photos are stored at up to 1600px but rendered in 40mm boxes — roughly 240px
// at print resolution — so embedding the originals bloated the PDF about 5x for
// no visible gain. A 20-photo visit would produce a ~10MB file that bounces off
// mail servers. No CORS concerns here: the bytes are already inline, which is
// what makes the broker path immune to the canvas tainting the old
// <img crossOrigin> approach risked.
const PDF_PHOTO_MAX_DIM = 800;
const measureDataUrl = (dataUrl) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PDF_PHOTO_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale === 1) {
        resolve({ dataUrl, w: img.naturalWidth, h: img.naturalHeight });
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', 0.85),
          w: canvas.width,
          h: canvas.height,
        });
      } catch {
        // Fall back to the full-size original rather than dropping the photo.
        resolve({ dataUrl, w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

// A photo's stable identity for the PDF's preload map. `path` is present on
// everything uploaded since photos were introduced; `url` covers anything older.
const photoKey = (p) => p?.path || p?.url || '';

// Load one photo for embedding: through the broker when we have a path, else the
// legacy public URL. Falls back rather than failing so one unreachable photo
// never breaks the whole export.
const loadPhotoForPdf = async (p) => {
  if (usingBroker() && p?.path) {
    try {
      const dataUrl = await fetchAuthedDataUrl(p.path);
      const measured = await measureDataUrl(dataUrl);
      if (measured) return measured;
    } catch (err) {
      console.warn('Broker photo fetch failed, trying legacy URL:', p.path, err?.message || err);
    }
  }
  return p?.url ? loadImageForPdf(p.url) : null;
};

// 3-way merge of a visit's `lines` array so concurrent edits to DIFFERENT lines
// both survive. `baseline` = the lines this client last synced; `local` = its
// current lines; `remote` = the lines currently in the cloud. A line this client
// changed since baseline wins for that line; every other line keeps the remote
// value (which may be another editor's change). Deletions this client made are
// honored; lines it newly added are appended. Only when BOTH edit the SAME line
// in the same window does this fall back to this client's version.

// Best-effort recursive delete of a Storage folder (compat listAll returns one
// level, so recurse into child prefixes).
async function wipeStorageFolder(ref) {
  try {
    const res = await ref.listAll();
    await Promise.all(res.items.map((i) => i.delete().catch(() => {})));
    await Promise.all(res.prefixes.map((p) => wipeStorageFolder(p)));
  } catch {
    /* folder may not exist — ignore */
  }
}

// Firestore doesn't cascade subcollections and Storage isn't touched when a
// visit doc is deleted. On PERMANENT delete, clean up photos, the service
// report, and the lineResets subcollection so they don't orphan.
async function deleteVisitAssets(uid, custId, visitId) {
  const st = firebase.storage().ref();
  await wipeStorageFolder(st.child(`issue-photos/${uid}/${custId}/${visitId}`));
  await st.child(`service-reports/${uid}/${custId}/${visitId}.pdf`).delete().catch(() => {});
  try {
    const snap = await firebase
      .firestore()
      .collection('user_files').doc(uid)
      .collection('customers').doc(custId)
      .collection('visits').doc(visitId)
      .collection('lineResets').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete().catch(() => {})));
  } catch {
    /* ignore */
  }
}

const exportDashboardToPDF = async (lines, globalData, includePhotos = false) => {
  if (lines.length === 0) return alert('No data to export');
  await ensurePdfLibs();
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  const pageHeight = doc.internal.pageSize.height;

  // Migrate all lines using shared utility
  const migratedLines = lines.map(migrateLineHeads);

  // Preload all issue photos into JPEG data URLs (keyed by URL) so the
  // synchronous render loop below can drop them in via doc.addImage.
  const photoMap = new Map();
  const photoStats = { requested: 0, embedded: 0 };
  if (includePhotos) {
    const found = [];
    migratedLines.forEach(line => (line.heads || []).forEach(head => {
      if (!headHasIssues(head)) return;
      (head.issues || []).forEach(iss => (iss.photos || []).forEach(p => photoKey(p) && found.push(p)));
      (head.photos || []).forEach(p => photoKey(p) && found.push(p));
    }));
    const byKey = new Map();
    found.forEach(p => { if (!byKey.has(photoKey(p))) byKey.set(photoKey(p), p); });
    const keys = [...byKey.keys()];
    // allSettled, not all: one rejected photo used to reject the whole export,
    // and the export had nobody catching it.
    const loaded = await Promise.allSettled(keys.map(k => loadPhotoForPdf(byKey.get(k))));
    keys.forEach((k, i) => {
      const r = loaded[i];
      if (r.status === 'fulfilled' && r.value) photoMap.set(k, r.value);
      else if (r.status === 'rejected') console.warn('Photo failed to load for PDF:', k, r.reason);
    });
    photoStats.requested = keys.length;
    photoStats.embedded = photoMap.size;
  }

  const drawPageHeader = () => {
    doc.addImage(PDF_CONFIG.logoUrl, 'PNG', 14, 10, 30, 15, 'jtiLogo', 'FAST');
    doc.setFontSize(16);
    doc.text('Ishida Dashboard Report', 105, 20, { align: 'center' });
  };

  // Render every photo attached to a head's issues, wrapping across rows/pages.
  const renderHeadPhotos = (head, startY) => {
    let y = startY;
    const photos = [
      ...(head.issues || []).flatMap(iss => (iss.photos || []).map(photoKey)),
      ...(head.photos || []).map(photoKey),
    ].filter(k => photoMap.has(k));
    if (!photos.length) return y;

    if (y + 10 > pageHeight - 15) { doc.addPage(); drawPageHeader(); y = 35; }
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(`Head ${head.id} photos:`, 14, y);
    doc.setFont(undefined, 'normal');
    y += 4;

    const boxW = 40, gap = 6, maxH = 45, rightEdge = 14 + 182;
    let x = 14, rowH = 0;
    photos.forEach(key => {
      const im = photoMap.get(key);
      const dispW = boxW;
      // A zero or missing width makes this NaN, and jsPDF throws on a NaN
      // dimension — one odd photo taking the whole export down with it.
      const ratio = im.w > 0 && im.h > 0 ? im.h / im.w : 0.75;
      const dispH = Math.min(maxH, boxW * ratio);
      if (x + dispW > rightEdge) { x = 14; y += rowH + 4; rowH = 0; }
      if (y + dispH > pageHeight - 15) { doc.addPage(); drawPageHeader(); y = 35; x = 14; rowH = 0; }
      doc.addImage(im.dataUrl, 'JPEG', x, y, dispW, dispH);
      x += dispW + gap;
      rowH = Math.max(rowH, dispH);
    });
    return y + rowH + 6;
  };

  // Add JTI logo top-left
  const logoUrl = PDF_CONFIG.logoUrl;
  doc.addImage(logoUrl, 'PNG', 14, 10, 30, 15, 'jtiLogo', 'FAST');

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
      doc.addImage(logoUrl, 'PNG', 14, 10, 30, 15, 'jtiLogo', 'FAST');
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

      // Embed any photos attached to this line's issue heads
      if (includePhotos) {
        issueHeads.forEach(head => { y = renderHeadPhotos(head, y); });
      }
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
  return photoStats;
};

// Renders the line report onto the current page of `doc` (so it can be merged with other sections)
const renderLineReport = (doc, line, globalData) => {
  const gd = globalData || {};
  // Migrate line to new format
  const migratedLine = migrateLineHeads(line);

  // Add JTI logo top-left
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight, 'jtiLogo', 'FAST');

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

const exportLineToPDF = async (line, globalData) => {
  if (!line) return alert('No line data to export');
  await ensurePdfLibs();
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  renderLineReport(doc, line, globalData);
  doc.save(`${(globalData?.customer) || 'ishida'}-${line.title.replace(/[^a-z0-9]/gi, '-')}.pdf`);
};

// Combination Weigher Proof of Span Adjustment — mirrors the printed JTI template.
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
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight, 'jtiLogo', 'FAST');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Combination Weigher Proof of Span Adjustment', 50, 14);
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

const buildSpanCalibrationPDF = async (line, globalData) => {
  await ensurePdfLibs();
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
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight, 'jtiLogo', 'FAST');
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
const buildCombinedPDF = async (line, globalData, opts = {}) => {
  await ensurePdfLibs();
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  let first = true;
  const next = () => { if (!first) doc.addPage(); first = false; };
  if (opts.dashboard !== false) { next(); renderLineReport(doc, line, globalData); }
  if (opts.span !== false) { next(); renderSpanCalibration(doc, line, globalData, { footer: false }); }
  if (opts.audit !== false) { next(); renderAudit(doc, line, globalData); }
  if (first) { doc.setFontSize(12); doc.text('No sections selected.', 20, 20); }
  return doc;
};

const exportLineHistoryToPDF = async (lineHistory, customerName, lineTitle) => {
  if (lineHistory.length === 0) return alert('No history to export');
  await ensurePdfLibs();
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  const pageHeight = doc.internal.pageSize.height;

  // Add JTI logo top-left
  doc.addImage(PDF_CONFIG.logoUrl, 'PNG', PDF_CONFIG.margin, 10, PDF_CONFIG.logoWidth, PDF_CONFIG.logoHeight, 'jtiLogo', 'FAST');

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
      doc.addImage(PDF_CONFIG.logoUrl, 'PNG', 14, 10, 30, 15, 'jtiLogo', 'FAST');
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


const AppContent = () => {
  const [searchParams] = useSearchParams();
  const toast = useToast();

  const [globalData, setGlobalData] = useState({ customer: '', address: '', cityState: '', headCount: '14' });
  const [lines, setLines] = useState([]);

  // Heads that are down right now, shown against Current Visit. A badge is only
  // worth the ink when there is something to answer for, so zero shows nothing.
  const navCounts = useMemo(() => {
    const offline = (lines || []).reduce(
      (n, line) => n + (line.heads || []).filter((h) => h.status === 'offline').length, 0);
    return { current: offline };
  }, [lines]);

  const [showDashboardView, setShowDashboardView] = useState(false);
  // Job numbers reserved in the dashboard, offered on the SR field so a visit
  // is tagged by picking rather than by typing one correctly.
  const [reservedSrs, setReservedSrs] = useState([]);
  const [activeLineId, setActiveLineId] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [exportingPhotos, setExportingPhotos] = useState(false);

  // Cloud autosave status for the currently-loaded visit
  const [cloudState, setCloudState] = useState('idle'); // idle | saving | saved | error
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [checkingCloud, setCheckingCloud] = useState(false); // "Check cloud" button in-flight
  const savedSnapshotRef = useRef(null);  // serialized content of the last cloud save (baseline)
  // Read inside the snapshot callback, which closes over a stale state value.
  const lastSavedAtRef = useRef(null);
  const autosaveTimerRef = useRef(null);

  // Dialog system for proper modals instead of window.prompt/alert
  const dialog = useDialog();
  const [showAddLineDialog, setShowAddLineDialog] = useState(false);
  const [showSetupLines, setShowSetupLines] = useState(false);

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
  // Who is crewed on each line, for the line list — the dashboard answers
  // "who is running this" as well as "what is broken".
  //
  // `session`, NOT `user`: `const user = session` is declared far below this
  // line, so naming `user` here hits its temporal dead zone on every render and
  // takes the whole app down with "Cannot access 'user' before initialization".
  // They are the same value; only this one exists yet.
  const appLineCrew = useLineCrew(session?.uid, currentCustomer?.id);
  const [visits, setVisits] = useState([]);
  // Visits across ALL customers — used only by Issue History (which lets you pick
  // any customer). Kept separate from `visits` (the current customer's live list)
  // so the cross-customer load can't clobber the toolbar count / visits picker.
  const [allVisits, setAllVisits] = useState([]);
  // The plant's own shift logs for the selected customer.
  const [plantLogs, setPlantLogs] = useState([]);
  // The plant log being looked at, if any. Kept apart from currentVisitId
  // because every write in this app keys off that — so a plant's log on screen
  // can never be the target of an autosave, a rename or a delete.
  const [viewingPlantLogId, setViewingPlantLogId] = useState(null);

  // Issue History reads both sides of the record: JTI's service visits and the
  // plant's own shift logs. `allVisits` still supplies other customers once JTI
  // has loaded them, and is de-duplicated against the live pair.
  const historyVisits = useMemo(() => {
    const cid = currentCustomer?.id;
    const mine = cid ? visits.map((v) => ({ ...v, customerId: v.customerId || cid, source: 'jti' })) : [];
    const theirs = cid ? plantLogs.map((v) => ({ ...v, customerId: cid, source: 'plant' })) : [];
    const key = (v) => `${v.customerId}/${v.id}`;
    const seen = new Set([...mine, ...theirs].map(key));
    const others = (allVisits || [])
      .filter((v) => !seen.has(key(v)))
      .map((v) => ({ ...v, source: v.source || 'jti' }));
    return [...mine, ...theirs, ...others]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [visits, plantLogs, allVisits, currentCustomer?.id]);

  const [showVisitList, setShowVisitList] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  // JTI's own screen for giving a plant a way in.
  const [showPlantLogins, setShowPlantLogins] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', address: '', cityState: '', headCount: '14' });
  const [currentVisitName, setCurrentVisitName] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showDeletePanel, setShowDeletePanel] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [showVisitsModal, setShowVisitsModal] = useState(false);

  // Group the current customer's visits that look like duplicates (same name).
  // Newest first within each group so the user can keep the latest and delete
  // the older copies. Nothing is deleted automatically.
  const duplicateGroups = useMemo(() => {
    const groups = new Map();
    (visits || []).forEach((v) => {
      const key = (v.name || '').trim().toLowerCase() || '__unnamed__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    });
    return [...groups.entries()]
      .filter(([, vs]) => vs.length > 1)
      .map(([key, vs]) => ({
        key,
        label: key === '__unnamed__' ? 'Unnamed visits' : (vs[0].name || 'Unnamed'),
        visits: [...vs].sort((a, b) => new Date(b.date) - new Date(a.date)),
      }))
      .sort((a, b) => b.visits.length - a.visits.length);
  }, [visits]);
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
  // Opens on the overview: the old landing screen was an empty visit-name box,
  // which is the one screen in the app that knows nothing.
  const [activeTab, setActiveTab] = useState('overview');
  const [showShareModal, setShowShareModal] = useState(false);
  const fileInputRef = useRef(null);

  // Handler for adding a new line via dialog
  // Lines created during this session. A line you just made is one you are
  // plainly responsible for, whatever the roster says, so the line lock does
  // not apply to it — locking someone out of a line they just created reads as
  // the app being broken, and it is not what the lock is for.

  const createdThisSession = useRef(new Set());

  // Lines removed from the CURRENT visit, restorable for 30 days.
  const [showDeletedLines, setShowDeletedLines] = useState(false);
  const [deletedLines, setDeletedLines] = useState([]);

  const LINE_BIN_DAYS = 30;
  const lineBinRef = () => {
    const custId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (!session?.uid || !custId || !visitId) return null;
    return firebase.firestore()
      .collection('user_files').doc(session.uid)
      .collection('customers').doc(custId)
      .collection('visits').doc(visitId)
      .collection('deletedLines');
  };

  const loadDeletedLines = async () => {
    const ref = lineBinRef();
    if (!ref) { setDeletedLines([]); return; }
    try {
      const snap = await ref.get();
      const cutoff = Date.now() - LINE_BIN_DAYS * 86400000;
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Anything past its 30 days is swept on the way past, so the bin cannot
      // grow without bound and nothing lingers longer than promised.
      rows.filter((r) => new Date(r.deletedAt).getTime() < cutoff)
        .forEach((r) => ref.doc(r.id).delete().catch(() => {}));
      setDeletedLines(
        rows.filter((r) => new Date(r.deletedAt).getTime() >= cutoff)
          .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))
      );
    } catch (e) {
      console.error('Could not read deleted lines:', e);
      setDeletedLines([]);
    }
  };

  const restoreDeletedLine = async (row) => {
    const ref = lineBinRef();
    if (!ref) return;
    // A restored line keeps its own id, so a visit that still holds it is not
    // given a duplicate.
    setLines((prev) => (prev.some((l) => l.id === row.line?.id) ? prev : [...prev, row.line]));
    setActiveLineId(row.line?.id ?? null);
    try { await ref.doc(row.id).delete(); } catch { /* the line is back either way */ }
    await loadDeletedLines();
    toast.success(`"${row.title || 'Line'}" restored`);
  };


  // Rebuild this customer's lines from their previous visits, in one press.
  const adoptHistoryLines = (built) => {
    if (!currentVisitId) {
      toast.error('Open or start a visit first — lines are saved with the visit.');
      return;
    }
    if (!built?.length) return;
    setLines(built);
    setActiveLineId(built[0]?.id ?? null);
    setActiveTab('current');
    toast.success(`${built.length} line${built.length === 1 ? '' : 's'} added`);
  };

  const handleAddLine = (lineName, headCount) => {
    createLine(lineName, headCount, (updater) => {
      setLines((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        // Whatever is in `next` but not in `prev` was just created here.
        const before = new Set(prev.map((l) => l.id));
        next.forEach((l) => { if (!before.has(l.id)) createdThisSession.current.add(l.id); });
        return next.map((l) => (before.has(l.id) ? l : { ...l, addedBy: 'JTI', addedAt: new Date().toISOString() }));
      });
    }, setActiveLineId, lines);
  };

  // Stable callbacks for <Line> so React.memo can skip untouched lines.
  // linesRef lets handlers read the latest lines without re-creating on every state change.
  const linesRef = useRef(lines);
  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => { lastSavedAtRef.current = lastSavedAt; }, [lastSavedAt]);
  const globalDataRef = useRef(globalData);
  useEffect(() => { globalDataRef.current = globalData; }, [globalData]);
  // Latest-value refs so the debounced cloud autosave reads current values.
  const currentVisitIdRef = useRef(currentVisitId);
  useEffect(() => { currentVisitIdRef.current = currentVisitId; }, [currentVisitId]);
  const currentCustomerRef = useRef(currentCustomer);
  useEffect(() => { currentCustomerRef.current = currentCustomer; }, [currentCustomer]);
  const serviceReportUrlRef = useRef(serviceReportUrl);
  useEffect(() => { serviceReportUrlRef.current = serviceReportUrl; }, [serviceReportUrl]);

  // One serializer used everywhere we baseline/compare visit content, so the
  // "has it changed?" check is always apples-to-apples.
  const serializeVisitContent = (l, g, n, s) =>
    JSON.stringify({ lines: l || [], globalData: g || {}, name: n || '', serviceReportUrl: s ?? null });

  const updateLineStable = useCallback((updated) => {
    setLines(prev => prev.map(l => l.id === updated.id ? updated : l));
  }, []);

  const handleRemoveLine = useCallback(async (id) => {
    const snapshot = linesRef.current.find(l => l.id === id);
    const lineTitle = snapshot?.title;
    const confirmed = await dialog.confirm(
      `Remove "${lineTitle || 'this line'}"? It can be restored for 30 days from `
      + `the gear menu → Deleted lines.`,
      { title: 'Remove Line', variant: 'danger', confirmText: 'Remove' }
    );
    if (!confirmed) return;

    (async () => {
      // Kept before it goes, not after. A line removed by mistake is a visit's
      // worth of head readings, issues and notes, and "are you sure?" is not a
      // backup.
      const custId = currentCustomerRef.current?.id;
      const visitId = currentVisitIdRef.current;
      if (snapshot && session?.uid && custId && visitId) {
        try {
          await firebase.firestore()
            .collection('user_files').doc(session.uid)
            .collection('customers').doc(custId)
            .collection('visits').doc(visitId)
            .collection('deletedLines').add({
              lineId: id,
              title: snapshot.title || 'Line',
              line: snapshot,
              deletedAt: new Date().toISOString(),
              deletedBy: 'JTI',
            });
        } catch (e) {
          // If the line cannot be saved, it does not get deleted. Losing it
          // quietly is the one outcome worth refusing.
          console.error('Could not back up line before removing:', e);
          toast.error('Could not save a copy of that line, so it was not removed. Try again.');
          return;
        }
      }
      setLines(prev => prev.filter(l => l.id !== id));
      setActiveLineId(prev => {
        if (prev !== id) return prev;
        const remaining = linesRef.current.filter(l => l.id !== id);
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
      toast.success(`"${lineTitle || 'Line'}" removed — restorable for 30 days`);
    })();
  }, [dialog, session, toast]);

  // One snapshot mechanism for both ways a line can lose data: resetting it,
  // and cutting its head count down. Shared so a line removed by either route
  // turns up in the same Recover panel, rather than one of them quietly having
  // no way back.
  const backupLine = useCallback(async (snapshot) => {
    const custId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (!custId || !visitId || !snapshot) return;
    await firebase.firestore()
      .collection('user_files').doc(session.uid)
      .collection('customers').doc(custId)
      .collection('visits').doc(visitId)
      .collection('lineResets').add({
        lineId: snapshot.id,
        title: snapshot.title || 'Line',
        line: snapshot,
        resetAt: new Date().toISOString(),
      });
  }, []);

  const handleResetLine = useCallback(async (line) => {
    const confirmed = await dialog.confirm(
      `Reset "${line.title}" to default? All data for this line will be cleared.`,
      { title: 'Reset Line', variant: 'warning', confirmText: 'Reset' }
    );
    if (!confirmed) return;
    // Snapshot the line before clearing to the visit's 7-day recovery bin, so an
    // accidental reset (incl. one on a customer's line) can be recovered in the
    // customer app.
    const snapshot = linesRef.current.find(l => l.id === line.id) || line;
    const custId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (session?.uid && custId && visitId) {
      try {
        await firebase.firestore()
          .collection('user_files').doc(session.uid)
          .collection('customers').doc(custId)
          .collection('visits').doc(visitId)
          .collection('lineResets').add({
            lineId: line.id,
            title: snapshot.title || line.title || 'Line',
            line: snapshot,
            resetAt: new Date().toISOString(),
          });
      } catch (e) {
        console.error('Could not back up line before reset:', e);
      }
    }
    setLines(prev => prev.map(l =>
      l.id === line.id ? { ...l, notes: '', heads: createDefaultHeads(l.heads.length) } : l
    ));
  }, [dialog, session]);

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

  useEffect(() => {
    if (!user?.uid) return;
    // Written here by the dashboard when a number is reserved. Read-only from
    // this side: the dashboard hands out numbers, this app records the visit.
    // Under user_files/{uid}, so the existing admin rules already cover it.
    firebase.firestore()
      .collection('user_files').doc(user.uid).collection('sr_directory')
      .get()
      .then((snap) => setReservedSrs(
        snap.docs.map((d) => d.data()).sort((a, b) => String(b.sr).localeCompare(String(a.sr))),
      ))
      .catch((err) => console.warn('Reserved job numbers unavailable:', err));
  }, [user]);

  // Deep link handler - load visit by ID from URL parameter
  const loadVisitByDeepLink = async (visitId, customerId, lineName, headName) => {
    if (!user) return;

    try {
      // Helper function to load data and navigate to line
      const loadAndNavigate = (data, custProfile, custId) => {
        setCurrentCustomer({ id: custId, ...custProfile });
        // Preserve the visit's own stored globalData (incl. serviceReportNumber);
        // only fall back to the customer profile for missing header fields.
        const gd = data.globalData || {};
        const mergedGlobal = {
          ...gd,
          customer: gd.customer || custProfile.name,
          address: gd.address ?? custProfile.address ?? '',
          cityState: gd.cityState ?? custProfile.cityState ?? '',
          headCount: (gd.headCount || custProfile.headCount || '14').toString(),
        };
        setGlobalData(mergedGlobal);

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
        // Baseline autosave for the deep-linked visit.
        savedSnapshotRef.current = serializeVisitContent(
          loadedLines,
          mergedGlobal,
          data.name || '',
          data.serviceReportUrl || null
        );
        // Loading is not saving. `date` is when the VISIT is dated — for most
        // records the moment it was created — so putting it beside a tick said
        // "your changes are safe, as of 08:22" about a screen that had saved
        // nothing at all, and the time never moved because the field never
        // does. The chip now starts blank and earns its tick.
        setCloudState('idle');
        setLastSavedAt(null);

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

  // Open one of the plant's daily logs to look at.
  //
  // Read-only, and structurally so: this app writes `visits`, a daily log lives
  // in `dailyLogs`, and it belongs to the plant. An editor that appeared to take
  // changes and then dropped them would be worse than one that says plainly it
  // cannot.
  const viewPlantLog = (logId) => {
    const v = plantLogs.find((x) => x.id === logId);
    if (!v) return;
    const loadedLines = (v.lines || []).map((line) => ({
      ...line,
      heads: (line.heads || []).map((h, i) => ({ ...h, id: h.id || i + 1 })),
    }));
    setCurrentVisitId(null);
    savedSnapshotRef.current = null;
    setCloudState('idle');
    setViewingPlantLogId(logId);
    setGlobalData(v.globalData || {});
    setLines(loadedLines);
    setActiveLineId(loadedLines[0]?.id ?? null);
    setCurrentVisitName(v.name || 'Plant daily log');
    setServiceReportUrl(null);
    setShowDashboardView(false);
    setActiveTab('current');
  };

  const closePlantLog = () => {
    setViewingPlantLogId(null);
    setLines([]);
    setActiveLineId(null);
    setCurrentVisitName('');
  };

  const loadVisit = async (visitId) => {
    if (!user || !currentCustomer) return toast.error('Select a customer first');
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
        // Baseline autosave so edits to this visit start saving automatically.
        savedSnapshotRef.current = serializeVisitContent(loadedLines, data.globalData || {}, data.name || '', data.serviceReportUrl || null);
        // Loading is not saving. `date` is when the VISIT is dated — for most
        // records the moment it was created — so putting it beside a tick said
        // "your changes are safe, as of 08:22" about a screen that had saved
        // nothing at all, and the time never moved because the field never
        // does. The chip now starts blank and earns its tick.
        setCloudState('idle');
        setLastSavedAt(null);
        toast.success(`Loaded "${data.name || 'visit'}"`);
      } else {
        console.error('[loadVisit] not found at', path, { currentCustomerId: currentCustomer.id, visitFromList });
        toast.error(`Visit not found at: ${path}`);
      }
    } catch (err) {
      console.error('[loadVisit] error fetching', path, err);
      toast.error(`Failed to load visit: ${err?.message || err}`);
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
    
    toast.success('Local storage cleared! All data reset.');
  };

  // Archiving, because deleting was the only way to get a plant out of the
  // picker and it takes every visit, photo and service report with it.
  // A customer who stopped buying is not a customer who never existed: the
  // history is the whole point of the app, and plants come back. Archived
  // customers keep everything and simply stop cluttering the list.
  const setCustomerArchived = async (custId, archived) => {
    const name = customers.find(c => c.id === custId)?.name || 'this customer';
    if (archived) {
      const ok = await dialog.confirm(
        `Archive "${name}"? Their visits, photos and service reports are all kept — `
        + `they just come off the customer list. You can bring them back any time.`,
        { title: 'Archive Customer', confirmText: 'Archive' },
      );
      if (!ok) return;
    }
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(custId)
        .set({ profile: { archived, archivedAt: archived ? new Date().toISOString() : null } }, { merge: true });

      // Leaving an archived customer selected would keep them on screen with no
      // way back to them once the picker drops them.
      if (archived && currentCustomer?.id === custId) handleSelectCustomer('');
      await refreshCustomers();
      toast.success(archived ? `${name} archived` : `${name} restored`);
    } catch (err) {
      console.error('Archive failed:', err);
      toast.error(`Could not ${archived ? 'archive' : 'restore'} ${name}`);
    }
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

      // Best-effort cleanup of the customer's Storage folders so photos and
      // service reports don't orphan.
      const st = firebase.storage().ref();
      await wipeStorageFolder(st.child(`issue-photos/${user.uid}/${custId}`));
      await wipeStorageFolder(st.child(`service-reports/${user.uid}/${custId}`));

      localStorage.removeItem(`ishida_${custId}`);
      toast.success('Customer and all visits deleted from cloud');
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete customer');
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
      toast.error('Failed to delete visit');
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
      toast.error('Failed to restore visit');
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
      await deleteVisitAssets(user.uid, custId, visitId); // best-effort orphan cleanup
      await loadDeletedVisits(custId);
    } catch (err) {
      toast.error('Failed to permanently delete visit');
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
      toast.success('Visit date updated');
      setVisitToEdit(null);
      setEditTimestamp('');
      await loadVisits(currentCustomer.id);
    } catch (err) {
      toast.error('Failed to update date');
    }
  };

  // Cloud autosave: write the loaded visit in place. Uses update() (not set())
  // so unrelated fields the editor doesn't track (e.g. serviceReportUploadedAt)
  // are preserved. No dialogs — this runs silently in the background.
  const writeVisitInPlace = async () => {
    const uid = user?.uid;
    const customerId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (!uid || !customerId || !visitId) return;

    setCloudState('saving');
    const localLines = linesRef.current.map(line => ({
      ...line,
      heads: (line.heads || []).map(head => ({ ...head, id: head.id })),
    }));
    const localGlobal = globalDataRef.current;
    const localName = currentVisitNameRef.current;
    const srUrl = serviceReportUrlRef.current;
    const prevBaseline = savedSnapshotRef.current;
    const base = prevBaseline
      ? JSON.parse(prevBaseline)
      : { lines: localLines, globalData: localGlobal, name: localName };

    const ref = firebase.firestore()
      .collection('user_files').doc(uid)
      .collection('customers').doc(customerId)
      .collection('visits').doc(visitId);

    try {
      // Transaction + 3-way merge so a concurrent editor (e.g. the customer app on
      // the same visit) doesn't get silently clobbered: each side's changed lines
      // win for those lines; every other line keeps the cloud value. We do NOT
      // write `date`/`shift`/`serviceReportUrl` — update() leaves those (and
      // serviceReportUploadedAt/deleted) untouched.
      let merged, mergedGlobal, mergedName;
      await firebase.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('visit-missing');
        const remote = snap.data();
        merged = remote.lines ? mergeLinesArrays(base.lines, localLines, remote.lines) : localLines;
        const globalChanged = JSON.stringify(localGlobal) !== JSON.stringify(base.globalData || {});
        mergedGlobal = globalChanged ? localGlobal : (remote.globalData !== undefined ? remote.globalData : localGlobal);
        const nameChanged = (localName || '') !== (base.name || '');
        mergedName = nameChanged ? localName : (remote.name !== undefined ? remote.name : localName);
        tx.update(ref, { name: mergedName, globalData: mergedGlobal, lines: merged });
      });

      const newBaseline = serializeVisitContent(merged, mergedGlobal, mergedName, srUrl);
      savedSnapshotRef.current = newBaseline;

      // Put the merged result on screen ONLY if nobody typed while the write
      // was in flight.
      //
      // `localLines` was copied before the transaction, and a transaction is a
      // network round trip. The old check compared the merge against that COPY,
      // so any edit made during the write was overwritten by a merge computed
      // without it: a head switched offline came back on, an issue type snapped
      // back to the first option, text disappeared out of a box. All three
      // only "sometimes", because the edit has to land inside the window — and
      // on a plant's connection that window is long.
      //
      // If the screen has moved on, the newer edits stand and the next autosave
      // carries them up. The baseline above has already advanced to what was
      // stored, so that save merges against the truth and nothing is lost.
      const sentSnapshot = serializeVisitContent(localLines, localGlobal, localName, srUrl);
      const currentSnapshot = serializeVisitContent(
        linesRef.current, globalDataRef.current, currentVisitNameRef.current, serviceReportUrlRef.current,
      );
      if (shouldAdoptMerge({ sentSnapshot, mergedSnapshot: newBaseline, currentSnapshot })) {
        setLines(merged);
        setGlobalData(mergedGlobal);
        setCurrentVisitName(mergedName);
      }

      // A write completed, so the time is now, whatever happens next.
      setLastSavedAt(new Date());

      // Edits made WHILE this write was in flight are still only on screen.
      //
      // The autosave effect runs when its state changes, and those edits
      // already had their run — the one that produced this write. Skipping the
      // merge above leaves them unsaved with nothing scheduled to carry them
      // up, so they would sit there until an unrelated edit triggered a save.
      //
      // The test is against what we SENT, not against the merged result. The
      // merge legitimately differs from what we sent — that is its whole job,
      // it folds in the other side — so comparing to it meant "there is more to
      // do" was true on every pass: a write every 400ms forever, and the clock
      // never reached the line below. Local versus what local was is the only
      // question that decides whether anything is outstanding.
      if (currentSnapshot !== sentSnapshot) {
        setCloudState('saving');
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(() => { writeVisitInPlace(); }, 400);
        return;
      }

      setCloudState('saved');
    } catch (err) {
      console.error('Autosave failed:', err);
      setCloudState('error');
    }
  };

  // On-demand check: fetch the current visit fresh from the cloud and tell the
  // user whether what's loaded matches. Complements the automatic sync — it's a
  // manual "am I looking at the right data?" confirmation.
  const verifyAgainstCloud = async () => {
    const uid = user?.uid;
    const customerId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (!uid || !customerId || !visitId) {
      return toast.info('Open a visit first, then you can check it against the cloud.');
    }
    setCheckingCloud(true);
    try {
      const doc = await firebase
        .firestore()
        .collection('user_files')
        .doc(uid)
        .collection('customers')
        .doc(customerId)
        .collection('visits')
        .doc(visitId)
        .get();

      if (!doc.exists) {
        toast.error('This visit no longer exists in the cloud — it may have been deleted on another device.');
        return;
      }

      const remote = doc.data() || {};
      const remoteLines = (remote.lines || []).map((line) => ({
        ...line,
        heads: (line.heads || []).map((head, i) => ({ ...head, id: head.id || i + 1 })),
      }));
      const remoteSnapshot = serializeVisitContent(
        remoteLines, remote.globalData || {}, remote.name || '', remote.serviceReportUrl || null
      );
      const localSnapshot = serializeVisitContent(
        linesRef.current, globalDataRef.current, currentVisitNameRef.current, serviceReportUrlRef.current
      );

      if (remoteSnapshot === localSnapshot) {
        toast.success('✓ In sync — the visit loaded here matches the cloud exactly.');
        return;
      }

      const hasUnsavedEdits =
        savedSnapshotRef.current !== null && localSnapshot !== savedSnapshotRef.current;

      if (!hasUnsavedEdits) {
        // No local edits, yet the cloud differs → the cloud copy is newer. Pull
        // it in so the user is looking at the correct, current data.
        setGlobalData(remote.globalData || {});
        setLines(remoteLines);
        setCurrentVisitName(remote.name || '');
        setServiceReportUrl(remote.serviceReportUrl || null);
        savedSnapshotRef.current = remoteSnapshot;
        setCloudState('saved');
        setLastSavedAt(new Date());
        toast.success('The cloud had a newer version of this visit — loaded it. You now match the cloud.');
        return;
      }

      // Local edits differ from the cloud → they just haven't uploaded yet.
      if (cloudState === 'error') {
        toast.error('You have unsaved changes and appear to be offline. They will upload automatically once you reconnect.');
      } else {
        toast.info('You have local changes not yet in the cloud — saving them now…');
        writeVisitInPlace();
      }
    } catch (err) {
      console.error('Cloud check failed:', err);
      toast.error('Could not reach the cloud to check — you may be offline.');
    } finally {
      setCheckingCloud(false);
    }
  };

  // Bulk-assign service report numbers to historical visits (across customers).
  // updates: [{ customerId, visitId, number }]. Uses a dotted-path update so
  // only globalData.serviceReportNumber is touched — other globalData fields and
  // the rest of the visit doc are left intact.
  const saveServiceReportNumbers = async (updates) => {
    if (!user) return;
    const changed = (updates || []).filter((u) => u.customerId && u.visitId);
    if (changed.length === 0) return;
    try {
      await Promise.all(
        changed.map((u) =>
          firebase
            .firestore()
            .collection('user_files')
            .doc(user.uid)
            .collection('customers')
            .doc(u.customerId)
            .collection('visits')
            .doc(u.visitId)
            .update({ 'globalData.serviceReportNumber': u.number })
        )
      );

      // Reflect the change in the in-memory all-customers list so the tool stays
      // accurate without a full reload.
      setAllVisits((prev) =>
        prev.map((v) => {
          const hit = changed.find((u) => u.visitId === v.id && u.customerId === v.customerId);
          return hit
            ? { ...v, globalData: { ...(v.globalData || {}), serviceReportNumber: hit.number } }
            : v;
        })
      );

      // If the currently-open visit was tagged, mirror it into live editor state
      // so its autosave baseline stays consistent (and won't overwrite the number).
      const openHit = changed.find(
        (u) => u.visitId === currentVisitIdRef.current && u.customerId === currentCustomerRef.current?.id
      );
      if (openHit) {
        setGlobalData((prev) => ({ ...prev, serviceReportNumber: openHit.number }));
      }

      toast.success(`Saved ${changed.length} service report number${changed.length === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error('Backfill save failed:', err);
      toast.error('Failed to save some numbers: ' + err.message);
    }
  };

  const saveToCloud = async (override = false) => {
    if (!user || !currentCustomer) return toast.error('Select a customer first');
    // A plant's daily log is open for reading. Saving would mint a JTI visit
    // containing THEIR shift's lines — a record that looks like a service call
    // that never happened. Guarded here as well as on the button, because a
    // disabled button is a courtesy and this is a correctness rule.
    if (viewingPlantLogId) {
      return toast.error("That's the plant's log — close it before saving a visit.");
    }

    // Different confirmation messages for new vs override
    if (override) {
      if (!currentVisitId) {
        return toast.error('No visit loaded to override. Use "New" to create a new visit first.');
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
        savedSnapshotRef.current = serializeVisitContent(lines, globalData, currentVisitName, serviceReportUrl);
        setCloudState('saved');
        setLastSavedAt(new Date());
        toast.success(`Saved "${currentVisitName || 'Unnamed'}"`);
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
        savedSnapshotRef.current = serializeVisitContent(lines, globalData, currentVisitName, serviceReportUrl);
        setCloudState('saved');
        setLastSavedAt(new Date());
        toast.success(`New visit "${currentVisitName || 'Unnamed'}" saved.`);
      }
      await loadVisits(currentCustomer.id);
    } catch (err) {
      console.error('Save to cloud error:', err);
      toast.error('Failed to save to cloud: ' + err.message);
      localStorage.setItem(`offline_${currentCustomer.id}_${Date.now()}`, JSON.stringify(payload));
    }
  };

  const duplicateVisit = async () => {
    if (!currentVisitId) return toast.error('No visit to duplicate');
    const ok = await dialog.confirm('Duplicate current visit?', { title: 'Duplicate Visit', confirmText: 'Duplicate' });
    if (!ok) return;

    const visitId = `visit_${Date.now()}`;
    const payload = {
      date: new Date().toISOString(),
      name: `${currentVisitName} (Copy)`,
      globalData,
      // Strip photos from the copy — otherwise both visits reference the same
      // Storage objects and deleting a photo in one breaks it in the other.
      lines: lines.map(line => ({
        ...line,
        heads: line.heads.map(head => ({
          ...head,
          id: head.id,
          photos: [],
          issues: (head.issues || []).map(iss => ({ ...iss, photos: [] })),
        }))
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
      setServiceReportUrl(null); // the clone starts without the original's report
      // Baseline autosave for the duplicate.
      savedSnapshotRef.current = serializeVisitContent(lines, globalData, payload.name, null);
      setCloudState('saved');
      setLastSavedAt(new Date());
      toast.success('Visit duplicated.');
      await loadVisits(currentCustomer.id);
    } catch (err) {
      toast.error('Failed to duplicate visit');
    }
  };

  // Create a brand-new visit from ANY prior visit in the list (one tap from the
  // sidebar) with a CLEAN SLATE: the machine setup carries over (customer, lines,
  // head layout, model/serial/job, span-cal constants) but every head starts
  // Active with no issues, audit/notes are cleared, and it's dated today.
  // (For an exact clone of the loaded visit, use "Duplicate Visit".)
  const newVisitFromPrior = async (visitId) => {
    if (!user || !currentCustomer) return toast.error('Select a customer first');
    const src = (visits || []).find((v) => v.id === visitId);
    if (!src) return toast.error('Could not find that visit to copy.');

    const ok = await dialog.confirm(
      `Start a new visit from "${src.name || 'Unnamed'}"?\n\nThe machine setup (lines, heads, model/serial) carries over. Every head starts Active with no issues, and the visit is dated today.`,
      { title: 'New Visit from Copy', confirmText: 'Create' }
    );
    if (!ok) return;

    // Carry the line scaffolding; reset everything that was logged this visit.
    const cleanLines = scaffoldLinesFrom(src);

    const newId = `visit_${Date.now()}`;
    const today = new Date();
    const payload = {
      date: today.toISOString(),
      name: `${src.name || 'Visit'} — ${today.toLocaleDateString()}`,
      globalData: src.globalData || {},
      lines: cleanLines,
    };

    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(src.customerId || currentCustomer.id)
        .collection('visits')
        .doc(newId)
        .set(payload);

      // Open the new visit in the editor (we already have the clean data, so no
      // extra read needed; the live sidebar snapshot adds it to the list).
      setGlobalData(payload.globalData);
      setLines(cleanLines);
      setActiveLineId(cleanLines.length > 0 ? cleanLines[0].id : null);
      setCurrentVisitName(payload.name);
      setCurrentVisitId(newId);
      setServiceReportUrl(null);
      // Baseline autosave for the new visit.
      savedSnapshotRef.current = serializeVisitContent(cleanLines, payload.globalData, payload.name, null);
      setCloudState('saved');
      setLastSavedAt(today);
      toast.success('New visit created from copy — clean slate, dated today.');
    } catch (err) {
      console.error('Copy visit error:', err);
      toast.error('Failed to create visit from copy: ' + (err?.message || err));
    }
  };

  // Start a new visit for the current customer. The machine setup doesn't change
  // between visits, so by default the lines and their head counts carry over from
  // the most recent visit with a clean slate — no issues, every head Active. The
  // issues only come along if explicitly asked for. Creates the cloud doc
  // immediately and baselines autosave, so there's no "unsaved" window.
  const startNewVisit = async () => {
    if (!user || !currentCustomer) return toast.error('Select a customer first');

    // Most recent visit for this customer (the list is date-desc, but don't rely
    // on ordering — pick the newest explicitly).
    const prior = (visits || [])
      .filter((v) => !v.deleted && (v.lines || []).length > 0)
      .slice()
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];

    let carriedLines = [];
    if (prior) {
      const mode = await dialog.choice(
        `Start a new visit for ${currentCustomer.name}.\n\nThe setup from "${prior.name || 'the last visit'}" can carry over.`,
        [
          {
            key: 'setup',
            label: 'Carry over the machine setup',
            description: 'Same lines and head counts. Every head starts Active with no issues.',
            variant: 'primary',
          },
          {
            key: 'everything',
            label: 'Carry over setup and issues',
            description: 'Also brings forward head status, logged issues and notes — for problems still open.',
            variant: 'outline-primary',
          },
          {
            key: 'blank',
            label: 'Start blank',
            description: 'No lines. Add them from scratch.',
            variant: 'outline-secondary',
          },
        ],
        { title: 'New Visit' }
      );
      if (!mode) return;                     // dismissed
      if (mode === 'setup') carriedLines = scaffoldLinesFrom(prior);
      if (mode === 'everything') carriedLines = scaffoldLinesFrom(prior, { keepIssues: true });
    }

    const newId = `visit_${Date.now()}`;
    const blankGlobal = {
      customer: currentCustomer.name,
      address: currentCustomer.address || '',
      cityState: currentCustomer.cityState || '',
      headCount: (currentCustomer.headCount || '14').toString(),
    };
    const payload = {
      date: new Date().toISOString(),
      name: '',
      globalData: carriedLines.length > 0 ? (prior.globalData || blankGlobal) : blankGlobal,
      lines: carriedLines,
    };
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(user.uid)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection('visits')
        .doc(newId)
        .set(payload);
      setGlobalData(payload.globalData);
      setLines(carriedLines);
      setActiveLineId(carriedLines.length > 0 ? carriedLines[0].id : null);
      setCurrentVisitName('');
      setCurrentVisitId(newId);
      setServiceReportUrl(null);
      setShowDashboardView(false);
      // Baseline must match what we just wrote, or autosave fires immediately.
      savedSnapshotRef.current = serializeVisitContent(carriedLines, payload.globalData, '', null);
      setCloudState('saved');
      setLastSavedAt(new Date());
      toast.success(
        carriedLines.length > 0
          ? `New visit started — ${carriedLines.length} line${carriedLines.length === 1 ? '' : 's'} carried over.`
          : 'New visit started — add lines and it saves automatically.'
      );
    } catch (e) {
      console.error('Start new visit error:', e);
      toast.error('Failed to start new visit');
    }
  };

  // saveAllToCloud / loadAllFromCloud were removed here (2026-08-05).
  // Nothing called them: no button, no menu item, no keyboard path. They were
  // a bulk 'overwrite local from cloud' and its mirror, written before visits
  // saved themselves, and they were the two most destructive functions in the
  // file — one confirm away from overwriting every visit on the device.

  useEffect(() => {
    const unsub = firebase.auth().onAuthStateChanged((u) => {
      setSession(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Retry any photos parked while offline, on startup and whenever the browser
  // regains connectivity. Firestore replays its own queued writes automatically;
  // Storage has no equivalent, so photos need this.
  const [pendingPhotos, setPendingPhotos] = useState(0);
  // Keep the CURRENT visit id/user/customer in a ref so the sync callback below
  // can tell whether a resolved photo belongs to the visit that's open, without
  // re-subscribing the listener on every visit change.
  const openVisitPathRef = useRef(null);
  useEffect(() => {
    openVisitPathRef.current =
      user?.uid && currentCustomer?.id && currentVisitId
        ? `user_files/${user.uid}/customers/${currentCustomer.id}/visits/${currentVisitId}`
        : null;
  }, [user, currentCustomer, currentVisitId]);

  useEffect(() => {
    const refresh = () => photoQueue.count().then(setPendingPhotos).catch(() => {});
    const stop = startPhotoSync({
      onProgress: refresh,
      // If the uploaded photo belongs to the visit currently open, swap the
      // placeholder in the editor's own state too. Without this the next
      // autosave would write the stale placeholder back over the real URL.
      onResolved: (docPath, pendingId, resolved) => {
        if (!docPath || docPath !== openVisitPathRef.current) return;
        setLines((prev) => {
          const [next, replaced] = replacePendingPhoto(prev, pendingId, resolved);
          return replaced > 0 ? next : prev;
        });
      },
    });
    refresh();
    const poll = setInterval(refresh, 15000);
    return () => { stop(); clearInterval(poll); };
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

  // The plant's own daily logs, for Issue History only.
  //
  // A head that keeps failing does not care whether the shift crew or JTI wrote
  // it down, and half the record lives on each side: JTI's visits here, the
  // plant's shifts in dailyLogs. Read-only and never loaded into the editor —
  // this app edits visits, and a daily log belongs to the plant.
  useEffect(() => {
    if (!user || !currentCustomer?.id) { setPlantLogs([]); return; }
    const cid = currentCustomer.id;
    setPlantLogs([]);
    const unsub = firebase
      .firestore()
      .collection('user_files').doc(user.uid)
      .collection('customers').doc(cid)
      .collection('dailyLogs')
      .orderBy('date', 'desc')
      .onSnapshot(
        (snap) => setPlantLogs(snap.docs.map((d) => ({ id: d.id, customerId: cid, ...d.data() })).filter((v) => !v.deleted)),
        (err) => { console.warn('Plant daily logs unavailable:', err); setPlantLogs([]); },
      );
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
          // Re-baseline autosave to the remote content so it doesn't immediately
          // push the same data back.
          savedSnapshotRef.current = serializeVisitContent(remoteLines, remote.globalData || {}, remote.name || '', remote.serviceReportUrl || null);
          // Pulling the cloud's copy in is not this screen saving something,
          // so it must not INVENT a time — that was the visit-date bug. But it
          // must not erase one either: this runs when our own write echoes
          // back, and clearing the chip a second after a real save is its own
          // kind of lie. Leave the time alone; the tick stands if this screen
          // has actually saved, and stays blank if it has not.
          setCloudState(lastSavedAtRef.current ? 'saved' : 'idle');
          dismissPrompt();
        };

        // Auto-refresh when there are no unsaved local edits: the local copy
        // still matches what we last saved to the cloud, so pulling in the newer
        // remote copy can't lose any work. Only when there ARE local edits that
        // differ from remote do we fall back to the manual Reload prompt (which
        // avoids silently clobbering in-progress work).
        const localSnapshot = serializeVisitContent(
          linesRef.current, globalDataRef.current, currentVisitNameRef.current, serviceReportUrlRef.current
        );
        const hasUnsavedEdits =
          savedSnapshotRef.current !== null && localSnapshot !== savedSnapshotRef.current;
        if (!hasUnsavedEdits) {
          applyRemote();
          return;
        }

        // Don't stack prompts; just replace the existing one
        if (cloudPromptToastIdRef.current != null) {
          toast.dismiss(cloudPromptToastIdRef.current);
        }

        const msg = (
          <div>
            <div>This visit was changed on another device.</div>
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
      toast.error('Failed to rename visit');
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
    const list = snap.docs.map(d => ({ id: d.id, ...d.data().profile, archived: !!d.data().profile?.archived }));
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
      toast.error('Failed to add customer');
    }
  };

  const handleImportLegacy = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.json')) {
      toast.error('Please select a valid .json file.');
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
          const importedGlobal = {
            customer: cust.name,
            address: cust.address,
            cityState: cust.cityState,
            headCount: cust.headCount.toString(),
          };
          setGlobalData(importedGlobal);
          const loadedLines = importedLines.map(line => ({
            ...line,
            heads: line.heads.map((head, i) => ({ ...head, id: head.id || i + 1 }))
          }));
          setLines(loadedLines);
          setActiveLineId(loadedLines.length > 0 ? loadedLines[0].id : null);
          setCurrentVisitName('');
          setCurrentVisitId(visitId);
          setServiceReportUrl(null);
          // Baseline the autosave so later edits to the imported visit actually
          // persist (without this the visit never autosaves yet shows "Saved").
          savedSnapshotRef.current = serializeVisitContent(loadedLines, importedGlobal, '', null);
          setCloudState('saved');
          setLastSavedAt(new Date());
        }

        toast.success(`Imported "${profile.name}" – new visit saved!`);
      } catch (err) {
        console.error('Import error:', err);
        toast.error(`Import failed: ${err.message}`);
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
    setServiceReportUrl(null);
    // Reset autosave baseline — nothing is loaded until a visit is opened/created,
    // so the editor won't autosave (and can't clobber) until then.
    savedSnapshotRef.current = null;
    setCloudState('idle');
  };

  // ---- Billed-but-never-logged service reports -----------------------------
  //
  // Confirmed renames. DatePac is not a typo — it is what Oasis Date used to be
  // called, and the change happened between two invoices in the same system.
  // Matching on name alone would file those under a second, duplicate plant and
  // split one machine's history in two. Extend this list when it happens again.
  // Written as the timesheet app actually spells them: the query below is an
  // exact-string Firestore `in`, so a normalised key would match nothing.
  const CUSTOMER_ALIASES = {
    'DatePac': 'Oasis Date',
    'Oasis Dates': 'Oasis Date',
    'B&G Foods': 'Seneca Foods',
  };

  const [backfill, setBackfill] = useState({ candidates: [], loading: false, error: '' });
  const [backfillCreating, setBackfillCreating] = useState(null);

  // Every timesheet spelling that means this CCW customer, so the query below
  // catches the invoices filed under an old name too.
  const timesheetNamesFor = useCallback((cust) => {
    if (!cust?.name) return [];
    const names = [cust.name];
    Object.entries(CUSTOMER_ALIASES).forEach(([alias, target]) => {
      if (customerKey(target) === customerKey(cust.name)) names.push(alias);
    });
    return names;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBackfillCandidates = useCallback(async (cust, visitList) => {
    if (!cust) return setBackfill({ candidates: [], loading: false, error: '' });
    if (!isTimesheetSignedIn()) {
      // The second sign-in happens at login, so a session that predates this
      // feature has no connection to the timesheet project. Rendering nothing
      // would be the same silent-empty failure this panel exists to avoid:
      // "no missing visits" and "never looked" have to read differently.
      return setBackfill({ candidates: [], loading: false, error: '', needsReconnect: true });
    }
    setBackfill((b) => ({ ...b, loading: true, error: '', needsReconnect: false }));
    try {
      // Scoped to this customer rather than pulling every timesheet: the
      // dashboard next door reads the whole collection to build the same view
      // and it is the slowest thing it does.
      const wanted = timesheetNamesFor(cust);
      const snap = await timesheetDb()
        .collection('timesheets')
        .where('customer', 'in', wanted.slice(0, 10))
        .get();
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBackfill({ candidates: findMissingVisits(rows, visitList), loading: false, error: '', needsReconnect: false });
    } catch (err) {
      console.error('Backfill lookup failed:', err);
      setBackfill({ candidates: [], loading: false, error: err?.message || 'Could not reach the timesheet app.' });
    }
  }, [timesheetNamesFor]);

  // A visit built from an invoice. Written straight to the visits collection
  // with the machines scaffolded from the customer's most recent visit, then
  // opened — so what lands is reviewable rather than taken on trust.
  useEffect(() => {
    if (!showVisitsModal || !currentCustomer) return;
    loadBackfillCandidates(currentCustomer, visits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVisitsModal, currentCustomer?.id, visits.length]);

  const createVisitFromCandidate = useCallback(async (candidate) => {
    if (!user || !currentCustomer) return;
    const prior = visits.find((v) => Array.isArray(v.lines) && v.lines.length);
    const lineCount = prior ? (prior.lines || []).length : 0;

    const ok = await dialog.confirm(
      `Create a visit for service report ${candidate.number}?\n\n`
      + `Customer: ${currentCustomer.name}\n`
      + `Date: ${candidate.date || 'not recorded'}\n`
      + `${lineCount ? `Lines: ${lineCount}, copied from "${prior.name || 'the last visit'}"` : 'Lines: none — this customer has no earlier visit to copy machines from'}\n`
      + `${candidate.hasWork ? 'The write-up from the timesheet goes into the visit notes.' : 'There is no write-up on this one.'}`,
      { title: 'Create Visit from Service Report', confirmText: 'Create' },
    );
    if (!ok) return;

    setBackfillCreating(candidate.norm);
    try {
      const payload = buildVisitFromCandidate(candidate, prior ? scaffoldLinesFrom(prior) : []);
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

      await loadVisits(currentCustomer.id);
      toast.success(`Visit ${candidate.number} created`);
      setBackfill((b) => ({ ...b, candidates: b.candidates.filter((c) => c.norm !== candidate.norm) }));
    } catch (err) {
      console.error('Could not create visit from service report:', err);
      toast.error('Could not create that visit: ' + err.message);
    } finally {
      setBackfillCreating(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentCustomer, visits, dialog, toast]);

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
      toast.error('Failed to delete visit');
    }
  };

  const loadFromCloud = async () => {
    if (!user || !currentCustomer) return toast.error('Select a customer first');
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

    if (snap.empty) return toast.error('No cloud data');

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

    toast.success('Loaded from cloud!');
  };

  const saveAllData = async () => {
    if (!user) return toast.error('Sign in first');
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
    toast.success('All data exported!');
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
        if (!user) return toast.error('Sign in first');
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
        toast.success('All data imported!');
        await refreshCustomers();
      } catch (err) {
        toast.error(`Import failed: ${err.message}`);
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

  // Cloud autosave: whenever a LOADED visit's content changes, push it to the
  // cloud after a short debounce. The savedSnapshotRef baseline is set on load /
  // create, so this never fires for unbaselined state and never writes no-op
  // changes. This is what makes saving "just work" — no manual Save needed.
  useEffect(() => {
    if (!user || !currentCustomer || !currentVisitId) return;
    if (savedSnapshotRef.current === null) return; // not baselined yet (mid-load)
    const current = serializeVisitContent(lines, globalData, currentVisitName, serviceReportUrl);
    if (current === savedSnapshotRef.current) {
      // Back to what's already stored — typically an edit undone inside the
      // debounce window. The previous run's cleanup has just cancelled the
      // pending write, so returning here left "Saving…" on screen with nothing
      // left to save and nothing that would ever clear it: the chip only moves
      // when a write completes, and no write is coming. Say saved, because it is.
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      setCloudState(prev => (prev === 'saving' ? 'saved' : prev));
      return;
    }
    setCloudState('saving');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => { writeVisitInPlace(); }, 1500);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, globalData, currentVisitName, serviceReportUrl, currentVisitId, currentCustomer, user]);

  // NOTE: localStorage is no longer auto-restored on customer change. With cloud
  // autosave, the cloud is the source of truth: the last visit is re-fetched on
  // app load (auto-resume), and switching customers clears the editor so you pick
  // a visit from the sidebar. Auto-restoring the per-customer cache here used to
  // overwrite cloud data with stale local data on switch — the main data-loss bug.

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
          allVisits.push(...visitSnap.docs
            .map(d => ({ id: d.id, customerId: custDoc.id, ...d.data() }))
            .filter(v => !v.deleted)); // don't surface recycle-binned visits in Issue History
        }
        setAllVisits(allVisits);
      };
      loadAllVisits();
    }
  }, [user]);

  // Reserve room at the bottom of the page while the thumb-zone action bar is
  // shown, so it never covers the end of the content. Declared down here (not
  // with the other effects up top) because it reads state defined below them.
  const showMobileActionBar = !!currentCustomer && lines.length > 0 && activeTab === 'current';
  useEffect(() => {
    document.body.classList.toggle('has-mobile-action-bar', showMobileActionBar);
    return () => document.body.classList.remove('has-mobile-action-bar');
  }, [showMobileActionBar]);

  // Freeze the page behind this file's hand-rolled modals (see useBodyScrollLock).
  useBodyScrollLock(showVisitsModal || showDuplicates || showLinesModal);

  if (loading) return <div className="text-center p-5">Loading...</div>;

  if (!user) {
    return <LoginScreen onLogin={async (email, password) => {
      const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
      // Same credentials, second project — read-only, and only so the visit list
      // can notice service reports that were billed but never logged. If it
      // fails this app still works completely; the backfill panel is the only
      // thing that goes quiet, and it says so rather than showing an empty list.
      signInToTimesheet(email, password).then((r) => {
        if (!r.ok) console.warn('Timesheet lookup unavailable:', r.error);
      });
      setSession(cred.user);
    }} />;
  }

  return (
    <div className="container-fluid p-0">
      {/* A tab left open for a week keeps running the build it opened with.
          This is what tells somebody the screen in front of them is old. */}
      <UpdateBanner />
      {/* Offline status indicator */}
      <OfflineIndicator pendingPhotos={pendingPhotos} />

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
        /* Narrow phones (portrait): let the toolbar wrap onto multiple rows
           instead of overflowing off-screen. The customer picker takes its own
           full-width first row; the icon buttons flow onto the row(s) below. */
        @media (max-width: 640px) {
          .control-bar .toolbar-row {
            flex-wrap: wrap !important;
            row-gap: 6px;
          }
          .control-bar .form-select-sm {
            flex: 1 1 100% !important;
            max-width: none;
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
          >
            <option value="">-- Select Customer --</option>
            {customers.filter(c => !c.archived).map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {/* Still selectable — archiving hides a plant from the working list,
                it does not put their history behind a door. */}
            {customers.some(c => c.archived) && (
              <optgroup label="Archived">
                {customers.filter(c => c.archived).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {currentCustomer && (
            <button
              onClick={() => setShowVisitsModal(true)}
              className="btn btn-outline-primary btn-sm"
              title="Choose or manage visits"
            >
              <List className="w-4 h-4" /> <span className="btn-label">Visits</span>{' '}
              <span className="badge bg-secondary ms-1" title={`${visits.length} visit${visits.length === 1 ? '' : 's'} for this customer`}>{visits.length}</span>
            </button>
          )}

          {/* A loaded visit autosaves to the cloud (status shown by the chip on
              the right). The only manual save needed is to commit a brand-new
              in-memory visit that doesn't have a doc yet. Use the sidebar "+ New"
              or a visit's Copy icon to create visits. */}
          {!currentVisitId && (
            <button
              onClick={() => saveToCloud(false)}
              className="btn btn-primary btn-sm"
              title="Save this as a new visit (then it autosaves)"
              disabled={!currentCustomer || lines.length === 0 || !!viewingPlantLogId}
            >
              <Save className="w-4 h-4" /> <span className="btn-label">Save Visit</span>
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
                <button
                  className="dropdown-item d-flex align-items-center gap-2"
                  onClick={async () => {
                    try {
                      await exportDashboardToPDF(lines, globalData);
                    } catch (err) {
                      console.error('Export failed:', err);
                      toast.error(`Could not export the PDF: ${err?.message || err}`);
                    }
                  }}
                >
                  <FileText className="w-4 h-4" /> Dashboard PDF
                </button>
              </li>
              <li>
                <button
                  className="dropdown-item d-flex align-items-center gap-2"
                  disabled={exportingPhotos}
                  onClick={async () => {
                    // Nothing caught this before. Every way the export could
                    // fail — a photo the broker would not serve, a stalled
                    // request, a bad image — ended as an unhandled rejection:
                    // a toast saying photos were loading, then silence, and no
                    // PDF. The failure has to reach the person who clicked.
                    setExportingPhotos(true);
                    toast.success('Loading photos into PDF…');
                    try {
                      const stats = await exportDashboardToPDF(lines, globalData, true);
                      if (stats && stats.requested > stats.embedded) {
                        // The PDF still saved. Say what is missing from it
                        // rather than letting it look complete.
                        toast.error(
                          `PDF saved, but ${stats.requested - stats.embedded} of ${stats.requested} photos could not be loaded.`
                        );
                      } else if (stats && stats.requested === 0) {
                        toast.success('PDF saved — no photos on this visit.');
                      } else {
                        toast.success(`PDF saved with ${stats?.embedded ?? 0} photo${stats?.embedded === 1 ? '' : 's'}.`);
                      }
                    } catch (err) {
                      console.error('Export with photos failed:', err);
                      toast.error(`Could not export the PDF: ${err?.message || err}`);
                    } finally {
                      setExportingPhotos(false);
                    }
                  }}
                >
                  <FileText className="w-4 h-4" /> {exportingPhotos ? 'Building PDF…' : 'Dashboard PDF (with Photos)'}
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
            {/* Who this tablet is currently logging as, and how to hand over.
                In the header rather than inside a form: the person who needs it
                is the one who has just walked up, before they open anything. */}
            <PinSession customerId={currentCustomer?.id} />
            {currentVisitId && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={verifyAgainstCloud}
                disabled={checkingCloud}
                title="Check the loaded visit against the cloud copy"
              >
                <RefreshCw className={'w-4 h-4' + (checkingCloud ? ' spin' : '')} />{' '}
                <span className="btn-label">{checkingCloud ? 'Checking…' : 'Check cloud'}</span>
              </button>
            )}
            {currentVisitId && (
              <span
                className={'badge ' + (cloudState === 'saving' ? 'bg-warning text-dark'
                  : cloudState === 'error' ? 'bg-danger'
                  : cloudState === 'saved' && lastSavedAt ? 'bg-success' : 'bg-secondary')}
                title="Changes save to the cloud automatically"
              >
                {/* `idle` used to fall through to the ✓ Saved branch, so a
                    visit that had never been written this session still showed
                    a tick — and a stale time beside it read as "saved just
                    now". A chip that cannot tell you nothing has happened is
                    worse than no chip. */}
                {cloudState === 'saving'
                  ? 'Saving…'
                  : cloudState === 'error'
                  ? '⚠ Offline — will retry'
                  : cloudState === 'saved' && lastSavedAt
                  ? `✓ Saved ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Loaded — no changes yet'}
              </span>
            )}

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
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowPlantLogins(true)}>
                    <Lock className="w-4 h-4" /> Plant logins
                  </button>
                </li>
                {currentVisitId && (
                  <li>
                    <button
                      className="dropdown-item d-flex align-items-center gap-2"
                      onClick={() => { setShowDeletedLines(true); loadDeletedLines(); }}
                    >
                      <History className="w-4 h-4" /> Deleted lines
                    </button>
                  </li>
                )}
                {currentVisitId && (
                  <li>
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={duplicateVisit}>
                      <Copy className="w-4 h-4" /> Duplicate Visit
                    </button>
                  </li>
                )}
                <li><hr className="dropdown-divider" /></li>
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
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowDuplicates(true)}>
                      <Copy className="w-4 h-4" /> Find Duplicate Visits
                    </button>
                  </li>
                )}
                <li>
                  <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowBackfill(true)}>
                    <Hash className="w-4 h-4" /> Backfill Service Report #s
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

      {/* Context bar.
          The customer's NAME is not repeated here — the dropdown directly above
          already says it, and a chip echoing it answered a question nobody had.
          What goes here instead is what the dropdown cannot tell you: how big
          this plant is, when it was last seen, and which visit is loaded. */}
      {(currentCustomer || currentVisitName) && (
        <div className="context-bar">
          {currentCustomer ? (
            <span className="pill pill-muted" title="This customer">
              {lines.length > 0 ? `${lines.length} line${lines.length === 1 ? '' : 's'} · ` : ''}
              {currentCustomer.headCount} heads
              {(() => {
                const last = visits.find((v) => !v.deleted);
                return last ? ` · last visit ${sinceLabel(last.date)}` : ' · no visits yet';
              })()}
            </span>
          ) : (
            <span className="pill pill-muted">No customer selected</span>
          )}
          {currentVisitName && (
            <span className="pill pill-primary pill-dot" title="Loaded visit">
              {currentVisitName}
            </span>
          )}
        </div>
      )}

      {showDeletedLines && (
        <div className="p-3 bg-light border-bottom">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="mb-0 d-flex align-items-center gap-2">
              <History className="w-4 h-4" /> Deleted lines — this visit
            </h6>
            <button onClick={() => setShowDeletedLines(false)} className="btn btn-sm btn-outline-secondary">
              Close
            </button>
          </div>
          <p className="text-muted small">
            A removed line is kept for {LINE_BIN_DAYS} days with everything on it — heads,
            issues and notes — and can be put back exactly as it was.
          </p>
          {deletedLines.length === 0 ? (
            <div className="text-muted small">Nothing removed from this visit.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr><th>Line</th><th>Removed</th><th>By</th><th>Expires</th><th></th></tr>
                </thead>
                <tbody>
                  {deletedLines.map((row) => {
                    const at = new Date(row.deletedAt);
                    const daysLeft = Math.ceil(
                      (at.getTime() + LINE_BIN_DAYS * 86400000 - Date.now()) / 86400000
                    );
                    return (
                      <tr key={row.id}>
                        <td><strong>{row.title || 'Line'}</strong></td>
                        <td>{at.toLocaleDateString()}</td>
                        <td>{row.deletedBy || '—'}</td>
                        <td>
                          <span className={`badge ${daysLeft <= 5 ? 'bg-danger' : 'bg-secondary'}`}>
                            {daysLeft} day{daysLeft === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-primary" onClick={() => restoreDeletedLine(row)}>
                            Restore
                          </button>
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


      {showPlantLogins && (
        <AdminLoginsPanel
          customers={customers}
          currentCustomerId={currentCustomer?.id || ''}
          onClose={() => setShowPlantLogins(false)}
          toast={toast}
        />
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
              <label className="form-label"><strong>Customer:</strong></label>
              <div className="d-flex gap-2">
                <select value={customerToDelete} onChange={(e) => setCustomerToDelete(e.target.value)} className="form-select form-select-sm">
                  <option value="">-- Select --</option>
                  {customers.filter(c => !c.archived).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  {customers.some(c => c.archived) && (
                    <optgroup label="Archived">
                      {customers.filter(c => c.archived).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {customerToDelete && (
                  customers.find(c => c.id === customerToDelete)?.archived ? (
                    <button onClick={() => { setCustomerArchived(customerToDelete, false); setCustomerToDelete(''); }} className="btn btn-outline-success btn-sm text-nowrap">Restore</button>
                  ) : (
                    <button onClick={() => { setCustomerArchived(customerToDelete, true); setCustomerToDelete(''); }} className="btn btn-outline-secondary btn-sm text-nowrap">Archive</button>
                  )
                )}
                {customerToDelete && (
                  <button onClick={() => { deleteCustomerFromCloud(customerToDelete); setCustomerToDelete(''); }} className="btn btn-danger btn-sm">Delete</button>
                )}
              </div>
              {/* Said plainly, because the two buttons sit next to each other and
                  only one of them can be undone. */}
              <div className="form-text">
                <strong>Archive</strong> keeps every visit and photo and just hides the plant.
                <strong> Delete</strong> destroys them permanently.
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
            <div className="d-flex gap-2">
              {/* Extensionless: Cloudflare Pages 308s /JTI_GUIDE.html to
                  /JTI_GUIDE, so linking the .html adds a redirect for nothing. */}
              <a href="/JTI_GUIDE" target="_blank" rel="noopener" className="btn btn-sm btn-primary">
                Full guide ↗
              </a>
              <button onClick={() => setShowHelp(false)} className="btn btn-sm btn-outline-secondary">Close</button>
            </div>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>How to Run the App</strong></h6>
            <ol className="small">
              <li>Pick a customer from the dropdown (your last customer + visit auto-resume on reload).</li>
              <li>Tap the <strong>Visits</strong> button in the toolbar to open the visits list. Tap a visit to open it, hit <strong>+ New</strong> for a blank visit, or a visit's <strong>copy</strong> icon to start a fresh visit from that one's setup.</li>
              <li>Add lines and heads, track issues, add notes.</li>
              <li>Everything <strong>saves to the cloud automatically</strong> as you work — the status chip (top-right) shows <em>Saving… / ✓ Saved</em>. There's no Save button to remember, and switching visits never loses work.</li>
              <li>Attach the signed service report (PDF) from the <strong>report bar</strong> pinned at the top — View / Replace / Delete it there anytime.</li>
              <li>Export to PDF or JSON from the <strong>Export</strong> menu.</li>
              <li>The maintenance tabs — <strong>Span Adjust</strong>, <strong>Parts/Boards</strong>, <strong>PM Log</strong>, <strong>Crew</strong>, <strong>Activity</strong> — are scoped to the <em>customer and line</em>, not to a visit, so they carry across service calls.</li>
            </ol>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Top Toolbar</strong></h6>

            <div className="mb-2">
              <strong className="text-secondary">Customer dropdown:</strong>
              <p className="small mb-1">Switch between customers. Your selection is remembered between sessions.</p>
            </div>

            <div className="mb-2">
              <strong className="text-primary">Visits:</strong>
              <p className="small mb-1">Opens the visits list (a pop-up): tap a visit to open it, <strong>+ New</strong> for a blank visit, or per-row icons to copy, rename, change date, or delete.</p>
            </div>

            <div className="mb-2">
              <strong className="text-primary">Save Visit (blue):</strong>
              <p className="small mb-1">Only appears when you've started a brand-new visit that isn't saved yet — it commits it to the cloud, after which it autosaves. Existing visits autosave with no button.</p>
            </div>

            <div className="mb-2">
              <strong className="text-success">✓ Saved chip:</strong>
              <p className="small mb-1">Shows the live cloud-save status of the loaded visit: <em>Saving… / ✓ Saved (time) / ⚠ Offline</em>.</p>
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
              <p className="small mb-1">Less-frequent actions: Add Customer, Duplicate Visit, Import JSON, Delete Options, <strong>Find Duplicate Visits</strong>, Recycle Bin, theme toggle, Help, Logout.</p>
            </div>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Service Report bar (top)</strong></h6>
            <ul className="small">
              <li>Pinned at the top whenever a visit is open, showing the visit name and the report actions.</li>
              <li><strong>View Report</strong> opens the attached PDF, <strong>Replace</strong> swaps it, <strong>Delete</strong> removes it.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Visits list (pop-up)</strong></h6>
            <ul className="small">
              <li><strong>Tap</strong> a visit to open it (the pop-up closes).</li>
              <li><strong>Copy</strong> icon starts a new visit from that one's machine setup (clean slate, dated today).</li>
              <li><strong>Double-tap</strong> the name or tap the pencil to rename; clock icon edits the date.</li>
              <li>Trash icon moves the visit to the recycle bin (restorable from the ⚙ menu).</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Cross-device sync</strong></h6>
            <ul className="small">
              <li>Edit on one device and the visits list on any other open device updates in real time.</li>
              <li>If the same visit is edited on another device, you'll see a <em>"This visit was changed on another device — Reload"</em> toast. Tap Reload to pull in those changes.</li>
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

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Span Adjust</strong></h6>
            <ul className="small">
              <li>Its own tab, scoped to a <strong>line</strong> rather than a visit — a span adjustment runs on its own ~30-day clock, whoever is on shift.</li>
              <li>The overview lists every line with <strong>overdue first</strong>. Span (target) weights carry forward from last time; current weights always start blank so a stale reading can't be re-logged by accident.</li>
              <li><strong>Scan screen</strong> — photograph the Ishida panel and the current weights fill in. It reads the circled head number and the weight in that same hopper, so it doesn't matter where head 1 sits on the ring.</li>
              <li>Scanned values land in editable fields with a <strong>blue border</strong>; the photo stays on screen so you can check them, and nothing is saved until you press Log.</li>
              <li>Heads it couldn't read are listed rather than guessed. Duplicates or numbers not on the line are shown but not filled in.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Parts / Boards</strong></h6>
            <ul className="small">
              <li>Logs part and circuit-board replacements per line. New entries pre-fill from the last one — line, head, board type, part — but <strong>never serials</strong>.</li>
              <li><strong>Parts manuals</strong> (JTI) links each line to one machine in the Parts Viewer catalog. Part suggestions then come only from that machine's manual.</li>
              <li>Type a part number <em>or name</em>, or press <strong>Browse</strong> to page through the drawings and tap the part on the exploded view. The eye button clears the markers so you can read the drawing; the list button picks from a list instead.</li>
              <li>Entries show <strong>✓ manual</strong> or <strong>unverified</strong>, so the log distinguishes a part checked against the manual from one typed in. Typing is never blocked.</li>
              <li><strong>Board types</strong> set here are what the customer app offers. Both board types and PM checklists can be copied from another customer.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>PM Log</strong></h6>
            <ul className="small">
              <li>The checklist JTI defines and the plant fills in. Editing it never changes checks already submitted — each submission keeps the wording it was signed off with.</li>
              <li>Items can carry a <strong>reference photo</strong> showing what to look at.</li>
              <li>A submitted check can be <strong>signed off by a supervisor</strong> with their own PIN — the one record here that is a real attestation rather than a name picked from a list.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Crew</strong></h6>
            <ul className="small">
              <li>The plant's own people, and who is on which line this shift. Plants manage their own list; JTI always has access.</li>
              <li>Every span, board and PM entry records the crew for <strong>its</strong> line. Names are copied at save time, so re-crewing later never rewrites what was already logged.</li>
              <li>Crewing older than 16 hours is flagged as probably last shift's — on this page and on the line list.</li>
              <li><strong>PINs</strong> identify a person on a shared tablet. Set or reset by a plant admin (a supervisor ticked as admin) or by JTI. <em>JTI must set the first one</em> — nobody can prove themselves before any PIN exists.</li>
              <li>A plant with no PINs keeps working, unattributed. This records who did something; it is not a lock.</li>
              <li><strong>Crewing history</strong> keeps every change, so "who was on Tuesday nights" stays answerable.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Activity</strong></h6>
            <ul className="small">
              <li>One time-ordered feed per line: span adjustments, part/board swaps, PM checks, heads stopped and restarted, issues fixed, and crewing changes — each with who did it. Filter by kind with the chips.</li>
              <li><strong>Alert me</strong> notifies this device when a head goes offline, on any line. It works while the app is open, including a background tab — it <em>cannot</em> reach a closed app or a locked phone.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Who did what</strong></h6>
            <ul className="small">
              <li>Taking a head offline, putting it back, or marking an issue fixed records the person — asked once per device with a PIN and remembered for 10 hours.</li>
              <li>Shown in the offline-heads table, on the customer's dashboard, and in Activity.</li>
              <li>Two different questions, answered from two places: who is <em>running</em> the line comes from the crewing; who <em>pressed the button</em> comes from the PIN.</li>
            </ul>
          </div>

          <div className="mb-2">
            <h6 className="text-primary mb-2"><strong>Quick Tips</strong></h6>
            <ul className="small">
              <li>Your work is cached locally and saved to the cloud automatically — it also keeps working offline and syncs when you're back online.</li>
              <li>Tap <strong>Visits</strong> in the toolbar to switch visits, start a new one, or copy a prior one.</li>
              <li>Got duplicate visits piling up? Use <strong>⚙ → Find Duplicate Visits</strong> to review and clean them up.</li>
              <li>Issue History shows every head that's had problems across all of this customer's visits.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Static visit + service-report bar, pinned at the top of the workspace. */}
      {currentVisitId && (
        <div className="report-bar">
          <div className="report-bar-visit">
            <span className="report-bar-label">Visit</span>
            <span className="report-bar-name" title={currentVisitName || 'Untitled visit'}>{currentVisitName || 'Untitled visit'}</span>
          </div>
          <div className="report-bar-sr">
            <label className="report-bar-label" htmlFor="sr-number">SR #</label>
            <input
              id="sr-number"
              type="text"
              inputMode="numeric"
              className="form-control form-control-sm report-bar-sr-input"
              list="ccw-reserved-srs"
              value={globalData.serviceReportNumber || ''}
              onChange={(e) => {
                const value = e.target.value;
                // Picking a reserved number also names the customer it was
                // reserved against — but only into a blank box. Overwriting a
                // customer already on the visit is not a side effect a number
                // field gets to have.
                const hit = reservedSrs.find((r) => String(r.sr) === value.trim());
                setGlobalData(prev => ({
                  ...prev,
                  serviceReportNumber: value,
                  customer: prev.customer || (hit?.customer ?? ''),
                }));
              }}
              placeholder="YYYY###"
              title="Service report number — links this visit to its service report & invoice in the dashboard"
            />
            {/* Numbers reserved in the dashboard. A datalist rather than a
                select: the number is still free text, because a visit can carry
                one that predates any of this, and typing must keep working. */}
            <datalist id="ccw-reserved-srs">
              {reservedSrs.map((r) => (
                <option key={r.sr} value={r.sr}>{r.customer || ''}</option>
              ))}
            </datalist>
          </div>
          <ServiceReportUpload
            userId={user?.uid}
            customerId={currentCustomer?.id}
            visitId={currentVisitId}
            currentReportUrl={serviceReportUrl}
            onReportUploaded={(url) => setServiceReportUrl(url)}
          />
        </div>
      )}

      <div className="workspace-shell workspace-shell--no-sidebar">
        <main className="workspace-main">
      <AppNav active={activeTab} onSelect={setActiveTab} counts={navCounts} />
      <div className="ccw-panes">
        <div className="ccw-pane" id="ccw-pane-overview" role="tabpanel"
             aria-labelledby="ccw-tab-overview" hidden={activeTab !== 'overview'}>
          <div className="tab-content p-3">
            <OverviewPage
              noun="visit"
              onAdoptLines={adoptHistoryLines}
              customerName={currentCustomer?.name}
              workspaceId={user?.uid}
              customerId={currentCustomer?.id}
              lines={lines}
              visits={visits}
              onGo={(tab, lineId) => {
                // A line picked on the overview must still be the line showing
                // when the Current Log opens.
                if (lineId != null) showLine(lineId, setShowDashboardView, setActiveLineId);
                setActiveTab(tab);
              }}
            />
          </div>
        </div>
        <div className="ccw-pane" id="ccw-pane-current" role="tabpanel"
             aria-labelledby="ccw-tab-current" hidden={activeTab !== 'current'}>
          <div className="tab-content p-3">
            {/* One of the plant's own logs, open for reading. */}
            {viewingPlantLogId && (
              <div className="alert alert-info d-flex align-items-center gap-2 py-2 flex-wrap" role="alert">
                <Eye size={16} />
                <span>
                  <strong>Plant daily log — view only.</strong>{' '}
                  {(() => {
                    const v = plantLogs.find((x) => x.id === viewingPlantLogId);
                    return v ? `${v.name || 'Log'}${v.date ? ` · ${new Date(v.date).toLocaleDateString()}` : ''}` : '';
                  })()}
                  . This is the plant&apos;s record — yours are the visits.
                </span>
                <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={closePlantLog}>
                  Close
                </button>
              </div>
            )}

            {currentCustomer && !viewingPlantLogId && (
              <div className="mb-3">
                <label className="form-label"><strong>Visit Name:</strong></label>
                <input
                  type="text"
                  value={currentVisitName}
                  onChange={(e) => setCurrentVisitName(e.target.value)}
                  placeholder="Enter visit name (optional)"
                  className="form-control"
                />
              </div>
            )}

            <div style={viewingPlantLogId ? { pointerEvents: 'none', opacity: 0.75 } : undefined}>
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
            </div>

            {/* Line picker: a scrollable chip strip rather than a native picker
                wheel — one tap to switch, and each chip's dot shows the line's
                status at a glance while walking the plant. */}
            {currentVisitId && (
              <div className="d-flex justify-content-end mb-1">
                <button type="button" className="btn btn-sm btn-link text-decoration-none" onClick={() => setShowSetupLines(true)}>
                  {lines.length === 0 ? 'Build your lines' : 'Set up lines'}
                </button>
              </div>
            )}
            {lines.length > 0 && (
              <div className="line-chips" role="tablist" aria-label="Equipment lines">
                {lines.map(line => (
                  <button
                    key={line.id}
                    type="button"
                    role="tab"
                    aria-selected={!showDashboardView && line.id === activeLineId}
                    className={`line-chip${!showDashboardView && line.id === activeLineId ? ' is-active' : ''}`}
                    onClick={() => showLine(line.id, setShowDashboardView, setActiveLineId)}
                  >
                    <span className={`line-chip-dot line-chip-dot--${lineStatusKey(line)}`} aria-hidden="true" />
                    {line.title}
                  </button>
                ))}
              </div>
            )}

            <div className="d-flex flex-wrap gap-2 my-3 align-items-center">
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

            {/* While reading a plant's log the line list is non-interactive.
                Writes are already blocked at source by currentVisitId being
                null; this stops the screen inviting edits that go nowhere. */}
            {showDashboardView ? (
              <Dashboard key={`dash-${lines.length}`} lines={lines} setShowDashboardView={setShowDashboardView} />
            ) : (
              <div style={viewingPlantLogId ? { pointerEvents: 'none', opacity: 0.75 } : undefined}>
                {lines.map(line => (
                  /* No requireEditAuth is passed here: the PIN gate is a PLANT
                     control and this app is JTI's — there is no crew roster to
                     prove yourself against. Line treats the prop as optional and
                     falls through to its confirm. backupLine still applies;
                     recovery is worth having whoever did the removing. */
                  <Line
                    key={line.id}
                    line={line}
                    // Created here, so the line lock does not apply to it.
                    isNewLine={createdThisSession.current.has(line.id)}
                    updateLine={updateLineStable}
                    removeLine={handleRemoveLine}
                    backupLine={backupLine}
                    resetLine={handleResetLine}
                    isVisible={line.id === activeLineId}
                    exportLineToPDF={exportLineStable}
                    buildSpanCalibrationPDF={buildSpanCalStable}
                    buildCombinedPDF={buildCombinedStable}
                    globalData={globalData}
                    isDark={isDark}
                    // Head history spans BOTH halves of the record — this plant's own
                    // logs and the service visits — the same combined set the Issue
                    // History tab reads. Passing only one half meant a head could show
                    // "History (0)" while its faults sat one tab away.
                    visits={historyVisits}
                    currentVisitId={currentVisitId}
                    userId={user?.uid}
                    customerId={currentCustomer?.id}
                    visitId={currentVisitId}
                    performedByName={user?.email || 'JTI'}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-span" role="tabpanel"
             aria-labelledby="ccw-tab-span" hidden={activeTab !== 'span'}>
          <div className="tab-content p-3">
            <SpanAdjustPage
              workspaceId={user?.uid}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
              performedByName={user?.email || 'JTI'}
              role="jti"
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-boards" role="tabpanel"
             aria-labelledby="ccw-tab-boards" hidden={activeTab !== 'boards'}>
          <div className="tab-content p-3">
            <BoardReplacementPage
              customers={customers}
              workspaceId={user?.uid}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
              performedByName={user?.email || 'JTI'}
              role="jti"
              canEditTypes
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-prestart" role="tabpanel"
             aria-labelledby="ccw-tab-prestart" hidden={activeTab !== 'prestart'}>
          <div className="tab-content p-3">
            {/* JTI writes the standard here and pushes it to plants. Filing a
                check from this app is allowed too — a tech walking a machine
                before handing it back is doing the same walk. */}
            <PrestartPage
              workspaceId={user?.uid}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              lines={lines}
              visits={visits}
              performedByName={user?.email || 'JTI'}
              role="jti"
              canEditTemplate
              canSubmit
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-pm" role="tabpanel"
             aria-labelledby="ccw-tab-pm" hidden={activeTab !== 'pm'}>
          <div className="tab-content p-3">
            {/* JTI both defines the checklist and can file a check — a tech
                doing the PM during a service call needs to record it. The log
                already distinguishes the two: a submission carries the
                submitter's role, and the history renders "(JTI)" or "(plant)"
                against every entry, so who performed a check is never in
                doubt. */}
            <PmLogPage
              customers={customers}
              workspaceId={user?.uid}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
              performedByName={user?.email || 'JTI'}
              role="jti"
              canEditTemplate
              canSubmit
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-crew" role="tabpanel"
             aria-labelledby="ccw-tab-crew" hidden={activeTab !== 'crew'}>
          <div className="tab-content p-3">
            <CrewPage
              isJti
              workspaceId={user?.uid}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-activity" role="tabpanel"
             aria-labelledby="ccw-tab-activity" hidden={activeTab !== 'activity'}>
          <div className="tab-content p-3">
            <ActivityPage
              workspaceId={user?.uid}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-history" role="tabpanel"
             aria-labelledby="ccw-tab-history" hidden={activeTab !== 'history'}>
          <div className="tab-content p-3">
            <IssueHistory
              customers={customers}
              visits={historyVisits}
              onExportPDF={exportLineHistoryToPDF}
              customerId={currentCustomer?.id}
              badgeSource="plant"
              badgeLabel="Plant log"
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-layout" role="tabpanel"
             aria-labelledby="ccw-tab-layout" hidden={activeTab !== 'layout'}>
          <div className="tab-content p-3">
            <Suspense fallback={<div className="text-muted p-3">Loading layout…</div>}>
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
            </Suspense>
          </div>
        </div>
      </div>
        </main>
      </div>

      {/* Thumb-zone action bar (phones only, CSS-gated). The sticky toolbar sits
          at the top of the screen, which is the hardest place to reach one-handed
          on a large phone — this mirrors the actions a tech needs mid-visit down
          where the thumb already is. */}
      {showMobileActionBar && (
        <div className="mobile-action-bar">
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={() => setShowLinesModal(true)}
          >
            <List className="w-4 h-4" /> Lines
          </button>
          <button
            type="button"
            className={`btn ${showDashboardView ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setShowDashboardView(!showDashboardView)}
          >
            <Eye className="w-4 h-4" /> Dashboard
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-scroll-top"
            aria-label="Back to top"
            title="Back to top"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            ↑
          </button>
        </div>
      )}

      {showVisitsModal && currentCustomer && (
        <div className="modal show d-block visits-modal" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowVisitsModal(false)}>
          <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Visits — {currentCustomer.name}</h5>
                <button type="button" className="btn-close" onClick={() => setShowVisitsModal(false)} aria-label="Close"></button>
              </div>
              <div className="modal-body p-0">
                <VisitsSidebar
                  visits={visits}
                  currentVisitId={currentVisitId}
                  onSelect={(id) => { loadVisit(id); setShowVisitsModal(false); }}
                  onNewVisit={() => { startNewVisit(); setShowVisitsModal(false); }}
                  onCopyVisit={(id) => { newVisitFromPrior(id); setShowVisitsModal(false); }}
                  onRename={renameVisit}
                  onEditDate={(v) => { setVisitToEdit(v); setEditTimestamp(new Date(v.date).toISOString().slice(0, 16)); setShowVisitsModal(false); }}
                  onDelete={deleteVisit}
                  collapsed={false}
                />

                {/* Billed but never logged: service reports whose number no
                    visit here claims. Sits under the list because that is where
                    you are when you notice the history has a gap. */}
                <BackfillPanel
                  candidates={backfill.candidates}
                  loading={backfill.loading}
                  error={backfill.error}
                  needsReconnect={backfill.needsReconnect}
                  creatingId={backfillCreating}
                  onCreate={createVisitFromCandidate}
                />

                {/* The plant's own shift logs. Listed apart because they are a
                    different record with different rules — read here, never
                    written, and never something a service visit is filed on. */}
                {plantLogs.length > 0 && (
                  <div className="border-top mt-2 pt-2">
                    <div className="px-3 pb-1 small text-uppercase fw-bold text-secondary" style={{ letterSpacing: '.08em' }}>
                      Plant daily logs · view only
                    </div>
                    <ul className="list-group list-group-flush">
                      {plantLogs.slice(0, 30).map((v) => (
                        <li key={v.id} className="list-group-item">
                          <button
                            type="button"
                            className="btn btn-link p-0 text-start text-decoration-none w-100"
                            onClick={() => { viewPlantLog(v.id); setShowVisitsModal(false); }}
                          >
                            <div className="fw-semibold">{v.name || 'Daily log'}</div>
                            <div className="small text-secondary">
                              {v.date ? new Date(v.date).toLocaleDateString() : 'no date'}
                              {v.shift ? ` · ${v.shift}` : ''}
                              {(v.lines || []).length ? ` · ${v.lines.length} line${v.lines.length === 1 ? '' : 's'}` : ''}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showDuplicates && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowDuplicates(false)}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title d-flex align-items-center gap-2"><Copy size={18} /> Duplicate Visits — {currentCustomer?.name}</h5>
                <button type="button" className="btn-close" onClick={() => setShowDuplicates(false)} aria-label="Close"></button>
              </div>
              <div className="modal-body">
                {duplicateGroups.length === 0 ? (
                  <p className="text-muted mb-0">No duplicate visits found — every visit has a unique name. 🎉</p>
                ) : (
                  <>
                    <p className="small text-muted">
                      Visits grouped by name. The <strong>newest is listed first</strong> in each group — keep that one and delete the older copies. Deleting moves a visit to the Recycle Bin (recoverable).
                    </p>
                    {duplicateGroups.map((g) => (
                      <div key={g.key} className="mb-3">
                        <div className="fw-semibold mb-1">
                          {g.label} <span className="badge bg-secondary">{g.visits.length}</span>
                        </div>
                        <ul className="list-group">
                          {g.visits.map((v, i) => (
                            <li key={v.id} className="list-group-item d-flex justify-content-between align-items-center gap-2">
                              <span className="d-flex align-items-center gap-2 flex-wrap">
                                {i === 0 && <span className="badge bg-success">Newest</span>}
                                <span>{new Date(v.date).toLocaleString()}</span>
                                <span className="text-muted small">· {(v.lines || []).length} line{(v.lines || []).length === 1 ? '' : 's'}</span>
                                {v.serviceReportUrl && <span className="badge bg-info" title="Service report attached"><FileText size={11} /></span>}
                              </span>
                              <span className="btn-group">
                                <button className="btn btn-sm btn-outline-primary" onClick={() => { setShowDuplicates(false); loadVisit(v.id); }}>Open</button>
                                <button className="btn btn-sm btn-outline-danger" onClick={() => deleteVisit(v.id)}><Trash2 size={14} /></button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowDuplicates(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBackfill && (
        <BackfillSrModal
          visits={allVisits}
          customers={customers}
          onClose={() => setShowBackfill(false)}
          onSave={saveServiceReportNumbers}
        />
      )}

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
                      // Two different questions were being answered by one number.
                      //
                      // "Repaired" counted a head with an OPEN issue as repaired,
                      // because it was running again. The customer's own viewer
                      // has always counted strictly-fixed, so the same line read
                      // "3 repaired" here and "1 repaired" on the portal the
                      // customer was sent — with this side the flattering one.
                      //
                      // Back in service is the right test for how many heads are
                      // running; it is the wrong word for repaired.
                      const isRepaired = (h) => {
                        const issues = h.issues || [];
                        if (issues.length > 0) return issues.every(iss => iss.fixed === 'fixed');
                        return h.fixed === 'fixed';
                      };
                      const isBackInService = (h) => {
                        const issues = h.issues || [];
                        if (issues.length > 0) {
                          return issues.every(iss => iss.fixed === 'fixed' || iss.fixed === 'active_with_issues');
                        }
                        return h.fixed === 'fixed' || h.fixed === 'active_with_issues';
                      };
                      const repairedCount = offlineHeads.filter(isRepaired).length;
                      const runningCount = line.heads.length - offlineCount + offlineHeads.filter(isBackInService).length;
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
                          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                            <span style={{ fontWeight: 'bold', color: 'white', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>{line.title}</span>
                            {(() => {
                              const c = appLineCrew.forLine(line.title);
                              const who = [c.operator, c.tech].filter(Boolean).join(' · ');
                              if (!who) return null;
                              // Names shown with full confidence on a board that
                              // was crewed two days ago is exactly the quiet
                              // wrongness this feature is meant to avoid.
                              const age = crewAge(appLineCrew.updatedAt);
                              return (
                                <span style={{ fontSize: '0.75em', color: 'rgba(255,255,255,0.9)' }}>
                                  {who}{age.stale ? ` ⚠ ${age.label}` : ''}
                                </span>
                              );
                            })()}
                          </span>
                          <span>
                            {repairedCount > 0 && (
                              <span className="badge bg-warning text-dark me-1">{repairedCount} repaired</span>
                            )}
                            {offlineCount > 0 ? (
                              <span className="badge bg-dark text-white">{runningCount}/{line.heads.length}</span>
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
      <SetupLinesModal
        isOpen={showSetupLines}
        lines={lines}
        defaultHeadCount={DEFAULT_HEAD_COUNT}
        onClose={() => setShowSetupLines(false)}
        onSave={(next) => {
          if (!currentVisitId) {
            // Lines live on a visit. Accepting them with none open put them in
            // state with nothing to save them into, so they looked added and
            // were gone by the next render.
            toast.error('Open or start a visit first — lines are saved with the visit.');
            return;
          }
          setLines(next);
          if (!next.some((l) => l.id === activeLineId)) setActiveLineId(next[0]?.id ?? null);
          toast.success('Lines updated');
        }}
      />

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