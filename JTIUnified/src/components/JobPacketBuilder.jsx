// src/components/JobPacketBuilder.jsx
//
// Build one PDF for a job and send it to accounts payable.
//
// The service report number is the key: the job, the invoice and the service
// report already share it, so picking one number is enough to find most of the
// packet. What the system already holds is filled in automatically and labelled
// as such — the point is to stop somebody hunting for a file the app is already
// holding.
//
// What is missing is shown the whole time, not at the end. A packet is rejected
// by AP for being incomplete far more often than for being wrong, and the
// moment to learn the PO is missing is before sending it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileText, Mail, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import BusyOverlay from './BusyOverlay.jsx';
import {
  fetchPacket, fetchPacketSources, addPacketFile, removePacketFile, markPacketBuilt, fetchFileBytes,
  fetchUnifiedJobs, startJob, markPacketSent, closeJob, releaseJobNumber, updatePacketFile,
} from '../data-service';
import { jobFlowSteps, nextAction, flowProgress, nextServiceReportNumber } from '../utils/jobFlow';
import { buildPacket, describeUnsupported, packetEmail, packetFileName, receiptsTotal, money, SECTIONS } from '../utils/jobPacket';
import { matchCustomer } from '@shared/utils/customerMatch.js';
import { scanReceipt } from '../utils/scanReceipt';
import { isAbsoluteUrl } from '../utils/fileRef';
import BulkReceiptImport from './BulkReceiptImport';
// The same nine types the bulk importer offers. One list: two lists would let a
// receipt loaded in bulk carry a type the packet page cannot show or set.
import { CATEGORIES, guessCategory } from '../utils/bulkReceipts';
import * as ui from '../ui/theme';

const KINDS = [
  { key: 'po', label: 'Purchase order', hint: 'What the customer authorised' },
  { key: 'invoice', label: 'Invoice', hint: 'What we are asking for' },
  { key: 'serviceReport', label: 'Service report', hint: 'What we did' },
  { key: 'receipts', label: 'Receipts', hint: 'What it cost us', many: true },
];

export default function JobPacketBuilder({ colors, serviceReports = [], customerRecords = [], customers = [], jobs = [], initialSr = '', onClose }) {
  const [sr, setSr] = useState(initialSr);
  const [started, setStarted] = useState([]);
  const [newJob, setNewJob] = useState(null);   // the form, when open
  const [packet, setPacket] = useState({ files: [] });
  const [sources, setSources] = useState(null);
  const [busy, setBusy] = useState('');
  // What the busy message is ABOUT — the file in hand and how far through. Kept
  // beside `busy` rather than folded into it so the message stays a short
  // headline and the filename does not have to fit in a button.
  const [busyDetail, setBusyDetail] = useState('');
  const [busyProgress, setBusyProgress] = useState(null);

  // Cleared together, always. Three pieces of state that have to agree, cleared
  // at seven call sites, is a stale progress bar from the last upload showing
  // over the next operation the first time one of them is missed.
  const clearBusy = () => { setBusy(''); setBusyDetail(''); setBusyProgress(null); };
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState(null);
  const [scanNote, setScanNote] = useState('');

  const job = useMemo(
    () => serviceReports.find((r) => String(r.number) === String(sr)) || null,
    [serviceReports, sr]);

  // The report entry has no customer of its own — it is on the visits and
  // timesheets joined to it, and fetchPacketSources resolves the same way.
  const customerName = sources?.customer
    || (job?.visits || []).find((v) => v.customer)?.customer
    || (job?.timesheets || []).find((t) => t.customer && t.customer !== 'Unknown')?.customer
    || started.find((j) => String(j.sr) === String(sr))?.customer
    || '';
  const record = useMemo(
    () => (customerName ? matchCustomer(customerName, customerRecords) : null),
    [customerName, customerRecords]);
  const apEmails = record?.profile?.invoiceEmails || [];

  const load = useCallback(async (number) => {
    if (!number) { setPacket({ files: [] }); setSources(null); return; }
    setBusy('Loading what we already have…');
    try {
      const [p, s] = await Promise.all([fetchPacket(number), fetchPacketSources(number)]);
      setPacket(p);
      setSources(s);
      setNotes(p.notes || '');
    } catch (err) { setError(err.message || String(err)); }
    clearBusy();
  }, []);

  useEffect(() => { setResult(null); setError(''); load(sr); }, [sr, load]);
  useEffect(() => { fetchUnifiedJobs().then(setStarted).catch(() => {}); }, []);
  // /packet/2026028 opens on that job.
  useEffect(() => { if (initialSr) setSr(initialSr); }, [initialSr]);

  // Every number in play: the ones with history, plus the ones started here
  // that the Jobs Tracker has not seen yet.
  const allNumbers = useMemo(() => {
    const seen = new Set(serviceReports.map((r) => String(r.number)));
    const extra = started.filter((j) => !seen.has(String(j.sr)))
      .map((j) => ({ number: j.sr, visits: [], timesheets: [], startedHere: true, customer: j.customer }));
    return [...extra, ...serviceReports];
  }, [serviceReports, started]);

  // The job in the JOBS TRACKER — the only thing that knows whether it was
  // paid. `job` above is a service report entry, which carries visits and
  // timesheets and no money at all, so reading `paid` off it was reading a
  // field that never existed: the step could not tick however many times
  // somebody ticked Paid over there.
  const norm = (v) => String(v || '').trim().replace(/[\s-]/g, '').toUpperCase();
  const trackerJob = useMemo(
    () => jobs.find((j) => norm(j.sr || j.invoiceNumber) === norm(sr)) || null,
    [jobs, sr]);

  const steps = useMemo(() => jobFlowSteps({
    job: trackerJob,
    sources,
    packet,
    manualInvoice: null,
  }), [trackerJob, sources, packet]);
  const startedHere = started.find((j) => String(j.sr) === String(sr)) || null;
  const progress = flowProgress(steps);
  const todo = nextAction(steps);

  const uploadedOf = (kind) => (packet.files || []).filter((f) => f.kind === kind);

  // What is actually in each slot: uploaded first, otherwise whatever the
  // system already holds.
  const slotState = (kind) => {
    const uploaded = uploadedOf(kind);
    if (uploaded.length) return { from: 'uploaded', files: uploaded };
    if (kind === 'serviceReport' && sources?.serviceReportUrl) {
      return { from: 'system', files: [{ name: sources.serviceReportName || 'Service report', url: sources.serviceReportUrl, type: 'application/pdf' }] };
    }
    if (kind === 'invoice' && sources?.invoiceUrl) {
      return { from: 'system', files: [{ name: sources.invoiceName || 'Invoice', url: sources.invoiceUrl, type: 'application/pdf' }] };
    }
    return { from: null, files: [] };
  };

  // Typed values are written a beat after typing stops, and again on blur.
  //
  // Blur alone was not enough: it fires when you click away, and somebody who
  // types an amount and immediately closes the tab never clicks away. One write
  // per keystroke is the other extreme — five documents to record "42.10" — so
  // this waits for a pause and then saves. Nothing typed survives longer than
  // the pause without reaching the cloud.
  const timers = useRef({});
  const flushField = async (file, field, value) => {
    const trimmed = String(value || '').trim();
    if ((file[field] || '') === trimmed) return;
    try {
      await updatePacketFile(sr, file.path, { [field]: trimmed });
      setPacket(await fetchPacket(sr));
    } catch (err) { setError(err.message || String(err)); }
  };
  const queueField = (file, field, value) => {
    const id = `${file.path}:${field}`;
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => flushField(file, field, value), 700);
  };
  const saveField = (file, field, value) => {
    clearTimeout(timers.current[`${file.path}:${field}`]);
    return flushField(file, field, value);
  };

  // The cover-sheet note had NO save of its own — it was only written as a
  // side effect of pressing Build, so typing one and reloading lost it. It is
  // part of the packet like everything else on this screen.
  const queueNotes = (value) => {
    clearTimeout(timers.current.notes);
    timers.current.notes = setTimeout(() => {
      markPacketBuilt(sr, { notes: value }).catch((err) => console.warn('Note not saved:', err));
    }, 700);
  };

  // A pending write must not be dropped by navigating away mid-pause.
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const onUpload = async (kind, fileList) => {
    setScanNote('');
    const files = [...(fileList || [])];
    if (!files.length) return;
    const bad = files.map(describeUnsupported).filter(Boolean);
    if (bad.length) { setError(bad.join(' ')); return; }
    setError('');
    setBusy(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
    setBusyProgress({ done: 0, total: files.length });
    try {
      const added = [];
      for (const f of files) {
        setBusyDetail(f.name);
        added.push({ entry: await addPacketFile(sr, kind, f), file: f });
        setBusyProgress({ done: added.length, total: files.length });
      }
      setPacket(await fetchPacket(sr));

      // Read receipts as they arrive, while the file is still in hand. Every
      // figure lands in an editable box and none of it is trusted: these end up
      // on an invoice, so a person confirms them before the packet is built.
      if (kind === 'receipts') {
        const read = [];
        // Only the photos get read, so the count is of those, not of everything
        // uploaded — a bar that stalls at "2 of 3" because the third was a PDF
        // looks like a failure.
        const toScan = added.filter(({ file }) => /^image\//.test(file.type || ''));
        if (toScan.length) {
          setBusy(toScan.length === 1 ? 'Reading the receipt…' : `Reading ${toScan.length} receipts…`);
          setBusyProgress({ done: 0, total: toScan.length });
        }
        for (const { entry, file } of toScan) {
          setBusyDetail(file.name);
          try {
            const r = await scanReceipt(file);
            const patch = {};
            if (r.vendor) patch.vendor = r.vendor;
            if (r.total != null) patch.amount = String(r.total);
            // The type follows from the vendor the scan just read — Shell is
            // fuel, Hertz is a car. Guessed from the vendor first and the
            // filename second, and only when the receipt has no type yet, so a
            // re-scan cannot overwrite a choice somebody made by hand.
            if (!entry.category) {
              const guess = guessCategory(r.vendor || '') || guessCategory(file.name || '');
              if (guess) patch.category = guess;
            }
            if (Object.keys(patch).length) {
              await updatePacketFile(sr, entry.path, patch);
              read.push(`${file.name}: ${r.vendor || 'vendor not read'} ${r.total != null ? money(r.total) : '— amount not read'}`);
            } else {
              read.push(`${file.name}: nothing readable — type it in`);
            }
          } catch (err) {
            // A failed scan must not lose the upload: the receipt is already
            // attached, it just has no figures yet.
            read.push(`${file.name}: ${err.message || 'could not be read'}`);
          }
          setBusyProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
        setPacket(await fetchPacket(sr));
        if (read.length) setScanNote(`Read from the photo — check each one: ${read.join(' · ')}`);
      }
    } catch (err) { setError(err.message || String(err)); }
    clearBusy();
  };

  const build = async () => {
    setBusy('Building the packet…');
    setError('');
    try {
      const parts = {};
      // A file the browser cannot read is the dangerous case: the slot shows a
      // green tick because the file exists, and it would drop out of the packet
      // without a word. Collected and said out loud below.
      const unreadable = [];
      for (const k of KINDS) {
        const { files, from } = slotState(k.key);
        const loaded = [];
        for (const f of files) {
          const bytes = await fetchFileBytes(f.path || f.url);
          if (bytes) loaded.push({ name: f.name, type: f.type, bytes, amount: f.amount, vendor: f.vendor });
          else unreadable.push({ name: f.name, from });
        }
        if (k.many) parts[k.key] = loaded;
        else parts[k.key] = loaded[0] || null;
      }
      if (unreadable.length) {
        // Says what happened, not why. An earlier version asserted a CORS
        // problem for any system file that would not load — which was the
        // wrong cause even when it was written, and sent somebody to a bucket
        // setting that was already correct. The console carries the actual
        // error; this says what to do about it.
        const fromSystem = unreadable.some((u) => u.from === 'system');
        setError(
          `Left out of the packet — could not be read: ${unreadable.map((u) => u.name).join(', ')}.`
          + (fromSystem
            ? ' This one is held by the CCW app. Open it from the link above, then add it here with'
              + ' Replace — and tell me, because it should not need doing.'
            : ''),
        );
      }

      const meta = {
        sr,
        customer: customerName,
        invoiceNumber: sources?.invoiceNumber || job?.invoiceNumber || '',
        date: sources?.date || '',
        amount: sources?.amount ?? job?.amount ?? '',
        notes,
      };
      const built = await buildPacket(meta, parts);
      const blob = new Blob([built.bytes], { type: 'application/pdf' });
      setResult({ ...built, meta, url: URL.createObjectURL(blob), fileName: packetFileName(meta) });
      await markPacketBuilt(sr, { notes });
    } catch (err) { setError(err.message || String(err)); }
    clearBusy();
  };

  const card = ui.card(colors, { marginBottom: '16px' });
  const label = ui.label(colors);
  const input = ui.input(colors);

  const missing = KINDS.filter((k) => slotState(k.key).files.length === 0).map((k) => k.label);

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Every slow operation on this panel — upload, scan, build, release —
          says so here. The message was previously only the Build button's
          label, which is at the bottom of a long panel and nowhere near the
          Add button that started the work. */}
      <BusyOverlay message={busy} detail={busyDetail} progress={busyProgress} colors={colors} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, color: colors.text, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Paperclip size={22} /> Job packet
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setNewJob({
              sr: nextServiceReportNumber([...allNumbers.map((r) => r.number)], new Date().getFullYear()),
              customer: '', date: new Date().toISOString().slice(0, 10), description: '',
            })}
            style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#ec4899', color: 'white', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={16} /> New job
          </button>
          {onClose && (
            <button type="button" onClick={onClose} style={{ ...input, cursor: 'pointer' }}>Close</button>
          )}
        </div>
      </div>

      {/* Loading historical receipts is not about the job currently selected, so
          it sits above the picker rather than inside a slot. */}
      <BulkReceiptImport
        colors={colors}
        knownSrs={allNumbers.map((r) => String(r.number))}
        onDone={() => { if (sr) load(sr); }}
      />

      {newJob && (
        <div style={{ ...card, borderLeft: '4px solid #ec4899' }}>
          <div style={{ fontWeight: 600, color: colors.text, marginBottom: '10px' }}>Start a job</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={label}>Service report number</label>
              {/* Offered, not imposed: the next number is usually right, and
                  the one time it is not, somebody has a paper pad that says so. */}
              <input style={{ ...input, width: '100%' }} value={newJob.sr}
                     onChange={(e) => setNewJob({ ...newJob, sr: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label style={label}>Customer</label>
              <input style={{ ...input, width: '100%' }} list="packet-customers" value={newJob.customer}
                     onChange={(e) => setNewJob({ ...newJob, customer: e.target.value })} placeholder="Start typing…" />
              <datalist id="packet-customers">
                {customers.map((c) => <option key={c.name} value={c.name} />)}
              </datalist>
            </div>
            <div>
              <label style={label}>Date</label>
              <input type="date" style={{ ...input, width: '100%' }} value={newJob.date}
                     onChange={(e) => setNewJob({ ...newJob, date: e.target.value })} />
            </div>
            <div>
              <label style={label}>What the job is</label>
              <input style={{ ...input, width: '100%' }} value={newJob.description}
                     onChange={(e) => setNewJob({ ...newJob, description: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button" disabled={!!busy}
              onClick={async () => {
                setBusy('Reserving the number…'); setError('');
                try {
                  await startJob(newJob);
                  setStarted(await fetchUnifiedJobs());
                  setSr(newJob.sr);
                  setNewJob(null);
                } catch (err) { setError(err.message || String(err)); }
                clearBusy();
              }}
              style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#10b981', color: 'white', fontWeight: 600, cursor: 'pointer' }}
            >
              Reserve {newJob.sr}
            </button>
            <button type="button" onClick={() => setNewJob(null)} style={{ ...input, cursor: 'pointer' }}>Cancel</button>
            <span style={{ color: colors.textSecondary, fontSize: '13px' }}>
              Reserves the number here. Create the job itself in the Jobs Tracker with the same number —
              it owns the quote and the amount.
            </span>
          </div>
        </div>
      )}

      <div style={card}>
        <label style={label} htmlFor="packet-sr">Service report</label>
        <select id="packet-sr" value={sr} onChange={(e) => setSr(e.target.value)} style={{ ...input, minWidth: '280px', maxWidth: '100%' }}>
          <option value="">Choose a service report…</option>
          {allNumbers.map((r) => (
            <option key={r.number} value={r.number}>
              {r.number}
              {(() => {
                const c = (r.visits || []).find((v) => v.customer)?.customer
                  || (r.timesheets || []).find((t) => t.customer && t.customer !== 'Unknown')?.customer;
                return c ? ` — ${c}` : '';
              })()}
            </option>
          ))}
        </select>
        {sr && startedHere && (
          <div style={{ marginTop: '10px' }}>
            {/* A cancelled job's number would otherwise sit in the pickers of
                three apps forever. Closing hides it; it stays reserved, because
                handing it out twice is not recoverable. */}
            <button
              type="button"
              onClick={async () => {
                const closing = !startedHere.closedAt;
                setBusy(closing ? 'Closing…' : 'Reopening…');
                try { await closeJob(sr, closing); setStarted(await fetchUnifiedJobs()); }
                catch (err) { setError(err.message || String(err)); }
                clearBusy();
              }}
              style={{ ...input, cursor: 'pointer', fontSize: '13px', padding: '5px 10px' }}
            >
              {startedHere.closedAt ? 'Reopen this number' : 'Close this number'}
            </button>
            {/* Releasing is only offered when nothing has been filed against
                the number: no visit, no timesheet, no invoice, no packet file.
                Once any of those exist the number has been written on
                something, and putting it back in the pool would let a second
                job take it. */}
            {/* Files uploaded here do not block releasing — they are removed
                with it. What blocks it is a commitment somewhere else: a job in
                the Jobs Tracker, a service report filed in CCW, an invoice in
                the system. Those mean the number is on somebody's paperwork and
                cannot be handed out again. Uploading a test receipt should not
                strand a number, which is what the old rule did. */}
            {!trackerJob && !job && !sources?.serviceReportUrl && !sources?.invoiceUrl && (
              <button
                type="button"
                onClick={async () => {
                  const files = packet.files || [];
                  if (!window.confirm(
                    `Release ${sr} back into the pool?\n\n`
                    + (files.length
                      ? `The ${files.length} file${files.length === 1 ? '' : 's'} attached here will be deleted.\n\n`
                      : '')
                    + 'It becomes the next number offered again. Only do this if nothing was ever '
                    + 'filed against it — a number written on a report or an invoice should be closed, not released.')) return;
                  setBusy('Releasing…');
                  try {
                    // Files first: releasing deletes the record that lists them,
                    // so leaving them until after would orphan them in storage.
                    for (const f of files) {
                      if (f.path) await removePacketFile(sr, f.path);
                    }
                    await releaseJobNumber(sr);
                    setStarted(await fetchUnifiedJobs());
                    setSr('');
                  } catch (err) { setError(err.message || String(err)); }
                  clearBusy();
                }}
                style={{ ...input, cursor: 'pointer', fontSize: '13px', padding: '5px 10px', marginLeft: '8px' }}
              >
                Release the number
              </button>
            )}
            {startedHere.closedAt && (
              <span style={{ color: '#f59e0b', fontSize: '13px', marginLeft: '8px' }}>
                Closed — hidden from the timesheet and other pickers, but still reserved.
              </span>
            )}
          </div>
        )}
        {sr && (
          <div style={{ marginTop: '10px', fontSize: '14px', color: colors.textSecondary }}>
            {customerName || 'Unknown customer'}
            {apEmails.length > 0
              ? <> · invoices go to <strong style={{ color: colors.text }}>{apEmails.join(', ')}</strong></>
              : <> · <span style={{ color: '#f59e0b' }}>no invoice email on this customer — add one on their record first</span></>}
          </div>
        )}
      </div>

      {sr && (
        <>
          {/* Where this job has got to. Derived from the files and records
              themselves rather than ticked by hand — a checklist somebody
              maintains goes stale the first busy week. */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <div style={{ fontWeight: 600, color: colors.text }}>Job {sr}</div>
              <div style={{ color: colors.textSecondary, fontSize: '13px' }}>
                {progress.done} of {progress.total} steps
                {todo ? <> · next: <strong style={{ color: colors.text }}>{todo.label.toLowerCase()}</strong></>
                      : <> · <span style={{ color: '#10b981' }}>complete</span></>}
              </div>
            </div>

            <div style={{ height: '6px', borderRadius: '999px', background: colors.hover, overflow: 'hidden', marginBottom: '14px' }}>
              <div style={{ width: `${progress.pct}%`, height: '100%', background: progress.pct === 100 ? '#10b981' : '#3b82f6', transition: 'width .3s' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {steps.map((st, i) => {
                const isNext = todo && st.key === todo.key;
                return (
                  <div key={st.key} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '6px 8px', borderRadius: '6px', background: isNext ? colors.hover : 'transparent' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{
                        width: '20px', height: '20px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: st.done ? '#10b981' : isNext ? '#3b82f6' : 'transparent',
                        border: st.done || isNext ? 'none' : `2px solid ${colors.border || '#d1d5db'}`,
                        color: 'white', fontSize: '11px', fontWeight: 700,
                      }}>
                        {st.done ? <Check size={13} /> : i + 1}
                      </div>
                      {/* The line between the dots is what makes it read as a
                          sequence rather than a list of unrelated ticks. */}
                      {i < steps.length - 1 && (
                        <div style={{ width: '2px', flex: 1, minHeight: '10px', background: colors.border || '#e5e7eb', marginTop: '2px' }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: '4px' }}>
                      <div style={{ color: st.done ? colors.textSecondary : colors.text, fontWeight: isNext ? 600 : 400, fontSize: '14px', textDecoration: st.done ? 'line-through' : 'none' }}>
                        {st.label}
                        {st.optional && <span style={{ color: colors.textSecondary, fontWeight: 400, fontSize: '12px' }}> · if applicable</span>}
                      </div>
                      <div style={{ color: colors.textSecondary, fontSize: '12px' }}>{st.hint}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {KINDS.map((k) => {
            const state = slotState(k.key);
            const present = state.files.length > 0;
            return (
              <div key={k.key} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {present ? <Check size={16} color="#10b981" /> : <AlertTriangle size={16} color="#f59e0b" />}
                      {k.label}
                      {state.from === 'system' && (
                        <span style={{ fontSize: '12px', fontWeight: 400, color: '#3b82f6' }}>already in the system</span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: colors.textSecondary, marginTop: '2px' }}>{k.hint}</div>
                  </div>
                  <label style={{ ...input, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Upload size={14} /> {present && !k.many ? 'Replace' : 'Add'}
                    <input
                      type="file"
                      multiple={!!k.many}
                      accept="application/pdf,image/jpeg,image/png"
                      onChange={(e) => { onUpload(k.key, e.target.files); e.target.value = ''; }}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>

                {state.files.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {state.files.map((f, i) => (
                      <div key={f.path || i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: colors.textSecondary, flexWrap: 'wrap' }}>
                        <FileText size={14} />
                        {/* A file the system already holds may be recorded as a
                            bare storage path rather than a URL. In an href that
                            resolves against this origin and the app serves
                            itself back, so a path is read through the broker
                            first — the same reason the reports screen does. */}
                        {isAbsoluteUrl(f.url) ? (
                          <a href={f.url} target="_blank" rel="noreferrer" style={{ color: ui.TONE.brand, textDecoration: 'none', flex: '1 1 160px' }}>{f.name}</a>
                        ) : (
                          <button
                            onClick={async () => {
                              setBusy('Opening the file…'); setBusyDetail(f.name);
                              try {
                                const bytes = await fetchFileBytes(f.url || f.path);
                                if (!bytes) throw new Error('That file could not be read from storage.');
                                const blobUrl = URL.createObjectURL(new Blob([bytes], { type: f.type || 'application/pdf' }));
                                window.open(blobUrl, '_blank', 'noopener');
                              } catch (err) { setError(err.message || String(err)); }
                              clearBusy();
                            }}
                            style={{ color: ui.TONE.brand, background: 'transparent', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', flex: '1 1 160px', font: 'inherit' }}
                          >{f.name}</button>
                        )}

                        {/* What it cost, against the receipt itself. Typed here
                            rather than totalled on a separate sheet, because a
                            figure kept apart from the thing it describes is a
                            figure nobody can check. */}
                        {k.key === 'receipts' && f.path && (
                          <>
                            {/* Type, then who, then how much — the order the
                                itemised page prints them in, so the row on
                                screen reads like the line in the packet. A
                                dropdown saves on change: there is no half-typed
                                state to wait out as there is with the boxes. */}
                            <select
                              value={f.category || ''}
                              onChange={(e) => saveField(f, 'category', e.target.value)}
                              aria-label={`Expense type for ${f.name}`}
                              style={ui.input(colors, { width: '135px', padding: '4px 8px', fontSize: '13px' })}
                            >
                              <option value="">Type…</option>
                              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <input
                              defaultValue={f.vendor || ''}
                              onChange={(e) => queueField(f, 'vendor', e.target.value)}
                              onBlur={(e) => saveField(f, 'vendor', e.target.value)}
                              placeholder="Vendor"
                              aria-label={`Vendor for ${f.name}`}
                              style={ui.input(colors, { width: '120px', padding: '4px 8px', fontSize: '13px' })}
                            />
                            <input
                              defaultValue={f.amount || ''}
                              onChange={(e) => queueField(f, 'amount', e.target.value)}
                              onBlur={(e) => saveField(f, 'amount', e.target.value)}
                              placeholder="0.00"
                              inputMode="decimal"
                              aria-label={`Amount for ${f.name}`}
                              style={ui.input(colors, { width: '90px', padding: '4px 8px', fontSize: '13px', textAlign: 'right' })}
                            />
                          </>
                        )}

                        {f.path && (
                          <button
                            type="button" aria-label={`Remove ${f.name}`}
                            onClick={async () => { setBusy('Removing…'); await removePacketFile(sr, f.path); setPacket(await fetchPacket(sr)); clearBusy(); }}
                            style={{ border: 'none', background: 'transparent', color: ui.TONE.bad, cursor: 'pointer', padding: 0 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {k.key === 'receipts' && scanNote && (
                      <div style={{ fontSize: '12px', color: ui.TONE.brand, paddingTop: '4px' }}>{scanNote}</div>
                    )}
                    {k.key === 'receipts' && state.files.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: '8px', fontSize: '14px', color: colors.text, paddingTop: '6px', borderTop: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
                        {/* A receipt with no amount counts as zero, and a total
                            of $0.00 beside three receipts reads as broken
                            software rather than as three receipts nobody has
                            priced. Say which it is. */}
                        {(() => {
                          const unpriced = state.files.filter((f) => !String(f.amount || '').trim()).length;
                          return unpriced > 0 ? (
                            <span style={{ color: ui.TONE.warn, fontSize: '13px' }}>
                              {unpriced} of {state.files.length} {unpriced === 1 ? 'has' : 'have'} no amount yet
                              {' '}— type it in, or re-upload to read it from the photo
                            </span>
                          ) : null;
                        })()}
                        <span style={{ color: colors.textSecondary }}>Total receipts</span>
                        <strong>{money(receiptsTotal(state.files))}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div style={card}>
            <label style={label} htmlFor="packet-notes">Notes for this job (optional)</label>
            <textarea
              id="packet-notes" value={notes} rows={2}
              onChange={(e) => { setNotes(e.target.value); queueNotes(e.target.value); }}
              onBlur={(e) => { clearTimeout(timers.current.notes); markPacketBuilt(sr, { notes: e.target.value }).catch(() => {}); }}
              placeholder="Anything AP should know — PO raised late, partial billing, etc."
              style={{ ...input, width: '100%', resize: 'vertical' }}
            />
          </div>

          {missing.length > 0 && (
            <div style={{ ...card, borderLeft: '4px solid #f59e0b', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div style={{ color: colors.text, fontSize: '14px' }}>
                <strong>Still missing: {missing.join(', ')}.</strong>
                <div style={{ color: colors.textSecondary, marginTop: '2px' }}>
                  You can still build it — nothing is invented, the packet simply will not contain them.
                </div>
              </div>
            </div>
          )}

          {error && <div style={{ ...card, borderLeft: '4px solid #ef4444', color: '#ef4444', fontSize: '14px' }}>{error}</div>}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button" onClick={build} disabled={!!busy}
              style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: 'white', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Paperclip size={16} /> {busy || 'Build the packet'}
            </button>

            {result && (
              <>
                <a
                  href={result.url} download={result.fileName}
                  style={{ padding: '10px 18px', borderRadius: '8px', background: '#10b981', color: 'white', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Download size={16} /> Download PDF
                </a>
                <a
                  onClick={() => markPacketSent(sr, apEmails).then(() => fetchPacket(sr).then(setPacket))}
                  href={packetEmail(result.meta, apEmails).href}
                  style={{
                    padding: '10px 18px', borderRadius: '8px', fontWeight: 600, textDecoration: 'none',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: apEmails.length ? '#8b5cf6' : '#9ca3af', color: 'white',
                    pointerEvents: apEmails.length ? 'auto' : 'none',
                  }}
                  title={apEmails.length ? `Email ${apEmails.join(', ')}` : 'No invoice email on this customer'}
                >
                  <Mail size={16} /> Email accounts payable
                </a>
              </>
            )}
          </div>

          {result && (
            <div style={{ ...card, marginTop: '16px', borderLeft: '4px solid #10b981' }}>
              <div style={{ color: colors.text, fontSize: '14px', fontWeight: 600 }}>
                Packet built — {result.fileName}
              </div>
              {/* Said plainly: a mailto cannot carry a file, and an email that
                  says "attached" with nothing attached is worse than none. */}
              <div style={{ color: colors.textSecondary, fontSize: '13px', marginTop: '4px' }}>
                Download it first, then press Email — your mail client opens addressed to
                {' '}{apEmails.length ? apEmails.join(', ') : 'accounts payable'} with the details filled in,
                and you attach the PDF you just downloaded.
              </div>
              {result.receiptsTotal > 0 && (
                <div style={{ color: colors.text, fontSize: '13px', marginTop: '4px' }}>
                  Receipts itemised in the packet: <strong>{money(result.receiptsTotal)}</strong>
                </div>
              )}
              {result.missing.length > 0 && (
                <div style={{ color: '#f59e0b', fontSize: '13px', marginTop: '6px' }}>
                  Not in this packet: {result.missing.join(', ').toLowerCase()}.
                </div>
              )}
              {result.problems.length > 0 && (
                <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '6px' }}>
                  {result.problems.join(' ')}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
