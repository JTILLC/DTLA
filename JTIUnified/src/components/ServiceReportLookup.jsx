import { useState, useMemo } from 'react';
import { Search, FileText, Receipt, ClipboardList, ExternalLink, AlertTriangle, RefreshCw, Eye, X } from 'lucide-react';

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

  const sectionCard = { background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14, marginBottom: 12 };
  const label = { fontSize: 12, color: colors.textSecondary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 };

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.text, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <FileText size={24} /> Service Report Lookup
        </h2>
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading}
            style={{ padding: '8px 14px', background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 6, cursor: loading ? 'default' : 'pointer', color: colors.text, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} style={loading ? { animation: 'jti-spin 0.8s linear infinite' } : undefined} /> Refresh
          </button>
        )}
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
        <div style={{ padding: 40, textAlign: 'center', color: colors.textSecondary }}>Loading service reports…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 340px) 1fr', gap: 16, alignItems: 'start' }} className="srl-grid">
          {/* LEFT: list */}
          <div style={{ background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden', maxHeight: '70vh', overflowY: 'auto' }}>
            {grouped.length === 0 ? (
              <div style={{ padding: 24, color: colors.textSecondary, fontSize: 14 }}>
                No report numbers{onlyUnmatched ? ' need attention' : ' found'}. {reports.length === 0 && 'Tag visits and invoices with a service report number to populate this.'}
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
                Select a service report number to see its invoice, timesheet, and weigher visit.
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
                    <div style={{ color: '#f59e0b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={14} /> No invoice/timesheet found for this number.
                    </div>
                  ) : (
                    selected.timesheets.map((t) => (
                      <div key={t.id} style={{ paddingBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 14, color: colors.text }}>
                            <div style={{ fontWeight: 600 }}>{t.customer}</div>
                            <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                              Invoice #{t.invoiceInfo?.invoiceNumber || '—'} · {t.entryCount} day{t.entryCount === 1 ? '' : 's'}
                              {t.customerInfo?.purpose ? ` · ${t.customerInfo.purpose}` : ''}
                            </div>
                          </div>
                          {linkBtn(TIMESHEET_URL, 'Timesheet app')}
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
                </div>

                {/* Weigher visit */}
                <div style={sectionCard}>
                  <div style={label}><ClipboardList size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> Weigher Visit (CCW Issues)</div>
                  {selected.visits.length === 0 ? (
                    <div style={{ color: '#f59e0b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={14} /> No weigher visit tagged with this number.
                    </div>
                  ) : (
                    selected.visits.map((v) => (
                      <div key={v.visitId} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: selected.visits.length > 1 ? `1px solid ${colors.border}` : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 14, color: colors.text }}>
                            <div style={{ fontWeight: 600 }}>{v.customer}{v.name ? ` — ${v.name}` : ''}</div>
                            <div style={{ color: colors.textSecondary, fontSize: 13 }}>
                              {fmtDate(v.date)} · {v.lineCount} line{v.lineCount === 1 ? '' : 's'}
                              {v.lines.length ? ` (${v.lines.map((l) => l.title).join(', ')})` : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {v.serviceReportUrl && (
                              <button onClick={() => setPreviewUrl(v.serviceReportUrl)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 500, color: '#7c3aed', cursor: 'pointer', padding: '5px 10px', border: `1px solid ${colors.border}`, borderRadius: 6, background: colors.cardBg }}>
                                <Eye size={13} /> Preview PDF
                              </button>
                            )}
                            {v.serviceReportUrl && linkBtn(v.serviceReportUrl, 'Open PDF')}
                            {linkBtn(`${CCW_URL}/?customerId=${encodeURIComponent(v.customerId)}&visitId=${encodeURIComponent(v.visitId)}`, 'Open visit')}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
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
