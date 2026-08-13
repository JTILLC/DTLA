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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, FileText, Mail, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import {
  fetchPacket, fetchPacketSources, addPacketFile, removePacketFile, markPacketBuilt, fetchFileBytes,
  fetchUnifiedJobs, startJob, markPacketSent, closeJob, releaseJobNumber, updatePacketFile,
} from '../data-service';
import { jobFlowSteps, nextAction, flowProgress, nextServiceReportNumber } from '../utils/jobFlow';
import { buildPacket, describeUnsupported, packetEmail, packetFileName, receiptsTotal, money, SECTIONS } from '../utils/jobPacket';
import { matchCustomer } from '@shared/utils/customerMatch.js';
import * as ui from '../ui/theme';

const KINDS = [
  { key: 'po', label: 'Purchase order', hint: 'What the customer authorised' },
  { key: 'invoice', label: 'Invoice', hint: 'What we are asking for' },
  { key: 'serviceReport', label: 'Service report', hint: 'What we did' },
  { key: 'receipts', label: 'Receipts', hint: 'What it cost us', many: true },
];

export default function JobPacketBuilder({ colors, serviceReports = [], customerRecords = [], customers = [], initialSr = '', onClose }) {
  const [sr, setSr] = useState(initialSr);
  const [started, setStarted] = useState([]);
  const [newJob, setNewJob] = useState(null);   // the form, when open
  const [packet, setPacket] = useState({ files: [] });
  const [sources, setSources] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState(null);

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
    setBusy('');
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

  const steps = useMemo(() => jobFlowSteps({
    job: job || started.find((j) => String(j.sr) === String(sr)) || null,
    sources,
    packet,
    manualInvoice: null,
  }), [job, started, sr, sources, packet]);
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

  // Saved on blur rather than per keystroke: each save is a document write, and
  // one per character typed into an amount is a lot of writes to record "42.10".
  const saveField = async (file, field, value) => {
    const trimmed = String(value || '').trim();
    if ((file[field] || '') === trimmed) return;
    try {
      await updatePacketFile(sr, file.path, { [field]: trimmed });
      setPacket(await fetchPacket(sr));
    } catch (err) { setError(err.message || String(err)); }
  };

  const onUpload = async (kind, fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const bad = files.map(describeUnsupported).filter(Boolean);
    if (bad.length) { setError(bad.join(' ')); return; }
    setError('');
    setBusy(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
    try {
      for (const f of files) await addPacketFile(sr, kind, f);
      setPacket(await fetchPacket(sr));
    } catch (err) { setError(err.message || String(err)); }
    setBusy('');
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
        const fromSystem = unreadable.some((u) => u.from === 'system');
        setError(
          `Left out of the packet — could not be read: ${unreadable.map((u) => u.name).join(', ')}.`
          + (fromSystem
            ? ' Files held by the CCW app are blocked by that storage bucket\'s CORS rules.'
              + ' Until that is set, download the service report and add it here with Replace.'
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
    setBusy('');
  };

  const card = ui.card(colors, { marginBottom: '16px' });
  const label = ui.label(colors);
  const input = ui.input(colors);

  const missing = KINDS.filter((k) => slotState(k.key).files.length === 0).map((k) => k.label);

  return (
    <div style={{ marginBottom: '32px' }}>
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
                setBusy('');
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
                setBusy('');
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
            {!job && !sources?.serviceReportUrl && !sources?.invoiceUrl && !(packet.files || []).length && (
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(
                    `Release ${sr} back into the pool?\n\n`
                    + 'It becomes the next number offered again. Only do this if nothing was ever '
                    + 'filed against it — a number written on a report or an invoice should be closed, not released.')) return;
                  setBusy('Releasing…');
                  try {
                    await releaseJobNumber(sr);
                    setStarted(await fetchUnifiedJobs());
                    setSr('');
                  } catch (err) { setError(err.message || String(err)); }
                  setBusy('');
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
                        <a href={f.url} target="_blank" rel="noreferrer" style={{ color: ui.TONE.brand, textDecoration: 'none', flex: '1 1 160px' }}>{f.name}</a>

                        {/* What it cost, against the receipt itself. Typed here
                            rather than totalled on a separate sheet, because a
                            figure kept apart from the thing it describes is a
                            figure nobody can check. */}
                        {k.key === 'receipts' && f.path && (
                          <>
                            <input
                              defaultValue={f.vendor || ''}
                              onBlur={(e) => saveField(f, 'vendor', e.target.value)}
                              placeholder="Vendor"
                              aria-label={`Vendor for ${f.name}`}
                              style={ui.input(colors, { width: '120px', padding: '4px 8px', fontSize: '13px' })}
                            />
                            <input
                              defaultValue={f.amount || ''}
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
                            onClick={async () => { setBusy('Removing…'); await removePacketFile(sr, f.path); setPacket(await fetchPacket(sr)); setBusy(''); }}
                            style={{ border: 'none', background: 'transparent', color: ui.TONE.bad, cursor: 'pointer', padding: 0 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {k.key === 'receipts' && state.files.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', fontSize: '14px', color: colors.text, paddingTop: '6px', borderTop: `1px solid ${colors.border}` }}>
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
            <label style={label} htmlFor="packet-notes">Notes for the cover sheet (optional)</label>
            <textarea
              id="packet-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
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
                  You can still build the packet — the cover sheet will say what is not in it.
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
                  The cover sheet records that {result.missing.join(', ').toLowerCase()} {result.missing.length === 1 ? 'is' : 'are'} not included.
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
