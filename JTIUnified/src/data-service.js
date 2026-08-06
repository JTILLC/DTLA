import { collection, getDocs, query, where, orderBy, limit, doc, deleteDoc, updateDoc, getDoc, setDoc, addDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { ref, getDownloadURL, getBlob, uploadBytes, deleteObject } from 'firebase/storage';
import { ref as dbRef, get } from 'firebase/database';
import { ccwIssuesDb, jobsMasterDb, timesheetDb, jobsStorage, ccwIssuesStorage, shearersRealtimeDb, ccwIssuesAuth, jobsMasterAuth } from './firebase-config';
import serviceLog from './components/Troubleshoot/serviceLog.json';
import { isPaid, jobAmount, sumIncome } from './utils/format';

// ============================================
// Docx-derived calendar events
// ============================================
// Parse date ranges like "5/5/2008 – 5/7/2008", "5/5/2008-5/7/2008",
// or 2-digit years like "7/21/09 – 7/24/09".
const DOCX_RANGE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[–\-—]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g;
const DOCX_SINGLE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function mdyDisplay(y, m, d) { return `${m}/${d}/${y}`; }
// 2-digit years all map to 20YY since the master log starts in April 2008.
function expandYear(y) {
  const n = parseInt(y, 10);
  if (Number.isNaN(n)) return n;
  if (n >= 100) return n;
  return 2000 + n;
}

function* eachDay(startY, startM, startD, endY, endM, endD) {
  const start = new Date(startY, startM - 1, startD);
  const end = new Date(endY, endM - 1, endD);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (end < start) return;
  // Cap absurd ranges to keep the calendar from drowning.
  const maxDays = 60;
  let count = 0;
  for (let d = new Date(start); d <= end && count < maxDays; d.setDate(d.getDate() + 1), count++) {
    yield isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
}

function buildDocxCalendarEvents() {
  const events = [];
  const entries = serviceLog?.entries || [];
  entries.forEach((entry, idx) => {
    const bodyLines = entry.body || [];
    const body = bodyLines.join(' ');
    if (!body) return;

    const customerLabel = entry.city
      ? `${entry.customer} — ${entry.city}, ${entry.state}`
      : entry.customer;

    // Full body for the day-detail modal (kept as separate lines).
    const fullBody = bodyLines;

    let foundRange = false;
    DOCX_RANGE_RE.lastIndex = 0;
    let m;
    while ((m = DOCX_RANGE_RE.exec(body)) !== null) {
      foundRange = true;
      const [, sM, sD, sY, eM, eD, eY] = m;
      const startY = expandYear(sY);
      const endY = expandYear(eY);
      const rangeDisplay = `${mdyDisplay(startY, sM, sD)} – ${mdyDisplay(endY, eM, eD)}`;
      for (const iso of eachDay(startY, +sM, +sD, endY, +eM, +eD)) {
        events.push({
          id: `doc:${idx}:${iso}`,
          date: iso,
          customer: customerLabel,
          customerName: entry.customer,
          city: entry.city,
          state: entry.state,
          period: entry.period,
          visitName: entry.visitName || '',
          hours: 0,
          serviceWork: body,
          fullBody,
          timestamp: null,
          invoiceNumber: '',
          type: 'doc',
          rangeDisplay,
        });
      }
    }

    if (!foundRange) {
      // Single date fallback: use the first M/D/YY(YY) found in the body.
      DOCX_SINGLE_RE.lastIndex = 0;
      const single = DOCX_SINGLE_RE.exec(body);
      if (single) {
        const [, mo, da, yr] = single;
        const fullYear = expandYear(yr);
        const iso = isoDate(fullYear, +mo, +da);
        events.push({
          id: `doc:${idx}:${iso}`,
          date: iso,
          customer: customerLabel,
          customerName: entry.customer,
          city: entry.city,
          state: entry.state,
          period: entry.period,
          visitName: entry.visitName || '',
          hours: 0,
          serviceWork: body,
          fullBody,
          timestamp: null,
          invoiceNumber: '',
          type: 'doc',
          rangeDisplay: mdyDisplay(fullYear, mo, da),
        });
      }
    }
  });
  return events;
}

let docxCalendarEventsCache = null;
function getDocxCalendarEvents() {
  if (!docxCalendarEventsCache) docxCalendarEventsCache = buildDocxCalendarEvents();
  return docxCalendarEventsCache;
}

// ============================================
// CACHING LAYER - Prevents redundant fetches
// ============================================
const dataCache = {
  jobs: null,
  downtime: null,
  timesheets: null,
  headHistory: null,
  inventory: null,
  partsManual: null,
  timestamps: {}
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const isCacheValid = (key) => {
  if (!dataCache[key] || !dataCache.timestamps[key]) return false;
  const age = Date.now() - dataCache.timestamps[key];
  return age < CACHE_DURATION;
};

const setCache = (key, data) => {
  dataCache[key] = data;
  dataCache.timestamps[key] = Date.now();
};

// Export cache clearing function for manual refresh
export const clearDataCache = () => {
  dataCache.jobs = null;
  dataCache.downtime = null;
  dataCache.timesheets = null;
  dataCache.headHistory = null;
  dataCache.inventory = null;
  dataCache.partsManual = null;
  dataCache.timestamps = {};
};

// Synchronous cache accessors — return whatever data is in memory right now,
// or null if nothing is cached yet. The UI uses these for stale-while-revalidate
// so it can render instantly on a tab switch / reload while a fresh fetch runs.
export const getCachedJobs = () => dataCache.jobs;
export const getCachedDowntime = () => dataCache.downtime;
export const getCachedTimesheets = () => dataCache.timesheets;
export const getCachedActivity = () => dataCache.activity;
export const hasAnyCache = () =>
  !!(dataCache.jobs || dataCache.downtime || dataCache.timesheets);

// Real-time subscription: invoke `callback` whenever jobs / issues /
// timesheets change in Firestore. Skips the initial snapshot (which fires
// immediately on subscription) and debounces bursts of changes. Returns an
// unsubscribe function.
export const subscribeAllUpdates = (callback, debounceMs = 1500) => {
  const unsubs = [];
  let initialFires = 0;
  const expectedInitial = 2; // jobs + timesheets (downtime visits live under per-customer subcollections, skipped)
  let timer = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { try { callback(); } catch (e) { console.error(e); } }, debounceMs);
  };
  const onSnap = (label) => () => {
    if (initialFires < expectedInitial) {
      initialFires += 1;
      return; // ignore initial state-load snapshots
    }
    // Invalidate the matching cache so the next fetch goes to network.
    if (label === 'jobs') dataCache.jobs = null;
    if (label === 'downtime') dataCache.downtime = null;
    if (label === 'timesheets') dataCache.timesheets = null;
    fire();
  };
  try {
    unsubs.push(onSnapshot(collection(jobsMasterDb, 'jobs'), onSnap('jobs'), (e) => console.warn('jobs snapshot error', e)));
    unsubs.push(onSnapshot(collection(timesheetDb, 'timesheets'), onSnap('timesheets'), (e) => console.warn('timesheets snapshot error', e)));
  } catch (e) {
    console.error('subscribeAllUpdates failed:', e);
  }
  return () => {
    if (timer) clearTimeout(timer);
    unsubs.forEach((u) => { try { u(); } catch {} });
  };
};

// Fetch Jobs Data from Firebase Storage JSON files
export const fetchJobsData = async () => {
  // Check cache first
  if (isCacheValid('jobs')) {
    return dataCache.jobs;
  }

  try {
    // Automatically generate year list from 2022 to current year + 3
    const currentYear = new Date().getFullYear();
    const startYear = 2022;
    const endYear = currentYear + 3;
    const years = [];
    for (let year = startYear; year <= endYear; year++) {
      years.push(year.toString());
    }
    let allJobs = [];

    // Fetch all year files in parallel
    const fetchPromises = years.map(async (year) => {
      try {
        const fileRef = ref(jobsStorage, `jobs-${year}.json`);
        const blob = await getBlob(fileRef);
        const text = await blob.text();
        const data = JSON.parse(text);

        // Handle different data structures
        let jobsArray = [];
        if (Array.isArray(data)) {
          jobsArray = data;
        } else if (data.jobs && Array.isArray(data.jobs)) {
          jobsArray = data.jobs;
        } else if (typeof data === 'object') {
          jobsArray = Object.values(data);
        }

        // Add year info to each job
        jobsArray.forEach(job => {
          allJobs.push({
            ...job,
            year: year
          });
        });

        return jobsArray;
      } catch (error) {
        return [];
      }
    });

    await Promise.all(fetchPromises);

    const jobs = allJobs;

    // Calculate statistics - use actual if available, otherwise quote
    const totalIncome = sumIncome(jobs);
    const paidIncome = sumIncome(jobs, { paidOnly: true });
    const unpaidIncome = totalIncome - paidIncome;

    const activeJobs = jobs.filter(job => {
      return !isPaid(job.paid);
    }).length;

    const result = {
      jobs,
      totalIncome,
      paidIncome,
      unpaidIncome,
      activeJobs,
      totalJobs: jobs.length
    };

    // Cache the result
    setCache('jobs', result);

    return result;
  } catch (error) {
    console.error('Error fetching jobs data:', error);
    return {
      jobs: [],
      totalIncome: 0,
      paidIncome: 0,
      unpaidIncome: 0,
      activeJobs: 0,
      totalJobs: 0
    };
  }
};

// Fetch CCW Issues (Downtime) Data from Firestore
export const fetchDowntimeData = async () => {
  // Check cache first
  if (isCacheValid('downtime')) {
    return dataCache.downtime;
  }

  try {
    const userId = 'tgezUokMZ1PO7iEDbLbj2U7Uwbx1';

    // Get all customers
    const customersCollection = collection(ccwIssuesDb, 'user_files', userId, 'customers');
    const customersSnapshot = await getDocs(customersCollection);

    // Fetch every customer's visits in parallel (was an N+1 sequential loop),
    // then flatten the per-customer issue lists into one array.
    const perCustomerIssues = await Promise.all(customersSnapshot.docs.map(async (customerDoc) => {
      const customerName = customerDoc.id;
      const customerIssues = [];

      const visitsCollection = collection(ccwIssuesDb, 'user_files', userId, 'customers', customerDoc.id, 'visits');
      const visitsSnapshot = await getDocs(visitsCollection);

      for (const visitDoc of visitsSnapshot.docs) {
        const visitData = visitDoc.data();
        if (!visitData.lines) continue;

        // Handle lines - could be array or object
        const linesArray = Array.isArray(visitData.lines) ? visitData.lines : Object.values(visitData.lines);

        for (const line of linesArray) {
          if (line.heads && (Array.isArray(line.heads) ? line.heads.length > 0 : Object.keys(line.heads).length > 0)) {
            const headsArray = Array.isArray(line.heads) ? line.heads : Object.values(line.heads);

            for (const head of headsArray) {
              // Add heads that are offline OR have been fixed
              const isOffline = head.status === 'offline' || head.status === 'Offline';
              const isFixed = head.fixed === true || head.fixed === 'Yes' || head.fixed === 'yes' || head.fixed === 'fixed' || head.fixed === 'Fixed';

              if (isOffline || isFixed) {
                customerIssues.push({
                  id: `${visitDoc.id}-${line.title || line.name || 'line'}-${head.name || head.id || 'head'}`,
                  customer: customerName,
                  line: line.title || line.name || 'Unknown Line',
                  visitId: visitDoc.id,
                  date: visitData.date,
                  headName: head.name || head.id,
                  status: head.status,
                  error: head.error || head.errorMessage || 'No error info',
                  fixed: head.fixed
                });
              }
            }
          }
        }
      }
      return customerIssues;
    }));

    const issues = perCustomerIssues.flat();

    // Count offline heads (active issues)
    const activeIssues = issues.filter(issue => {
      return issue.status === 'offline' || issue.status === 'Offline';
    }).length;

    // Get recent/offline issues
    const recentIssues = issues
      .filter(issue => issue.status === 'offline' || issue.status === 'Offline')
      .slice(0, 5);

    const result = {
      issues,
      activeIssues,
      totalIssues: issues.length,
      recentIssues
    };

    // Cache the result
    setCache('downtime', result);

    return result;
  } catch (error) {
    console.error('Error fetching downtime data:', error);
    return {
      issues: [],
      activeIssues: 0,
      totalIssues: 0,
      recentIssues: []
    };
  }
};

// ============================================
// Inventory + Parts Manual fetchers
// ============================================
async function waitForUser(authObj) {
  if (authObj.currentUser) return authObj.currentUser;
  return new Promise((resolve) => {
    const unsub = authObj.onAuthStateChanged((u) => { unsub(); resolve(u); });
  });
}

export const fetchInventoryData = async () => {
  if (isCacheValid('inventory')) return dataCache.inventory;
  try {
    const user = await waitForUser(ccwIssuesAuth);
    if (!user) return { parts: [], boards: [] };
    const userRoot = `user_files/${user.uid}`;
    const [partsSnap, boardsSnap] = await Promise.all([
      getDocs(collection(ccwIssuesDb, `${userRoot}/parts`)),
      getDocs(collection(ccwIssuesDb, `${userRoot}/boards`)),
    ]);
    const parts = partsSnap.docs.map((d) => ({ id: d.id, type: 'part', ...d.data() }));
    const boards = boardsSnap.docs.map((d) => ({ id: d.id, type: 'board', ...d.data() }));
    const result = { parts, boards };
    setCache('inventory', result);
    return result;
  } catch (e) {
    console.error('Error fetching inventory:', e);
    return { parts: [], boards: [] };
  }
};

export const fetchPartsManualDiagrams = async () => {
  if (isCacheValid('partsManual')) return dataCache.partsManual;
  try {
    await waitForUser(jobsMasterAuth);
    const snap = await getDocs(collection(jobsMasterDb, 'parts-viewer-diagrams'));
    const diagrams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setCache('partsManual', diagrams);
    return diagrams;
  } catch (e) {
    console.error('Error fetching parts manual diagrams:', e);
    return [];
  }
};

// Fetch Timesheet Data
export const fetchTimesheetData = async () => {
  // Check cache first
  if (isCacheValid('timesheets')) {
    return dataCache.timesheets;
  }

  try {
    const timesheetsCollection = collection(timesheetDb, 'timesheets');
    const timesheetsSnapshot = await getDocs(timesheetsCollection);
    const timesheets = timesheetsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Calculate this week's hours
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const hoursThisWeek = timesheets.reduce((sum, timesheet) => {
      const date = timesheet.date?.toDate?.() || new Date(timesheet.date || 0);
      if (date >= startOfWeek) {
        const hours = parseFloat(timesheet.hours || 0);
        return sum + hours;
      }
      return sum;
    }, 0);

    // Calculate total hours
    const totalHours = timesheets.reduce((sum, timesheet) => {
      return sum + parseFloat(timesheet.hours || 0);
    }, 0);

    const result = {
      timesheets,
      hoursThisWeek,
      totalHours,
      totalEntries: timesheets.length
    };

    // Cache the result
    setCache('timesheets', result);

    return result;
  } catch (error) {
    console.error('Error fetching timesheet data:', error);
    return {
      timesheets: [],
      hoursThisWeek: 0,
      totalHours: 0,
      totalEntries: 0
    };
  }
};

// ============================================
// Service Report Lookup
// ============================================
// Joins timesheets (invoiceInfo.invoiceNumber == service report #) with CCW
// Issues visits (globalData.serviceReportNumber) on a normalized number, so a
// single report number surfaces its invoice/timesheet AND its weigher visit.
// ============================================
// Manually entered invoices and service reports
// ============================================
// The Reports page joins two systems that generate their own records: invoices
// come from the timesheet app, weigher visits from CCW Issues. Plenty of real
// work lives in neither — an invoice raised outside the timesheet app, a report
// written up for a job that was never logged as a visit — and until now there
// was no way to say so. The number showed up half-matched forever, or not at
// all, and the "unmatched" filter was full of things that were not actually
// missing.
//
// These live in their own collection rather than being written into the
// timesheet or CCW collections: a hand-typed invoice is not a timesheet, and a
// fake visit would appear in CCW Issues as a machine record that never
// happened. They are merged into the join at read time, flagged `manual` so the
// page can label them and offer edit and delete — a derived record cannot be
// edited here, but one you typed should be.
export const MANUAL_REPORTS = 'unified_manual_reports';

const normalizeReportNumber = (n) => String(n || '').trim().replace(/[\s-]/g, '').toUpperCase();

export const fetchManualReports = async () => {
  const snap = await getDocs(collection(jobsMasterDb, MANUAL_REPORTS));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// The PDF is optional and goes to the same project the collection lives in.
// Named by document id, so replacing a file never collides with another entry's.
const uploadManualFile = async (docId, file) => {
  const safe = String(file.name || 'attachment.pdf').replace(/[^A-Za-z0-9._-]/g, '_');
  const path = `manual-reports/${docId}/${safe}`;
  await uploadBytes(ref(jobsStorage, path), file, { contentType: file.type || 'application/pdf' });
  return { filePath: path, fileName: safe, fileUrl: await getDownloadURL(ref(jobsStorage, path)) };
};

export const saveManualReport = async ({ id, kind, number, customer, date, invoiceNumber, amount, notes, file, removeFile }) => {
  const trimmedNumber = String(number || '').trim();
  if (!trimmedNumber) throw new Error('A service report number is required.');
  if (kind !== 'invoice' && kind !== 'report') throw new Error('Unknown entry type.');
  if (!String(customer || '').trim()) throw new Error('A customer is required.');

  const parsedAmount = amount === '' || amount == null ? null : Number(amount);
  if (parsedAmount != null && !Number.isFinite(parsedAmount)) throw new Error('Amount must be a number.');

  const base = {
    kind,
    number: trimmedNumber,
    norm: normalizeReportNumber(trimmedNumber),
    customer: String(customer).trim(),
    date: date || '',
    invoiceNumber: String(invoiceNumber || '').trim(),
    amount: parsedAmount,
    notes: String(notes || '').trim(),
    updatedAt: serverTimestamp(),
  };

  let docId = id;
  if (docId) {
    await updateDoc(doc(jobsMasterDb, MANUAL_REPORTS, docId), base);
  } else {
    const created = await addDoc(collection(jobsMasterDb, MANUAL_REPORTS), { ...base, createdAt: serverTimestamp() });
    docId = created.id;
  }

  // File handling runs after the document exists so the path can be keyed to
  // its id. A failure here must not lose what was typed, so it is reported
  // separately rather than rolling the whole save back.
  if (removeFile && !file) {
    const existing = id ? (await getDoc(doc(jobsMasterDb, MANUAL_REPORTS, docId))).data() : null;
    if (existing?.filePath) {
      try { await deleteObject(ref(jobsStorage, existing.filePath)); } catch (e) { console.warn('Could not delete attachment:', e); }
    }
    await updateDoc(doc(jobsMasterDb, MANUAL_REPORTS, docId), { filePath: null, fileName: null, fileUrl: null });
  } else if (file) {
    const meta = await uploadManualFile(docId, file);
    await updateDoc(doc(jobsMasterDb, MANUAL_REPORTS, docId), meta);
  }

  clearDataCache();
  return docId;
};

export const deleteManualReport = async (id) => {
  const snap = await getDoc(doc(jobsMasterDb, MANUAL_REPORTS, id));
  const data = snap.exists() ? snap.data() : null;
  if (data?.filePath) {
    try { await deleteObject(ref(jobsStorage, data.filePath)); } catch (e) { console.warn('Could not delete attachment:', e); }
  }
  await deleteDoc(doc(jobsMasterDb, MANUAL_REPORTS, id));
  clearDataCache();
};

export const fetchServiceReports = async () => {
  // Normalize for the JOIN only (strip spaces/dashes, upper-case) so small
  // formatting differences ("2025-016" vs "2025016") still match. Original text
  // is preserved for display.
  const normalize = (n) => String(n || '').trim().replace(/[\s-]/g, '').toUpperCase();
  const yearOf = (norm) => { const m = /^(\d{4})/.exec(norm); return m ? m[1] : 'Other'; };

  try {
    // --- Timesheets (reuses the cached timesheet fetch) ---
    const tsResult = await fetchTimesheetData();
    const timesheets = (tsResult?.timesheets || []).map((t) => {
      const raw = t.invoiceInfo?.invoiceNumber || '';
      // Per-day "work performed" text (serviceReportData is keyed by date string).
      const srd = t.serviceReportData || {};
      const dates = Array.isArray(t.entries) && t.entries.length ? t.entries.map((e) => e.date) : Object.keys(srd);
      const serviceWork = dates
        .map((d) => ({ date: d, text: (srd[d] || '').trim() }))
        .filter((x) => x.text)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      return {
        kind: 'timesheet',
        id: t.id,
        number: raw,
        norm: normalize(raw),
        customer: t.customer || t.customerInfo?.company || 'Unknown',
        customerInfo: t.customerInfo || {},
        invoiceInfo: t.invoiceInfo || {},
        entryCount: Array.isArray(t.entries) ? t.entries.length : 0,
        serviceWork,
      };
    });

    // --- CCW Issues visits ---
    const userId = 'tgezUokMZ1PO7iEDbLbj2U7Uwbx1';
    const customersSnapshot = await getDocs(collection(ccwIssuesDb, 'user_files', userId, 'customers'));
    const perCustomer = await Promise.all(customersSnapshot.docs.map(async (customerDoc) => {
      const customerName = customerDoc.id;
      const visitsSnap = await getDocs(collection(ccwIssuesDb, 'user_files', userId, 'customers', customerDoc.id, 'visits'));
      return visitsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((v) => !v.deleted)
        .map((v) => {
          const raw = v.globalData?.serviceReportNumber || '';
          const linesArr = Array.isArray(v.lines) ? v.lines : (v.lines ? Object.values(v.lines) : []);
          return {
            kind: 'visit',
            visitId: v.id,
            customerId: customerName,
            customer: customerName,
            number: raw,
            norm: normalize(raw),
            name: v.name || '',
            date: v.date || '',
            serviceReportUrl: v.serviceReportUrl || null,
            lineCount: linesArr.length,
            lines: linesArr.map((l) => ({
              title: l.title || l.name || 'Line',
              headCount: Array.isArray(l.heads) ? l.heads.length : (l.heads ? Object.keys(l.heads).length : 0),
            })),
          };
        });
    }));
    const visits = perCustomer.flat();

    // --- Manually entered records ---
    // Read separately so one failure here (a permission problem, an offline
    // moment) leaves the derived halves of the page intact rather than blanking
    // the whole screen. `manual: true` is what the UI keys edit/delete off.
    let manual = [];
    try {
      manual = (await fetchManualReports()).map((m) => ({
        ...m,
        manual: true,
        kind: m.kind === 'invoice' ? 'manual-invoice' : 'manual-report',
        norm: m.norm || normalize(m.number),
        // The two sides render different fields; give each the shape its
        // section already expects so nothing downstream special-cases them.
        ...(m.kind === 'invoice'
          ? { invoiceInfo: { invoiceNumber: m.invoiceNumber || '' }, entryCount: 0,
              serviceWork: m.notes ? [{ date: m.date, text: m.notes }] : [] }
          : { visitId: m.id, lineCount: 0, lines: [], serviceReportUrl: m.fileUrl || null }),
      }));
    } catch (e) {
      console.warn('Could not load manually entered reports:', e);
    }

    // --- Join by normalized number ---
    const map = new Map();
    const add = (item, side) => {
      if (!item.norm) return; // no number → tracked separately as untagged
      if (!map.has(item.norm)) {
        map.set(item.norm, { number: item.number, norm: item.norm, year: yearOf(item.norm), timesheets: [], visits: [] });
      }
      map.get(item.norm)[side].push(item);
    };
    timesheets.forEach((t) => add(t, 'timesheets'));
    visits.forEach((v) => add(v, 'visits'));
    // A manual entry counts as its side being present, so a number that was
    // only ever half-recorded stops being reported as unmatched once you say
    // what the other half was.
    manual.forEach((m) => add(m, m.kind === 'manual-invoice' ? 'timesheets' : 'visits'));

    const reports = [...map.values()].sort((a, b) => b.norm.localeCompare(a.norm));
    const years = [...new Set(reports.map((r) => r.year))].sort((a, b) => b.localeCompare(a));

    return {
      reports,
      years,
      untaggedVisits: visits.filter((v) => !v.norm),
      untaggedTimesheets: timesheets.filter((t) => !t.norm),
    };
  } catch (error) {
    console.error('Error fetching service reports:', error);
    return { reports: [], years: [], untaggedVisits: [], untaggedTimesheets: [] };
  }
};

// Fetch all activity across all databases
export const fetchRecentActivity = async () => {
  try {
    const activities = [];

    // Get recent jobs - sort by SR number (highest = most recent)
    const jobsData = await fetchJobsData();
    const sortedJobs = [...jobsData.jobs].sort((a, b) => {
      const srA = parseInt(a.sr || 0);
      const srB = parseInt(b.sr || 0);
      return srB - srA;
    });

    sortedJobs.slice(0, 5).forEach(job => {
      const status = isPaid(job.paid) ? 'Paid' : 'Unpaid';
      activities.push({
        type: 'job',
        message: `SR ${job.sr || 'N/A'} - ${job.customer || 'Unknown'} (${status})`,
        time: job.date || 'Recently',
        timestamp: job.date ? new Date(job.date) : new Date(),
        url: 'https://jti-jobs.pages.dev/'
      });
    });

    // Get recent downtime issues
    const downtimeData = await fetchDowntimeData();
    downtimeData.issues.slice(0, 5).forEach(issue => {
      const fixedStatus = issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? 'Fixed' : 'Offline';
      activities.push({
        type: 'downtime',
        message: `${issue.customer || 'Unknown'} - ${issue.line} (${fixedStatus})`,
        time: issue.date || 'Recently',
        timestamp: issue.date ? new Date(issue.date) : new Date(),
        url: 'https://jti-issues.pages.dev/'
      });
    });

    // Get recent timesheets - sort by timestamp
    const timesheetData = await fetchTimesheetData();
    const sortedTimesheets = [...timesheetData.timesheets].sort((a, b) => {
      const dateA = a.timestamp?.toDate?.() || new Date(a.timestamp || 0);
      const dateB = b.timestamp?.toDate?.() || new Date(b.timestamp || 0);
      return dateB - dateA;
    });

    sortedTimesheets.slice(0, 5).forEach(timesheet => {
      const invoiceNum = timesheet.invoiceInfo?.invoiceNumber || timesheet.visitName || 'N/A';
      activities.push({
        type: 'timesheet',
        message: `${invoiceNum} - ${timesheet.customer || timesheet.visitName || 'Unknown'}`,
        time: formatRelativeTime(timesheet.timestamp?.toDate?.() || new Date(timesheet.timestamp || 0)),
        timestamp: timesheet.timestamp?.toDate?.() || new Date(timesheet.timestamp || 0),
        url: 'https://jti-timesheet.pages.dev/'
      });
    });

    // Sort by timestamp (most recent first)
    activities.sort((a, b) => b.timestamp - a.timestamp);

    return activities.slice(0, 10);
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    return [];
  }
};

// Helper function to format relative time
const formatRelativeTime = (date) => {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
};

// Fetch unique customers list from all databases with source tracking
export const fetchCustomersList = async () => {
  try {
    // Fetch all data in parallel
    const [jobsData, downtimeData, timesheetData] = await Promise.all([
      fetchJobsData(),
      fetchDowntimeData(),
      fetchTimesheetData()
    ]);

    // Track customers and their sources
    const customersMap = new Map();

    // From jobs
    jobsData.jobs.forEach(job => {
      const customer = job.customer || job.customerName;
      if (customer && customer.trim() && customer.toLowerCase() !== 'unknown customer') {
        const name = customer.trim();
        if (!customersMap.has(name)) {
          customersMap.set(name, { name, sources: [] });
        }
        if (!customersMap.get(name).sources.includes('Jobs')) {
          customersMap.get(name).sources.push('Jobs');
        }
      }
    });

    // From issues
    downtimeData.issues.forEach(issue => {
      if (issue.customer && issue.customer.trim() && issue.customer.toLowerCase() !== 'unknown') {
        const name = issue.customer.trim();
        if (!customersMap.has(name)) {
          customersMap.set(name, { name, sources: [] });
        }
        if (!customersMap.get(name).sources.includes('Downtime')) {
          customersMap.get(name).sources.push('Downtime');
        }
      }
    });

    // From timesheets
    timesheetData.timesheets.forEach(timesheet => {
      const customer = timesheet.customer || timesheet.visitName;
      if (customer && customer.trim() && customer.toLowerCase() !== 'unknown') {
        const name = customer.trim();
        if (!customersMap.has(name)) {
          customersMap.set(name, { name, sources: [] });
        }
        if (!customersMap.get(name).sources.includes('Timesheets')) {
          customersMap.get(name).sources.push('Timesheets');
        }
      }
    });

    // Convert to sorted array
    const customers = Array.from(customersMap.values()).sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );

    return customers;
  } catch (error) {
    console.error('Error fetching customers list:', error);
    return [];
  }
};

// Fetch all data for a specific customer
export const fetchCustomerData = async (customerName) => {
  if (!customerName) {
    return { jobs: [], issues: [], timesheets: [] };
  }

  try {
    // Fetch all data in parallel
    const [jobsData, downtimeData, timesheetData] = await Promise.all([
      fetchJobsData(),
      fetchDowntimeData(),
      fetchTimesheetData()
    ]);

    const term = customerName.toLowerCase();

    // Filter jobs for this customer
    const customerJobs = jobsData.jobs.filter(job => {
      const jobCustomer = (job.customer || job.customerName || '').toLowerCase();
      return jobCustomer.includes(term) || term.includes(jobCustomer);
    });

    // Filter issues for this customer
    const customerIssues = downtimeData.issues.filter(issue => {
      const issueCustomer = (issue.customer || '').toLowerCase();
      return issueCustomer.includes(term) || term.includes(issueCustomer);
    });

    // Filter timesheets for this customer
    const customerTimesheets = timesheetData.timesheets.filter(timesheet => {
      const tsCustomer = (timesheet.customer || timesheet.visitName || '').toLowerCase();
      return tsCustomer.includes(term) || term.includes(tsCustomer);
    });

    // Sort by date (most recent first)
    const sortByDate = (a, b) => {
      const dateA = a.date?.toDate?.() || new Date(a.date || a.timestamp || 0);
      const dateB = b.date?.toDate?.() || new Date(b.date || b.timestamp || 0);
      return dateB - dateA;
    };

    customerJobs.sort(sortByDate);
    customerIssues.sort((a, b) => {
      const dateA = a.timestamp?.toDate?.() || new Date(a.timestamp || 0);
      const dateB = b.timestamp?.toDate?.() || new Date(b.timestamp || 0);
      return dateB - dateA;
    });
    customerTimesheets.sort(sortByDate);

    // Calculate totals - use actual if available, otherwise quote
    const totalIncome = sumIncome(customerJobs);
    const paidIncome = sumIncome(customerJobs, { paidOnly: true });

    return {
      jobs: customerJobs,
      issues: customerIssues,
      timesheets: customerTimesheets,
      totalJobs: customerJobs.length,
      totalIssues: customerIssues.length,
      totalTimesheets: customerTimesheets.length,
      totalIncome,
      paidIncome,
      unpaidIncome: totalIncome - paidIncome
    };
  } catch (error) {
    console.error('Error fetching customer data:', error);
    return { jobs: [], issues: [], timesheets: [] };
  }
};

// Lowercased JSON blob per record, memoized by object identity. Cached fetch
// results hand back the same object references across keystrokes, so this turns
// the per-keystroke JSON.stringify of every record into a one-time cost.
const recordBlobCache = new WeakMap();
const recordBlob = (rec) => {
  if (rec === null || typeof rec !== 'object') return String(rec).toLowerCase();
  let blob = recordBlobCache.get(rec);
  if (blob === undefined) {
    blob = JSON.stringify(rec).toLowerCase();
    recordBlobCache.set(rec, blob);
  }
  return blob;
};

// Unified search function - search by customer name or service report number
export const searchUnified = async (searchTerm) => {
  if (!searchTerm || searchTerm.trim() === '') {
    return {
      jobs: [],
      issues: [],
      timesheets: [],
      headHistory: [],
      parts: [],
      boards: [],
      diagrams: [],
      totalResults: 0
    };
  }

  const term = searchTerm.trim().toLowerCase();

  // Generate search variations so "WH1" matches "WH 1", "100-689" matches
  // "100 689"/"100689", and so on. Anything alphanumeric separated by
  // hyphen/slash/underscore/space should be interchangeable.
  const getSearchVariations = (searchTerm) => {
    const variations = new Set([searchTerm]);
    variations.add(searchTerm.replace(/([A-Za-z]+)(\d+)/g, '$1 $2'));
    variations.add(searchTerm.replace(/([A-Za-z]+)\s+(\d+)/g, '$1$2'));
    variations.add(searchTerm.replace(/(?<=[A-Za-z0-9])[-_/.](?=[A-Za-z0-9])/g, ' '));
    variations.add(searchTerm.replace(/(?<=[A-Za-z0-9])[-_/.\s](?=[A-Za-z0-9])/g, ''));
    variations.add(searchTerm.replace(/(?<=[A-Za-z0-9])\s+(?=[A-Za-z0-9])/g, '-'));
    return [...variations].filter(Boolean);
  };

  const searchVariations = getSearchVariations(term);
  // Fully-stripped form of the search term — used to compare against a
  // similarly-stripped haystack so part numbers like "000-071-0881-06" match
  // "000.071.0881.06", "000071088106", "000 071 0881 06", etc.
  const stripSeparators = (s) => String(s).toLowerCase().replace(/[-_/.\s]+/g, '');
  const termStripped = stripSeparators(term);
  const matchesAny = (haystack) => {
    const lower = String(haystack).toLowerCase();
    if (searchVariations.some((v) => lower.includes(v))) return true;
    if (termStripped && stripSeparators(lower).includes(termStripped)) return true;
    return false;
  };

  try {
    // Fetch all data in parallel
    const [jobsData, downtimeData, timesheetData, headHistoryResults, inventoryData, diagramsData] = await Promise.all([
      fetchJobsData(),
      fetchDowntimeData(),
      fetchTimesheetData(),
      searchHeadHistory(searchTerm),
      fetchInventoryData(),
      fetchPartsManualDiagrams()
    ]);

    // Helper function to find matched fields in an object
    const findMatchedFields = (obj, searchTerm, prefix = '') => {
      const matches = [];

      const searchInValue = (value, key, path) => {
        if (value === null || value === undefined) return;

        if (typeof value === 'string') {
          const valueLower = value.toLowerCase();
          if (searchVariations.some(variant => valueLower.includes(variant))) {
            matches.push({ field: path || key, value: value });
          }
        } else if (typeof value === 'number') {
          const numStr = value.toString().toLowerCase();
          if (searchVariations.some(variant => numStr.includes(variant))) {
            matches.push({ field: path || key, value: value.toString() });
          }
        } else if (Array.isArray(value)) {
          value.forEach((item, index) => {
            searchInValue(item, `${key}[${index}]`, `${path ? path + '.' : ''}${key}[${index}]`);
          });
        } else if (typeof value === 'object') {
          if (value.toDate) return;
          Object.entries(value).forEach(([k, v]) => {
            searchInValue(v, k, `${path ? path + '.' : ''}${key}.${k}`);
          });
        }
      };

      Object.entries(obj).forEach(([key, value]) => {
        searchInValue(value, key, key);
      });

      return matches;
    };

    const matchingJobs = jobsData.jobs.filter(job => matchesAny(recordBlob(job))).map(job => ({
      ...job,
      matchedFields: findMatchedFields(job, term)
    }));

    const matchingIssues = downtimeData.issues.filter(issue => matchesAny(recordBlob(issue))).map(issue => ({
      ...issue,
      matchedFields: findMatchedFields(issue, term)
    }));

    const matchingTimesheets = timesheetData.timesheets.filter(timesheet => matchesAny(recordBlob(timesheet))).map(timesheet => ({
      ...timesheet,
      matchedFields: findMatchedFields(timesheet, term)
    }));

    // Sort results by date (most recent first)
    const sortByDate = (a, b) => {
      const dateA = a.date?.toDate?.() || new Date(a.date || a.timestamp || 0);
      const dateB = b.date?.toDate?.() || new Date(b.date || b.timestamp || 0);
      return dateB - dateA;
    };

    matchingJobs.sort(sortByDate);
    matchingIssues.sort((a, b) => {
      const dateA = a.timestamp?.toDate?.() || new Date(a.timestamp || 0);
      const dateB = b.timestamp?.toDate?.() || new Date(b.timestamp || 0);
      return dateB - dateA;
    });
    matchingTimesheets.sort(sortByDate);

    // Inventory parts: search across name, sku, location, notes, category, customers.
    const matchInventoryItem = (item) => {
      const fields = [
        item.name, item.sku, item.partNumber, item.location, item.notes, item.category,
        item.model, item.revision, item.serial,
        ...(Array.isArray(item.customers) ? item.customers : []),
      ].filter(Boolean).join(' ');
      return matchesAny(fields);
    };
    const matchingParts = (inventoryData.parts || []).filter(matchInventoryItem);
    const matchingBoards = (inventoryData.boards || []).filter(matchInventoryItem);

    // Parts manual diagrams: search the diagram name AND partsData.
    // partsData is often keyed by hotspot index (e.g., 17, 28) and the real
    // part number is jammed into a free-text partName/description blob.
    // Pull part numbers out of the text via regex so they can be displayed
    // and highlighted cleanly.
    const PN_RE = /\b\d{2,4}[-_/.\s]+\d{1,4}[-_/.\s]+\d{1,5}(?:[-_/.\s]+\d{1,4})?\b/g;
    const extractPartNumbers = (text) => {
      if (!text) return [];
      const out = [];
      const seen = new Set();
      String(text).replace(PN_RE, (m) => {
        const cleaned = m.trim();
        if (!seen.has(cleaned)) { seen.add(cleaned); out.push(cleaned); }
        return m;
      });
      return out;
    };

    // Walk the entire `info` value (which may itself contain a nested
    // `parts` array, a `rows` array, or freeform fields) and harvest every
    // string we encounter — that becomes the searchable blob and the source
    // we mine for part numbers + part names.
    const collectStrings = (value, out) => {
      if (value == null) return;
      if (typeof value === 'string' || typeof value === 'number') {
        out.push(String(value));
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v) => collectStrings(v, out));
        return;
      }
      if (typeof value === 'object') {
        Object.values(value).forEach((v) => collectStrings(v, out));
      }
    };

    const matchingDiagrams = [];
    (diagramsData || []).forEach((diagram) => {
      const diagramName = diagram.name || '';
      const matchedParts = [];
      const partsData = diagram.partsData || {};

      Object.entries(partsData).forEach(([key, info]) => {
        if (info == null) return;
        const allStrings = [];
        collectStrings(info, allStrings);
        const textBlob = allStrings.join(' ');
        const pnFromText = extractPartNumbers(textBlob);

        // Pull explicit metadata if present, otherwise rely on regex extraction.
        const explicitPartNumber = (info && (info.partNumber || info.part_number || info.pn)) || '';
        const partName = (info && (info.partName || info.part_name || info.name)) || '';
        const desc = (info && (info.description || info.notes || info.detail)) || '';
        const partNumber = explicitPartNumber || pnFromText[0] || '';

        if (matchesAny(`${key} ${textBlob}`)) {
          matchedParts.push({
            hotspotKey: key,
            partNumber,
            allPartNumbers: pnFromText,
            partName: partName || (textBlob.length > 200 ? textBlob.slice(0, 200) + '…' : textBlob),
            description: desc,
            qty: info && (info.qty || info.quantity),
          });
        }
      });

      // Final safety net: if no hotspot row matched but the search term IS
      // somewhere in the diagram document, surface the diagram anyway so the
      // user can drill in. This catches schemas we haven't anticipated.
      const wholeDiagramStrings = [];
      collectStrings(diagram, wholeDiagramStrings);
      const diagramBlob = wholeDiagramStrings.join(' ');
      const diagramHits = matchesAny(diagramBlob);

      if (matchedParts.length > 0 || diagramHits) {
        matchingDiagrams.push({
          id: diagram.id,
          name: diagram.name || 'Untitled diagram',
          customer: diagram.customer || diagram.customerName || '',
          matchedParts,
          totalParts: Object.keys(partsData).length,
          updatedAt: diagram.updatedAt || diagram.createdAt || null,
        });
      }
    });

    return {
      jobs: matchingJobs,
      issues: matchingIssues,
      timesheets: matchingTimesheets,
      headHistory: headHistoryResults,
      parts: matchingParts,
      boards: matchingBoards,
      diagrams: matchingDiagrams,
      totalResults:
        matchingJobs.length + matchingIssues.length + matchingTimesheets.length +
        headHistoryResults.length + matchingParts.length + matchingBoards.length +
        matchingDiagrams.length,
      searchTerm: searchTerm.trim()
    };
  } catch (error) {
    console.error('Error searching unified data:', error);
    return {
      jobs: [],
      issues: [],
      timesheets: [],
      headHistory: [],
      parts: [],
      boards: [],
      diagrams: [],
      totalResults: 0,
      error: error.message
    };
  }
};

// Fetch Calendar Events from Timesheets and Shearers Database
export const fetchCalendarEvents = async () => {
  try {
    const events = [];

    // Fetch timesheet events
    const timesheetsCollection = collection(timesheetDb, 'timesheets');
    const timesheetsSnapshot = await getDocs(timesheetsCollection);

    // Normalize any of the date formats we might find ("4/21/2008",
    // "04/21/2008", "4/21/08", "2008-04-21", Firestore Timestamp, Date) into
    // an ISO YYYY-MM-DD string the calendar grid can match.
    const toIsoDateString = (raw) => {
      if (!raw) return null;
      if (raw?.toDate) {
        const d = raw.toDate();
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      }
      if (raw instanceof Date) {
        return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
        const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) {
          const [, mo, da, yr] = m;
          return `${expandYear(yr)}-${pad2(+mo)}-${pad2(+da)}`;
        }
        const d = new Date(trimmed);
        if (!Number.isNaN(d.getTime())) {
          return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        }
      }
      return null;
    };

    timesheetsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const customer = data.customer || data.visitName || 'Unknown';
      const visitName = data.visitName || '';
      const entries = data.entries || [];

      // Extract dates from entries (normalize whatever format is stored).
      entries.forEach(entry => {
        const iso = toIsoDateString(entry.date);
        if (iso) {
          events.push({
            id: doc.id,
            date: iso,
            customer: customer,
            visitName: visitName,
            hours: entry.hours || 0,
            serviceWork: data.serviceReportData?.[entry.date] || '',
            timestamp: data.timestamp,
            invoiceNumber: data.invoiceInfo?.invoiceNumber || '',
            type: 'timesheet'
          });
        }
      });

      // If no entries but has timestamp, use that as the date
      if (entries.length === 0 && data.timestamp) {
        const date = data.timestamp?.toDate?.() || new Date(data.timestamp);
        // Local, not toISOString() — that's UTC, so a visit saved after 5pm in
        // Arizona landed on the following day in the grid.
        const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
        events.push({
          id: doc.id,
          date: dateStr,
          customer: customer,
          visitName: visitName,
          hours: 0,
          serviceWork: '',
          timestamp: data.timestamp,
          invoiceNumber: data.invoiceInfo?.invoiceNumber || '',
          type: 'timesheet'
        });
      }
    });

    // Fetch onsite events from Shearers database
    const headHistoryData = await fetchHeadHistoryData();
    if (headHistoryData.calendarEvents && headHistoryData.calendarEvents.length > 0) {
      events.push(...headHistoryData.calendarEvents);
    }

    // Add historical visits parsed from Service Work Master List.docx.
    events.push(...getDocxCalendarEvents());

    // Sort by date descending
    events.sort((a, b) => new Date(b.date) - new Date(a.date));

    return events;
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    return [];
  }
};

// Delete a specific entry from a timesheet by date
export const deleteTimesheetEntry = async (docId, entryDate) => {
  try {
    const docRef = doc(timesheetDb, 'timesheets', docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Timesheet not found');
    }

    const data = docSnap.data();
    const entries = data.entries || [];

    // Filter out the entry with the matching date
    const updatedEntries = entries.filter(entry => entry.date !== entryDate);

    // Also remove from serviceReportData if it exists
    const serviceReportData = { ...(data.serviceReportData || {}) };
    delete serviceReportData[entryDate];

    // If no entries left, delete the whole document
    if (updatedEntries.length === 0) {
      await deleteDoc(docRef);
    } else {
      // Update the document with remaining entries
      await updateDoc(docRef, {
        entries: updatedEntries,
        serviceReportData: serviceReportData
      });
    }

    return true;
  } catch (error) {
    console.error('Error deleting timesheet entry:', error);
    throw error;
  }
};

// Delete an entire timesheet document
export const deleteTimesheet = async (docId) => {
  try {
    const docRef = doc(timesheetDb, 'timesheets', docId);
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    console.error('Error deleting timesheet:', error);
    throw error;
  }
};

// Fetch Head History data from Shearers Realtime Database
export const fetchHeadHistoryData = async () => {
  // Check cache first
  if (isCacheValid('headHistory')) {
    return dataCache.headHistory;
  }

  try {
    const entries = [];
    const calendarEvents = [];

    // Specific paths to query
    const pathsToQuery = [
      'jti-downtime/head-history',
      'jti-downtime/main-logger/data'
    ];

    // Helper to normalize date to YYYY-MM-DD format
    const normalizeDate = (dateVal) => {
      if (!dateVal) return null;

      if (typeof dateVal === 'string' && dateVal.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateVal;
      }

      const dateObj = new Date(dateVal);
      if (!isNaN(dateObj.getTime())) {
        // Local date — UTC would shift evening entries onto the next day.
        return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
      }

      return null;
    };

    // Helper to extract dates from an object recursively
    const extractDates = (obj, path = '', source = '') => {
      if (!obj || typeof obj !== 'object') return;

      if (obj.date || obj.visitDate || obj.timestamp) {
        const dateStr = normalizeDate(obj.date || obj.visitDate || obj.timestamp);
        if (dateStr) {
          const entry = {
            path: path,
            source: source,
            ...obj
          };
          entries.push(entry);

          let serviceWorkParts = [];
          if (obj.notes) serviceWorkParts.push(obj.notes);
          if (obj.machineNotes) serviceWorkParts.push(`Machine Notes: ${obj.machineNotes}`);
          if (obj.line) serviceWorkParts.push(`Line: ${obj.line}`);
          if (obj.status) serviceWorkParts.push(`Status: ${obj.status}`);
          if (obj.repairStatus) serviceWorkParts.push(`Repair: ${obj.repairStatus}`);
          if (obj.fixed !== undefined) serviceWorkParts.push(`Fixed: ${obj.fixed}`);
          if (obj.error) serviceWorkParts.push(`Error: ${obj.error}`);
          if (obj.description) serviceWorkParts.push(obj.description);
          if (obj.action) serviceWorkParts.push(`Action: ${obj.action}`);

          calendarEvents.push({
            id: `${source}-${path || Date.now()}`,
            date: dateStr,
            customer: obj.customer || obj.machine || obj.location || 'Shearers',
            visitName: obj.line ? `Line: ${obj.line}` : 'Onsite',
            hours: 0,
            serviceWork: serviceWorkParts.join(' | '),
            status: obj.status,
            repairStatus: obj.repairStatus,
            line: obj.line,
            type: 'onsite'
          });
        }
      }

      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => {
          extractDates(item, `${path}[${idx}]`, source);
        });
        return;
      }

      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          extractDates(obj[key], path ? `${path}/${key}` : key, source);
        }
      }
    };

    // Query each path
    for (const pathName of pathsToQuery) {
      try {
        const pathRef = dbRef(shearersRealtimeDb, pathName);
        const snapshot = await get(pathRef);

        if (snapshot.exists()) {
          const data = snapshot.val();
          extractDates(data, '', pathName);
        }
      } catch (err) {
        // Path doesn't exist or access denied
      }
    }

    // Remove duplicate dates
    const uniqueEvents = [];
    const seenDates = new Set();
    calendarEvents.forEach(event => {
      const key = `${event.date}-${event.customer}`;
      if (!seenDates.has(key)) {
        seenDates.add(key);
        uniqueEvents.push(event);
      }
    });

    const result = { entries, calendarEvents: uniqueEvents };

    // Cache the result
    setCache('headHistory', result);

    return result;
  } catch (error) {
    console.error('Error fetching head history:', error);
    return { entries: [], calendarEvents: [] };
  }
};

// Search Head History for notes and machine notes
export const searchHeadHistory = async (searchTerm) => {
  try {
    const results = [];
    const term = searchTerm.toLowerCase();
    const seenPaths = new Set();

    const pathsToQuery = [
      'jti-downtime/head-history',
      'jti-downtime/main-logger/data'
    ];

    // Generate search variations (mirrors searchUnified's logic).
    const getSearchVariations = (searchTerm) => {
      const variations = new Set([searchTerm]);
      variations.add(searchTerm.replace(/([A-Za-z]+)(\d+)/g, '$1 $2'));
      variations.add(searchTerm.replace(/([A-Za-z]+)\s+(\d+)/g, '$1$2'));
      variations.add(searchTerm.replace(/(?<=[A-Za-z0-9])[-_/](?=[A-Za-z0-9])/g, ' '));
      variations.add(searchTerm.replace(/(?<=[A-Za-z0-9])[-_/\s](?=[A-Za-z0-9])/g, ''));
      variations.add(searchTerm.replace(/(?<=[A-Za-z0-9])\s+(?=[A-Za-z0-9])/g, '-'));
      return [...variations].filter(Boolean);
    };

    const searchVariations = getSearchVariations(term);

    const searchInObject = (obj, path = '', source = '') => {
      if (!obj || typeof obj !== 'object') return;

      const matchedFields = [];

      const checkField = (fieldName, value) => {
        if (value && typeof value === 'string') {
          const valueLower = value.toLowerCase();
          if (searchVariations.some(variant => valueLower.includes(variant))) {
            matchedFields.push({ field: fieldName, value: value });
          }
        }
      };

      checkField('notes', obj.notes);
      checkField('machineNotes', obj.machineNotes);
      checkField('machine', obj.machine);
      checkField('customer', obj.customer);
      checkField('location', obj.location);
      checkField('action', obj.action);
      checkField('description', obj.description);
      checkField('error', obj.error);
      checkField('head', obj.head);
      checkField('line', obj.line);
      checkField('status', obj.status);
      checkField('repairStatus', obj.repairStatus);

      if (matchedFields.length > 0) {
        const uniqueKey = `${source}-${path}`;
        if (!seenPaths.has(uniqueKey)) {
          seenPaths.add(uniqueKey);

          results.push({
            path: path,
            source: source,
            customer: obj.customer || obj.machine || obj.location || 'Shearers',
            date: obj.date || obj.visitDate || obj.timestamp || '',
            status: obj.status || obj.Status,
            repairStatus: obj.repaired || obj.repairStatus || obj.repair_status || obj.RepairStatus,
            line: obj.line || obj.Line,
            error: obj.issue || obj.error || obj.Error || obj.errorMessage,
            fixed: obj.fixed || obj.Fixed || obj.repaired,
            head: obj.head,
            matchedFields: matchedFields,
            data: obj
          });
        }
      }

      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => {
          searchInObject(item, `${path}[${idx}]`, source);
        });
        return;
      }

      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          searchInObject(obj[key], path ? `${path}/${key}` : key, source);
        }
      }
    };

    // Query each path
    for (const pathName of pathsToQuery) {
      try {
        const pathRef = dbRef(shearersRealtimeDb, pathName);
        const snapshot = await get(pathRef);

        if (snapshot.exists()) {
          const data = snapshot.val();
          searchInObject(data, '', pathName);
        }
      } catch (err) {
        // Path doesn't exist or access denied
      }
    }

    return results;
  } catch (error) {
    console.error('Error searching head history:', error);
    return [];
  }
};

// ============================================
// FACTORY LOCATIONS - Firebase Persistence
// ============================================

const FACTORY_LOCATIONS_DOC = 'jti-unified-settings';
const FACTORY_LOCATIONS_COLLECTION = 'settings';

// Fetch factory locations from Firebase
export const fetchFactoryLocations = async () => {
  try {
    const docRef = doc(jobsMasterDb, FACTORY_LOCATIONS_COLLECTION, FACTORY_LOCATIONS_DOC);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return data.factoryLocations || [];
    }
    return [];
  } catch (error) {
    console.error('Error fetching factory locations:', error);
    const saved = localStorage.getItem('jti-factory-locations');
    return saved ? JSON.parse(saved) : [];
  }
};

// Save factory locations to Firebase
export const saveFactoryLocations = async (factories) => {
  try {
    const docRef = doc(jobsMasterDb, FACTORY_LOCATIONS_COLLECTION, FACTORY_LOCATIONS_DOC);
    await setDoc(docRef, {
      factoryLocations: factories,
      lastUpdated: new Date().toISOString()
    }, { merge: true });

    localStorage.setItem('jti-factory-locations', JSON.stringify(factories));
    return true;
  } catch (error) {
    console.error('Error saving factory locations to Firebase:', error);
    localStorage.setItem('jti-factory-locations', JSON.stringify(factories));
    return false;
  }
};

// Subscribe to factory locations changes (real-time updates)
export const subscribeToFactoryLocations = (callback) => {
  try {
    const docRef = doc(jobsMasterDb, FACTORY_LOCATIONS_COLLECTION, FACTORY_LOCATIONS_DOC);
    return onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        callback(data.factoryLocations || []);
      } else {
        callback([]);
      }
    }, (error) => {
      console.error('Error in factory locations subscription:', error);
      const saved = localStorage.getItem('jti-factory-locations');
      callback(saved ? JSON.parse(saved) : []);
    });
  } catch (error) {
    console.error('Error setting up factory locations subscription:', error);
    return null;
  }
};
