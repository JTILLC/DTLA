// src/components/CustomerRecordCard.jsx
//
// Who a customer is: where they are, who to ring, and where invoices go.
//
// This reads and writes the customer record in the CCW database — the same
// document CCW Issues and Headcount use for a plant's name and address — so an
// address corrected here is corrected everywhere, and there is never a second
// copy to wonder about.
//
// It stays in view mode until somebody presses Edit. This is reference
// information people come here to READ, many times for every once it changes,
// and a screen full of input boxes invites accidental edits to a phone number
// nobody meant to touch.
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Building2, Check, Mail, Phone, Plus, Trash2, X } from 'lucide-react';
import { looksLikeADifferentSite } from '@shared/utils/customerMatch.js';
import * as ui from '../ui/theme';

const BLANK_CONTACT = { name: '', role: '', phone: '', email: '' };

const inputStyle = (colors) => ui.input(colors, { width: '100%' });

const labelStyle = (colors) => ui.label(colors, { marginBottom: '4px' });

// Module scope, NOT inside the component.
//
// It was declared in the render body, which makes a new function — and so, to
// React, a NEW COMPONENT TYPE — on every keystroke. React cannot know that two
// different functions render the same thing, so it threw the old subtree away
// and mounted a fresh one each time: the address input was destroyed and
// recreated after every character, taking the caret with it. Typing an address
// meant clicking back into the box for each letter.
//
// Anything that renders children and holds an input has to be defined once,
// where its identity is stable.
const Row = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
    {children}
  </div>
);

export default function CustomerRecordCard({
  customerName,
  record,          // { id, name, profile } or null when nothing is linked
  colors,
  onSave,          // (customerId, patch) => Promise
  onLink,          // (customerId) => Promise — records this name as an alias
  allRecords = [],
}) {
  const profile = record?.profile || {};
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(profile);
  const [linkTo, setLinkTo] = useState('');

  // Re-seed whenever a different customer is shown, so a draft never leaks
  // from the customer being looked at onto the next one.
  useEffect(() => {
    setDraft({
      address: '', cityState: '', miles: null, paymentTerms: '', contacts: [], invoiceEmails: [], aliases: [], notes: '', ...(record?.profile || {}),
    });
    setEditing(false);
    setError('');
    setLinkTo('');
  }, [record?.id, customerName]);

  // No record answers to this name. Rather than an empty card, offer the join —
  // and let a person make it, because matching plants by name automatically is
  // how one plant's invoice addresses end up under another plant's name.
  if (!record) {
    const chosen = allRecords.find((r) => r.id === linkTo);
    const siteWarning = chosen && looksLikeADifferentSite(customerName, chosen.name) ? chosen.name : null;
    return (
      <div style={{
        background: colors.cardBg, borderRadius: '12px', padding: '20px', marginBottom: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: `1px dashed ${colors.border || '#d1d5db'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Building2 size={18} color={colors.textSecondary} />
          <strong style={{ color: colors.text }}>No customer record linked</strong>
        </div>
        <p style={{ color: colors.textSecondary, fontSize: '14px', margin: '0 0 12px' }}>
          Jobs and timesheets use the name <strong>{customerName}</strong>, and no customer record
          matches it. Link one and this page will show their address, contacts and invoice emails —
          and remember the link for next time.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <select
            value={linkTo}
            onChange={(e) => setLinkTo(e.target.value)}
            style={{ ...inputStyle(colors), maxWidth: '320px' }}
          >
            <option value="">Choose the customer record…</option>
            {[...allRecords].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!linkTo || saving}
            onClick={async () => {
              // One name being the other plus a location is how two plants of
              // one company get filed as one — and then invoices and history
              // for Portland show under Oakland. Worth one question; not worth
              // refusing, since "Flagstone" and "Flagstone Foods" really are
              // one plant.
              if (siteWarning && !window.confirm(
                `${customerName} and ${siteWarning} may be different sites of the same company.\n\n`
                + 'Linking them puts their addresses, invoices and history together under one record. '
                + 'Link them anyway?')) return;
              setSaving(true);
              setError('');
              try { await onLink(linkTo); } catch (err) { setError(err.message || String(err)); }
              setSaving(false);
            }}
            style={{
              padding: '8px 14px', borderRadius: '6px', border: 'none', fontWeight: 600,
              background: linkTo ? '#3b82f6' : '#9ca3af', color: 'white',
              cursor: linkTo ? 'pointer' : 'not-allowed', fontSize: '14px',
            }}
          >
            {saving ? 'Linking…' : 'Link'}
          </button>
        </div>
        {siteWarning && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginTop: '10px', fontSize: '13px', color: '#f59e0b' }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              <strong>{customerName}</strong> and <strong>{siteWarning}</strong> may be different sites
              of one company. Check the city before linking — separate plants should stay separate.
            </span>
          </div>
        )}
        {error && <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px' }}>{error}</div>}
      </div>
    );
  }

  const contacts = draft.contacts || [];
  const invoiceEmails = draft.invoiceEmails || [];

  const setContact = (i, key, value) =>
    setDraft((d) => ({ ...d, contacts: (d.contacts || []).map((c, n) => (n === i ? { ...c, [key]: value } : c)) }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // Blank rows are what a half-finished edit leaves behind; they would
      // otherwise pile up on the record forever.
      const cleaned = {
        address: (draft.address || '').trim(),
        cityState: (draft.cityState || '').trim(),
        // Stored as a number so it can be summed and compared; '' clears it.
        miles: draft.miles === '' || draft.miles == null ? null : Number(draft.miles),
        notes: (draft.notes || '').trim(),
        paymentTerms: (draft.paymentTerms || '').trim(),
        contacts: contacts
          .map((c) => ({
            name: (c.name || '').trim(), role: (c.role || '').trim(),
            phone: (c.phone || '').trim(), email: (c.email || '').trim(),
            ...(c.primary ? { primary: true } : {}),
          }))
          .filter((c) => c.name || c.phone || c.email),
        invoiceEmails: invoiceEmails.map((e) => (e || '').trim()).filter(Boolean),
        aliases: (draft.aliases || []).map((a) => (a || '').trim()).filter(Boolean),
      };
      await onSave(record.id, cleaned);
      setDraft((d) => ({ ...d, ...cleaned }));
      setEditing(false);
    } catch (err) {
      setError(err.message || String(err));
    }
    setSaving(false);
  };

  return (
    <div style={{
      background: colors.cardBg, borderRadius: '12px', padding: '20px', marginBottom: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={18} color={colors.textSecondary} />
          <strong style={{ color: colors.text, fontSize: '16px' }}>Customer details</strong>
          {record.name && record.name.toLowerCase() !== String(customerName || '').toLowerCase() && (
            <span style={{ fontSize: '12px', color: colors.textSecondary }}>
              · filed as <strong>{record.name}</strong>
            </span>
          )}
        </div>
        {editing ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button" onClick={() => { setDraft({ ...profile }); setEditing(false); setError(''); }}
              style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${colors.border || '#d1d5db'}`, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <X size={14} /> Cancel
            </button>
            <button
              type="button" onClick={save} disabled={saving}
              style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: '#10b981', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Check size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            type="button" onClick={() => setEditing(true)}
            style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${colors.border || '#d1d5db'}`, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: '13px' }}
          >
            Edit
          </button>
        )}
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

      {/* Address */}
      <div style={{ marginBottom: '18px' }}>
        <Row>
          <div>
            <label style={labelStyle(colors)}>Address</label>
            {editing
              ? <input style={inputStyle(colors)} value={draft.address || ''} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Street address" />
              : <div style={{ color: draft.address ? colors.text : colors.textSecondary, fontSize: '14px' }}>{draft.address || 'Not recorded'}</div>}
          </div>
          <div>
            <label style={labelStyle(colors)}>City / State</label>
            {editing
              ? <input style={inputStyle(colors)} value={draft.cityState || ''} onChange={(e) => setDraft({ ...draft, cityState: e.target.value })} placeholder="City, ST" />
              : <div style={{ color: draft.cityState ? colors.text : colors.textSecondary, fontSize: '14px' }}>{draft.cityState || 'Not recorded'}</div>}
          </div>
          <div>
            {/* The round trip somebody has agreed for this plant. A default for
                the timesheet, not a rule — a job run from somewhere else has
                different mileage and must stay editable there. */}
            <label style={labelStyle(colors)}>Mileage (round trip)</label>
            {editing
              ? <input type="number" min="0" style={inputStyle(colors)} value={draft.miles ?? ''}
                       onChange={(e) => setDraft({ ...draft, miles: e.target.value })} placeholder="e.g. 240" />
              : <div style={{ color: (draft.miles || draft.miles === 0) ? colors.text : colors.textSecondary, fontSize: '14px' }}>
                  {(draft.miles || draft.miles === 0) ? `${draft.miles} miles` : 'Not recorded'}
                </div>}
          </div>
        </Row>
      </div>

      {/* Contacts */}
      <div style={{ marginBottom: '18px' }}>
        <label style={labelStyle(colors)}>Plant contacts</label>
        {/* These are the plant's own people. The one marked below fills a
            timesheet's contact, phone and email — which is a DIFFERENT thing
            from the invoice emails lower down, and the two get confused
            because both are addresses. */}
        <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '-2px', marginBottom: '8px' }}>
          Who to ask for on site. The one marked <strong>timesheet default</strong> pre-fills a
          timesheet&rsquo;s contact, phone and email.
        </div>
        {contacts.length === 0 && !editing && (
          <div style={{ color: colors.textSecondary, fontSize: '14px' }}>Nobody recorded</div>
        )}
        {contacts.map((c, i) => (
          <div key={i} style={{ marginBottom: '10px' }}>
            {editing ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <input style={{ ...inputStyle(colors), flex: '1 1 130px' }} value={c.name} onChange={(e) => setContact(i, 'name', e.target.value)} placeholder="Name" />
                <input style={{ ...inputStyle(colors), flex: '1 1 110px' }} value={c.role} onChange={(e) => setContact(i, 'role', e.target.value)} placeholder="Role" />
                <input style={{ ...inputStyle(colors), flex: '1 1 120px' }} value={c.phone} onChange={(e) => setContact(i, 'phone', e.target.value)} placeholder="Phone" />
                <input style={{ ...inputStyle(colors), flex: '1 1 160px' }} value={c.email} onChange={(e) => setContact(i, 'email', e.target.value)} placeholder="Email" />
                <button
                  type="button"
                  aria-label={`Use ${c.name || 'this contact'} on timesheets`}
                  title="Use this person on timesheets"
                  onClick={() => setDraft((d) => ({
                    ...d,
                    contacts: d.contacts.map((x, n) => ({ ...x, primary: n === i })),
                  }))}
                  style={{
                    padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                    border: `1px solid ${colors.border || '#d1d5db'}`,
                    background: (c.primary || (i === 0 && !contacts.some((x) => x.primary))) ? 'rgba(59,130,246,0.15)' : 'transparent',
                    color: (c.primary || (i === 0 && !contacts.some((x) => x.primary))) ? '#3b82f6' : colors.textSecondary,
                    whiteSpace: 'nowrap',
                  }}
                >
                  timesheet
                </button>
                <button
                  type="button" aria-label={`Remove ${c.name || 'contact'}`}
                  onClick={() => setDraft((d) => ({ ...d, contacts: d.contacts.filter((_, n) => n !== i) }))}
                  style={{ padding: '8px', borderRadius: '6px', border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '14px', color: colors.text, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <strong>{c.name}</strong>
                {(c.primary || (i === 0 && !contacts.some((x) => x.primary))) && (
                  <>
                    <span style={{ fontSize: '11px', padding: '1px 7px', borderRadius: '999px', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}>
                      timesheet default
                    </span>
                    {/* Said here because here is where it can be fixed: either
                        give this person a number, or mark the colleague who has
                        one as the default. A timesheet fills from ONE contact,
                        so a name without a number leaves two boxes empty. */}
                    {!c.phone && !c.email && (
                      <span style={{ fontSize: '11px', color: '#f59e0b' }}>
                        no phone or email — a timesheet cannot fill those from this contact
                      </span>
                    )}
                  </>
                )}
                {c.role && <span style={{ color: colors.textSecondary }}>{c.role}</span>}
                {c.phone && <a href={`tel:${c.phone}`} style={{ color: '#3b82f6', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Phone size={13} />{c.phone}</a>}
                {c.email && <a href={`mailto:${c.email}`} style={{ color: '#3b82f6', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Mail size={13} />{c.email}</a>}
              </div>
            )}
          </div>
        ))}
        {editing && (
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, contacts: [...(d.contacts || []), { ...BLANK_CONTACT }] }))}
            style={{ marginTop: '4px', padding: '6px 10px', borderRadius: '6px', border: `1px dashed ${colors.border || '#d1d5db'}`, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <Plus size={14} /> Add contact
          </button>
        )}
      </div>

      {/* Other names this record answers to.
          These were invisible until a bad one attributed eight jobs to the
          wrong plant. A link nobody can see is a link nobody can undo, and
          the merge it causes shows up as somebody else's money. */}
      <div style={{ marginBottom: '18px' }}>
        <label style={labelStyle(colors)}>Also known as</label>
        {(draft.aliases || []).length === 0 && (
          <div style={{ color: colors.textSecondary, fontSize: '14px' }}>No other names</div>
        )}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {(draft.aliases || []).map((a, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '3px 10px', borderRadius: '999px', fontSize: '13px',
              background: colors.hover, color: colors.text,
              border: `1px solid ${colors.border || '#d1d5db'}`,
            }}>
              {a}
              {editing && (
                <button
                  type="button" aria-label={`Stop treating ${a} as this customer`}
                  title={`Stop treating "${a}" as this customer`}
                  onClick={() => setDraft((d) => ({ ...d, aliases: d.aliases.filter((_, n) => n !== i) }))}
                  style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                >
                  <X size={13} />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Invoice emails */}
      <div>
        <label style={labelStyle(colors)}>Invoice emails (accounts payable)</label>
        {/* Stated because it is the one thing here that never leaves this
            company's side: it is where WE send the invoice, not a contact a
            technician would ask for, and it never appears on a timesheet. */}
        <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '-2px', marginBottom: '8px' }}>
          Where JTI sends the invoice. Used by the job packet only &mdash; never put on a timesheet.
        </div>
        <div style={{ marginBottom: '12px', maxWidth: '260px' }}>
          {/* Standing terms for this plant. They belong to the customer rather
              than the job, so a timesheet should not be asked for them afresh
              every time. */}
          <label style={labelStyle(colors)}>Payment terms</label>
          {editing
            ? <input style={inputStyle(colors)} value={draft.paymentTerms || ''}
                     onChange={(e) => setDraft({ ...draft, paymentTerms: e.target.value })} placeholder="e.g. Net 30" />
            : <div style={{ color: draft.paymentTerms ? colors.text : colors.textSecondary, fontSize: '14px' }}>
                {draft.paymentTerms || 'Not recorded'}
              </div>}
        </div>
        {invoiceEmails.length === 0 && !editing && (
          <div style={{ color: colors.textSecondary, fontSize: '14px' }}>None recorded</div>
        )}
        {invoiceEmails.map((email, i) => (
          <div key={i} style={{ marginBottom: '8px' }}>
            {editing ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  style={{ ...inputStyle(colors), maxWidth: '320px' }} value={email} type="email"
                  onChange={(e) => setDraft((d) => ({ ...d, invoiceEmails: d.invoiceEmails.map((v, n) => (n === i ? e.target.value : v)) }))}
                  placeholder="billing@example.com"
                />
                <button
                  type="button" aria-label={`Remove ${email || 'invoice email'}`}
                  onClick={() => setDraft((d) => ({ ...d, invoiceEmails: d.invoiceEmails.filter((_, n) => n !== i) }))}
                  style={{ padding: '8px', borderRadius: '6px', border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <a href={`mailto:${email}`} style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Mail size={13} />{email}
              </a>
            )}
          </div>
        ))}
        {editing && (
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, invoiceEmails: [...(d.invoiceEmails || []), ''] }))}
            style={{ marginTop: '4px', padding: '6px 10px', borderRadius: '6px', border: `1px dashed ${colors.border || '#d1d5db'}`, background: 'transparent', color: colors.text, cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <Plus size={14} /> Add invoice email
          </button>
        )}
      </div>
    </div>
  );
}
