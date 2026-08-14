import { collection, getDocs, query, where, orderBy, limit, doc, deleteDoc, updateDoc, getDoc, setDoc, addDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { showsWithoutEntries } from './utils/timesheetVisibility.js';
import { matchPackets, matchCustomerRecords } from './utils/searchExtras.js';
import { ref, getDownloadURL, getBlob, uploadBytes, deleteObject } from 'firebase/storage';
import { ref as dbRef, get } from 'firebase/database';
import { ccwIssuesDb, jobsMasterDb, timesheetDb, jobsStorage, ccwIssuesStorage, shearersRealtimeDb, ccwIssuesAuth, jobsMasterAuth } from './firebase-config';
import serviceLog from './components/Troubleshoot/serviceLog.json';
import { isPaid, jobAmount, sumIncome } from './utils/format';
import { matchCustomer, consolidateCustomers, normalizeCustomerName } from '@shared/utils/customerMatch.js';
import { customerDefaults, missingDefaults } from '@shared/utils/customerDefaults.js';

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

    // Apply any corrections before anything counts or groups these jobs, so a
    // reassigned job leaves the old customer's totals as well as joining the
    // new one's. Applied here rather than at each call site: a correction that
    // only some screens honoured would be worse than none.
    const overrides = await fetchJobCustomerOverrides();
    const jobs = overrides.size === 0 ? allJobs : allJobs.map((job) => {
      const to = overrides.get(srKey(job.sr || job.invoiceNumber));
      return to ? { ...job, customer: to, customerName: to, customerCorrected: true } : job;
    });

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


// ============================================
// Job → customer corrections
// ============================================
//
// Jobs are read from JSON files in Storage that the Jobs Tracker writes. They
// cannot be corrected in place from here: the next export would overwrite the
// change, and the two apps would disagree about the same job.
//
// So a correction is recorded ALONGSIDE the job, keyed by service report
// number, and applied when the jobs are read. The original file stays exactly
// as the Jobs Tracker wrote it, the correction survives the next export, and
// undoing one is deleting a row.
//
// The case this exists for: a company with more than one plant, whose jobs were
// filed under the bare company name. "Ajinomoto" alone does not say whether it
// was Oakland or Portland, and only somebody who was there knows.
export const JOB_CUSTOMER_OVERRIDES = 'unified_job_customer_overrides';

const srKey = (n) => String(n || '').trim().replace(/[\s-]/g, '').toUpperCase();

export const fetchJobCustomerOverrides = async () => {
  try {
    const snap = await getDocs(collection(jobsMasterDb, JOB_CUSTOMER_OVERRIDES));
    const map = new Map();
    snap.docs.forEach((d) => {
      const v = d.data() || {};
      if (v.customer) map.set(srKey(v.sr || d.id), v.customer);
    });
    return map;
  } catch (error) {
    console.error('Error fetching job customer overrides:', error);
    return new Map();
  }
};

/** File this service report's job against a different customer. */
export const setJobCustomer = async (sr, customer, note = '') => {
  const key = srKey(sr);
  if (!key) throw new Error('A service report number is required.');
  if (!String(customer || '').trim()) throw new Error('A customer is required.');
  await setDoc(doc(collection(jobsMasterDb, JOB_CUSTOMER_OVERRIDES), key), {
    sr: key,
    customer: String(customer).trim(),
    note: String(note || '').trim(),
    updatedAt: new Date().toISOString(),
  });
  clearDataCache();
  return true;
};

/** Undo a correction — the job goes back to whatever the Jobs Tracker says. */
export const clearJobCustomer = async (sr) => {
  await deleteDoc(doc(collection(jobsMasterDb, JOB_CUSTOMER_OVERRIDES), srKey(sr)));
  clearDataCache();
  return true;
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

    // One entry per actual customer. The raw list carries the same plant under
    // every spelling each source happened to use; consolidation folds those
    // together WITHOUT folding two sites of one company together — see
    // consolidateCustomers.
    const records = await fetchCustomerRecords();
    return consolidateCustomers(Array.from(customersMap.values()), records);
  } catch (error) {
    console.error('Error fetching customers list:', error);
    return [];
  }
};

// Fetch all data for a specific customer
export const fetchCustomerData = async (customerName) => {
  if (!customerName) {
    return { record: null, visits: [], jobs: [], issues: [], timesheets: [] };
  }

  try {
    // Fetch all data in parallel
    const [jobsData, downtimeData, timesheetData, records] = await Promise.all([
      fetchJobsData(),
      fetchDowntimeData(),
      fetchTimesheetData(),
      fetchCustomerRecords()
    ]);

    // The customer RECORD — address, contacts, invoice emails — and the visits
    // filed against it. Null when no record answers to this name, which the
    // screen turns into "link this to a customer" rather than a blank card.
    const record = matchCustomer(customerName, records);
    const visits = record ? await fetchCustomerVisits(record.id) : [];

    // Which spellings count as THIS customer.
    //
    // This used to be a substring test in both directions, which quietly made
    // "Ajinomoto" pick up Ajinomoto Portland's jobs and Ajinomoto Oakland's
    // hours — two plants' money under one name. A customer is its own name,
    // every spelling recorded against its record, and nothing else.
    const spellings = new Set([
      normalizeCustomerName(customerName),
      ...(record ? [normalizeCustomerName(record.name), ...(record.profile?.aliases || []).map(normalizeCustomerName)] : []),
    ].filter(Boolean));
    const isOurs = (value) => spellings.has(normalizeCustomerName(value));

    // Filter jobs for this customer
    const customerJobs = jobsData.jobs.filter(job => isOurs(job.customer || job.customerName));

    // Filter issues for this customer
    const customerIssues = downtimeData.issues.filter(issue => isOurs(issue.customer));

    // Filter timesheets for this customer
    const customerTimesheets = timesheetData.timesheets.filter(
      timesheet => isOurs(timesheet.customer || timesheet.visitName));

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
      record,
      visits,
      jobs: customerJobs,
      issues: customerIssues,
      timesheets: customerTimesheets,
      totalVisits: visits.length,
      totalJobs: customerJobs.length,
      totalIssues: customerIssues.length,
      totalTimesheets: customerTimesheets.length,
      totalIncome,
      paidIncome,
      unpaidIncome: totalIncome - paidIncome
    };
  } catch (error) {
    console.error('Error fetching customer data:', error);
    return { record: null, visits: [], jobs: [], issues: [], timesheets: [] };
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
      packets: [],
      customers: [],
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
    const [jobsData, downtimeData, timesheetData, headHistoryResults, inventoryData, diagramsData,
           packetsMap, customerRecords] = await Promise.all([
      fetchJobsData(),
      fetchDowntimeData(),
      fetchTimesheetData(),
      searchHeadHistory(searchTerm),
      fetchInventoryData(),
      fetchPartsManualDiagrams(),
      // Packets and the customer directory — the two sources the box could not
      // see. Both are single collection reads, in the same parallel batch.
      fetchAllPackets().catch(() => new Map()),
      fetchCustomerRecords().catch(() => []),
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

    // Reuses matchesAny, so a receipt or a contact is found by the same
    // "WH1" = "WH 1" rules as everything else in the box.
    const matchingPackets = matchPackets([...packetsMap.values()], matchesAny);
    const matchingCustomers = matchCustomerRecords(customerRecords, matchesAny);

    return {
      jobs: matchingJobs,
      issues: matchingIssues,
      timesheets: matchingTimesheets,
      headHistory: headHistoryResults,
      parts: matchingParts,
      boards: matchingBoards,
      diagrams: matchingDiagrams,
      packets: matchingPackets,
      customers: matchingCustomers,
      totalResults:
        matchingJobs.length + matchingIssues.length + matchingTimesheets.length +
        headHistoryResults.length + matchingParts.length + matchingBoards.length +
        matchingDiagrams.length + matchingPackets.length + matchingCustomers.length,
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
      packets: [],
      customers: [],
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

      // If no entries but has timestamp, use that as the date — so a timesheet
      // saved before day rows existed still shows up rather than vanishing.
      //
      // Unless its days were deleted on purpose: that is an empty timesheet
      // somebody emptied, and redrawing it here on its save date would undo the
      // deletion in front of them.
      if (entries.length === 0 && showsWithoutEntries(data)) {
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

    // Remove the DAY. Never the timesheet.
    //
    // Deleting the last day used to delete the whole document, and the dialog
    // that asked only ever said "delete this entry for <customer> on <date>".
    // Everything else on that record went with it — the invoice number, the
    // customer details, the machines, every service note — with no undo and no
    // warning that it was even at risk. Removing the one day somebody logged by
    // mistake is not a request to destroy the job's paperwork.
    //
    // An emptied timesheet is kept, and `deleteTimesheet` remains the way to
    // remove a whole record deliberately.
    await updateDoc(docRef, {
      entries: updatedEntries,
      serviceReportData: serviceReportData,
      // Marks the empty state as INTENDED. The calendar dates a timesheet with
      // no entries by its save timestamp so old records aren't invisible —
      // without this the day just deleted would come straight back, sitting on
      // whatever date the timesheet happened to be saved.
      ...(updatedEntries.length === 0 ? { entriesEmptiedAt: new Date().toISOString() } : {}),
    });

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

// ============================================
// Customer records: address, contacts, invoice emails, visits
// ============================================
//
// The customer record lives in the CCW database, at
// user_files/{WORKSPACE_UID}/customers/{id}, under a `profile` map. That is
// where CCW Issues and Headcount already keep a plant's name and address, so
// this extends the record every app shares rather than starting a second one
// that would immediately disagree with it.

export const WORKSPACE_UID = 'tgezUokMZ1PO7iEDbLbj2U7Uwbx1';

const customersRef = () => collection(ccwIssuesDb, 'user_files', WORKSPACE_UID, 'customers');

/** Every customer record JTI holds: id, name, and the profile map. */
export const fetchCustomerRecords = async () => {
  try {
    const snap = await getDocs(customersRef());
    return snap.docs.map((d) => {
      const data = d.data() || {};
      const profile = data.profile || {};
      return {
        id: d.id,
        // The name lives on the profile in CCW; older docs kept it at the top.
        name: profile.name || data.name || '',
        profile: {
          address: '', cityState: '', contacts: [], invoiceEmails: [], aliases: [], notes: '',
          ...profile,
        },
      };
    }).filter((c) => c.name);
  } catch (error) {
    console.error('Error fetching customer records:', error);
    return [];
  }
};

/**
 * Update part of a customer's profile, leaving the rest alone.
 *
 * A merge rather than a write: the same document carries headCount and the
 * name that CCW Issues and Headcount depend on, and replacing it wholesale
 * from this screen would quietly drop whatever this screen does not know about.
 */
export const saveCustomerProfile = async (customerId, patch) => {
  if (!customerId) throw new Error('No customer record to save against.');
  const ref = doc(customersRef(), customerId);
  const snap = await getDoc(ref);
  const existing = (snap.exists() ? snap.data()?.profile : null) || {};
  await setDoc(ref, {
    profile: { ...existing, ...patch, updatedAt: new Date().toISOString() },
  }, { merge: true });
  // Push the copy the timesheet reads. Fire-and-forget: a directory that failed
  // to update must not make it look like the record failed to save, and the
  // next save or the Publish button will catch it up.
  publishToTimesheet().catch((e) => console.warn('Could not update the timesheet directory:', e));
  return { ...existing, ...patch };
};

/** JTI's service visits for one customer, newest first. */
export const fetchCustomerVisits = async (customerId) => {
  if (!customerId) return [];
  try {
    const snap = await getDocs(collection(customersRef(), customerId, 'visits'));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((v) => !v.deleted)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  } catch (error) {
    console.error('Error fetching customer visits:', error);
    return [];
  }
};

// ============================================
// Job packets: PO + invoice + service report + receipts, as one PDF
// ============================================
//
// Files are kept per service report number, because that is the number the
// job, the invoice and the service report already share — the one thing every
// system here agrees on.
export const JOB_PACKETS = 'unified_job_packets';

const packetKey = (sr) => String(sr || '').trim().replace(/[\s-]/g, '').toUpperCase();

/**
 * Bytes for a file already in the system.
 *
 * Uses the SDK's getBlob rather than fetch. A download URL fetched cross-origin
 * needs a CORS rule on the bucket, and the failure is a browser-level error the
 * app cannot even see the body of — whereas getBlob goes through the SDK's own
 * authenticated path. The two buckets are tried in turn because a service
 * report lives with CCW and an uploaded invoice lives with Jobs.
 */
export const fetchFileBytes = async (urlOrPath) => {
  if (!urlOrPath) return null;

  // A full download URL is fetched directly. It carries its own access token,
  // and ref() mis-parses one — the ?alt=media&token=... is not part of any
  // object path, so the SDK looks for a file that does not exist and throws.
  if (/^https?:\/\//i.test(urlOrPath)) {
    try {
      const res = await fetch(urlOrPath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      console.warn('Could not read file for packet:', urlOrPath, err);
      return null;
    }
  }

  // A bare STORAGE PATH. Older visits stored the service report this way, so
  // both shapes are in the data and both have to work.
  //
  // CCW's bucket is tried first because that is where service reports live.
  // And a download URL plus a plain fetch is preferred over getBlob: the
  // tokenised URL is a simple GET that needs no preflight, where getBlob sends
  // authorization headers and does. getBlob stays as the fallback for anything
  // the first route cannot reach.
  // CCW's service reports and photos are NOT readable from storage at all —
  // the rules deny them outright and the media broker serves them with a
  // service account. So a bare path goes through the broker, exactly as the
  // CCW apps do.
  //
  // This is why one visit merged and another did not: a visit that stored a
  // tokenised download URL worked, because a token bypasses the rules, while a
  // visit that stored a plain path had nothing to bypass them with.
  try {
    const user = ccwIssuesAuth.currentUser;
    if (user) {
      const idToken = await user.getIdToken();
      const encoded = String(urlOrPath).split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`https://ccw-media.josh-c80.workers.dev/a/${encoded}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    }
  } catch { /* fall through to the buckets this app owns */ }

  // Jobs-project paths (packet uploads) are ordinary storage reads.
  for (const store of [jobsStorage, ccwIssuesStorage]) {
    try {
      const blob = await getBlob(ref(store, urlOrPath));
      return new Uint8Array(await blob.arrayBuffer());
    } catch { /* try the other bucket */ }
  }
  console.warn('Could not read file for packet:', urlOrPath);
  return null;
};

/** What the system already holds for this service report. */
// Resolve one report's sources from lists already in hand.
//
// Split out so the packet page and the job board read a job the same way. When
// this was inline, the only way to ask "does 2026028 have an invoice?" for
// thirty jobs was to call the single-job version thirty times — or to write a
// second copy of these rules that would drift from this one.
const sourcesFromLists = (sr, report, manual) => {
  const key = packetKey(sr);
  const visitWithFile = (report?.visits || []).find((v) => v.serviceReportUrl);
  const invoiceEntry = (manual || []).find(
    (m) => m.kind === 'invoice' && (packetKey(m.number) === key || packetKey(m.invoiceNumber) === key));
  const reportEntry = (manual || []).find((m) => m.kind === 'report' && packetKey(m.number) === key);
  return {
    serviceReportUrl: visitWithFile?.serviceReportUrl || reportEntry?.fileUrl || null,
    serviceReportName: visitWithFile?.serviceReportUrl ? `Service report ${sr}.pdf` : (reportEntry?.fileName || null),
    customer: (report?.visits || []).find((v) => v.customer)?.customer
      || (report?.timesheets || []).find((t) => t.customer && t.customer !== 'Unknown')?.customer
      || '',
    date: (report?.visits || [])[0]?.date || (report?.timesheets || [])[0]?.date || '',
    invoiceUrl: invoiceEntry?.fileUrl || null,
    invoiceName: invoiceEntry?.fileName || null,
    invoiceNumber: invoiceEntry?.invoiceNumber || invoiceEntry?.number || null,
    amount: invoiceEntry?.amount ?? null,
  };
};

export const fetchPacketSources = async (sr) => {
  const key = packetKey(sr);
  const [reports, manual] = await Promise.all([fetchServiceReports(), fetchManualReports()]);
  // A report entry carries no customer or file of its own: both live on the
  // visits and timesheets joined to it by number.
  const list = reports?.reports || reports || [];
  return sourcesFromLists(sr, list.find((r) => packetKey(r.number) === key), manual);
};

/** Every packet in one read, keyed by service report number. */
export const fetchAllPackets = async () => {
  const snap = await getDocs(collection(jobsMasterDb, JOB_PACKETS));
  const byKey = new Map();
  snap.docs.forEach((d) => byKey.set(d.id, { id: d.id, files: [], ...d.data() }));
  return byKey;
};

/**
 * Everything the job board needs, in a fixed number of reads.
 *
 * One read for the packets and the usual cached fetches for the rest — NOT a
 * per-job round trip. A board that costs a Firestore read per job is a board
 * that gets slower every month it is used, which is the surest way to stop
 * anybody opening it.
 */
export const fetchJobBoardRows = async () => {
  const [reports, manual, packets, started, jobsData] = await Promise.all([
    fetchServiceReports(),
    fetchManualReports(),
    fetchAllPackets(),
    fetchUnifiedJobs(),
    fetchJobsData(),
  ]);
  const list = reports?.reports || reports || [];
  const trackerJobs = jobsData?.jobs || jobsData || [];
  const trackerFor = (sr) => trackerJobs.find(
    (j) => packetKey(j.sr || j.invoiceNumber) === packetKey(sr)) || null;

  // Numbers with history, plus ones started here the tracker has not seen. A
  // job reserved this morning belongs on the board today, not once it has been
  // through another app.
  const seen = new Set(list.map((r) => packetKey(r.number)));
  const rows = list.map((r) => {
    const sources = sourcesFromLists(r.number, r, manual);
    return {
      sr: r.number,
      customer: sources.customer,
      date: sources.date,
      job: trackerFor(r.number),
      sources,
      packet: packets.get(packetKey(r.number)) || { files: [] },
    };
  });

  (started || []).forEach((j) => {
    if (seen.has(packetKey(j.sr))) return;
    rows.push({
      sr: j.sr,
      customer: j.customer || '',
      date: j.date || '',
      job: trackerFor(j.sr),
      sources: sourcesFromLists(j.sr, null, manual),
      packet: packets.get(packetKey(j.sr)) || { files: [] },
    });
  });

  return rows;
};

/** The packet record: everything uploaded against this service report. */
export const fetchPacket = async (sr) => {
  const snap = await getDoc(doc(jobsMasterDb, JOB_PACKETS, packetKey(sr)));
  return snap.exists() ? { id: snap.id, files: [], ...snap.data() } : { id: packetKey(sr), files: [] };
};

/**
 * Add a file to a packet.
 *
 * Stored under the service report number and stamped with the time, so
 * uploading two receipts photographed a second apart cannot have one quietly
 * replace the other.
 */
export const addPacketFile = async (sr, kind, file, extra = {}) => {
  const key = packetKey(sr);
  if (!key) throw new Error('A service report number is required.');
  const safe = String(file.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const path = `job-packets/${key}/${kind}-${Date.now()}-${safe}`;
  await uploadBytes(ref(jobsStorage, path), file, { contentType: file.type || 'application/octet-stream' });
  const url = await getDownloadURL(ref(jobsStorage, path));
  const entry = { kind, name: safe, path, url, type: file.type || '', uploadedAt: new Date().toISOString(), ...extra };
  const current = await fetchPacket(key);
  await setDoc(doc(jobsMasterDb, JOB_PACKETS, key),
    { sr: key, files: [...(current.files || []), entry] }, { merge: true });
  return entry;
};

/**
 * Set fields on one file already in a packet — an amount, a vendor.
 *
 * Merged into the entry rather than written over it: the upload recorded where
 * the file is, and losing that to save a number typed next to it would leave a
 * receipt in the packet that nothing can find.
 */
export const updatePacketFile = async (sr, path, patch) => {
  const key = packetKey(sr);
  const current = await fetchPacket(key);
  const files = (current.files || []).map((f) => (f.path === path ? { ...f, ...patch } : f));
  await setDoc(doc(jobsMasterDb, JOB_PACKETS, key), { sr: key, files }, { merge: true });
  return files;
};

/** Remove one file from a packet, and from storage. */
export const removePacketFile = async (sr, path) => {
  const key = packetKey(sr);
  const current = await fetchPacket(key);
  await setDoc(doc(jobsMasterDb, JOB_PACKETS, key),
    { sr: key, files: (current.files || []).filter((f) => f.path !== path) }, { merge: true });
  try { await deleteObject(ref(jobsStorage, path)); } catch (e) { console.warn('Could not delete packet file:', e); }
  return true;
};

/** Record that a packet was built and sent, so "did we invoice this?" has an answer. */
export const markPacketBuilt = async (sr, { notes = '' } = {}) => {
  const key = packetKey(sr);
  await setDoc(doc(jobsMasterDb, JOB_PACKETS, key),
    { sr: key, notes, builtAt: new Date().toISOString() }, { merge: true });
  return true;
};

// ============================================
// Starting a job, and its service report number
// ============================================
//
// The number is allocated HERE and the job is created in the Jobs Tracker.
// That split is deliberate: the Tracker rewrites the whole jobs-{year}.json on
// every save, so anything this app wrote into that file would be erased the
// next time somebody pressed save over there. Two writers and one whole-file
// document is a race nobody wins.
//
// So this app owns the number and the workflow around it; the Tracker stays
// the record of the job, its quote and its amount.
export const UNIFIED_JOBS = 'unified_jobs';

export const fetchUnifiedJobs = async () => {
  try {
    const snap = await getDocs(collection(jobsMasterDb, UNIFIED_JOBS));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching started jobs:', error);
    return [];
  }
};

/**
 * Reserve a service report number.
 *
 * Written with create-if-absent semantics so two people starting a job at the
 * same moment cannot both be handed the same number — the second one fails and
 * is told to try again rather than quietly sharing.
 */
export const startJob = async ({ sr, customer, date, description }) => {
  const key = String(sr || '').trim().toUpperCase();
  if (!key) throw new Error('A service report number is required.');
  if (!String(customer || '').trim()) throw new Error('A customer is required.');

  const ref2 = doc(jobsMasterDb, UNIFIED_JOBS, key);
  const existing = await getDoc(ref2);
  if (existing.exists()) {
    throw new Error(`${key} has already been started. Refresh and take the next number.`);
  }
  const record = {
    sr: key,
    customer: String(customer).trim(),
    date: date || '',
    description: String(description || '').trim(),
    createdAt: new Date().toISOString(),
  };
  await setDoc(ref2, record);
  // Push it out immediately. Reserving a number and having it appear nowhere
  // until somebody happened to save a customer is the same as not reserving it:
  // the point is that the next person to need it can pick it rather than type
  // it. Fire-and-forget — a directory that failed to update must not make it
  // look like the number failed to reserve.
  publishToTimesheet().catch((e) => console.warn('Could not publish the new number:', e));
  return record;
};

/**
 * Close a reserved service report number.
 *
 * A job gets cancelled and its number would otherwise sit in every picker in
 * three apps forever. Closing hides it without deleting it — the number stays
 * spoken for, because handing it out again would put two jobs under one number
 * in systems that cannot tell them apart.
 */
export const closeJob = async (sr, closed = true) => {
  const key = String(sr || '').trim().toUpperCase();
  if (!key) throw new Error('A service report number is required.');
  await setDoc(doc(jobsMasterDb, UNIFIED_JOBS, key),
    { sr: key, closedAt: closed ? new Date().toISOString() : null }, { merge: true });
  await publishToTimesheet().catch((e) => console.warn('Directory not updated:', e));
  return true;
};

/**
 * Release a reserved number back into the pool.
 *
 * Different from closing, and deliberately so. Closing says "this job is not
 * happening, but the number is spent" — which is right when the number has been
 * written on something. Releasing says "this reservation should never have
 * existed", and the number becomes the next one offered again.
 *
 * Only safe when NOTHING was ever filed against it. Two jobs sharing a number
 * cannot be told apart afterwards by any of the four systems that key on it, so
 * the caller must establish that first — see the guard in the packet screen.
 */
export const releaseJobNumber = async (sr) => {
  const key = String(sr || '').trim().toUpperCase();
  if (!key) throw new Error('A service report number is required.');
  await deleteDoc(doc(jobsMasterDb, UNIFIED_JOBS, key));
  // ...and the packet record, or the number comes back carrying the previous
  // job's notes and file list.
  await deleteDoc(doc(jobsMasterDb, JOB_PACKETS, key)).catch(() => {});
  // Take it out of the directories too, or it lingers in the other apps'
  // pickers pointing at a reservation that no longer exists.
  await Promise.all([
    deleteDoc(doc(timesheetDb, SR_DIRECTORY, key)).catch(() => {}),
    deleteDoc(doc(ccwIssuesDb, 'user_files', WORKSPACE_UID, SR_DIRECTORY, key)).catch(() => {}),
  ]);
  return true;
};

/** Record that the packet actually went to accounts payable. */
export const markPacketSent = async (sr, to = []) => {
  const key = String(sr || '').trim().replace(/[\s-]/g, '').toUpperCase();
  await setDoc(doc(jobsMasterDb, JOB_PACKETS, key),
    { sr: key, sentAt: new Date().toISOString(), sentTo: to }, { merge: true });
  return true;
};

/**
 * Everything another app needs about a job, from its service report number.
 *
 * The point of the dashboard being the centre: a timesheet asks for one number
 * and gets the customer and their standing details back, instead of somebody
 * retyping eight fields per visit and spelling the plant differently each time.
 *
 * `defaults` is already in the shape a timesheet's customer form expects, so
 * the caller copies rather than translates. `missing` says which fields the
 * record could not supply, so a half-filled form can say why.
 */
export const lookupJobDefaults = async (sr) => {
  const key = String(sr || '').trim();
  if (!key) return null;
  const [sources, records, started] = await Promise.all([
    fetchPacketSources(key), fetchCustomerRecords(), fetchUnifiedJobs(),
  ]);
  const name = sources?.customer || started.find((j) => String(j.sr) === key)?.customer || '';
  const record = name ? matchCustomer(name, records) : null;
  return {
    sr: key,
    customer: record?.name || name || '',
    date: sources?.date || '',
    invoiceNumber: sources?.invoiceNumber || '',
    defaults: customerDefaults(record),
    missing: missingDefaults(record),
  };
};

// ============================================
// Publishing the customer directory to the timesheet app
// ============================================
//
// Firebase Auth is per PROJECT. The timesheet app signs into timesheetapp-c4e54
// and that sign-in says nothing to downtimelogger-a96fb, where the customer
// records live — so it cannot read them, however much it would like to. Asking
// a technician to sign into a second project to fill in a timesheet is not a
// feature.
//
// So the directory is pushed to where the timesheet can already read: its own
// project. The dashboard stays the place customers are EDITED — one record,
// one truth — and this is a copy for reading, stamped so a stale one is
// obvious. Nothing here is authoritative; delete it all and republish and
// nothing is lost.
export const CUSTOMER_DIRECTORY = 'customer_directory';
export const SR_DIRECTORY = 'sr_directory';

export const publishToTimesheet = async () => {
  const [records, started] = await Promise.all([fetchCustomerRecords(), fetchUnifiedJobs()]);
  const at = new Date().toISOString();

  // Defaults are computed HERE so the timesheet copies rather than interprets.
  // The rules for what a customer's details are should not be re-implemented in
  // an app whose job is hours and mileage.
  await Promise.all(records.map((r) => setDoc(doc(timesheetDb, CUSTOMER_DIRECTORY, r.id), {
    id: r.id,
    name: r.name,
    aliases: r.profile?.aliases || [],
    defaults: customerDefaults(r),
    missing: missingDefaults(r),
    updatedAt: at,
  })));

  // Jobs started in the dashboard, so a brand-new number is pickable on a
  // timesheet before it exists anywhere else. Historical numbers need no entry:
  // the timesheet app already has them on its own past sheets.
  // Closed numbers stay reserved but stop cluttering the pickers — and a
  // number closed AFTER it was published has to be removed, not merely skipped,
  // or it sits in the other app's list forever.
  await Promise.all(started.filter((j) => j.closedAt)
    .map((j) => deleteDoc(doc(timesheetDb, SR_DIRECTORY, String(j.sr))).catch(() => {})));

  await Promise.all(started.filter((j) => !j.closedAt).map((j) => setDoc(doc(timesheetDb, SR_DIRECTORY, String(j.sr)), {
    sr: String(j.sr),
    customer: j.customer || '',
    date: j.date || '',
    description: j.description || '',
    updatedAt: at,
  })));

  // ...and the same job numbers into the CCW project, so a visit can be tagged
  // by picking a number rather than typing one. Only the numbers go: CCW knows
  // its own customers, and the addresses and invoice emails are none of its
  // business.
  const openJobs = started.filter((j) => !j.closedAt);
  await Promise.all(started.filter((j) => j.closedAt)
    .map((j) => deleteDoc(doc(ccwIssuesDb, 'user_files', WORKSPACE_UID, SR_DIRECTORY, String(j.sr))).catch(() => {})));
  await Promise.all(openJobs.map((j) => setDoc(
    doc(ccwIssuesDb, 'user_files', WORKSPACE_UID, SR_DIRECTORY, String(j.sr)),
    { sr: String(j.sr), customer: j.customer || '', date: j.date || '', description: j.description || '', updatedAt: at },
  )));

  // ...and the customer directory into the Jobs project, so the Jobs app can
  // fill a city, state and terms from the same record rather than keeping its
  // own idea of who a customer is. It reads unified_jobs directly — same
  // project — so the numbers need no copy there.
  await Promise.all(records.map((r) => setDoc(doc(jobsMasterDb, CUSTOMER_DIRECTORY, r.id), {
    id: r.id,
    name: r.name,
    aliases: r.profile?.aliases || [],
    defaults: customerDefaults(r),
    updatedAt: at,
  })));

  return { customers: records.length, jobs: openJobs.length, at };
};

/**
 * Job numbers reserved in the dashboard, readable by CCW Issues.
 *
 * Lives under user_files/{WORKSPACE_UID} so the existing admin rules cover it
 * without a rules change: everything under there is already JTI-only.
 */
export const fetchReservedJobNumbers = async () => {
  try {
    const snap = await getDocs(collection(ccwIssuesDb, 'user_files', WORKSPACE_UID, SR_DIRECTORY));
    return snap.docs.map((d) => d.data()).sort((a, b) => String(b.sr).localeCompare(String(a.sr)));
  } catch (error) {
    console.error('Error reading reserved job numbers:', error);
    return [];
  }
};
