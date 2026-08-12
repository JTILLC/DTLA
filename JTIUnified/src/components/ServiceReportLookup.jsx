import { useState, useMemo } from 'react';
import * as ui from '../ui/theme';
import { Search, FileText, Receipt, ClipboardList, ExternalLink, AlertTriangle, RefreshCw, Eye, X, Plus, Pencil, Trash2, Paperclip } from 'lucide-react';
import { saveManualReport, deleteManualReport } from '../data-service';

const CCW_URL = 'https://jti-issues.pages.dev';
// Every other link in this dashboard — SearchResults, CalendarView, App, the
// data service — opens the Cloudflare copy. This one alone opened the Netlify
// copy, which is a stale build still carrying the code path that lost a full
// sheet, and the two origins keep separate localStorage: a draft or recovery
// snapshot saved on one is not there on the other. Sending people to two
// different versions of the same app from the same dashboard is the bug.
const TIMESHEET_URL = 'https://jti-timesheet.pages.dev';

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// A blank entry. `kind` decides which half of a report number it fills in.
const emptyEntry = (kind, number = '') => ({
  id: null, kind, number, customer: '', date: '', invoiceNumber: '', amount: '', notes: '',
  file: null, removeFile: false, existingFileName: '',
});

export default function ServiceReportLookup({
  reports = [],
  years = [],
  untaggedVisits = [],
  untaggedTimesheets = [],
  loading = false,
  colors,
  onRefresh,
}) {
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [selectedNorm, setSelectedNorm] = useState(null);
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  // Manual entry: the form, what it is saving, and which row is one click from
  // being deleted (a second click on the row itself, rather than a native
  // confirm that blocks the page).
  const [entry, setEntry] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  const openEntry = (kind, number = '') => { setFormError(''); setEntry(emptyEntry(kind, number)); };
  const editEntry = (row) => {
    setFormError('');
    setEntry({
      id: row.id,
      kind: row.kind === 'manual-invoice' ? 'invoice' : 'report',
      number: row.number || '',
      customer: row.customer || '',
      date: row.date || '',
      invoiceNumber: row.invoiceNumber || '',
      amount: row.amount == null ? '' : String(row.amount),
      notes: row.notes || '',
      file: null,
      removeFile: false,
      existingFileName: row.fileName || '',
    });
  };

  const submitEntry = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await saveManualReport(entry);
      setSelectedNorm(String(entry.number || '').trim().replace(/[\s-]/g, '').toUpperCase());
      setEntry(null);
      await onRefresh?.();
    } catch (err) {
      // Kept on screen with the form still filled in — a failed save must never
      // be a retyped one.
      setFormError(err?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (id) => {
    setPendingDelete(null);
    try {
      await deleteManualReport(id);
      await onRefresh?.();
    } catch (err) {
      setFormError(err?.message || 'Could not delete that entry.');
    }
  };

  const isUnmatched = (r) => r.timesheets.length === 0 || r.visits.length === 0;
  const unmatchedCount = useMemo(() => reports.filter(isUnmatched).length, [reports]);

  const filtered = useMemo(() => {
    let list = reports;
    if (yearFilter !== 'all') list = list.filter((r) => r.year === yearFilter);
    if (onlyUnmatched) list = list.filter(isUnmatched);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.number.toLowerCase().includes(q) ||
          r.timesheets.some((t) => (t.customer || '').toLowerCase().includes(q)) ||
          r.visits.some((v) => (v.customer || '').toLowerCase().includes(q))
      );
    }
    return list;
  }, [reports, yearFilter, onlyUnmatched, search]);

  const grouped = useMemo(() => {
    const g = new Map();
    filtered.forEach((r) => {
      if (!g.has(r.year)) g.set(r.year, []);
      g.get(r.year).push(r);
    });
    return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const selected = useMemo(() => reports.find((r) => r.norm === selectedNorm) || null, [reports, selectedNorm]);

  // Every customer name the page has already seen, for the entry form's
  // autocomplete — typing a new spelling of an existing customer is the easiest
  // way to make a manual record fail to line up with everything else.
  const knownCustomers = useMemo(() => {
    const names = new Set();
    reports.forEach((r) => {
      r.timesheets.forEach((t) => t.customer && names.add(t.customer));
      r.visits.forEach((v) => v.customer && names.add(v.customer));
    });
    untaggedVisits.forEach((v) => v.customer && names.add(v.customer));
    untaggedTimesheets.forEach((t) => t.customer && names.add(t.customer));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [reports, untaggedVisits, untaggedTimesheets]);

  const chip = (bg, color, Icon, label, title) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: bg, color }}>
      <Icon size={11} /> {label}
    </span>
  );

  const linkBtn = (href, label) => (
    <a href={href} target="_blank" rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 500, color: '#3b82f6', textDecoration: 'none', padding: '5px 10px', border: `1px solid ${colors.border}`, borderRadius: 6, background: colors.cardBg }}>
      {label} <ExternalLink size={13} />
    </a>
  );

  const input = ui.input(colors, { width: '100%' });
  const fieldLabel = { display: 'block', fontSize: 12, color: colors.textSecondary, fontWeight: 600, marginBottom: 4 };

  const manualBadge = (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 999, background: '#fef3c7', color: '#92400e' }}>
      Manual
    </span>
  );

  // Edit and delete are offered only on entries typed here. A record derived
  // from a timesheet or a visit belongs to that app, and editing it in this
  // window would put the two out of step with no sign that it happened.
  const manualControls = (row) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button onClick={() => editEntry(row)} title="Edit this entry"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: colors.text, cursor: 'pointer', padding: '5px 10px', border: `1px solid ${colors.border}`, borderRadius: 6, background: colors.cardBg }}>
        <Pencil size={13} /> Edit
      </button>
      {pendingDelete === row.id ? (
        <button onClick={() => removeEntry(row.id)} title="Click again to delete"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: 'white', cursor: 'pointer', padding: '5px 10px', border: '1px solid #dc2626', borderRadius: 6, background: '#dc2626' }}>
          <Trash2 size={13} /> Confirm
        </button>
      ) : (
        <button onClick={() => setPendingDelete(row.id)} title="Delete this entry"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#dc2626', cursor: 'pointer', padding: '5px 10px', border: `1px solid ${colors.border}`, borderRadius: 6, background: colors.cardBg }}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );

  const addBtn = (kind, label) => (
    <button onClick={() => openEntry(kind, selected?.number || '')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 500, color: '#3b82f6', cursor: 'pointer', padding: '5px 10px', border: `1px dashed ${colors.border}`, borderRadius: 6, background: 'transparent' }}>
      <Plus size={13} /> {label}
    </button>
  );

  const sectionCard = { background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14, marginBottom: 12 };
  const label = ui.label(colors, { fontSize: 12, marginBottom: 8 });

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.text, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <FileText size={24} /> Reports
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => openEntry('invoice')}
          style={{ padding: '8px 14px', background: '#3b82f6', border: '1px solid #3b82f6', borderRadius: 6, cursor: 'pointer', color: 'white', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={15} /> Add entry
        </button>
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading}
            style={{ padding: '8px 14px', background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 6, cursor: loading ? 'default' : 'pointer', color: colors.text, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} style={loading ? { animation: 'jti-spin 0.8s linear infinite' } : undefined} /> Refresh
          </button>
        )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: colors.textSecondary }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number or customer…"
            style={{ width: '100%', padding: '8px 10px 8px 32px', borderRadius: 8, border: `1px solid ${colors.border}`, background: colors.cardBg, color: colors.text, fontSize: 14 }} />
        </div>
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${colors.border}`, background: colors.cardBg, color: colors.text, fontSize: 14 }}>
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={() => setOnlyUnmatched((v) => !v)}
          style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${onlyUnmatched ? '#f59e0b' : colors.border}`, background: onlyUnmatched ? '#f59e0b' : colors.cardBg, color: onlyUnmatched ? 'white' : colors.text, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={14} /> Unmatched ({unmatchedCount})
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: colors.textSecondary }}>Loading reports…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 340px) 1fr', gap: 16, alignItems: 'start' }} className="srl-grid">
          {/* LEFT: list */}
          <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden', maxHeight: '70vh', overflowY: 'auto' }}>
            {grouped.length === 0 ? (
              <div style={{ padding: 24, color: colors.textSecondary, fontSize: 14 }}>
                No report numbers{onlyUnmatched ? ' need attention' : ' found'}. {reports.length === 0 && 'Tag visits and invoices with a service report number, or add one by hand with Add entry.'}
              </div>
            ) : (
              grouped.map(([year, rs]) => (
                <div key={year}>
                  <div style={{ position: 'sticky', top: 0, background: colors.hover, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: colors.textSecondary }}>
                    {year} <span style={{ fontWeight: 500 }}>· {rs.length}</span>
                  </div>
                  {rs.map((r) => {
                    const active = r.norm === selectedNorm;
                    const hasPdf = r.visits.some((v) => v.serviceReportUrl);
                    return (
                      <button key={r.norm} onClick={() => setSelectedNorm(r.norm)}
                        style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: `1px solid ${colors.border}`, background: active ? '#3b82f6' : 'transparent', color: active ? 'white' : colors.text, padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{r.number}</span>
                          {isUnmatched(r) && <AlertTriangle size={13} style={{ color: active ? 'white' : '#f59e0b' }} title="Only found on one side" />}
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', opacity: active ? 0.95 : 1 }}>
                          {r.timesheets.length > 0 && chip(active ? 'rgba(255,255,255,0.2)' : '#ecfdf5', active ? 'white' : '#059669', Receipt, 'Invoice', 'Invoice / timesheet exists')}
                          {r.visits.length > 0 && chip(active ? 'rgba(255,255,255,0.2)' : '#eff6ff', active ? 'white' : '#2563eb', ClipboardList, 'Visit', 'Weigher visit exists')}
                          {hasPdf && chip(active ? 'rgba(255,255,255,0.2)' : '#f5f3ff', active ? 'white' : '#7c3aed', FileText, 'PDF', 'Service report PDF attached')}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* RIGHT: detail */}
          <div>
            {!selected ? (
              <div style={{ ...sectionCard, color: colors.textSecondary, fontSize: 14 }}>
                Select a report number to see its invoice, timesheet and weigher visit — or use Add entry to record one that is not in either system.
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>{selected.number}</span>
                  <span style={{ fontSize: 13, color: colors.textSecondary }}>{selected.year}</span>
                </div>

                {/* Invoice / Timesheet */}
                <div style={sectionCard}>
                  <div style={label}><Receipt size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> Invoice / Timesheet</div>
                  {selected.timesheets.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ color: '#f59e0b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertTriangle size={14} /> No invoice/timesheet found for this number.
                      </span>
                      {addBtn('invoice', 'Add invoice')}
                    </div>
                  ) : (
                    selected.timesheets.map((t) => (
                      <div key={t.id} style={{ paddingBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 14, color: colors.text }}>
                            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {t.customer} {t.manual && manualBadge}
                            </div>
                            <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                              Invoice #{t.invoiceInfo?.invoiceNumber || '—'}
                              {t.manual
                                ? `${t.date ? ` · ${fmtDate(t.date)}` : ''}${t.amount != null ? ` · $${Number(t.amount).toFixed(2)}` : ''}`
                                : ` · ${t.entryCount} day${t.entryCount === 1 ? '' : 's'}${t.customerInfo?.purpose ? ` · ${t.customerInfo.purpose}` : ''}`}
                            </div>
                          </div>
                          {t.manual ? manualControls(t) : linkBtn(TIMESHEET_URL, 'Timesheet app')}
                        </div>
                        {t.serviceWork && t.serviceWork.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ ...label, marginBottom: 6 }}>Service performed</div>
                            {t.serviceWork.map((w, i) => (
                              <div key={i} style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>{fmtDate(w.date)}</div>
                                <div style={{ fontSize: 13, color: colors.text, whiteSpace: 'pre-wrap' }}>{w.text}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  {selected.timesheets.length > 0 && (
                    <div style={{ marginTop: 4 }}>{addBtn('invoice', 'Add another invoice')}</div>
                  )}
                </div>

                {/* Weigher visit */}
                <div style={sectionCard}>
                  <div style={label}><ClipboardList size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> Service Report / Weigher Visit</div>
                  {selected.visits.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ color: '#f59e0b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertTriangle size={14} /> No weigher visit tagged with this number.
                      </span>
                      {addBtn('report', 'Add service report')}
                    </div>
                  ) : (
                    selected.visits.map((v) => (
                      <div key={v.visitId} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: selected.visits.length > 1 ? `1px solid ${colors.border}` : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 14, color: colors.text }}>
                            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {v.customer}{v.name ? ` — ${v.name}` : ''} {v.manual && manualBadge}
                            </div>
                            {/* A derived visit always has a date. A manual one
                                may not, and an em dash sitting alone under the
                                customer name reads as missing data rather than
                                as nothing to say — so the line goes instead. */}
                            {(!v.manual || v.date || v.fileName) && (
                              <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                                {(!v.manual || v.date) && fmtDate(v.date)}
                                {v.manual
                                  ? (v.fileName ? `${v.date ? ' · ' : ''}${v.fileName}` : '')
                                  : ` · ${v.lineCount} line${v.lineCount === 1 ? '' : 's'}${v.lines.length ? ` (${v.lines.map((l) => l.title).join(', ')})` : ''}`}
                              </div>
                            )}
                            {v.manual && v.notes && (
                              <div style={{ fontSize: 13, color: colors.text, whiteSpace: 'pre-wrap', marginTop: 6 }}>{v.notes}</div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {v.serviceReportUrl && (
                              <button onClick={() => setPreviewUrl(v.serviceReportUrl)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 500, color: '#7c3aed', cursor: 'pointer', padding: '5px 10px', border: `1px solid ${colors.border}`, borderRadius: 6, background: colors.cardBg }}>
                                <Eye size={13} /> Preview PDF
                              </button>
                            )}
                            {v.serviceReportUrl && linkBtn(v.serviceReportUrl, 'Open PDF')}
                            {v.manual
                              ? manualControls(v)
                              : linkBtn(`${CCW_URL}/?customerId=${encodeURIComponent(v.customerId)}&visitId=${encodeURIComponent(v.visitId)}`, 'Open visit')}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  {selected.visits.length > 0 && (
                    <div style={{ marginTop: 4 }}>{addBtn('report', 'Add another service report')}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual entry form */}
      {entry && (
        <div onClick={() => !saving && setEntry(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submitEntry}
            style={{ background: colors.cardBg, borderRadius: 10, width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${colors.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ fontWeight: 600, color: colors.text, fontSize: 16 }}>
                {entry.id ? 'Edit entry' : 'Add entry'}
              </span>
              <button type="button" onClick={() => setEntry(null)} aria-label="Close"
                style={{ background: 'transparent', border: 0, cursor: 'pointer', color: colors.textSecondary, display: 'flex' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* What this record is. Switching it changes which fields matter,
                  so it sits first and reads as a choice, not a filter. */}
              <div>
                <div style={fieldLabel}>This is an</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[['invoice', 'Invoice', Receipt], ['report', 'Service report', ClipboardList]].map(([k, lbl, Icon]) => (
                    <button key={k} type="button" onClick={() => setEntry({ ...entry, kind: k })}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 10px', fontSize: 14, fontWeight: 500, cursor: 'pointer', borderRadius: 8, border: `1px solid ${entry.kind === k ? '#3b82f6' : colors.border}`, background: entry.kind === k ? '#3b82f6' : colors.cardBg, color: entry.kind === k ? 'white' : colors.text }}>
                      <Icon size={14} /> {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={fieldLabel} htmlFor="mr-number">Service report number *</label>
                  <input id="mr-number" required value={entry.number} onChange={(e) => setEntry({ ...entry, number: e.target.value })}
                    placeholder="2026012" style={input} />
                </div>
                <div>
                  <label style={fieldLabel} htmlFor="mr-date">Date</label>
                  <input id="mr-date" type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} style={input} />
                </div>
              </div>

              <div>
                <label style={fieldLabel} htmlFor="mr-customer">Customer *</label>
                <input id="mr-customer" required list="mr-customers" value={entry.customer}
                  onChange={(e) => setEntry({ ...entry, customer: e.target.value })} placeholder="Customer name" style={input} />
                {/* Names already in the data, so a manual entry lands under the
                    same spelling the rest of the dashboard uses. */}
                <datalist id="mr-customers">
                  {knownCustomers.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>

              {entry.kind === 'invoice' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={fieldLabel} htmlFor="mr-inv">Invoice number</label>
                    <input id="mr-inv" value={entry.invoiceNumber} onChange={(e) => setEntry({ ...entry, invoiceNumber: e.target.value })} style={input} />
                  </div>
                  <div>
                    <label style={fieldLabel} htmlFor="mr-amt">Amount</label>
                    <input id="mr-amt" type="number" step="0.01" min="0" value={entry.amount}
                      onChange={(e) => setEntry({ ...entry, amount: e.target.value })} placeholder="0.00" style={input} />
                  </div>
                </div>
              )}

              <div>
                <label style={fieldLabel} htmlFor="mr-notes">
                  {entry.kind === 'invoice' ? 'Notes' : 'Work performed'}
                </label>
                <textarea id="mr-notes" rows={3} value={entry.notes} onChange={(e) => setEntry({ ...entry, notes: e.target.value })}
                  style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>

              {entry.kind === 'report' && (
                <div>
                  <div style={fieldLabel}>PDF (optional)</div>
                  {entry.existingFileName && !entry.file && !entry.removeFile ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text }}>
                      <Paperclip size={14} /> {entry.existingFileName}
                      <button type="button" onClick={() => setEntry({ ...entry, removeFile: true })}
                        style={{ background: 'transparent', border: 0, color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>Remove</button>
                    </div>
                  ) : (
                    <input type="file" accept="application/pdf,.pdf"
                      onChange={(e) => setEntry({ ...entry, file: e.target.files?.[0] || null, removeFile: false })}
                      style={{ ...input, padding: 8 }} />
                  )}
                </div>
              )}

              {formError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 6, padding: '8px 10px', fontSize: 13 }}>
                  {formError}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: `1px solid ${colors.border}` }}>
              <button type="button" onClick={() => setEntry(null)} disabled={saving}
                style={{ padding: '9px 14px', borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.cardBg, color: colors.text, fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={saving}
                style={{ padding: '9px 16px', borderRadius: 6, border: '1px solid #3b82f6', background: '#3b82f6', color: 'white', fontSize: 14, fontWeight: 500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : entry.id ? 'Save changes' : 'Add entry'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* PDF preview overlay */}
      {previewUrl && (
        <div onClick={() => setPreviewUrl(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: colors.cardBg, borderRadius: 10, width: 'min(920px, 100%)', height: 'min(90vh, 100%)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }}>
              <span style={{ fontWeight: 600, color: colors.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={16} /> Service Report
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <a href={previewUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#3b82f6', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  Open in new tab <ExternalLink size={13} />
                </a>
                <button onClick={() => setPreviewUrl(null)} aria-label="Close preview"
                  style={{ background: 'transparent', border: 0, cursor: 'pointer', color: colors.textSecondary, display: 'flex' }}>
                  <X size={20} />
                </button>
              </div>
            </div>
            <iframe title="Service Report PDF" src={previewUrl} style={{ flex: 1, border: 0, width: '100%', background: '#fff' }} />
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 720px) {
          .srl-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
