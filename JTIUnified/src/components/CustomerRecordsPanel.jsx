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
import React, { useMemo } from 'react';
import { AlertTriangle, Check, Link2, Mail, MapPin, Route, Users } from 'lucide-react';

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
  if (!has(profile.invoiceEmails)) gaps.push('invoice email');
  // Mileage is what a timesheet pre-fills from, so a record without it still
  // leaves somebody typing.
  if (profile.miles == null || profile.miles === '') gaps.push('mileage');
  return gaps;
};

const Pill = ({ children, tone, colors }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '2px 8px', borderRadius: '999px', fontSize: '12px', fontWeight: 500,
    background: tone === 'bad' ? 'rgba(239,68,68,0.12)' : tone === 'warn' ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.12)',
    color: tone === 'bad' ? '#ef4444' : tone === 'warn' ? '#f59e0b' : '#10b981',
    border: `1px solid ${tone === 'bad' ? 'rgba(239,68,68,0.3)' : tone === 'warn' ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`,
  }}>{children}</span>
);

export default function CustomerRecordsPanel({ customers = [], records = [], colors, onOpenCustomer }) {
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

  const cell = { padding: '10px 12px', borderBottom: `1px solid ${colors.border || '#e5e7eb'}`, fontSize: '14px', verticalAlign: 'top' };
  const head = { ...cell, fontSize: '11px', letterSpacing: '0.04em', textTransform: 'uppercase', color: colors.textSecondary, fontWeight: 600, textAlign: 'left' };

  return (
    <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '20px', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: 0 }}>Customer records</h2>
        <span style={{ color: colors.textSecondary, fontSize: '14px' }}>
          {complete} of {rows.length} complete
          {unlinked > 0 && ` · ${unlinked} with no record to fill in`}
        </span>
      </div>
      <p style={{ color: colors.textSecondary, fontSize: '13px', margin: '0 0 16px' }}>
        Address, contacts and invoice emails, per customer. Click a row to open it and fill it in.
        Anything saved here also shows in CCW Issues and Headcount.
      </p>

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
                        <Pill tone="bad" colors={colors}><Link2 size={11} /> no record linked</Pill>
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    {r.unlinked ? <span style={{ color: colors.textSecondary }}>—</span>
                      : has(p.address) || has(p.cityState)
                        ? <span style={{ color: colors.textSecondary }}>{[p.address, p.cityState].filter(Boolean).join(', ')}</span>
                        : <Pill tone="warn" colors={colors}><AlertTriangle size={11} /> missing</Pill>}
                  </td>
                  <td style={cell}>
                    {r.unlinked ? <span style={{ color: colors.textSecondary }}>—</span>
                      : contacts > 0
                        ? <Pill tone="ok" colors={colors}><Check size={11} /> {contacts}</Pill>
                        : <Pill tone="warn" colors={colors}><AlertTriangle size={11} /> none</Pill>}
                  </td>
                  <td style={cell}>
                    {r.unlinked ? <span style={{ color: colors.textSecondary }}>—</span>
                      : emails > 0
                        ? <Pill tone="ok" colors={colors}><Check size={11} /> {emails}</Pill>
                        : <Pill tone="warn" colors={colors}><AlertTriangle size={11} /> none</Pill>}
                  </td>
                  <td style={cell}>
                    {r.unlinked ? <span style={{ color: colors.textSecondary }}>—</span>
                      : (p.miles != null && p.miles !== '')
                        ? <span style={{ color: colors.textSecondary }}>{p.miles} mi</span>
                        : <Pill tone="warn" colors={colors}><AlertTriangle size={11} /> none</Pill>}
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
