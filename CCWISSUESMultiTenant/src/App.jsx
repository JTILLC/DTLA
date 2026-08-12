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
import { Save, CloudUpload, CloudDownload, Copy, RefreshCw, Trash2, Edit3, Plus, Download, Upload, FileText, History, Settings, Eye, HelpCircle, Factory, List, Share2, Hash, Lock, User } from 'lucide-react';
import ShareModal from '@shared/components/ShareModal.jsx';
import ServiceReportUpload from '@shared/components/ServiceReportUpload.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import { ToastProvider, AlertShim, useToast } from '@shared/components/Toast.jsx';
import VisitsSidebar from './components/VisitsSidebar.jsx';
import BackfillSrModal from '@shared/components/BackfillSrModal.jsx';

// Shared utilities and constants
import { FIREBASE_CONFIG, DEFAULT_HEAD_COUNT, PDF_CONFIG, FIXED_STATUS, AUDIT_SECTIONS, WORKSPACE_UID } from './config/constants';
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
import OpenLogCard from '@shared/components/OpenLogCard.jsx';
import PinSession from '@shared/components/PinSession.jsx';
import SetupLinesModal from '@shared/components/SetupLinesModal.jsx';
import UpdateBanner from '@shared/components/UpdateBanner.jsx';
import { screenGate, tierOf, TIER, TIER_LABEL } from '@shared/utils/screenAccess.js';
import { mergeLinesArrays } from '@shared/utils/mergeLines.js';
import { shouldAdoptMerge } from '@shared/utils/mergeApply.js';
import PrestartPage from '@shared/components/PrestartPage.jsx';
import ImportLinesDialog from '@shared/components/ImportLinesDialog.jsx';
import { withFreshIds } from '@shared/utils/importLines.js';
import BoardReplacementPage from '@shared/components/BoardReplacementPage.jsx';
import PmLogPage from '@shared/components/PmLogPage.jsx';
import CrewPage from '@shared/components/CrewPage.jsx';
import IssueHistory from '@shared/components/IssueHistory.jsx';
import ActivityPage from '@shared/components/ActivityPage.jsx';
import { useLineCrew, crewAge } from '@shared/utils/useLineCrew.js';
import { startPhotoSync, replacePendingPhoto } from '@shared/utils/photoSync.js';
import { usingBroker, fetchAuthedDataUrl, MEDIA_BROKER_BASE } from '@shared/config/media.js';
import { lineStatusKey } from '@shared/utils/headHelpers.js';
import photoQueue from '@shared/utils/photoQueue.js';
import PlantLoginsPage from '@shared/components/PlantLoginsPage.jsx';
import AdminLoginsPanel from '@shared/components/AdminLoginsPanel.jsx';
import PinPrompt from '@shared/components/PinPrompt.jsx';
import { hasPin } from '@shared/utils/pin.js';
import { useVerifiedPerson } from '@shared/utils/useVerifiedPerson.js';
import { subscribeCrew } from '@shared/services/logs.js';
import { isSiteLead } from '@shared/utils/roles.js';
import { chooseOpeningLog, logLabel, daysOld } from '@shared/utils/todaysLog.js';
import AppNav, { navGroups } from '@shared/components/AppNav.jsx';
import OverviewPage from '@shared/components/OverviewPage.jsx';

// The plant's own daily logs.
//
// Deliberately NOT `visits`: that collection is JTI's record of a service call,
// and the database rules now allow only JTI to write it. The two used to share
// one collection, so a customer login could edit or delete a JTI visit — and,
// with no author field on the document, no rule could tell them apart.
// Separate collections make the boundary something the database enforces
// rather than something the UI politely observes.
const DAILY_LOGS = 'dailyLogs';

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

// Salted SHA-256 hex, used for the per-customer supervisor password. Not
// high-security (client-side, no server), but a solid deterrent against casual
// changes by operators — the stored value is a hash, not the password.

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

// Best-effort recursive delete of a Storage folder (compat SDK listAll only
// returns one level, so recurse into child prefixes).
async function wipeStorageFolder(ref) {
  try {
    const res = await ref.listAll();
    await Promise.all(res.items.map((i) => i.delete().catch(() => {})));
    await Promise.all(res.prefixes.map((p) => wipeStorageFolder(p)));
  } catch {
    /* folder may not exist — ignore */
  }
}

// Firestore doesn't cascade-delete subcollections and Storage objects aren't
// touched when a visit doc is removed. When a visit is PERMANENTLY deleted,
// clean up its photos, service report, and lineResets so they don't orphan.
async function deleteVisitAssets(uid, custId, visitId) {
  const st = firebase.storage().ref();
  await wipeStorageFolder(st.child(`issue-photos/${uid}/${custId}/${visitId}`));
  await st.child(`service-reports/${uid}/${custId}/${visitId}.pdf`).delete().catch(() => {});
  try {
    const snap = await firebase
      .firestore()
      .collection('user_files').doc(uid)
      .collection('customers').doc(custId)
      .collection(DAILY_LOGS).doc(visitId)
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
    const loaded = await Promise.all(keys.map(k => loadPhotoForPdf(byKey.get(k))));
    keys.forEach((k, i) => { if (loaded[i]) photoMap.set(k, loaded[i]); });
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
      const dispH = Math.min(maxH, boxW * (im.h / im.w));
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
  const [showDashboardView, setShowDashboardView] = useState(false);
  const [activeLineId, setActiveLineId] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Multi-tenant role for the signed-in user, from app_roles/{uid}:
  //   { admin: true }        → sees/edits every customer (the owner/master view)
  //   { customerId: '<cid>'} → scoped to one customer
  //   null while loading; { admin:false, customerId:null } if no role doc (no access)
  const [role, setRole] = useState(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  // Whether the role LOOKUP failed, as opposed to coming back empty. Those are
  // different problems with different fixes and they were rendering the same
  // screen: "you have no access yet" is a setup task, "we couldn't read your
  // access" is a rules or network fault, and telling someone the first when it
  // is the second sends them to the wrong person.
  const [roleError, setRoleError] = useState('');
  const isAdmin = !!role?.admin;
  const scopedCustomerId = !isAdmin ? (role?.customerId || null) : null;

  // Cloud autosave status for the currently-loaded visit
  const [cloudState, setCloudState] = useState('idle'); // idle | saving | saved | error
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [checkingCloud, setCheckingCloud] = useState(false); // "Check cloud" button in-flight
  const savedSnapshotRef = useRef(null);  // serialized content of the last cloud save (baseline)
  const autosaveTimerRef = useRef(null);

  // Dialog system for proper modals instead of window.prompt/alert
  const dialog = useDialog();
  const [showAddLineDialog, setShowAddLineDialog] = useState(false);
  // Building and ordering lines. Gated like any other change to the record:
  // an admin passes straight through, a plant is asked once on the way in
  // rather than on every tap inside.
  const [showSetupLines, setShowSetupLines] = useState(false);
  // Rebuild this plant's lines from its own previous logs, in one press.
  // Same gate as building them by hand — it is the same decision, and the
  // shortcut must not be the way round the gate.
  const adoptHistoryLines = async (built) => {
    if (!currentVisitId) {
      toast.error('Open today\'s log first — lines are saved with the log.');
      return;
    }
    if (!built?.length) return;
    if (!(await requireSiteLeadAuth('add this plant\'s lines to the log'))) return;
    setLines(built);
    setActiveLineId(built[0]?.id ?? null);
    setActiveTab('current');
    toast.success(`${built.length} line${built.length === 1 ? '' : 's'} added`);
  };

  // End of shift: the machines go to sanitation.
  //
  // This is the real boundary in a plant's day. Sanitation strips, washes and
  // rebuilds them, so nothing checked before it still describes what is on the
  // floor — which is what makes the next shift's pre-start walk compulsory
  // rather than a reminder they can wave off. Recording the moment is what
  // enforces it; there is no separate switch to forget to set.
  const endShiftForSanitation = async () => {
    if (!currentVisitId || !currentCustomer) return;
    const openIssues = lines.reduce(
      (n, l) => n + (l.heads || []).filter((h) => h.status === 'offline' || (h.issues || []).length).length, 0);

    const ok = await dialog.confirm(
      `Hand ${currentCustomer.name} over to sanitation and close this shift?\n\n`
      + (openIssues
        ? `${openIssues} head${openIssues === 1 ? '' : 's'} still logged — carry them over when the next shift starts and they stay on the record.\n\n`
        : '')
      + 'Every line will need its pre-start walk again before it runs, because sanitation will have had the machines.',
      { title: 'End shift', confirmText: 'End shift' },
    );
    if (!ok) return;

    // Attributed like anything else that changes the record — "who closed the
    // shift" is exactly the sort of thing asked about the morning after.
    const who = verifiedPerson?.name || (isAdmin ? 'JTI' : 'Plant staff');
    try {
      await firebase
        .firestore()
        .collection('user_files').doc(WORKSPACE_UID)
        .collection('customers').doc(currentCustomer.id)
        .collection(DAILY_LOGS).doc(currentVisitId)
        .set({ shiftEndedAt: new Date().toISOString(), shiftEndedBy: who }, { merge: true });
      toast.success('Shift ended — pre-start is required again before these lines run');
    } catch (err) {
      console.error('Could not end the shift:', err);
      toast.error('Could not end the shift: ' + err.message);
    }
  };

  // The way back.
  //
  // A shift gets ended early, or sanitation is held up and the line keeps
  // running. Without this the only options are to re-walk every line for no
  // reason or to work around the app, and the second one is how a plant stops
  // trusting it.
  //
  // Ending a shift asks for MORE checking, which is the safe direction and
  // costs nothing if it was a mistake. Continuing removes a check that is
  // currently required, so it takes a supervisor or Site Lead PIN and it is
  // written down — the reopening stays on the record even though the boundary
  // it cancels does not.
  const continueShift = async () => {
    if (!currentVisitId || !currentCustomer) return;
    if (!(await requireDestructiveAuth('continue this shift'))) return;
    const who = verifiedPerson?.name || (isAdmin ? 'JTI' : 'Plant staff');
    try {
      await firebase
        .firestore()
        .collection('user_files').doc(WORKSPACE_UID)
        .collection('customers').doc(currentCustomer.id)
        .collection(DAILY_LOGS).doc(currentVisitId)
        .set({
          shiftEndedAt: null,
          shiftEndedBy: null,
          shiftReopenedAt: new Date().toISOString(),
          shiftReopenedBy: who,
        }, { merge: true });
      toast.success('Shift continued — earlier pre-start checks count again');
    } catch (err) {
      console.error('Could not continue the shift:', err);
      toast.error('Could not continue the shift: ' + err.message);
    }
  };

  const openSetupLines = async () => {
    // Adding or reordering lines describes the plant itself and everything
    // filed against it afterwards, so it takes the plant's own top role rather
    // than any supervisor.
    if (!(await requireSiteLeadAuth('set up this plant\'s lines'))) return;
    setShowSetupLines(true);
  };

  // Daily-log creation: pick date (default today) + shift.
  const SHIFT_OPTIONS = ['1st Shift', '2nd Shift', '3rd Shift'];
  const todayYMD = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [showNewLogModal, setShowNewLogModal] = useState(false);
  const [newLogDate, setNewLogDate] = useState(todayYMD());
  const [newLogShift, setNewLogShift] = useState(SHIFT_OPTIONS[0]);
  const [newLogCarry, setNewLogCarry] = useState(true);

  // Recover-a-reset-line bin (kept 7 days), scoped to the loaded log.
  const [resetBackups, setResetBackups] = useState([]);
  const [showRecoverModal, setShowRecoverModal] = useState(false);

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
  const appLineCrew = useLineCrew(WORKSPACE_UID, currentCustomer?.id);
  const [visits, setVisits] = useState([]);
  // Visits across ALL customers — used only by Issue History (which lets you pick
  // any customer). Kept separate from `visits` (the current customer's live list)
  // so the cross-customer load can't clobber the toolbar count / visits picker.
  const [allVisits, setAllVisits] = useState([]);
  const [showVisitList, setShowVisitList] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', address: '', cityState: '', headCount: '14' });
  // Admin-only: link a Firebase Auth account (UID) to a plant so that login is
  // scoped to it. Writes app_roles/{uid} = { customerId } (or { admin:true }).
  const [showLinkLogin, setShowLinkLogin] = useState(false);
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

  const currentLog = useMemo(
    () => (currentVisitId ? visits.find((v) => v.id === currentVisitId) || null : null),
    [visits, currentVisitId],
  );
  const shiftEndedAt = currentLog?.shiftEndedAt || null;

  // The customer whose log list has actually arrived from the subscription.
  // Distinguishes "no logs" from "not loaded yet" for the Current Log decision.
  const [visitsLoadedFor, setVisitsLoadedFor] = useState(null);
  // JTI's own service visits for this customer, from the `visits` collection.
  // A plant may READ these (the rules already allow it) and never write them —
  // that boundary is enforced by the database, not by this screen.
  const [jtiVisits, setJtiVisits] = useState([]);
  // The JTI visit being looked at, if any. Kept apart from currentVisitId so
  // that nothing which writes can ever be pointed at one.
  const [viewingJtiId, setViewingJtiId] = useState(null);
  const [showImportLines, setShowImportLines] = useState(false);
  const [serviceReportUrl, setServiceReportUrl] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [deepLinkProcessed, setDeepLinkProcessed] = useState(false);
  const [showLinesModal, setShowLinesModal] = useState(false);
  // Opens on the overview: the old landing screen was an empty log-name box,
  // which is the one screen in the app that knows nothing.
  const [activeTab, setActiveTab] = useState('overview');
  const [showShareModal, setShowShareModal] = useState(false);
  const fileInputRef = useRef(null);

  // Handler for adding a new line via dialog
  const handleAddLine = (lineName, headCount) => {
    createLine(lineName, headCount, setLines, setActiveLineId, lines);
  };

  // Keep an isAdmin ref so the (memoized) destructive-action gate never goes stale.
  const isAdminRef = useRef(isAdmin);
  useEffect(() => { isAdminRef.current = isAdmin; }, [isAdmin]);

  // Is the person currently proven at this tablet a Site Lead? Set from an
  // effect below, once the roster and the PIN session are both in scope.
  const activeSiteLeadRef = useRef(null);

  // Backstop: never autosave a JTI service visit opened by a customer (view-only).
  // Looking at one of JTI's visits is view-only for EVERYONE here, JTI included:
  // this app writes dailyLogs, and a visit lives in another collection that the
  // plant's rules refuse in writing. An editor that appeared to accept changes
  // and then dropped them would be worse than one that says it is read-only.
  //
  // That — a JTI visit, reached through viewingJtiId — is the ONLY read-only
  // case. There used to be a second one: a dailyLog with no `shift` on it was
  // taken for "one of JTI's records in the same collection" and refused. It is
  // not. JTI's visits live in the `visits` collection, and the security rules
  // let a plant write every collection under its own customer except that one,
  // shift or no shift. So the check refused writes the database would have
  // accepted — and because only the autosave believed it, the screen stayed
  // editable and dropped every save in silence. That is the bug behind "I add
  // lines and they don't save": an older log with no shift field was a
  // permanent, invisible dead end.
  const readOnlyRef = useRef(false);
  useEffect(() => {
    readOnlyRef.current = !!viewingJtiId;
  }, [viewingJtiId]);

  // The crew roster, so a destructive action can be authorised by a named
  // person rather than by a secret the whole plant shares.
  // How old the open log is, in whole days. Drives the badge beside Log Name so
  // an operator can see at a glance that they are typing into an earlier day.
  const openLogAge = useMemo(() => {
    const lv = currentVisitId ? visits.find(v => v.id === currentVisitId) : null;
    return lv ? daysOld(lv) : null;
  }, [visits, currentVisitId]);

  // What the Issue History tab reads.
  //
  // It used to read `allVisits`, which is filled only by the manual "load all
  // from cloud" and only from dailyLogs — so for a plant it was empty, and for
  // JTI it never contained a service visit. The question the tab answers ("has
  // this head done this before?") does not care which of the two recorded it,
  // and for a site JTI has serviced for years the answer is mostly in the
  // visits.
  //
  // Both sources are already subscribed, so this costs nothing to assemble.
  // allVisits still contributes JTI's other customers when they have loaded it.
  const historyVisits = useMemo(() => {
    const cid = currentCustomer?.id;
    const mine = cid ? visits.map((v) => ({ ...v, customerId: v.customerId || cid, source: 'log' })) : [];
    const jti = cid ? jtiVisits.map((v) => ({ ...v, customerId: cid, source: 'jti' })) : [];
    const key = (v) => `${v.customerId}/${v.id}`;
    const seen = new Set([...mine, ...jti].map(key));
    const others = (allVisits || [])
      .filter((v) => !seen.has(key(v)))
      .map((v) => ({ ...v, source: v.source || 'log' }));
    return [...mine, ...jti, ...others]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [visits, jtiVisits, allVisits, currentCustomer?.id]);

  // Heads down right now, badged on Current Log. Zero shows nothing.
  const navCounts = useMemo(() => {
    const offline = (lines || []).reduce(
      (n, line) => n + (line.heads || []).filter((h) => h.status === 'offline').length, 0);
    return { current: offline };
  }, [lines]);

  const [crewPeople, setCrewPeople] = useState([]);
  const crewPeopleRef = useRef([]);
  useEffect(() => { crewPeopleRef.current = crewPeople; }, [crewPeople]);
  useEffect(() => {
    // `session`, not `user`: `const user = session` is declared far below, so
    // naming it here is a temporal dead zone crash on every render.
    const cid = currentCustomer?.id;
    if (!session || !cid) { setCrewPeople([]); return undefined; }
    return subscribeCrew(WORKSPACE_UID, cid, setCrewPeople);
  }, [session, currentCustomer?.id]);

  // A pending authorisation: { actionLabel, resolve }. Held here so the gate can
  // keep its async shape and every call site stays `if (!(await …)) return;`.
  const [pinGate, setPinGate] = useState(null);
  const canAuthorise = (p) => ((p.roles || []).includes('supervisor') || isSiteLead(p)) && p.pinHash;

  // Adding, removing or deleting takes a SUPERVISOR or SITE LEAD PIN.
  //
  // This replaced a single password shared by the whole plant. A shared secret
  // cannot say who used it, spreads by being told to people, and read exactly
  // like the account password it sat next to — three problems a per-person PIN
  // does not have, using the roster the plant already keeps.
  //
  // Asked every time. Proving who you are earlier in the shift is not the same
  // as authorising this, and permission must not accumulate on a shared tablet.
  const requireDestructiveAuth = useCallback(async (actionLabel = 'make this change') => {
    if (isAdminRef.current) return true;
    // A Site Lead who keyed their PIN a moment ago is not asked again.
    //
    // The gate used to ask every time, on the reasoning that identifying
    // yourself is not the same as authorising this. That is right for a
    // supervisor stepping in to approve somebody else's action — and wrong for
    // the Site Lead setting the plant up, who was being asked to key a PIN for
    // every line they added. The session is the proof, it is five minutes of
    // inactivity long, and the header says whose it is the whole time.
    if (activeSiteLeadRef.current) { touchVerified(); return true; }
    const eligible = crewPeopleRef.current.filter(canAuthorise);
    if (!eligible.length) {
      toast.error(
        'Adding, removing and deleting need a supervisor or Site Lead with a PIN. '
        + 'Set one on the Crew tab, or ask JTI to.'
      );
      return false;
    }
    return new Promise((resolve) => setPinGate({ actionLabel, resolve }));
  }, [toast]);


  // Stable callbacks for <Line> so React.memo can skip untouched lines.
  // linesRef lets handlers read the latest lines without re-creating on every state change.
  const linesRef = useRef(lines);
  useEffect(() => { linesRef.current = lines; }, [lines]);
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

  // Who the PIN session says is at this tablet. The stored record is only
  // { id, name }, so the roster is what turns it into a role.
  const { person: verifiedPerson, remember: rememberVerified, touch: touchVerified } = useVerifiedPerson(currentCustomer?.id);

  // A Site Lead PIN specifically. Building or reordering lines describes the
  // plant itself and everything filed against it afterwards, so it is not a
  // thing any supervisor should be able to wave through.
  const requireSiteLeadAuth = useCallback(async (actionLabel = 'make this change') => {
    if (isAdminRef.current) return true;
    if (activeSiteLeadRef.current) { touchVerified(); return true; }
    const leads = crewPeopleRef.current.filter((p) => isSiteLead(p) && p.pinHash);
    if (!leads.length) {
      toast.error('Building lines needs a Site Lead PIN. Set one on the Crew tab, or ask JTI to.');
      return false;
    }
    return new Promise((resolve) => setPinGate({ actionLabel, resolve, siteLeadOnly: true }));
  }, [toast]);

  // Which screens this tablet may open, by the PIN currently active.
  //
  // Nothing is hidden. A tab above the active person's level asks for a PIN
  // rather than disappearing, so an operator who needs Parts/Boards hands the
  // tablet to maintenance instead of concluding the app cannot do it.
  //
  // JTI is exempt: a JTI account is not plant crew, and its limits live in the
  // security rules rather than here.
  const [screenGateReq, setScreenGateReq] = useState(null);
  const activeCrewPerson = useMemo(
    () => (verifiedPerson?.id ? crewPeople.find((p) => p.id === verifiedPerson.id) || null : null),
    [verifiedPerson?.id, crewPeople],
  );

  useEffect(() => {
    activeSiteLeadRef.current = activeCrewPerson ? isSiteLead(activeCrewPerson) : null;
  }, [activeCrewPerson]);

  const requestTab = useCallback((tab) => {
    if (isAdmin) { setActiveTab(tab); return; }
    const gate = screenGate(tab, activeCrewPerson, crewPeople, hasPin);
    if (gate.action !== 'ask') { setActiveTab(tab); return; }
    setScreenGateReq({ tab, need: gate.need, label: gate.label });
  }, [isAdmin, activeCrewPerson, crewPeople]);

  const handleRemoveLine = useCallback(async (id) => {
    if (!(await requireDestructiveAuth('remove this line'))) return;
    const lineTitle = linesRef.current.find(l => l.id === id)?.title;
    const confirmed = await dialog.confirm(
      `Are you sure you want to remove "${lineTitle || 'this line'}"?`,
      { title: 'Remove Line', variant: 'danger', confirmText: 'Remove' }
    );
    if (!confirmed) return;

    // Keep the line before it goes. Resetting one was already backed up here;
    // REMOVING one was not, which made remove the only action in the app that
    // could lose a shift's readings with no way back. Written to the same bin
    // the recovery panel already reads, so it restores through the path that
    // already exists rather than a second one.
    const snapshot = linesRef.current.find(l => l.id === id);
    const custId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (snapshot && custId && visitId) {
      try {
        await firebase.firestore()
          .collection('user_files').doc(WORKSPACE_UID)
          .collection('customers').doc(custId)
          .collection(DAILY_LOGS).doc(visitId)
          .collection('lineResets').add({
            lineId: id,
            title: snapshot.title || 'Line',
            line: snapshot,
            // The bin sorts and expires on resetAt, so removals carry it too
            // rather than needing the panel taught a second field.
            resetAt: new Date().toISOString(),
            kind: 'removed',
          });
      } catch (e) {
        // No copy, no delete. Losing a line quietly is the one outcome worth
        // refusing outright.
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
    toast.success(`"${lineTitle || 'Line'}" removed — recoverable for 30 days`);
  }, [dialog, requireDestructiveAuth, toast]);

  // One snapshot mechanism for both ways a line can lose data: resetting it,
  // and cutting its head count down. Shared so a line removed by either route
  // turns up in the same Recover panel, rather than one of them quietly having
  // no way back.
  const backupLine = useCallback(async (snapshot) => {
    const custId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (!custId || !visitId || !snapshot) return;
    await firebase.firestore()
      .collection('user_files').doc(WORKSPACE_UID)
      .collection('customers').doc(custId)
      .collection(DAILY_LOGS).doc(visitId)
      .collection('lineResets').add({
        lineId: snapshot.id,
        title: snapshot.title || 'Line',
        line: snapshot,
        resetAt: new Date().toISOString(),
      });
  }, []);

  const handleResetLine = useCallback(async (line) => {
    // Reset is not gated — customers may clear a line freely.
    const confirmed = await dialog.confirm(
      `Reset "${line.title}" to default? All data for this line will be cleared. You'll be able to recover it for 7 days.`,
      { title: 'Reset Line', variant: 'warning', confirmText: 'Reset' }
    );
    if (!confirmed) return;
    // Snapshot the line BEFORE clearing so an accidental reset can be undone.
    const snapshot = linesRef.current.find(l => l.id === line.id) || line;
    const custId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (custId && visitId) {
      try {
        await firebase.firestore()
          .collection('user_files').doc(WORKSPACE_UID)
          .collection('customers').doc(custId)
          .collection(DAILY_LOGS).doc(visitId)
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
        setCloudState('saved');
        setLastSavedAt(data.date ? new Date(data.date) : new Date());

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
          .doc(WORKSPACE_UID)
          .collection('customers')
          .doc(customerId)
          .collection(DAILY_LOGS)
          .doc(visitId);

        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = docSnap.data();

          // Get customer profile
          const custDoc = await firebase
            .firestore()
            .collection('user_files')
            .doc(WORKSPACE_UID)
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
        .doc(WORKSPACE_UID)
        .collection('customers')
        .get();

      for (const custDoc of customerSnap.docs) {
        const visitDoc = await firebase
          .firestore()
          .collection('user_files')
          .doc(WORKSPACE_UID)
          .collection('customers')
          .doc(custDoc.id)
          .collection(DAILY_LOGS)
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
    if (!user || !currentCustomer) return toast.error('Select a customer first');
    // Resolve against the customerId tagged on the visit in the subscription list
    // (visit.customerId is stamped in the onSnapshot mapper). Falls back to the
    // currently-selected customer. This protects against race conditions where
    // the user clicks a visit from one customer while we're switching to another.
    const visitFromList = (visits || []).find(v => v.id === visitId);
    const effectiveCustomerId = visitFromList?.customerId || currentCustomer.id;
    const path = `user_files/${WORKSPACE_UID}/customers/${effectiveCustomerId}/visits/${visitId}`;
    console.log('[loadVisit] fetching', path);
    try {
      const doc = await firebase
        .firestore()
        .collection('user_files')
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(effectiveCustomerId)
        .collection(DAILY_LOGS)
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
        setCloudState('saved');
        setLastSavedAt(data.date ? new Date(data.date) : new Date());
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
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(custId)
        .collection(DAILY_LOGS)
        .get();
      
      const batch = firebase.firestore().batch();
      visitSnap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      await firebase
        .firestore()
        .collection('user_files')
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(custId)
        .delete();

      // Best-effort cleanup of the customer's Storage folders + secret doc so
      // photos/reports and the supervisor-password hash don't orphan.
      const st = firebase.storage().ref();
      await wipeStorageFolder(st.child(`issue-photos/${WORKSPACE_UID}/${custId}`));
      await wipeStorageFolder(st.child(`service-reports/${WORKSPACE_UID}/${custId}`));
      // The shared supervisor password is gone (replaced by supervisor PINs),
      // but old documents may still exist for customers set up before that.
      // Deleting a customer should not leave one behind.
      await firebase.firestore().collection('customer_secrets').doc(custId).delete().catch(() => {});

      localStorage.removeItem(`ishida_${custId}`);
      toast.success('Customer and all visits deleted from cloud');
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete customer');
    }
  };

  const deleteVisitFromCloud = async (custId, visitId) => {
    if (!(await requireDestructiveAuth('delete this visit'))) return;
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
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(custId)
        .collection(DAILY_LOGS)
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
      .doc(WORKSPACE_UID)
      .collection('customers')
      .doc(custId)
      .collection(DAILY_LOGS)
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
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(custId)
        .collection(DAILY_LOGS)
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
    if (!(await requireDestructiveAuth('permanently delete this visit'))) return;
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
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(custId)
        .collection(DAILY_LOGS)
        .doc(visitId)
        .delete();
      await deleteVisitAssets(WORKSPACE_UID, custId, visitId); // best-effort orphan cleanup
      await loadDeletedVisits(custId);
    } catch (err) {
      toast.error('Failed to permanently delete visit');
    }
  };

  const updateVisitTimestamp = async () => {
    if (!visitToEdit) return;
    if (!isAdmin && !visitToEdit.shift) {
      toast.error('This is a JTI service visit — view only. Contact JTI to change it.');
      setVisitToEdit(null);
      return;
    }
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection(DAILY_LOGS)
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
    if (readOnlyRef.current) return; // view-only JTI visit — never persist edits
    const uid = user ? WORKSPACE_UID : null;
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
      .collection(DAILY_LOGS).doc(visitId);

    try {
      // Transaction + 3-way merge so a concurrent editor (e.g. JTI on production
      // and the customer here, on the same visit) doesn't get silently clobbered:
      // each side's changed lines win for those lines; every other line keeps the
      // cloud value. We intentionally do NOT write `date`/`shift`/`serviceReportUrl`
      // — update() leaves those (and serviceReportUploadedAt/deleted) untouched.
      let merged, mergedGlobal, mergedName;
      await firebase.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('visit-missing'); // deleted concurrently — don't recreate
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
      setCloudState('saved');
      setLastSavedAt(new Date());
    } catch (err) {
      console.error('Autosave failed:', err);
      setCloudState('error');
    }
  };

  // On-demand check: fetch the current visit fresh from the cloud and tell the
  // user whether what's loaded matches. Complements the automatic sync — it's a
  // manual "am I looking at the right data?" confirmation.
  const verifyAgainstCloud = async () => {
    const uid = user ? WORKSPACE_UID : null;
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
        .collection(DAILY_LOGS)
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
            .doc(WORKSPACE_UID)
            .collection('customers')
            .doc(u.customerId)
            .collection(DAILY_LOGS)
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
          .doc(WORKSPACE_UID)
          .collection('customers')
          .doc(currentCustomer.id)
          .collection(DAILY_LOGS)
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
          .doc(WORKSPACE_UID)
          .collection('customers')
          .doc(currentCustomer.id)
          .collection(DAILY_LOGS)
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
    // Preserve the source's shift so a customer's copy stays an editable log
    // (a shift-less visit reads as a read-only "JTI Visit"). Give customer copies
    // a default shift if the source had none, so they're never locked out.
    const srcShift = (visits.find(v => v.id === currentVisitId) || {}).shift;
    const copyShift = srcShift || (isAdmin ? null : SHIFT_OPTIONS[0]);
    const payload = {
      date: new Date().toISOString(),
      name: `${currentVisitName} (Copy)`,
      ...(copyShift ? { shift: copyShift } : {}),
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
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection(DAILY_LOGS)
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
    const cleanLines = (src.lines || []).map((line) => ({
      ...line,
      notes: '',
      audit: {},
      auditNotes: '',
      avgWeight100: '',   // measured this-visit result
      stdDev100: '',      // measured this-visit result
      signerName: '',     // calibration cert is signed per visit
      calDate: '',
      calDueDate: '',
      heads: (line.heads || []).map((head, i) => ({
        id: head.id || i + 1,
        status: 'active',
        error: 'None',
        fixed: 'na',
        notes: '',
        issues: [],
        currentWeight: 0,
        spanWeight: 0,
        weightDifference: 0,
      })),
    }));

    const newId = `visit_${Date.now()}`;
    const today = new Date();
    // Keep a shift so a customer's new log is editable (shift-less = read-only JTI visit).
    const copyShift = src.shift || (isAdmin ? null : SHIFT_OPTIONS[0]);
    const payload = {
      date: today.toISOString(),
      name: `${src.name || 'Visit'} — ${today.toLocaleDateString()}`,
      ...(copyShift ? { shift: copyShift } : {}),
      globalData: src.globalData || {},
      lines: cleanLines,
    };

    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(src.customerId || currentCustomer.id)
        .collection(DAILY_LOGS)
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

  // Start a fresh, blank visit for the current customer. Creates the cloud doc
  // immediately and baselines autosave, so there's no "unsaved" window. (To start
  // from a prior visit's setup, use the Copy icon on that visit instead.)
  // Carry a prior shift's lines forward as a fresh continuation: keep line setup
  // + head status + issues (the open problems), but drop this-shift-only data —
  // photos and RedZone work-order links — so the new shift owns its own.
  const carryLinesForward = (lines) => (lines || []).map(l => ({
    ...JSON.parse(JSON.stringify(l)),
    heads: (l.heads || []).map(h => {
      const { redzoneWorkOrderId, redzoneWorkOrderUrl, redzoneSyncedAt, redzoneStatus, ...rest } = h;
      return {
        ...rest,
        photos: [],  // don't carry head-level photos (each shift owns its own; avoids shared-Storage deletion)
        issues: (h.issues || []).map(iss => ({ ...iss, photos: [] })),
      };
    }),
  }));

  const startNewVisit = async (dateISO, shift, carrySource) => {
    if (!user || !currentCustomer) return toast.error('Select a customer first');
    const iso = dateISO || new Date().toISOString();
    const shiftLabel = shift || '';
    const newId = `visit_${Date.now()}`;
    const blankGlobal = {
      customer: currentCustomer.name,
      address: currentCustomer.address || '',
      cityState: currentCustomer.cityState || '',
      headCount: (currentCustomer.headCount || '14').toString(),
    };
    const carriedLines = carrySource?.lines ? carryLinesForward(carrySource.lines) : [];
    // Auto-name the log by its date + shift (still renamable later).
    const autoName = `${new Date(iso).toLocaleDateString()}${shiftLabel ? ` — ${shiftLabel}` : ''}`;
    const payload = { date: iso, shift: shiftLabel, name: autoName, globalData: blankGlobal, lines: carriedLines };
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection(DAILY_LOGS)
        .doc(newId)
        .set(payload);
      setGlobalData(blankGlobal);
      setLines(carriedLines);
      setActiveLineId(carriedLines[0]?.id ?? null);
      setCurrentVisitName(autoName);
      setCurrentVisitId(newId);
      setServiceReportUrl(null);
      setShowDashboardView(false);
      savedSnapshotRef.current = serializeVisitContent(carriedLines, blankGlobal, autoName, null);
      setCloudState('saved');
      setLastSavedAt(new Date());
      await loadVisits(currentCustomer.id);
      toast.success(carrySource
        ? 'New shift started with last shift’s open issues carried over.'
        : 'New daily log started — add lines and it saves automatically.');
    } catch (e) {
      console.error('Start new log error:', e);
      toast.error('Failed to start new daily log');
    }
  };

  // Live list of recoverable reset-line snapshots for the loaded log (last 7 days).
  useEffect(() => {
    const custId = currentCustomer?.id;
    const visitId = currentVisitId;
    if (!user || !custId || !visitId) { setResetBackups([]); return; }
    // 30 days. A line removed by mistake is often not noticed until the next
    // visit, which is weeks away — a week was short enough that the safety net
    // expired before anyone looked for it.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const unsub = firebase.firestore()
      .collection('user_files').doc(WORKSPACE_UID)
      .collection('customers').doc(custId)
      .collection(DAILY_LOGS).doc(visitId)
      .collection('lineResets')
      .onSnapshot((snap) => {
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(b => b.resetAt && new Date(b.resetAt).getTime() >= cutoff)
          .sort((a, b) => new Date(b.resetAt) - new Date(a.resetAt));
        setResetBackups(list);
      }, (err) => console.error('lineResets subscription error:', err));
    return () => unsub();
  }, [user, currentCustomer?.id, currentVisitId]);

  const deleteResetBackup = async (backupId) => {
    const custId = currentCustomerRef.current?.id;
    const visitId = currentVisitIdRef.current;
    if (!custId || !visitId) return;
    try {
      await firebase.firestore()
        .collection('user_files').doc(WORKSPACE_UID)
        .collection('customers').doc(custId)
        .collection(DAILY_LOGS).doc(visitId)
        .collection('lineResets').doc(backupId).delete();
    } catch (e) { console.error('Could not remove reset backup:', e); }
  };

  const restoreLineBackup = async (backup) => {
    // Put the line data back (replace the matching line, or re-add if it's gone).
    setLines(prev => {
      const exists = prev.some(l => l.id === backup.lineId);
      return exists
        ? prev.map(l => (l.id === backup.lineId ? backup.line : l))
        : [...prev, backup.line];
    });
    setActiveLineId(backup.lineId);
    setShowDashboardView(false);
    await deleteResetBackup(backup.id);
    setShowRecoverModal(false);
    toast.success(`Restored "${backup.title}"`);
  };

  // Open/submit the "New Daily Log" picker (date + shift + carry-over).
  const createNewLogFromModal = async () => {
    // For today's log capture the actual local moment; for a back-dated log use
    // local noon so it lands on the chosen calendar day regardless of timezone.
    const iso = (newLogDate === todayYMD())
      ? new Date().toISOString()
      : new Date(`${newLogDate}T12:00:00`).toISOString();
    // "Last shift" = the most recent existing log for this customer. A plant with
    // no logs yet falls back to JTI's most recent service visit, so a site JTI has
    // been servicing for years starts with its lines and heads already set up
    // instead of a blank screen and an evening of typing.
    const priorLog = [...visits].filter(v => !v.deleted)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const prior = newLogCarry ? (priorLog || jtiVisits[0] || null) : null;
    const startedFresh = !newLogCarry;      // captured before the reset below
    setShowNewLogModal(false);
    setShowVisitsModal(false);
    await startNewVisit(iso, newLogShift, prior);
    setNewLogDate(todayYMD());
    setNewLogShift(SHIFT_OPTIONS[0]);
    setNewLogCarry(true);

    // A shift that starts fresh has nothing carried over — no known-good state,
    // no open issues, nothing said about the machines. That is exactly the shift
    // where the walk round matters, and the moment to ask is now, while the
    // person is still standing at the tablet having just started it. Asked, not
    // forced: a plant mid-changeover has reasons, and a prompt that cannot be
    // declined gets clicked through without reading.
    if (startedFresh) {
      const go = await dialog.confirm(
        'Nothing has been carried over, so no machine has been checked on this shift yet. Walk the pre-start checks now?',
        { title: 'Pre-start checks', confirmText: 'Do pre-start', cancelText: 'Not now' },
      );
      if (go) requestTab('prestart');
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

  // Load the signed-in user's multi-tenant role from app_roles/{uid}.
  useEffect(() => {
    if (!user) { setRole(null); setRoleLoaded(false); setRoleError(''); return; }
    let active = true;
    setRoleError('');

    // FROM THE SERVER, not the cache.
    //
    // Offline persistence is on, and a plain .get() falls back to the local
    // cache whenever the round-trip does not complete. A cache MISS returns a
    // snapshot with exists === false and throws nothing — indistinguishable
    // from "this account has no role". So one flaky moment on the first sign-in
    // of a device locked the owner out of his own app while the record sat in
    // Firestore, correct, the whole time.
    //
    // This one read decides what the account may see, so it is worth a
    // guaranteed server answer. If the network really is gone we fall back to
    // the cache deliberately, and if even that has nothing we say we could not
    // check rather than inventing a "no access" answer.
    const ref = firebase.firestore().collection('app_roles').doc(user.uid);
    ref.get({ source: 'server' })
      .then((doc) => {
        if (!active) return;
        setRole(doc.exists ? doc.data() : { admin: false, customerId: null });
        setRoleLoaded(true);
      })
      .catch(async (err) => {
        console.warn('Role read from server failed, trying cache:', err);
        if (!active) return;
        try {
          const cached = await ref.get({ source: 'cache' });
          if (!active) return;
          if (cached.exists) {
            setRole(cached.data());
            setRoleLoaded(true);
            return;
          }
        } catch (cacheErr) {
          console.warn('No cached role either:', cacheErr);
        }
        if (!active) return;
        setRole({ admin: false, customerId: null });
        setRoleError(err?.message || 'Could not reach the server to check your access.');
        setRoleLoaded(true);
      });
    return () => { active = false; };
  }, [user]);

  // Retry any photos parked while offline, on startup and whenever the browser
  // regains connectivity. Firestore replays its own queued writes automatically;
  // Storage has no equivalent, so photos need this.
  const [pendingPhotos, setPendingPhotos] = useState(0);
  // Which visit is open, so the sync callback can tell whether a resolved photo
  // belongs to it. Paths here use WORKSPACE_UID, matching this fork's writes.
  const openVisitPathRef = useRef(null);
  useEffect(() => {
    openVisitPathRef.current =
      currentCustomer?.id && currentVisitId
        ? `user_files/${WORKSPACE_UID}/customers/${currentCustomer.id}/visits/${currentVisitId}`
        : null;
  }, [currentCustomer, currentVisitId]);
  useEffect(() => {
    const refresh = () => photoQueue.count().then(setPendingPhotos).catch(() => {});
    const stop = startPhotoSync({
      onProgress: refresh,
      // Swap the placeholder in the editor's own state as well — otherwise the
      // next autosave writes the stale placeholder back over the real URL.
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
    if (!user || !roleLoaded) return;
    const base = firebase
      .firestore()
      .collection('user_files')
      .doc(WORKSPACE_UID)
      .collection('customers');

    // A customer-scoped user only ever loads their own customer doc — never the
    // full list — so other customers aren't even fetched to the client.
    if (scopedCustomerId) {
      const unsub = base.doc(scopedCustomerId).onSnapshot((doc) => {
        setCustomers(doc.exists ? [{ id: doc.id, ...doc.data().profile }] : []);
      });
      return () => unsub();
    }

    // Admin (or owner) sees every customer.
    const unsub = base.onSnapshot((snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data().profile }));
      setCustomers(list);
    });
    return () => unsub();
  }, [user, roleLoaded, scopedCustomerId]);

  // Auto-resume last customer on first customers-loaded (skip if deep-link in progress)
  const autoResumedRef = useRef(false);
  useEffect(() => {
    if (autoResumedRef.current) return;
    if (!user || customers.length === 0 || currentCustomer) return;
    // Respect deep-link flows — if URL has ?customerId=, let that path drive
    const urlHasDeepLink = typeof window !== 'undefined' &&
      /[?&](customerId|visitId)=/.test(window.location.search);
    if (urlHasDeepLink) { autoResumedRef.current = true; return; }

    const lastCustId = localStorage.getItem('ccwissues-last-customer-id');
    const cust = lastCustId && customers.find(c => c.id === lastCustId);
    autoResumedRef.current = true;
    // The remembered CUSTOMER is resumed here; the remembered LOG is not. Which
    // log to open is decided by chooseOpeningLog once the log list arrives, so a
    // log from a previous day can no longer reopen itself and quietly collect
    // today's readings.
    if (cust) handleSelectCustomer(cust.id);
  }, [user, customers, currentCustomer]);

  // Customer-scoped users are locked to their one customer — always select it
  // (ignore the remembered-customer flow, which is for the multi-customer admin).
  useEffect(() => {
    if (!scopedCustomerId) return;
    if (currentCustomer?.id === scopedCustomerId) return;
    const cust = customers.find(c => c.id === scopedCustomerId);
    if (cust) handleSelectCustomer(cust.id);
  }, [scopedCustomerId, customers, currentCustomer]);

  // ── Which log does Current Log open? ──────────────────────────────────────
  // Today's, automatically. Anything older is offered, never opened — see
  // shared/utils/todaysLog.js for what goes wrong otherwise.
  //
  // `logDecision` is derived, so the card below stays right after a log is
  // deleted or a new one is started; the auto-open beside it is a one-shot per
  // customer, so closing a log does not immediately reopen it.
  const logDecision = useMemo(() => {
    const cid = currentCustomer?.id;
    if (!cid || visitsLoadedFor !== cid) return null; // log list hasn't arrived yet
    return chooseOpeningLog(visits, {
      isAdmin,
      rememberedId: typeof localStorage !== 'undefined'
        ? localStorage.getItem('ccwissues-last-visit-id')
        : null,
    });
  }, [currentCustomer?.id, visitsLoadedFor, visits, isAdmin]);

  const autoOpenedForRef = useRef(null);
  useEffect(() => {
    const cid = currentCustomer?.id;
    if (!cid || !logDecision) return;
    if (autoOpenedForRef.current === cid) return;
    if (viewingJtiId) return;                                      // looking at a JTI visit
    if (currentVisitId) { autoOpenedForRef.current = cid; return; } // something already open
    // A ?visitId= link owns the choice; don't race it.
    const urlHasDeepLink = typeof window !== 'undefined' &&
      /[?&](visitId|id)=/.test(window.location.search);
    if (urlHasDeepLink && !deepLinkProcessed) return;
    autoOpenedForRef.current = cid;
    if (logDecision.action === 'open') loadVisit(logDecision.log.id);
  }, [logDecision, currentVisitId, currentCustomer?.id, deepLinkProcessed, viewingJtiId]);

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
      setVisitsLoadedFor(null);
      return;
    }
    const subscribedCustomerId = currentCustomer.id;
    // Clear immediately so the old customer's visits don't flash in the UI
    // before the new subscription's first snapshot arrives.
    setVisits([]);
    // An empty `visits` means "none yet" and "not loaded yet" alike, and the
    // difference decides whether Current Log offers to start a log or waits.
    setVisitsLoadedFor(null);
    const unsub = firebase
      .firestore()
      .collection('user_files')
      .doc(WORKSPACE_UID)
      .collection('customers')
      .doc(subscribedCustomerId)
      .collection(DAILY_LOGS)
      .orderBy('date', 'desc')
      .onSnapshot((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, customerId: subscribedCustomerId, ...d.data() }))
          .filter((v) => !v.deleted);
        setVisits(list);
        setVisitsLoadedFor(subscribedCustomerId);
      });
    return () => unsub();
  }, [user, currentCustomer?.id]);

  // JTI's service visits for this customer — read-only here.
  //
  // A plant set up for a site JTI has been servicing for years arrives with an
  // empty app, while the history of what was found and fixed sits in `visits`
  // where nobody at the plant ever looks. The rules already permit the read; the
  // app simply never asked.
  useEffect(() => {
    if (!user || !currentCustomer?.id) { setJtiVisits([]); return; }
    const cid = currentCustomer.id;
    setJtiVisits([]);
    const unsub = firebase.firestore()
      .collection('user_files').doc(WORKSPACE_UID)
      .collection('customers').doc(cid)
      .collection('visits')
      .orderBy('date', 'desc')
      .onSnapshot(
        (snap) => setJtiVisits(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((v) => !v.deleted)),
        (err) => { console.warn('JTI visits unavailable:', err); setJtiVisits([]); },
      );
    return () => unsub();
  }, [user, currentCustomer?.id]);

  // Open one of JTI's visits to look at. currentVisitId is deliberately cleared:
  // every write path in this app keys off it, so a visit on screen cannot be the
  // target of an autosave, a rename or a delete.
  const viewJtiVisit = async (visitId) => {
    const v = jtiVisits.find((x) => x.id === visitId);
    if (!v) return;
    const loadedLines = (v.lines || []).map((line) => ({
      ...line,
      heads: (line.heads || []).map((h, i) => ({ ...h, id: h.id || i + 1 })),
    }));
    setCurrentVisitId(null);
    savedSnapshotRef.current = null;   // nothing to autosave against
    setCloudState('idle');
    setViewingJtiId(visitId);
    setGlobalData(v.globalData || {});
    setLines(loadedLines);
    setActiveLineId(loadedLines[0]?.id ?? null);
    setCurrentVisitName(v.name || 'JTI service visit');
    setServiceReportUrl(v.serviceReportUrl || null);
    setShowDashboardView(false);
    setActiveTab('current');
  };

  // Copy JTI's line setup into the log that is open now. Gated like Add Line —
  // it is the same act, done several lines at a time.
  const importLinesFromVisit = async (newLines) => {
    if (!newLines?.length) return;
    if (!(await requireDestructiveAuth('add lines from a JTI visit'))) return;
    const fresh = withFreshIds(newLines);
    setLines((prev) => [...prev, ...fresh]);
    setActiveLineId((cur) => cur ?? fresh[0]?.id ?? null);
    setShowDashboardView(false);
    setShowImportLines(false);
    toast.success(`Added ${fresh.length} line${fresh.length === 1 ? '' : 's'} — they save automatically.`);
  };

  const closeJtiVisit = () => {
    setViewingJtiId(null);
    setLines([]);
    setActiveLineId(null);
    setCurrentVisitName('');
    setServiceReportUrl(null);
  };

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
      .doc(WORKSPACE_UID)
      .collection('customers')
      .doc(currentCustomer.id)
      .collection(DAILY_LOGS)
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
          // Auto-refresh is only safe when it cannot lose work, and the check
          // for that lives below. If it ever gets it wrong the symptom is
          // lines that were just added quietly disappearing — so say it out
          // loud rather than let somebody conclude the app "didn't add them".
          const lost = (linesRef.current || []).length - remoteLines.length;
          if (lost > 0) {
            toast.error(
              `The cloud copy of this log has ${lost} fewer line${lost === 1 ? '' : 's'} than this screen. `
              + 'Loading it — press Check cloud if that is not what you expected.'
            );
          }
          setGlobalData(remote.globalData || {});
          setLines(remoteLines);
          setCurrentVisitName(remote.name || '');
          setServiceReportUrl(remote.serviceReportUrl || null);
          // Re-baseline autosave to the remote content so it doesn't immediately
          // push the same data back.
          savedSnapshotRef.current = serializeVisitContent(remoteLines, remote.globalData || {}, remote.name || '', remote.serviceReportUrl || null);
          setCloudState('saved');
          setLastSavedAt(remote.date ? new Date(remote.date) : new Date());
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
    const target = (visits || []).find(x => x.id === visitId);
    if (!isAdmin && target && !target.shift) {
      toast.error('This is a JTI service visit — view only. Contact JTI to change it.');
      return;
    }
    try {
      await firebase
        .firestore()
        .collection('user_files')
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection(DAILY_LOGS)
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
      .doc(WORKSPACE_UID)
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
      .doc(WORKSPACE_UID)
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
          .doc(WORKSPACE_UID)
          .collection('customers')
          .doc(customerId)
          .collection(DAILY_LOGS)
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
          .doc(WORKSPACE_UID)
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

  const loadVisits = async (custId) => {
    if (!user) return;
    const snap = await firebase
      .firestore()
      .collection('user_files')
      .doc(WORKSPACE_UID)
      .collection('customers')
      .doc(custId)
      .collection(DAILY_LOGS)
      .orderBy('date', 'desc')
      .get();
    const list = snap.docs
      .map(d => ({ id: d.id, customerId: custId, ...d.data() }))
      .filter(v => !v.deleted);
    setVisits(list);
  };

  const deleteVisit = async (visitId) => {
    if (!(await requireDestructiveAuth('delete this visit'))) return;
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
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(currentCustomer.id)
        .collection(DAILY_LOGS)
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
      .doc(WORKSPACE_UID)
      .collection('customers')
      .doc(currentCustomer.id)
      .collection(DAILY_LOGS)
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
      .doc(WORKSPACE_UID)
      .collection('customers')
      .get();
    allData.customers = customerSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (const doc of customerSnap.docs) {
      const custId = doc.id;
      const visitSnap = await firebase
        .firestore()
        .collection('user_files')
        .doc(WORKSPACE_UID)
        .collection('customers')
        .doc(custId)
        .collection(DAILY_LOGS)
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
            .doc(WORKSPACE_UID)
            .collection('customers')
            .doc(key)
            .set(custData);
          for (const visitData of allData.visits.filter(v => v.customerId === custData.id)) {
            await firebase
              .firestore()
              .collection('user_files')
              .doc(WORKSPACE_UID)
              .collection('customers')
              .doc(key)
              .collection(DAILY_LOGS)
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

  // Load all visits for history. A customer-scoped user only loads their own
  // customer's visits (never other customers'); admin loads everyone's.
  useEffect(() => {
    if (!user || !roleLoaded) return;
    const loadAllVisits = async () => {
      const base = firebase.firestore()
        .collection('user_files').doc(WORKSPACE_UID).collection('customers');
      const custIds = scopedCustomerId
        ? [scopedCustomerId]
        : (await base.get()).docs.map(d => d.id);
      const all = [];
      for (const cid of custIds) {
        const visitSnap = await base.doc(cid).collection(DAILY_LOGS).get();
        all.push(...visitSnap.docs
          .map(d => ({ id: d.id, customerId: cid, ...d.data() }))
          .filter(v => !v.deleted)); // don't surface recycle-binned visits in Issue History
      }
      setAllVisits(all);
    };
    loadAllVisits();
  }, [user, roleLoaded, scopedCustomerId]);

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
    return <LoginScreen
      onLogin={async (email, password) => {
        const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
        setSession(cred.user);
      }}
      onResetPassword={async (email) => {
        await firebase.auth().sendPasswordResetEmail(email);
      }}
    />;
  }

  // Signed in but no role assigned yet — no admin flag and no customer scope.
  if (roleLoaded && !isAdmin && !scopedCustomerId) {
    return (
      <div className="text-center p-5">
        <h4 className="mb-3">{roleError ? "Couldn't check your access" : 'Account not set up yet'}</h4>
        {roleError ? (
          <p className="text-muted">
            You're signed in as <strong>{user.email}</strong>, but reading this account's
            access failed — so this is not necessarily a setup problem. Worth a retry
            before anything else.
            <br />
            <span className="small font-monospace text-danger">{roleError}</span>
          </p>
        ) : (
          <p className="text-muted">
            You're signed in as <strong>{user.email}</strong>, and that account has no
            access record yet — access here is granted per account, so having a login
            is not the same as having access. Send JTI the ID below and they can
            finish setup in a moment.
          </p>
        )}

        {/* The account ID, shown because linking an account needs it and the
            person staring at this screen is the only one who can see it. It was
            previously findable only in the Firebase console, which turned a
            ten-second job into a support call. It identifies the account, and
            grants nothing on its own — the link is written by an admin. */}
        <div className="card mx-auto mt-3" style={{ maxWidth: '520px' }}>
          <div className="card-body">
            <label className="form-label small text-muted mb-1">Account ID</label>
            <div className="input-group input-group-sm">
              <input
                type="text"
                className="form-control font-monospace"
                value={user.uid}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(user.uid)
                    .then(() => toast.success('Account ID copied'))
                    .catch(() => toast.error('Select the ID and copy it manually'));
                }}
              >
                Copy
              </button>
            </div>
            <div className="form-text">
              JTI links this to your plant with ⚙ → Link login to customer.
            </div>
          </div>
        </div>

        <button className="btn btn-outline-secondary btn-sm mt-3" onClick={() => firebase.auth().signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  // Viewing one of JTI's own visits is read-only for everyone, including JTI:
  // this app writes dailyLogs, and the visit lives elsewhere.
  //
  // A missing `shift` used to mark a log as JTI's and lock a plant out of it.
  // It never meant that — see readOnlyRef above — and it made older logs
  // silently unwritable. One rule, one source, and it matches what the
  // database will actually accept.
  const viewedJtiVisit = viewingJtiId ? jtiVisits.find(v => v.id === viewingJtiId) : null;
  const barName = viewingJtiId
    ? (viewedJtiVisit?.visitName || viewedJtiVisit?.name || 'JTI service visit')
    : (currentVisitName || 'Untitled log');
  const readOnly = !!viewingJtiId;

  // "What's down" summary for the loaded log: an offline head still needs
  // attention unless all its issues are marked Fixed (Fixed = running/working).
  const headNeedsAttention = (h) => {
    if (h.status !== 'offline') return false;
    const issues = h.issues || [];
    if (issues.length === 0) return true;
    return !issues.every(i => i.fixed === 'fixed');
  };
  const linesDown = lines
    .map(l => ({ id: l.id, title: l.title, count: (l.heads || []).filter(headNeedsAttention).length }))
    .filter(x => x.count > 0);
  const totalDown = linesDown.reduce((s, x) => s + x.count, 0);

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
        /* The toolbar wraps rather than overflows.
           It used to be pinned to one row at every width above a phone, on the
           assumption the contents would always fit. They stopped fitting when
           the PIN badge arrived: the row ran off the right-hand edge, taking
           the account badge and the whole overflow menu — Add Customer, logins,
           the settings — off-screen with no scrollbar and no way back. A second
           row is a much smaller cost than a button nobody can reach. */
        .control-bar .toolbar-row {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 6px;
          align-items: center;
          min-width: 0;
        }
        .control-bar .toolbar-row > * {
          flex: 0 0 auto;
          min-width: 0;
        }
        /* The right-hand group takes the slack and wraps inside itself, so the
           items that do fit stay on the first row against the right edge. */
        .control-bar .toolbar-right {
          flex: 1 1 auto;
          min-width: 0;
          flex-wrap: wrap;
          justify-content: flex-end;
          row-gap: 6px;
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
        .acct-badge {
          background: var(--bg-secondary);
          color: var(--text-secondary);
          border: 1px solid var(--border-color);
          font-weight: 600;
          max-width: 260px;
          overflow: hidden;
          /* Shrinks to an ellipsis before it will push anything off the row.
             A truncated address still answers "which login is this?"; a gear
             icon pushed past the edge answers nothing. */
          flex: 0 1 auto;
          min-width: 0;
        }
        .acct-badge .acct-who {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* The address is the confirmation; the role is the answer. On a narrower
           toolbar the address goes and the role stays. */
        @media (max-width: 1200px) {
          .acct-badge .acct-email { display: none; }
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
          /* ...but always keep labels flagged .keep (e.g. Daily Log, Help) */
          .control-bar .btn-label.keep {
            display: inline !important;
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
        /* Narrow phones (portrait): the customer picker takes its own
           full-width first row; the icon buttons flow onto the row(s) below.
           (Wrapping itself is no longer conditional — see .toolbar-row above.) */
        @media (max-width: 640px) {
          .control-bar .toolbar-row {
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
          {scopedCustomerId ? (
            // Customer-scoped user: locked to their own customer, no picker.
            <span className="form-select form-select-sm d-inline-flex align-items-center" style={{ width: 'auto', cursor: 'default' }}>
              {currentCustomer?.name || customers[0]?.name || 'Loading…'}
            </span>
          ) : (
            <select
              value={currentCustomer?.id || ''}
              onChange={(e) => handleSelectCustomer(e.target.value)}
              className="form-select form-select-sm"
            >
              <option value="">-- Select Customer --</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {currentCustomer && (
            <button
              onClick={() => setShowVisitsModal(true)}
              className="btn btn-outline-primary btn-sm"
              title="Choose or manage daily logs"
            >
              <List className="w-4 h-4" /> <span className="btn-label keep">Daily Log</span>{' '}
              <span className="badge bg-secondary ms-1" title={`${visits.length} daily log${visits.length === 1 ? '' : 's'} for this customer`}>{visits.length}</span>
            </button>
          )}

          <button
            onClick={() => setShowHelp(true)}
            className="btn btn-outline-info btn-sm"
            title="How to use this app"
          >
            <HelpCircle className="w-4 h-4" /> <span className="btn-label keep">Help</span>
          </button>

          {/* Recover a line that was reset or removed (kept 30 days) for the loaded log. */}
          {currentCustomer && resetBackups.length > 0 && (
            <button
              onClick={() => setShowRecoverModal(true)}
              className="btn btn-outline-warning btn-sm"
              title="Recover a line that was reset or removed"
            >
              <RefreshCw className="w-4 h-4" /> <span className="btn-label">Recover</span>{' '}
              <span className="badge bg-warning text-dark ms-1">{resetBackups.length}</span>
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
              disabled={!currentCustomer || lines.length === 0}
            >
              <Save className="w-4 h-4" /> <span className="btn-label">Save Visit</span>
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => setShowShareModal(true)}
              className="btn btn-outline-primary btn-sm"
              disabled={!currentCustomer}
              title="Share"
            >
              <Share2 className="w-4 h-4" /> <span className="btn-label">Share</span>
            </button>
          )}

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
                <button
                  className="dropdown-item d-flex align-items-center gap-2"
                  onClick={async () => {
                    toast.success('Loading photos into PDF…');
                    await exportDashboardToPDF(lines, globalData, true);
                  }}
                >
                  <FileText className="w-4 h-4" /> Dashboard PDF (with Photos)
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
          <div className="toolbar-right ms-auto d-flex align-items-center gap-2">
            {/* Who this tablet is currently logging as, and how to hand over.
                In the header rather than inside a form: the person who needs it
                is the one who has just walked up, before they open anything. */}
            <PinSession
              customerId={currentCustomer?.id}
              roleLabel={activeCrewPerson
                ? (isSiteLead(activeCrewPerson) ? 'Site Lead' : (TIER_LABEL[tierOf(activeCrewPerson)] || ''))
                : ''}
              anyoneCanSignIn={crewPeople.some(hasPin)}
            />
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
                className={'badge ' + (cloudState === 'saving' ? 'bg-warning text-dark' : cloudState === 'error' ? 'bg-danger' : 'bg-success')}
                title="Changes save to the cloud automatically"
              >
                {cloudState === 'saving'
                  ? 'Saving…'
                  : cloudState === 'error'
                  ? '⚠ Offline — will retry'
                  : `✓ Saved${lastSavedAt ? ' ' + lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`}
              </span>
            )}

            {/* WHICH ACCOUNT this browser is signed in as.
                Not the same question as the PIN badge beside it: that says who
                is logging entries right now, this says whose login the app is
                running under. Nothing on screen answered the second one, and
                the difference matters — a plant login and JTI's own account see
                different data, and working out which you were took a support
                conversation. The role is spelled out rather than implied,
                because "admin" of the Firebase project and admin in here are
                unrelated things that share a word. */}
            {user && (
              <span
                className="badge d-inline-flex align-items-center gap-1 acct-badge"
                title={`Signed in as ${user.email}${isAdmin ? ' — JTI account, sees every customer' : currentCustomer?.name ? ` — plant login for ${currentCustomer.name}` : ' — plant login'}`}
              >
                <User className="w-4 h-4" />
                <span className="btn-label acct-who">
                  {isAdmin ? 'JTI' : (currentCustomer?.name || 'Plant')}
                  <span className="acct-email"> · {user.email}</span>
                </span>
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
                {isAdmin && (
                  <li>
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowAddCustomer(true)}>
                      <Plus className="w-4 h-4" /> Add Customer
                    </button>
                  </li>
                )}
                {isAdmin && (
                  <li>
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowLinkLogin(true)}>
                      <Lock className="w-4 h-4" /> Plant logins
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
                {isAdmin && (
                  <>
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
                  </>
                )}
                {isAdmin && currentCustomer && (
                  <li>
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowDuplicates(true)}>
                      <Copy className="w-4 h-4" /> Find Duplicate Visits
                    </button>
                  </li>
                )}
                {isAdmin && (
                  <li>
                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setShowBackfill(true)}>
                      <Hash className="w-4 h-4" /> Backfill Service Report #s
                    </button>
                  </li>
                )}
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
                  <a
                    className="dropdown-item d-flex align-items-center gap-2"
                    href="/USER_GUIDE"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FileText className="w-4 h-4" /> User guide
                  </a>
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

      {showLinkLogin && isAdmin && (
        <AdminLoginsPanel
          customers={customers}
          currentCustomerId={currentCustomer?.id || ''}
          onClose={() => setShowLinkLogin(false)}
          toast={toast}
        />
      )}

      {pinGate && (
        <PinPrompt
          customerId={currentCustomer?.id}
          people={crewPeople.filter(pinGate.siteLeadOnly ? (p) => isSiteLead(p) && p.pinHash : canAuthorise)}
          title={pinGate.siteLeadOnly ? 'Site Lead' : 'Supervisor or Site Lead'}
          message={pinGate.siteLeadOnly
            ? `Enter a Site Lead PIN to ${pinGate.actionLabel}.`
            : `Enter a supervisor or Site Lead PIN to ${pinGate.actionLabel}.`}
          onVerified={(person) => {
            // Remembered as the person at this tablet.
            //
            // It used to be deliberately forgotten, so that a supervisor
            // authorising one action did not leave the device acting as them.
            // That reasoning stopped holding once a Site Lead was meant to stop
            // being asked twice: the only proof the app keeps IS this session,
            // so forgetting it meant they were asked every single time and the
            // header said "Nobody signed in" immediately after they had keyed a
            // PIN — which is what a person reasonably reads as the PIN not
            // working.
            //
            // The protections that make this safe are the ones now on screen:
            // the header names them for as long as it lasts, five minutes of
            // inactivity ends it, and Sign off is one tap.
            if (person?.id) rememberVerified({ id: person.id, name: person.name });
            const done = pinGate.resolve;
            setPinGate(null);
            done(true);
          }}
          onCancel={() => {
            const done = pinGate.resolve;
            setPinGate(null);
            done(false);
          }}
        />
      )}

      {/* A screen above the active PIN's level. Unlike the action gate above,
          the person who unlocks it BECOMES the person at this tablet: they are
          not authorising one thing and walking away, they are taking the tablet
          over, and everything logged next is theirs. */}
      {screenGateReq && (
        <PinPrompt
          customerId={currentCustomer?.id}
          people={crewPeople.filter((p) => tierOf(p) >= screenGateReq.need && hasPin(p))}
          title={`${screenGateReq.label} PIN needed`}
          message={`That screen is for ${screenGateReq.label} and above. Whoever unlocks it will be the name this tablet logs under.`}
          onVerified={(person) => {
            const { tab } = screenGateReq;
            setScreenGateReq(null);
            rememberVerified({ id: person.id, name: person.name });
            setActiveTab(tab);
          }}
          onCancel={() => setScreenGateReq(null)}
        />
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
          <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
            <h5 className="mb-0">Help Guide</h5>
            <div className="d-flex align-items-center gap-2">
              {/* The long-form guide, served as a static page from public/.
                  Extensionless: Cloudflare Pages 308s /USER_GUIDE.html to
                  /USER_GUIDE, so linking the .html adds a redirect for nothing.
                  New tab rather than routed — reading it must not throw away an
                  in-progress log behind the modal. */}
              <a
                href="/USER_GUIDE"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-primary"
              >
                <FileText className="w-4 h-4" /> Full user guide
              </a>
              <button onClick={() => setShowHelp(false)} className="btn btn-sm btn-outline-secondary">Close</button>
            </div>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>What this app is for</strong></h6>
            <p className="small mb-1">
              Keep a <strong>daily log</strong> of your Ishida weighers, shift by shift: mark any head that's
              down, say what's wrong, add a photo, and mark it fixed when it's back. Everything
              <strong> saves automatically</strong> — the chip at the top-right shows <em>✓ Saved</em>. There's no save button.
            </p>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>1. Start a daily log</strong></h6>
            <ul className="small">
              <li>Tap the <strong>Daily Log</strong> button (top toolbar). Tap an existing log to open it, or tap <strong>+ New Log</strong>.</li>
              <li>Pick the <strong>date</strong> (today by default) and the <strong>shift</strong> (1st / 2nd / 3rd). Each shift is its own log.</li>
              <li>Leave <strong>“Continue from last shift”</strong> checked to carry over the heads that are still down, so you pick up where the last shift left off.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>2. Mark a head down &amp; explain it</strong></h6>
            <ul className="small">
              <li>In a line's <strong>Quick Head Toggle</strong> grid, <strong>tap a head number</strong>. It turns <span className="text-danger fw-bold">red</span> (offline) and a pop-up opens.</li>
              <li>In the pop-up, tap <strong>+ Add Issue</strong>, choose the problem (Chute, Load Cell, …), type a note, and tap <strong>Photo</strong> to snap a picture.</li>
              <li>Add more than one issue on the same head if needed. Tap <strong>Done</strong>.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>3. Mark it fixed</strong></h6>
            <ul className="small">
              <li>Tap the head again to reopen the pop-up.</li>
              <li>Tap the issue's status button to set it to <strong>Fixed</strong>. <strong>Fixed means the head is running and working again</strong> — you do <em>not</em> need to set the head Active.</li>
              <li>Only tap <strong>Active</strong> if you logged the issue by mistake. (Setting a head Active while an issue is still open shows it as <em>Active with Issues</em>.)</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Head colors</strong></h6>
            <p className="small mb-1">
              <span className="badge bg-success me-1">Green</span> Running &nbsp;
              <span className="badge bg-danger me-1">Red</span> Offline / not fixed &nbsp;
              <span className="badge bg-warning text-dark me-1">Orange</span> Fixed &nbsp;
              <span className="badge bg-info text-dark me-1">Blue</span> Active with issues
            </p>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Undo an accidental reset</strong></h6>
            <ul className="small">
              <li>If a line gets <strong>Reset</strong> by mistake, a yellow <strong>Recover</strong> button appears in the toolbar.</li>
              <li>Tap it and hit <strong>Restore</strong> to bring the line back. Resets are kept for <strong>7 days</strong>.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>“JTI Visit” entries</strong></h6>
            <p className="small mb-1">
              Logs marked <span className="badge bg-primary">JTI Visit</span> are service visits done by JTI.
              You can <strong>view</strong> them to see what was done, but they're read-only.
            </p>
          </div>

          <div className="mb-2">
            <h6 className="text-primary mb-2"><strong>Some actions are locked</strong></h6>
            <p className="small mb-1">
              Adding, removing, or deleting a line or log needs a <strong>supervisor password</strong>. This prevents
              accidental changes. Your supervisor (or JTI) has it — resetting a line does not need it, and can be recovered.
            </p>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Crew — who's working</strong></h6>
            <ul className="small">
              <li>The <strong>Crew</strong> tab holds your people and who is on which line this shift. You manage this yourselves; JTI can also see it.</li>
              <li>Set the line crewing at the start of a shift. Every span adjustment, part replacement and PM check logged afterwards records the crew for <strong>that line</strong>.</li>
              <li>If crewing hasn't been changed in over 16 hours you'll see a warning — it's probably last shift's.</li>
              <li><strong>PINs</strong> tell people apart on a shared tablet. A supervisor marked as <em>admin</em> can set and reset them; JTI sets the first one.</li>
              <li>No PINs set? Everything still works — entries are just recorded without a name.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Span Adjust</strong></h6>
            <ul className="small">
              <li>Each line has its own ~30-day clock. The list puts <strong>overdue first</strong>.</li>
              <li>Target (span) weights carry over from last time. Current weights always start blank, so an old reading can't be logged again by mistake.</li>
              <li><strong>Scan screen</strong> — take a photo of the weigher panel and the current weights fill themselves in. It finds each circled head number and reads the weight in that hopper, so it doesn't matter which way the ring is turned.</li>
              <li>Filled-in values have a <strong>blue border</strong> and the photo stays on screen — tap it to zoom in and check. Nothing is saved until you press Log.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Parts &amp; boards</strong></h6>
            <ul className="small">
              <li>Record what was replaced. A new entry starts from the last one — same line, head and part — but never the serials.</li>
              <li>Type a part number <em>or</em> name, or tap <strong>Browse</strong> to page through your machine's drawings and tap the part on the exploded view.</li>
              <li>The eye button hides the markers so you can read the drawing; the list button lets you pick from a list instead.</li>
              <li>Parts come only from <em>your</em> machine's manual. You can still type anything — it's just marked <strong>unverified</strong>.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Who turned a head off</strong></h6>
            <ul className="small">
              <li>Taking a head offline, putting it back, or marking an issue fixed asks who you are — once per device, then it remembers you for 10 hours.</li>
              <li>The name shows on the offline-heads list and on the dashboard, so the next shift knows who to ask.</li>
            </ul>
          </div>

          <div className="mb-4">
            <h6 className="text-primary mb-2"><strong>Activity</strong></h6>
            <ul className="small">
              <li>One list of everything that happened on a line — heads, parts, span adjustments, PM checks, crew changes — newest first, with who did it.</li>
              <li><strong>Alert me</strong> pops up a notification on this device when a head goes offline on any line. It only works while the app is open (a background tab is fine); it can't reach a closed app or a locked phone.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Static visit + service-report bar, pinned at the top of the workspace.
          Also shown while reading one of JTI's own visits — that is where the
          service reports live, and gating the bar on currentVisitId alone hid
          every one of them from the plant. */}
      {(currentVisitId || viewingJtiId) && (
        <div className="report-bar">
          <div className="report-bar-visit">
            <span className="report-bar-label">{viewingJtiId ? 'Visit' : 'Log'}</span>
            <span className="report-bar-name" title={barName}>{barName}</span>
          </div>
          {/* The SR number is the service-tech's own workflow and stays with JTI. */}
          {isAdmin && (
            <>
              <div className="report-bar-sr">
                <label className="report-bar-label" htmlFor="sr-number">SR #</label>
                <input
                  id="sr-number"
                  type="text"
                  inputMode="numeric"
                  className="form-control form-control-sm report-bar-sr-input"
                  value={globalData.serviceReportNumber || ''}
                  onChange={(e) => setGlobalData(prev => ({ ...prev, serviceReportNumber: e.target.value }))}
                  placeholder="YYYY###"
                  title="Service report number — links this visit to its service report & invoice in the dashboard"
                />
              </div>
            </>
          )}
          {/* The report itself is shown to the plant too: it is the write-up of
              work done on their machines, and it was hidden from them entirely.
              Read-only for them — replacing or deleting it stays with JTI — and
              the control renders nothing at all when there is no report. */}
          <ServiceReportUpload
            userId={WORKSPACE_UID}
            customerId={currentCustomer?.id}
            visitId={currentVisitId || viewingJtiId}
            collectionName={currentVisitId ? DAILY_LOGS : 'visits'}
            currentReportUrl={serviceReportUrl}
            onReportUploaded={(url) => setServiceReportUrl(url)}
            readOnly={!isAdmin || !!viewingJtiId}
          />
        </div>
      )}

      <div className="workspace-shell workspace-shell--no-sidebar">
        <main className="workspace-main">
      <AppNav
        active={activeTab}
        onSelect={requestTab}
        counts={navCounts}
        groups={navGroups({ noun: 'log', extras: (!isAdmin && role?.customerId) ? [{ key: 'logins', title: 'Logins' }] : [] })}
      />
      <div className="ccw-panes">
        <div className="ccw-pane" id="ccw-pane-overview" role="tabpanel"
             aria-labelledby="ccw-tab-overview" hidden={activeTab !== 'overview'}>
          <div className="tab-content p-3">
            <OverviewPage
              customerName={currentCustomer?.name}
              workspaceId={WORKSPACE_UID}
              customerId={currentCustomer?.id}
              lines={lines}
              visits={visits}
              onGo={requestTab}
              onAdoptLines={adoptHistoryLines}
            />
          </div>
        </div>
        <div className="ccw-pane" id="ccw-pane-current" role="tabpanel"
             aria-labelledby="ccw-tab-current" hidden={activeTab !== 'current'}>
          <div className="tab-content p-3">
            {readOnly && (
              <div className="alert alert-info d-flex align-items-center gap-2 py-2 flex-wrap" role="alert">
                <Eye size={16} />
                <span>
                  <strong>JTI service visit — view only.</strong>{' '}
                  {viewedJtiVisit
                    ? <>{viewedJtiVisit.name || 'Visit'}{viewedJtiVisit.date ? ` · ${new Date(viewedJtiVisit.date).toLocaleDateString()}` : ''}. Nothing here can be changed.</>
                    : <>This log was done by JTI. Contact JTI to make changes.</>}
                </span>
                {viewingJtiId && (
                  <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={closeJtiVisit}>
                    Close
                  </button>
                )}
              </div>
            )}

            {/* At-a-glance "what's down" for this log. */}
            {currentVisitId && lines.length > 0 && (
              <div className={`alert ${totalDown > 0 ? 'alert-danger' : 'alert-success'} py-2 mb-3 d-flex flex-wrap align-items-center gap-2`}>
                {totalDown > 0 ? (
                  <>
                    <strong>🔴 {totalDown} head{totalDown > 1 ? 's' : ''} down</strong>
                    <span>on {linesDown.length} line{linesDown.length > 1 ? 's' : ''}:</span>
                    {linesDown.map(x => (
                      <button
                        key={x.id}
                        type="button"
                        className="btn btn-sm btn-danger py-0 px-2"
                        onClick={() => { setActiveLineId(x.id); setShowDashboardView(false); }}
                        title={`Go to ${x.title}`}
                      >
                        {x.title} ({x.count})
                      </button>
                    ))}
                  </>
                ) : (
                  <strong>✓ All heads running — nothing down on this log.</strong>
                )}
              </div>
            )}
            {/* No log open: say what exists and offer the two useful moves,
                rather than presenting an empty Log Name box. */}
            {currentCustomer && !currentVisitId && !viewingJtiId && logDecision && (
              <OpenLogCard
                decision={logDecision}
                onOpen={(log) => loadVisit(log.id)}
                onStart={() => setShowNewLogModal(true)}
                priorVisits={jtiVisits}
                onViewPrior={viewJtiVisit}
              />
            )}

            {/* The editor proper. Hidden until a log is open, so the card above is
                the whole screen rather than a note stuck on top of a live-looking
                form with nothing behind it. */}
            {(currentVisitId || viewingJtiId) && (
            <div style={{ pointerEvents: readOnly ? 'none' : 'auto', opacity: readOnly ? 0.7 : 1 }}>
            {currentCustomer && currentVisitId && (
              <div className="mb-3">
                <label className="form-label d-flex align-items-center gap-2 flex-wrap">
                  <strong>Log Name:</strong>
                  {/* Which day you are typing into. The name is renamable and often
                      renamed, so it cannot be relied on to carry the date. */}
                  {openLogAge != null && (
                    <span className={`badge ${openLogAge > 0 ? 'bg-warning text-dark' : 'bg-secondary'}`}>
                      {logLabel(visits.find(v => v.id === currentVisitId))}
                      {openLogAge > 0 ? ` · not today` : ''}
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={currentVisitName}
                  onChange={(e) => setCurrentVisitName(e.target.value)}
                  placeholder="Enter log name (optional)"
                  className="form-control"
                />
              </div>
            )}

            <GlobalForm
              key={`gf-${lines.length}-${JSON.stringify(globalData)}`}
              globalData={globalData}
              setGlobalData={setGlobalData}
              addLine={async () => { if (await requireDestructiveAuth('add a line')) setShowAddLineDialog(true); }}
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
            )}

            {/* Line picker: a scrollable chip strip rather than a native picker
                wheel — one tap to switch, and each chip's dot shows the line's
                status at a glance while walking the plant. */}
            {/* The "this log can't be edited" banner that stood here is gone
                with the rule that produced it: a plant's own log is always
                theirs to write, whether or not a shift was recorded on it. */}

            {shiftEndedAt && !readOnly && (
              <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 py-2">
                <span>
                  <strong>Shift ended — handed to sanitation</strong>
                  {currentLog?.shiftEndedBy ? ` by ${currentLog.shiftEndedBy}` : ''}
                  {' '}at {new Date(shiftEndedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                  {' '}Every line needs its pre-start walk again before it runs.
                </span>
                <button type="button" className="btn btn-sm btn-outline-dark ms-auto" onClick={continueShift}>
                  Shift is continuing — undo
                </button>
              </div>
            )}

            {lines.length > 0 && !readOnly && (
              <div className="d-flex justify-content-end align-items-center gap-2 mb-1">
                {currentVisitId && !shiftEndedAt && (
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={endShiftForSanitation}>
                    End shift → sanitation
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-link text-decoration-none" onClick={openSetupLines}>
                  Set up lines
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

            {/* A log with no lines and a JTI visit to take them from. This is
                the state a plant is in on day one at a site JTI has serviced for
                years — the equipment layout exists, just not in their app. */}
            {currentVisitId && !readOnly && lines.length === 0 && (
              <div className="alert alert-info d-flex flex-wrap align-items-center gap-2">
                <span>
                  <strong>No lines on this log yet.</strong>{' '}
                  {jtiVisits.length > 0
                    ? "JTI has this plant's lines on record, or you can build them yourself."
                    : 'Add them once and every log from here on starts with them.'}
                </span>
                <div className="d-flex gap-2 ms-auto">
                  {/* Building them yourself is offered even when JTI has a
                      record to copy: a plant that has changed its floor since
                      JTI last visited should not have to import a stale layout
                      and then correct it. */}
                  <button type="button" className="btn btn-sm btn-primary" onClick={openSetupLines}>
                    <Plus size={14} /> Build your lines
                  </button>
                  {jtiVisits.length > 0 && (
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setShowImportLines(true)}>
                      <Download size={14} /> Copy from a JTI visit
                    </button>
                  )}
                </div>
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
                  {currentVisitId && !readOnly && jtiVisits.length > 0 && (
                    <button
                      onClick={() => setShowImportLines(true)}
                      className="btn btn-sm btn-outline-secondary"
                      title="Add lines JTI has on record that this log does not have"
                    >
                      <Download className="w-4 h-4" /> Add from JTI
                    </button>
                  )}
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
              <div style={{ pointerEvents: readOnly ? 'none' : 'auto', opacity: readOnly ? 0.7 : 1 }}>
              <div>
                {lines.map(line => (
                  <Line
                    key={line.id}
                    line={line}
                    updateLine={updateLineStable}
                    removeLine={handleRemoveLine}
                    requireEditAuth={requireDestructiveAuth}
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
                    userId={WORKSPACE_UID}
                    customerId={currentCustomer?.id}
                    visitId={currentVisitId}
                    performedByName={session?.email || (isAdmin ? 'JTI' : 'Plant staff')}
                    logRole={isAdmin ? 'jti' : 'customer'}
                  />
                ))}
              </div>
              </div>
            )}
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-span" role="tabpanel"
             aria-labelledby="ccw-tab-span" hidden={activeTab !== 'span'}>
          <div className="tab-content p-3">
            <SpanAdjustPage
              workspaceId={WORKSPACE_UID}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
              performedByName={session?.email || (isAdmin ? 'JTI' : 'Plant staff')}
              role={isAdmin ? 'jti' : 'customer'}
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-boards" role="tabpanel"
             aria-labelledby="ccw-tab-boards" hidden={activeTab !== 'boards'}>
          <div className="tab-content p-3">
            <BoardReplacementPage
              customers={isAdmin ? customers : []}
              workspaceId={WORKSPACE_UID}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
              performedByName={session?.email || (isAdmin ? 'JTI' : 'Plant staff')}
              role={isAdmin ? 'jti' : 'customer'}
              canEditTypes={isAdmin}
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-prestart" role="tabpanel"
             aria-labelledby="ccw-tab-prestart" hidden={activeTab !== 'prestart'}>
          <div className="tab-content p-3">
            <PrestartPage
              workspaceId={WORKSPACE_UID}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              lines={lines}
              visits={visits}
              performedByName={session?.email || (isAdmin ? 'JTI' : 'Plant staff')}
              role={isAdmin ? 'jti' : 'customer'}
              // The list is JTI's standard, edited by JTI — same rule as the PM
              // checklist next door. A plant fills it in and nothing more.
              canEditTemplate={isAdmin}
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-pm" role="tabpanel"
             aria-labelledby="ccw-tab-pm" hidden={activeTab !== 'pm'}>
          <div className="tab-content p-3">
            <PmLogPage
              customers={isAdmin ? customers : []}
              workspaceId={WORKSPACE_UID}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
              performedByName={session?.email || (isAdmin ? 'JTI' : 'Plant staff')}
              role={isAdmin ? 'jti' : 'customer'}
              canEditTemplate={isAdmin}
            />
          </div>
        </div>

        <div className="ccw-pane" id="ccw-pane-crew" role="tabpanel"
             aria-labelledby="ccw-tab-crew" hidden={activeTab !== 'crew'}>
          <div className="tab-content p-3">
            <CrewPage
              isJti={isAdmin}
              workspaceId={WORKSPACE_UID}
              customerId={currentCustomer?.id}
              customerName={currentCustomer?.name}
              visits={visits}
            />
          </div>
        </div>

        {/* Only for a plant login: JTI has no customerId of its own, and
            creates logins from the admin screen instead. */}
        {!isAdmin && role?.customerId && (
          <div className="ccw-pane" id="ccw-pane-logins" role="tabpanel"
             aria-labelledby="ccw-tab-logins" hidden={activeTab !== 'logins'}>
            <div className="tab-content">
              <PlantLoginsPage
                workspaceId={WORKSPACE_UID}
                customerId={currentCustomer?.id}
                customerName={currentCustomer?.name}
                getIdToken={() => firebase.auth().currentUser.getIdToken()}
              />
            </div>
          </div>
        )}

        <div className="ccw-pane" id="ccw-pane-activity" role="tabpanel"
             aria-labelledby="ccw-tab-activity" hidden={activeTab !== 'activity'}>
          <div className="tab-content p-3">
            <ActivityPage
              workspaceId={WORKSPACE_UID}
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
              customerId={scopedCustomerId || currentCustomer?.id}
              locked={!!scopedCustomerId}
              badgeSource="jti"
              badgeLabel="JTI visit"
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
                readOnly={readOnly}
                /* Recorded on the layout, so a plant opening one JTI plotted
                   for them is told so rather than left guessing. */
                author={isAdmin ? 'JTI' : (currentCustomer?.name || 'Plant')}
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
                  onNewVisit={() => setShowNewLogModal(true)}
                  onCopyVisit={(id) => { newVisitFromPrior(id); setShowVisitsModal(false); }}
                  onRename={renameVisit}
                  onEditDate={(v) => { setVisitToEdit(v); setEditTimestamp(new Date(v.date).toISOString().slice(0, 16)); setShowVisitsModal(false); }}
                  onDelete={deleteVisit}
                  collapsed={false}
                />

                {/* JTI's own visits. Listed apart from the plant's logs because
                    they are a different kind of record with different rules —
                    read here, never written, and not something a shift can be
                    filed against. */}
                {jtiVisits.length > 0 && (
                  <div className="border-top mt-2 pt-2">
                    <div className="px-3 pb-1 small text-uppercase fw-bold text-secondary" style={{ letterSpacing: '.08em' }}>
                      JTI service visits · view only
                    </div>
                    <ul className="list-group list-group-flush">
                      {jtiVisits.map((v) => (
                        <li key={v.id} className="list-group-item">
                          <button
                            type="button"
                            className="btn btn-link p-0 text-start text-decoration-none w-100"
                            onClick={() => { viewJtiVisit(v.id); setShowVisitsModal(false); }}
                          >
                            <div className="fw-semibold">{v.name || 'Service visit'}</div>
                            <div className="small text-secondary">
                              {v.date ? new Date(v.date).toLocaleDateString() : 'no date'}
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

      {showImportLines && (
        <ImportLinesDialog
          visits={jtiVisits}
          existingLines={lines}
          onImport={importLinesFromVisit}
          onClose={() => setShowImportLines(false)}
        />
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
        userId={WORKSPACE_UID}
      />

      {/* Add Line Dialog */}
      <AddLineDialog
        isOpen={showAddLineDialog}
        onClose={() => setShowAddLineDialog(false)}
        onAdd={handleAddLine}
        defaultHeadCount={parseInt(globalData.headCount) || DEFAULT_HEAD_COUNT}
      />

      {/* New Daily Log: pick date + shift */}
      {showNewLogModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowNewLogModal(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">New Daily Log</h5>
                <button type="button" className="btn-close" onClick={() => setShowNewLogModal(false)} aria-label="Close" />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label"><strong>Date</strong></label>
                  <input
                    type="date"
                    className="form-control"
                    value={newLogDate}
                    max={todayYMD()}
                    onChange={(e) => setNewLogDate(e.target.value)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label"><strong>Shift</strong></label>
                  <select className="form-select" value={newLogShift} onChange={(e) => setNewLogShift(e.target.value)}>
                    {SHIFT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="carryOverShift"
                    checked={newLogCarry}
                    onChange={(e) => setNewLogCarry(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="carryOverShift">
                    Continue from last shift — carry over offline heads &amp; their issues (photos not carried)
                  </label>
                </div>
                <small className="text-muted d-block mt-2">A day can have a separate log for each shift.</small>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowNewLogModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={createNewLogFromModal} disabled={!newLogDate}>Create Log</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recover a reset line (kept 7 days) */}
      {showRecoverModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowRecoverModal(false)}>
          <div className="modal-dialog modal-dialog-centered modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Recover a line</h5>
                <button type="button" className="btn-close" onClick={() => setShowRecoverModal(false)} aria-label="Close" />
              </div>
              <div className="modal-body">
                <p className="text-muted small">
                  Lines reset in this log are kept for 7 days. Restore one to bring back its heads, issues, and notes.
                </p>
                {resetBackups.length === 0 ? (
                  <p className="text-muted">Nothing to recover.</p>
                ) : (
                  <div className="list-group">
                    {resetBackups.map((b) => {
                      const heads = b.line?.heads || [];
                      const offline = heads.filter(h => h.status === 'offline').length;
                      const withIssues = heads.filter(h => (h.issues || []).length > 0).length;
                      return (
                        <div key={b.id} className="list-group-item d-flex justify-content-between align-items-center">
                          <div className="small" style={{ minWidth: 0 }}>
                            <div className="fw-semibold text-truncate">{b.title}</div>
                            <div className="text-muted">
                              {b.kind === 'removed' ? 'Removed' : 'Reset'}{' '}
                              {b.resetAt ? new Date(b.resetAt).toLocaleString() : ''} · {offline} offline, {withIssues} with issues
                              {b.resetAt && (() => {
                                const daysLeft = Math.ceil(
                                  (new Date(b.resetAt).getTime() + 30 * 86400000 - Date.now()) / 86400000
                                );
                                return (
                                  <span className={'badge ms-2 ' + (daysLeft <= 5 ? 'bg-danger' : 'bg-secondary')}>
                                    {daysLeft}d left
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="d-flex gap-1 flex-shrink-0 ms-2">
                            <button className="btn btn-sm btn-success" onClick={() => restoreLineBackup(b)}>Restore</button>
                            <button className="btn btn-sm btn-outline-danger" title="Discard this backup" onClick={async () => { if (await requireDestructiveAuth('discard this recovery backup')) deleteResetBackup(b.id); }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowRecoverModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dialog System (confirm/alert/prompt dialogs and toasts) */}
      <SetupLinesModal
        isOpen={showSetupLines}
        lines={lines}
        defaultHeadCount={DEFAULT_HEAD_COUNT}
        onClose={() => setShowSetupLines(false)}
        onSave={(next) => {
          if (!currentVisitId) {
            // Lines live on a log. With none open there is nothing to save them
            // into, and they would look added right up until the next render.
            toast.error('Open today\'s log first — lines are saved with the log.');
            return;
          }
          // Autosave watches `lines`, so the new order and any additions
          // persist through the same path every other edit uses.
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