// xlsx is lazy-imported inside exportAccountStatement so the ~300 KB
// SheetJS bundle isn't paid on first dashboard load.

const isPaid = (paidValue) => {
  if (paidValue === true || paidValue === 1) return true;
  if (typeof paidValue === 'string') {
    const lower = paidValue.toLowerCase().trim();
    return lower === 'yes' || lower === 'true' || lower === '1' || lower === 'paid';
  }
  return false;
};

const fmtDate = (raw) => {
  if (!raw) return '';
  if (raw?.toDate) {
    const d = raw.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof raw === 'string') return raw.slice(0, 10);
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  } catch {}
  return '';
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const clip = (s, max = 32767) => {
  if (s == null) return '';
  const str = String(s);
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
};

const sortByDateDesc = (arr, key = 'date') =>
  [...arr].sort((a, b) => {
    const da = a?.[key]?.toDate?.() || new Date(a?.[key] || a?.timestamp || 0);
    const db = b?.[key]?.toDate?.() || new Date(b?.[key] || b?.timestamp || 0);
    return db - da;
  });

export async function exportAccountStatement(customerName, data) {
  const XLSX = await import('xlsx');
  const safeName = String(customerName || 'Customer')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 60);
  const todayIso = new Date().toISOString().slice(0, 10);

  const jobs = sortByDateDesc(data?.jobs || []);
  const issues = sortByDateDesc(data?.issues || [], 'timestamp');
  const timesheets = sortByDateDesc(data?.timesheets || []);

  const totalQuote = jobs.reduce((acc, j) => acc + num(j.quote), 0);
  const totalActual = jobs.reduce((acc, j) => acc + num(j.actual || j.quote), 0);
  const totalPaid = jobs.reduce(
    (acc, j) => acc + (isPaid(j.paid) ? num(j.actual || j.quote) : 0),
    0
  );
  const totalUnpaid = totalActual - totalPaid;
  const unpaidCount = jobs.filter((j) => !isPaid(j.paid)).length;
  const paidCount = jobs.length - unpaidCount;

  const wb = XLSX.utils.book_new();

  // Header that gets prepended to every sheet:
  //   Row 1: Joshua Todd Industries (merged across all columns)
  //   Row 2: Account Statement for <Customer> (merged)
  //   Row 3: blank
  //   Row 4+: actual data
  const HEADER_ROWS = 3;
  const headerLines = [
    'Joshua Todd Industries',
    `Account Statement for ${customerName || 'Customer'}`,
  ];
  const addHeader = (ws, colCount) => {
    XLSX.utils.sheet_add_aoa(ws, [[headerLines[0]], [headerLines[1]], []], { origin: 'A1' });
    ws['!merges'] = ws['!merges'] || [];
    if (colCount > 1) {
      ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } });
      ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } });
    }
    return ws;
  };
  const sheetFromJson = (rows, name, cols) => {
    const ws = XLSX.utils.json_to_sheet(rows, { origin: 'A4', dateNF: 'yyyy-mm-dd' });
    addHeader(ws, cols ? cols.length : (rows[0] ? Object.keys(rows[0]).length : 1));
    if (cols) ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  const sheetFromAoa = (rows, name, cols) => {
    const ws = XLSX.utils.aoa_to_sheet(rows, { origin: 'A4' });
    addHeader(ws, cols ? cols.length : (rows[0] ? rows[0].length : 1));
    if (cols) ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  // ---- Summary ----
  const summaryRows = [
    ['Generated', new Date().toLocaleString()],
    [],
    ['Totals', ''],
    ['Total quoted', totalQuote],
    ['Total actual / billed', totalActual],
    ['Total paid', totalPaid],
    ['Total outstanding', totalUnpaid],
    [],
    ['Counts', ''],
    ['Jobs total', jobs.length],
    ['Jobs paid', paidCount],
    ['Jobs unpaid', unpaidCount],
    ['Issues / Visits', issues.length],
    ['Timesheets', timesheets.length],
  ];
  sheetFromAoa(summaryRows, 'Summary', [{ wch: 28 }, { wch: 32 }]);

  // ---- Jobs ----
  if (jobs.length > 0) {
    const jobsRows = jobs.map((j) => ({
      'SR #': j.sr || '',
      Date: fmtDate(j.date),
      'PO #': j.po || j.poNumber || '',
      Description: clip(j.description || j.title || j.notes || ''),
      'Quote ($)': num(j.quote),
      'Actual ($)': num(j.actual || j.quote),
      Paid: isPaid(j.paid) ? 'Yes' : 'No',
      'Date paid': fmtDate(j.paidDate),
      'Invoice #': j.invoice || j.invoiceNumber || '',
      Notes: clip(j.notes || ''),
    }));
    sheetFromJson(jobsRows, 'Jobs', [
      { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 50 },
      { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 },
      { wch: 12 }, { wch: 50 },
    ]);
  }

  // ---- Issues / Visits (CCW Issues / Downtime) ----
  if (issues.length > 0) {
    const issueRows = issues.map((i) => ({
      Date: fmtDate(i.date || i.timestamp),
      Line: i.line || '',
      Head: i.head || (i.data && i.data.head) || '',
      Status: i.status || (isPaid(i.fixed) ? 'Fixed' : 'Open'),
      Issue: clip(i.issue || i.problem || i.description || ''),
      Resolution: clip(i.fix || i.resolution || ''),
      'Tech notes': clip(i.notes || (i.data && i.data.notes) || ''),
    }));
    sheetFromJson(issueRows, 'Issues', [
      { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 14 },
      { wch: 60 }, { wch: 60 }, { wch: 50 },
    ]);
  }

  // ---- Invoices: single combined list of every billable record ----
  // Pulls invoice rows from BOTH the Jobs Master (job.invoice / job.actual)
  // and timesheet docs (invoiceInfo.invoiceNumber / .amount). Each row:
  // Invoice #, Date, Amount, Paid, Owed.
  // Single source of truth: compute Owed first, then derive the displayed
  // Paid flag from Owed so they can never disagree — if nothing's owed,
  // the row reads Paid = Yes regardless of what the source flag says.
  const invoiceRows = [];
  jobs.forEach((j) => {
    const invNumber = j.invoice || j.invoiceNumber || j.sr || '';
    const amount = num(j.actual || j.quote);
    const flagPaid = isPaid(j.paid);
    if (!invNumber && amount === 0) return;
    const owed = flagPaid ? 0 : amount;
    invoiceRows.push({
      'Invoice #': invNumber,
      Date: fmtDate(j.invoiceDate || j.date),
      'Amount ($)': amount,
      Paid: owed <= 0 ? 'Yes' : 'No',
      'Owed ($)': owed,
    });
  });
  timesheets.forEach((t) => {
    const inv = t.invoiceInfo || {};
    const invNumber = inv.invoiceNumber || '';
    const amount = num(inv.amount);
    if (!invNumber && amount === 0) return;
    const flagPaid = isPaid(inv.paid) || isPaid(t.paid);
    const owed = flagPaid ? 0 : amount;
    invoiceRows.push({
      'Invoice #': invNumber,
      Date: fmtDate(inv.invoiceDate || t.timestamp || t.date),
      'Amount ($)': amount,
      Paid: owed <= 0 ? 'Yes' : 'No',
      'Owed ($)': owed,
    });
  });
  // Dedupe rows that share the same invoice number — same SR often shows up
  // in both Jobs Master and the Timesheet app. Keep the one whose Amount is
  // greater than 0; drop groups where every entry is $0.
  const dedupedRows = (() => {
    const byInv = new Map();
    const noInv = []; // rows with no invoice number — keep all that have amount > 0
    for (const row of invoiceRows) {
      const key = String(row['Invoice #'] || '').trim();
      const amt = num(row['Amount ($)']);
      if (!key) {
        if (amt > 0) noInv.push(row);
        continue;
      }
      const existing = byInv.get(key);
      if (!existing) {
        byInv.set(key, row);
        continue;
      }
      // Prefer whichever row has the higher amount.
      if (amt > num(existing['Amount ($)'])) byInv.set(key, row);
    }
    // Drop invoice-number groups whose only surviving row has amount 0.
    return [...byInv.values()].filter((r) => num(r['Amount ($)']) > 0).concat(noInv);
  })();
  invoiceRows.length = 0;
  invoiceRows.push(...dedupedRows);

  // Sort ascending by Invoice # (e.g. 2024036, 2024042, 2025014…).
  // Falls back to Date if a row has no invoice number.
  invoiceRows.sort((a, b) => {
    const an = String(a['Invoice #'] || '').trim();
    const bn = String(b['Invoice #'] || '').trim();
    if (an && bn) return an.localeCompare(bn, undefined, { numeric: true });
    if (an) return -1;
    if (bn) return 1;
    return (a.Date || '').localeCompare(b.Date || '');
  });

  if (invoiceRows.length > 0) {
    const totalAmount = invoiceRows.reduce((acc, r) => acc + num(r['Amount ($)']), 0);
    const totalOwed = invoiceRows.reduce((acc, r) => acc + num(r['Owed ($)']), 0);
    invoiceRows.push({
      'Invoice #': 'TOTAL',
      Date: '',
      'Amount ($)': totalAmount,
      Paid: '',
      'Owed ($)': totalOwed,
    });
    sheetFromJson(invoiceRows, 'Invoices', [
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 14 },
    ]);
  }

  // ---- Equipment Profile (extracted from text) ----
  const PN_RE = /\b\d{2,4}[-_/.]\d{1,4}[-_/.]\d{1,5}[-_/.]\d{1,4}\b/g;
  const pnCounts = new Map();
  const all = [...jobs, ...issues, ...timesheets];
  all.forEach((item) => {
    const text = JSON.stringify(item);
    const found = text.match(PN_RE) || [];
    found.forEach((p) => pnCounts.set(p, (pnCounts.get(p) || 0) + 1));
  });
  if (pnCounts.size > 0) {
    const partsRows = [...pnCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([part, count]) => ({ 'Part number': part, 'Mentions': count }));
    sheetFromJson(partsRows, 'Parts seen', [{ wch: 22 }, { wch: 10 }]);
  }

  XLSX.writeFile(wb, `${safeName}_AccountStatement_${todayIso}.xlsx`);
}
