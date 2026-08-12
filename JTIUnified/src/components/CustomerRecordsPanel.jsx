// src/components/CustomerRecordsPanel.jsx
//
// Which customer records are still missing something.
//
// The details card fills in one customer at a time, which is the wrong shape
// for the job it creates: nobody discovers that eleven plants have no invoice
// email by opening eleven plants. This is the same information turned ninety
// degrees — every customer at once, what each one is missing, and a way
// straight to it.
//
// Sorted by what is missing rather than by name. A list where the finished
// rows come first is a list nobody scrolls.
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Link2, Mail, MapPin, Route, Send, Users } from 'lucide-react';
import { publishToTimesheet } from '../data-service';
import { primaryContact } from '@shared/utils/customerDefaults.js';
import * as ui from '../ui/theme';

const has = (v) => Array.isArray(v) ? v.length > 0 : !!String(v || '').trim();

/**
 * What a record is missing, as a list of short labels.
 *
 * An address counts if either line is there — plenty of plants are known by a
 * city and nothing else, and demanding both would mark them permanently
 * incomplete for no benefit.
 */
export const missingFrom = (profile = {}) => {
  const gaps = [];
  if (!has(profile.address) && !has(profile.cityState)) gaps.push('address');
  if (!has(profile.contacts)) gaps.push('contacts');
  // The contact the timesheet ACTUALLY uses — the one marked default, else the
  // first — must be reachable. Checking whether *any* contact has a number was
  // the wrong test and said "complete" for a plant whose default contact had
  // neither: the timesheet fills from one person, and mixing that person's name
  // with a colleague's phone number would be worse than leaving it blank.
  else if (!(() => { const c = primaryContact(profile.contacts); return has(c?.phone) || has(c?.email); })()) {
    gaps.push('contact phone/email');
  }
  if (!has(profile.invoiceEmails)) gaps.push('invoice email');
  // Mileage is what a timesheet pre-fills from, so a record without it still
  // leaves somebody typing.
  if (profile.miles == null || profile.miles === '') gaps.push('mileage');
  return gaps;
};

// Tone names rather than three parallel colour ternaries, which is what this
// was: one list of hexes for text, one for background, one for border, kept in
// step by hand.
const TONES = { bad: ui.TONE.bad, warn: ui.TONE.warn, ok: ui.TONE.ok };
const Pill = ({ children, tone }) => (
  <span style={ui.pill(TONES[tone] || ui.TONE.ok)}>{children}</span>
);

export default function CustomerRecordsPanel({ customers = [], records = [], colors, onOpenCustomer }) {
  const [publish, setPublish] = useState('');
  const rows = useMemo(() => {
    const byId = new Map(records.map((r) => [r.id, r]));
    const list = customers.map((c) => {
      const record = c.recordId ? byId.get(c.recordId) : null;
      return {
        name: c.name,
        variants: c.variants || [c.name],
        record,
        // No record at all is the biggest gap there is: without one there is
        // nowhere to PUT an address, so it is ranked above a missing field.
        gaps: record ? missingFrom(record.profile) : ['no record linked'],
        unlinked: !record,
      };
    });
    return list.sort((a, b) => {
      if (a.unlinked !== b.unlinked) return a.unlinked ? -1 : 1;
      if (a.gaps.length !== b.gaps.length) return b.gaps.length - a.gaps.length;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }, [customers, records]);

  const complete = rows.filter((r) => r.gaps.length === 0).length;
  const unlinked = rows.filter((r) => r.unlinked).length;

  const cell = ui.cell(colors);
  const head = ui.cell(colors, {
    fontSize: '11px', letterSpacing: '0.04em', textTransform: 'uppercase',
    color: colors.textSecondary, fontWeight: 600, textAlign: 'left',
  });

  return (
    <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '20px', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: 0 }}>Customer records</h2>
        <span style={{ color: colors.textSecondary, fontSize: '14px' }}>
          {complete} of {rows.length} complete
          {unlinked > 0 && ` · ${unlinked} with no record to fill in`}
        </span>
      </div>
      <p style={{ color: colors.textSecondary, fontSize: '13px', margin: '0 0 12px' }}>
        Address, contacts, invoice emails and mileage, per customer. Click a row to open it and fill
        it in. Anything saved here also shows in CCW Issues and Headcount, and is published to the
        timesheet app so a sheet can fill itself in.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {/* Saving a record republishes on its own; this is for the first run
            and for when somebody wants to be sure rather than assume. */}
        <button
          type="button"
          onClick={async () => {
            setPublish('Publishing…');
            try {
              const r = await publishToTimesheet();
              setPublish(`Sent ${r.customers} customers and ${r.jobs} job numbers to the timesheet app.`);
            } catch (err) { setPublish(`Could not publish: ${err.message || err}`); }
          }}
          style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${colors.border || '#d1d5db'}`, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <Send size={14} /> Publish to timesheet app
        </button>
        {publish && <span style={{ color: colors.textSecondary, fontSize: '13px' }}>{publish}</span>}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
          <thead>
            <tr>
              <th style={head}>Customer</th>
              <th style={head}><MapPin size={12} style={{ verticalAlign: '-2px' }} /> Address</th>
              <th style={head}><Users size={12} style={{ verticalAlign: '-2px' }} /> Contacts</th>
              <th style={head}><Mail size={12} style={{ verticalAlign: '-2px' }} /> Invoice email</th>
              <th style={head}><Route size={12} style={{ verticalAlign: '-2px' }} /> Mileage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = r.record?.profile || {};
              const contacts = (p.contacts || []).length;
              const emails = (p.invoiceEmails || []).length;
              return (
                <tr
                  key={r.name}
                  onClick={() => onOpenCustomer?.(r.name)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = colors.hover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <td style={{ ...cell, color: colors.text, fontWeight: 500 }}>
                    {r.name}
                    {/* The spellings this one entry stands for, so a merge that
                        looks wrong can be spotted from here rather than found
                        later in a total. */}
                    {r.variants.length > 1 && (
                      <div style={{ color: colors.textSecondary, fontSize: '12px', fontWeight: 400, marginTop: '2px' }}>
                        also: {r.variants.filter((v) => v !== r.name).join(', ')}
                      </div>
                    )}
                    {r.unlinked && (
                      <div style={{ marginTop: '4px' }}>
                        <Pill tone="bad"><Link2 size={11} /> no record linked</Pill>
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    {r.unlinked ? <span style={{ color: colors.textSecondary }}>—</span>
                      : has(p.address) || has(p.cityState)
                        ? <span style={{ color: colors.textSecondary }}>{[p.address, p.cityState].filter(Boolean).join(', ')}</span>
                        : <Pill tone="warn"><AlertTriangle size={11} /> missing</Pill>}
                  </td>
                  <td style={cell}>
                    {r.unlinked ? <span style={{ color: colors.textSecondary }}>—</span>
                      : contacts > 0
                        ? <Pill tone="ok"><Check size={11} /> {contacts}</Pill>
                        : <Pill tone="warn"><AlertTriangle size={11} /> none</Pill>}
                  </td>
                  <td style={cell}>
                    {r.unlinked ? <span style={{ color: colors.textSecondary }}>—</span>
                      : emails > 0
                        ? <Pill tone="ok"><Check size={11} /> {emails}</Pill>
                        : <Pill tone="warn"><AlertTriangle size={11} /> none</Pill>}
                  </td>
                  <td style={cell}>
                    {r.unlinked ? <span style={{ color: colors.textSecondary }}>—</span>
                      : (p.miles != null && p.miles !== '')
                        ? <span style={{ color: colors.textSecondary }}>{p.miles} mi</span>
                        : <Pill tone="warn"><AlertTriangle size={11} /> none</Pill>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
