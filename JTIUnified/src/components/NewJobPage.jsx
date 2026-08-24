// src/components/NewJobPage.jsx
//
// Start a job: take the next number and say who it is for.
//
// This was a modal on the packet page, which put "start a job" behind "build a
// packet" — the wrong way round, since the packet is the last step and this is
// the first. It also collected a customer and one date, so the address and the
// span of days got typed again into the timesheet and the Jobs tracker from
// whatever the person remembered.
//
// The number is allocated here and nowhere else. Once it is handed out it is in
// the timesheet picker, on CCW's service report field and in the Jobs tracker,
// and it can never be quietly reused — so the form says plainly what is about
// to happen before it happens.

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Building2, Check, Plus, RefreshCw } from 'lucide-react';
import { fetchUnifiedJobs, startJob, fetchServiceReports, fetchServiceQuotes, setQuoteSr } from '../data-service';
import { nextServiceReportNumber } from '../utils/jobFlow';
import { normalizeDraft, draftProblems } from '../utils/jobDraft';
import { matchCustomer, isSameCustomer } from '@shared/utils/customerMatch.js';
import * as ui from '../ui/theme';

const today = () => new Date().toISOString().slice(0, 10);

export default function NewJobPage({ colors, customerRecords = [], onCreated, onOpenPacket }) {
  const [draft, setDraft] = useState({
    sr: '', customer: '', address: '', city: '', state: '',
    dateStart: today(), dateEnd: '', description: '',
  });
  const [taken, setTaken] = useState(null);      // every number already in use
  const [reserved, setReserved] = useState(null); // ...and the subset a JOB holds
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [showProblems, setShowProblems] = useState(false);

  // The next number, worked out from every number in use — the reserved ones
  // AND the historical ones. Reading only the reserved list would hand out a
  // number that a past job already carries.
  //
  // The two are kept APART, because they mean different things when somebody
  // types a number over the suggestion. A number already RESERVED cannot be
  // taken: two claims on one number is the thing this guard exists for. A
  // number that only exists on a timesheet, a visit or a packet holds no
  // reservation — it was invoiced without one ever being taken — and
  // reserving it is how that work gets a job record at last. Blocking both
  // looked identical to the person doing it, and made the second impossible.
  const loadNumber = async () => {
    setLoading(true); setError('');
    try {
      const [started, reports] = await Promise.all([fetchUnifiedJobs(), fetchServiceReports()]);
      const historyNumbers = ((reports?.reports || [])).map((r) => r.number);
      const all = [...(started || []).map((j) => j.sr), ...historyNumbers];
      // The records, not just the numbers, so the guard can say WHO holds a
      // number. "Already taken" sends somebody hunting for it; "reserved for
      // SunTree" is the answer they were going to go looking for.
      setReserved(started || []);
      setTaken(all);
      setDraft((d) => ({ ...d, sr: nextServiceReportNumber(all, new Date().getFullYear()) }));
    } catch (err) {
      setError(err.message || String(err));
    }
    setLoading(false);
  };

  useEffect(() => { loadNumber(); }, []);

  // Quotes that could belong to this job.
  //
  // A quote is connected to a job by the service report number written on it,
  // and that could only be done in the quote app — weeks later, from memory.
  // Offering it HERE is offering it at the one moment somebody certainly knows
  // the answer, because they are creating the job the quote was written for.
  const [quotes, setQuotes] = useState([]);
  const [quotePath, setQuotePath] = useState('');
  useEffect(() => {
    fetchServiceQuotes()
      .then(setQuotes)
      .catch((err) => console.warn('Quotes unavailable:', err));
  }, []);

  // This plant's quotes, unconnected ones first — a quote already against
  // another number is almost never the one being looked for, but it is shown
  // rather than hidden so a mistaken connection can be spotted and moved.
  const customerQuotes = useMemo(() => {
    const rec = matchCustomer(draft.customer, customerRecords);
    const mine = quotes.filter((q) => (
      (rec && q.customerId && q.customerId === rec.id)
      || (draft.customer && isSameCustomer(q.customer, draft.customer))
    ));
    return mine.sort((a, b) => (a.sr ? 1 : 0) - (b.sr ? 1 : 0) || String(b.date).localeCompare(String(a.date)));
  }, [quotes, draft.customer, customerRecords]);

  // A quote picked for one plant must not survive switching to another.
  useEffect(() => {
    if (quotePath && !customerQuotes.some((q) => q.path === quotePath)) setQuotePath('');
  }, [customerQuotes, quotePath]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  // Picking a known customer fills the address from the record — the same
  // record the invoice emails come from, so there is one answer to "where is
  // this plant" rather than one per app. Still editable: a job can be at a
  // different site, and the record can be out of date.
  const applyCustomer = (name) => {
    const rec = matchCustomer(name, customerRecords);
    const p = rec?.profile || {};
    setDraft((d) => ({
      ...d,
      customer: name,
      address: d.address || p.address || '',
      city: d.city || p.city || '',
      state: d.state || p.state || '',
    }));
  };

  const problems = useMemo(() => draftProblems(draft), [draft]);
  const same = (n) => String(n || '').trim().toUpperCase() === draft.sr.trim().toUpperCase();
  // Already reserved: cannot be taken. The record itself, so the message can
  // name the plant it is held for.
  const heldBy = (reserved && draft.sr) ? reserved.find((j) => same(j?.sr)) : null;
  const clash = !!heldBy;
  // Used, but by no job: taking it is what gives that work a job record.
  const historicalOnly = !clash && !!(taken && draft.sr && taken.some(same));

  const submit = async (e) => {
    e.preventDefault();
    if (problems.length) { setShowProblems(true); return; }
    setSaving(true); setError('');
    try {
      const rec = await startJob(draft);
      // Connected AFTER the job is created, and never fatally: the number is
      // the thing that had to be saved, and a quote that failed to connect is
      // a two-second fix on the job board, not a reason to tell somebody their
      // job was not started.
      let quoteError = null;
      if (quotePath) {
        try {
          await setQuoteSr(quotePath, rec.sr);
        } catch (err) {
          quoteError = err?.message || String(err);
          console.warn('Job created, quote not connected:', quoteError);
        }
      }
      const quote = customerQuotes.find((q) => q.path === quotePath) || null;
      setCreated({ ...rec, quote: quoteError ? null : quote, quoteError });
      onCreated?.(rec);
    } catch (err) {
      setError(err.message || String(err));
    }
    setSaving(false);
  };

  const label = ui.label(colors);
  const input = ui.input(colors, { width: '100%' });
  const card = ui.card(colors, { padding: '20px', marginBottom: '16px' });

  if (created) {
    return (
      <div style={{ marginBottom: '32px' }}>
        {/* The write to the Jobs Tracker IS the reservation — there is no
            separate reservation record any more. So when it fails, nothing
            was saved anywhere, and saying "2026029 is yours" over the top of
            that is the worst thing this page could do: the number reads as
            taken, nobody enters the job, and the work has no record at all. */}
        <div style={{ ...card, borderLeft: `3px solid ${created.trackerError ? ui.TONE.bad : ui.TONE.ok}` }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
            {created.trackerError
              ? <><AlertTriangle size={20} color={ui.TONE.bad} /> {created.sr} was NOT saved</>
              : <><Check size={20} color={ui.TONE.ok} /> {created.sr} is yours</>}
          </h2>
          {created.quote && (
            <p style={{ color: colors.textSecondary, fontSize: '13px', margin: '0 0 8px' }}>
              Quote {created.quote.quoteNumber || '(unnumbered)'} connected — $
              {(created.quote.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              . The timesheet will count down against it.
            </p>
          )}
          {created.quoteError && (
            <p style={{ color: ui.TONE.bad, fontSize: '13px', margin: '0 0 8px' }}>
              The job was saved, but the quote could not be connected ({created.quoteError}).
              Connect it from the job board.
            </p>
          )}
          <p style={{ color: colors.textSecondary, fontSize: '14px', margin: '0 0 14px' }}>
            {created.customer}{created.dateEnd ? ` · ${created.dateStart} → ${created.dateEnd}` : created.dateStart ? ` · ${created.dateStart}` : ''}
          </p>
          {created.trackerError ? (
            <div style={{ fontSize: '13px', color: colors.textSecondary, lineHeight: 1.7 }}>
              The job could not be written to the Jobs Tracker, and that write is what reserves the
              number — so <strong style={{ color: colors.text }}>nothing has been saved</strong> and{' '}
              {created.sr} is still free. Nothing else was told about it either.
              Press <strong style={{ color: colors.text }}>Start another</strong> to try again; if it
              keeps failing, enter the job in the Jobs Tracker directly.
              <div style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '6px', background: '#fef2f2', color: '#991b1b', fontSize: '12px' }}>
                {created.trackerError}
              </div>
            </div>
          ) : (
            /* Said explicitly, because the number appearing in three other apps
               a moment later is surprising if nobody told you it would. */
            <div style={{ fontSize: '13px', color: colors.textSecondary, lineHeight: 1.7 }}>
              The job is already <strong style={{ color: colors.text }}>in the Jobs Tracker</strong> — there is
              nothing to re-enter, only the quote and terms to fill in when you have them.
              It is also offered on the <strong style={{ color: colors.text }}>Timesheet</strong> app's job picker
              and on the service report field in <strong style={{ color: colors.text }}>CCW Issues</strong>.
              Headcount does not use service report numbers and is unaffected.
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            {/* Nothing was saved, so there is no packet to open. */}
            {!created.trackerError && (
              <button type="button" onClick={() => onOpenPacket?.(created.sr)}
                style={ui.btn(colors, { tone: ui.TONE.brand, active: true, over: { display: 'flex', alignItems: 'center', gap: '6px' } })}>
                Open its packet <ArrowRight size={14} />
              </button>
            )}
            <button type="button"
              onClick={() => { setCreated(null); setShowProblems(false); setDraft({ sr: '', customer: '', address: '', city: '', state: '', dateStart: today(), dateEnd: '', description: '' }); loadNumber(); }}
              style={ui.btn(colors)}>
              Start another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 600, color: colors.text, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Plus size={22} /> Start a job
      </h2>

      <div style={card}>
        <div style={label}>Service report number</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Editable, because the proposal is not always the right answer:
              work that was invoiced without a job ever being started needs
              ITS number, not the next one. */}
          <input
            id="nj-sr" value={loading ? '' : draft.sr} onChange={set('sr')}
            placeholder={loading ? '…' : '—'} inputMode="numeric" autoComplete="off"
            aria-label="Service report number"
            style={{
              ...input, width: '9ch', fontSize: '30px', fontWeight: 700,
              fontVariantNumeric: 'tabular-nums', padding: '4px 8px',
            }}
          />
          <button type="button" onClick={loadNumber} disabled={loading}
            style={ui.btn(colors, { size: 'sm', over: { display: 'flex', alignItems: 'center', gap: '6px' } })}>
            <RefreshCw size={13} /> Check again
          </button>
        </div>
        <div style={{ color: colors.textSecondary, fontSize: '13px', marginTop: '6px' }}>
          The next number after the highest in use. Gaps are never filled — a skipped
          number is usually still spoken for somewhere.
        </div>
        {/* Two people on this page at once would otherwise both take it. */}
        {/* "Reserved", not "belongs to a job": the number is spoken for, but
            its Jobs Tracker record may not exist yet — that is step one of
            eight and the normal state early on. Search says the same thing
            about the same number, and two screens contradicting each other
            about one number is worse than either wording alone. */}
        {clash && (
          <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '6px', background: '#fef2f2', color: '#991b1b', fontSize: '13px' }}>
            {draft.sr} is already reserved{heldBy?.customer ? ` for ${heldBy.customer}` : ''}.
            {' '}Press Check again to take the next free one.
          </div>
        )}
        {/* Not a clash: a number used by work that never got a job record. */}
        {historicalOnly && (
          <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '6px', background: '#fffbeb', color: '#92400e', fontSize: '13px' }}>
            {draft.sr} is already on a timesheet, visit or packet, but no job holds it —
            it was billed without one being started. Reserving it now is what gives that
            work a job, and the two will join up on the Reports page.
          </div>
        )}
      </div>

      <div style={card}>
        <label style={label} htmlFor="nj-customer">Customer</label>
        <input id="nj-customer" list="nj-customers" value={draft.customer}
          onChange={(e) => applyCustomer(e.target.value)}
          placeholder="Who is this for?" style={input} autoComplete="off" />
        <datalist id="nj-customers">
          {customerRecords.map((r) => <option key={r.id} value={r.name} />)}
        </datalist>
        {/* Only says so when it actually filled something in. */}
        {draft.customer && matchCustomer(draft.customer, customerRecords) && (
          <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Building2 size={12} /> Address filled from the customer record — edit it if this job is at a different site.
          </div>
        )}

        {/* The quote this job is being done against.
            Optional, and only offered once a customer is chosen — a list of
            every quote JTI has ever written is not a choice, it is a haystack.
            Connecting it here is what lets the timesheet count down against
            the agreed figure while the hours are being typed. */}
        {customerQuotes.length > 0 && (
          <div style={{ marginTop: '14px' }}>
            <label style={label} htmlFor="nj-quote">Quote for this job (optional)</label>
            <select id="nj-quote" value={quotePath} onChange={(e) => setQuotePath(e.target.value)} style={input}>
              <option value="">No quote</option>
              {customerQuotes.map((q) => (
                <option key={q.path} value={q.path}>
                  {[q.quoteNumber || 'Unnumbered', q.date, `$${(q.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]
                    .filter(Boolean).join(' · ')}
                  {q.sr ? `  (already on ${q.sr})` : ''}
                </option>
              ))}
            </select>
            <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '6px' }}>
              The timesheet counts down against this, so you can see what is left of the
              quote while you are filling it in.
              {quotePath && customerQuotes.find((q) => q.path === quotePath)?.sr && (
                <strong style={{ color: ui.TONE.warn, display: 'block', marginTop: '4px' }}>
                  That quote is already connected to {customerQuotes.find((q) => q.path === quotePath).sr}.
                  Saving moves it to this job.
                </strong>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', marginTop: '14px' }}>
          <div>
            <label style={label} htmlFor="nj-address">Address</label>
            <input id="nj-address" value={draft.address} onChange={set('address')} style={input} placeholder="Street" />
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 160px' }}>
              <label style={label} htmlFor="nj-city">City</label>
              <input id="nj-city" value={draft.city} onChange={set('city')} style={input} />
            </div>
            <div style={{ flex: '1 1 80px' }}>
              <label style={label} htmlFor="nj-state">State</label>
              <input id="nj-state" value={draft.state} onChange={set('state')} style={input} placeholder="AZ" maxLength={2} />
            </div>
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label style={label} htmlFor="nj-start">Starts</label>
            <input id="nj-start" type="date" value={draft.dateStart} onChange={set('dateStart')} style={input} />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={label} htmlFor="nj-end">Ends</label>
            <input id="nj-end" type="date" value={draft.dateEnd} onChange={set('dateEnd')} style={input} />
          </div>
        </div>
        <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '6px' }}>
          Leave the end date blank for a one-day job.
        </div>

        <div style={{ marginTop: '14px' }}>
          <label style={label} htmlFor="nj-desc">What is the work?</label>
          <textarea id="nj-desc" value={draft.description} onChange={set('description')} rows={3}
            style={{ ...input, resize: 'vertical' }} placeholder="Scope, machines, anything the timesheet should carry" />
        </div>
      </div>

      {(showProblems && problems.length > 0) && (
        <div style={{ ...card, borderLeft: `3px solid ${ui.TONE.bad}` }}>
          {problems.map((p) => (
            <div key={p} style={{ color: colors.text, fontSize: '13px', marginBottom: '4px' }}>{p}</div>
          ))}
        </div>
      )}
      {error && (
        <div style={{ ...card, borderLeft: `3px solid ${ui.TONE.bad}`, color: colors.text, fontSize: '13px' }}>{error}</div>
      )}

      <button type="submit" disabled={saving || loading || clash}
        style={ui.btn(colors, { tone: ui.TONE.ok, active: true, over: { padding: '10px 18px', fontSize: '15px', opacity: (saving || loading || clash) ? 0.6 : 1 } })}>
        {saving ? 'Reserving…' : `Reserve ${draft.sr || 'the number'} and start`}
      </button>
    </form>
  );
}
