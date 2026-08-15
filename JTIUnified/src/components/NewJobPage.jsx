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
import { ArrowRight, Building2, Check, Plus, RefreshCw } from 'lucide-react';
import { fetchUnifiedJobs, startJob, fetchServiceReports } from '../data-service';
import { nextServiceReportNumber } from '../utils/jobFlow';
import { normalizeDraft, draftProblems } from '../utils/jobDraft';
import { matchCustomer } from '@shared/utils/customerMatch.js';
import * as ui from '../ui/theme';

const today = () => new Date().toISOString().slice(0, 10);

export default function NewJobPage({ colors, customerRecords = [], onCreated, onOpenPacket }) {
  const [draft, setDraft] = useState({
    sr: '', customer: '', address: '', city: '', state: '',
    dateStart: today(), dateEnd: '', description: '',
  });
  const [taken, setTaken] = useState(null);      // every number already in use
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [showProblems, setShowProblems] = useState(false);

  // The next number, worked out from every number in use — the reserved ones
  // AND the historical ones. Reading only the reserved list would hand out a
  // number that a past job already carries.
  const loadNumber = async () => {
    setLoading(true); setError('');
    try {
      const [started, reports] = await Promise.all([fetchUnifiedJobs(), fetchServiceReports()]);
      const all = [
        ...(started || []).map((j) => j.sr),
        ...((reports?.reports || [])).map((r) => r.number),
      ];
      setTaken(all);
      setDraft((d) => ({ ...d, sr: nextServiceReportNumber(all, new Date().getFullYear()) }));
    } catch (err) {
      setError(err.message || String(err));
    }
    setLoading(false);
  };

  useEffect(() => { loadNumber(); }, []);

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
  const clash = taken && draft.sr
    && taken.some((n) => String(n || '').trim().toUpperCase() === draft.sr.trim().toUpperCase());

  const submit = async (e) => {
    e.preventDefault();
    if (problems.length) { setShowProblems(true); return; }
    setSaving(true); setError('');
    try {
      const rec = await startJob(draft);
      setCreated(rec);
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
        <div style={{ ...card, borderLeft: `3px solid ${ui.TONE.ok}` }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Check size={20} color={ui.TONE.ok} /> {created.sr} is yours
          </h2>
          <p style={{ color: colors.textSecondary, fontSize: '14px', margin: '0 0 14px' }}>
            {created.customer}{created.dateEnd ? ` · ${created.dateStart} → ${created.dateEnd}` : created.dateStart ? ` · ${created.dateStart}` : ''}
          </p>
          {/* Said explicitly, because the number appearing in three other apps
              a moment later is surprising if nobody told you it would. */}
          <div style={{ fontSize: '13px', color: colors.textSecondary, lineHeight: 1.7 }}>
            {created.trackerJobId
              ? <>The job is already <strong style={{ color: colors.text }}>in the Jobs Tracker</strong> — there is
                  nothing to re-enter, only the quote and terms to fill in when you have them. </>
              : <>The number is reserved, but the job could not be created in the Jobs Tracker just now —
                  open it there and the number will be offered on the service report field. </>}
            It is also offered on the <strong style={{ color: colors.text }}>Timesheet</strong> app's job picker
            and on the service report field in <strong style={{ color: colors.text }}>CCW Issues</strong>.
            Headcount does not use service report numbers and is unaffected.
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onOpenPacket?.(created.sr)}
              style={ui.btn(colors, { tone: ui.TONE.brand, active: true, over: { display: 'flex', alignItems: 'center', gap: '6px' } })}>
              Open its packet <ArrowRight size={14} />
            </button>
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
          <span style={{ fontSize: '30px', fontWeight: 700, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>
            {loading ? '…' : draft.sr || '—'}
          </span>
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
        {clash && (
          <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '6px', background: '#fef2f2', color: '#991b1b', fontSize: '13px' }}>
            {draft.sr} is already in use. Press Check again to take the next free one.
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
