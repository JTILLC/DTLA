import React, { useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle, ChevronDown, Clock, ExternalLink, FileText, Search, Users, X, XCircle } from 'lucide-react';
import CustomerRecordCard from './CustomerRecordCard';
import { isPaid } from '../utils/format';
import { extractMachines } from './Troubleshoot/facets';
import { exportAccountStatement } from '../utils/exportAccountStatement';
import { ccwVisitLink } from '../utils/ccwLink';
import { FIXED_STATUS, FIXED_LABEL } from '../utils/headIssue';

  // Module scope on purpose. A component declared inside another component's
  // render body is a new function — and so a new component TYPE — on every
  // render, which unmounts its subtree and takes the caret out of any input in
  // it. That is exactly the bug that made the address field on the Records
  // page accept one character at a time.
  const PartsOrders = ({ orders, customerName, colors, onUpload, onDelete, setSearchTerm }) => {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const [expanded, setExpanded] = useState(null);

    const choose = async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = '';          // so the same file can be picked again
      if (!files.length || !onUpload) return;
      setBusy(true);
      setNote('');
      try {
        setNote(await onUpload(files));
      } catch (err) {
        setNote(err?.message || String(err));
      } finally {
        setBusy(false);
      }
    };

    // Shown even with nothing in it, because the upload control is the only way
    // to put the first one there.
    return (
      <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '16px 20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: colors.text }}>
            Parts orders{orders.length > 0 ? ` (${orders.length})` : ''}
          </div>
          <label
            style={{ marginLeft: 'auto', fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: `1px solid ${colors.border || '#d1d5db'}`, color: colors.text, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
            title={`Upload a parts list exported from the Parts Viewer. It is filed against ${customerName}.`}
          >
            {busy ? 'Reading…' : 'Upload parts list…'}
            <input type="file" accept=".json,application/json" multiple disabled={busy} onChange={choose} style={{ display: 'none' }} />
          </label>
        </div>

        {orders.length === 0 && (
          <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '6px' }}>
            Nothing ordered through the Parts Viewer yet — or the export was never
            uploaded. Orders built in the viewer from now on save themselves here.
          </div>
        )}

        {note && <div style={{ fontSize: '12px', color: colors.text, marginTop: '8px' }}>{note}</div>}

        {orders.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
            {orders.map((o) => (
              <div key={o.id} style={{ background: colors.hover, borderRadius: '8px', padding: '10px 12px', borderLeft: '4px solid #0d9488' }}>
                <div
                  onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                  style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', cursor: 'pointer' }}
                >
                  <strong style={{ fontSize: '13px', color: colors.text }}>
                    {o.orderedAt ? new Date(o.orderedAt).toLocaleDateString() : 'Undated'}
                  </strong>
                  <span style={{ fontSize: '12px', color: colors.textSecondary }}>
                    {o.itemCount} line{o.itemCount === 1 ? '' : 's'} · {o.totalQuantity} parts
                    {o.diagrams?.length ? ` · ${o.diagrams.join(', ')}` : ''}
                  </span>
                  <ChevronDown
                    size={14}
                    style={{ marginLeft: 'auto', color: colors.textSecondary, transform: expanded === o.id ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}
                  />
                </div>
                {expanded === o.id && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {(o.items || []).map((it, i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '12px', color: colors.text, padding: '4px 6px', background: colors.cardBg, borderRadius: '4px' }}>
                        {it.partCode && (
                          <span
                            onClick={() => setSearchTerm && setSearchTerm(it.partCode)}
                            title={`Search ${it.partCode}`}
                            style={{ cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600, color: '#0f766e' }}
                          >
                            {it.partCode}
                          </span>
                        )}
                        <span>{it.partName}</span>
                        <span style={{ marginLeft: 'auto', color: colors.textSecondary, whiteSpace: 'nowrap' }}>ordered {it.orderQty}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '4px' }}>
                      {o.fileName && (
                        <span style={{ fontSize: '11px', color: colors.textSecondary }}>from {o.fileName}</span>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(o)}
                          style={{ marginLeft: 'auto', fontSize: '11px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                          title="Remove this order — for one uploaded twice or filed against the wrong plant"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const CustomerDetailView = ({
    data, customerName, loading, onClear, setSearchTerm, colors,
    customerRecords = [], onSaveProfile, onLinkCustomer,
    onMoveJob, moveTargets = [], onUploadPartsOrder, onDeletePartsOrder,
  }) => {
    const [collapsedCustomerSections, setCollapsedCustomerSections] = useState({
      jobs: false,
      issues: false,
      timesheets: false,
      visits: false
    });

    const toggleCustomerSection = (section) => {
      setCollapsedCustomerSections(prev => ({
        ...prev,
        [section]: !prev[section]
      }));
    };

    if (loading) {
      return (
        <div style={{
          background: colors.cardBg,
          borderRadius: '12px',
          padding: '40px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          textAlign: 'center',
          color: colors.textSecondary
        }}>
          Loading customer data...
        </div>
      );
    }

    if (!data) return null;

    const formatDate = (date) => {
      if (!date) return 'N/A';
      const d = date?.toDate?.() || new Date(date);
      return d.toLocaleDateString();
    };

    const formatCurrency = (amount) => {
      if (!amount) return 'N/A';
      return `$${parseFloat(amount).toLocaleString()}`;
    };

    return (
      <div style={{ marginBottom: '32px' }}>
        {/* Customer Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: '600',
            color: colors.text,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Users size={28} />
            {customerName}
          </h2>
          <button
            onClick={onClear}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              background: colors.cardBg,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              color: colors.text,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <X size={16} />
            Clear Selection
          </button>
        </div>

        {/* Who this customer is — address, contacts, invoice emails. Above the
            money, because it is what somebody ringing the plant came for. */}
        <CustomerRecordCard
          customerName={customerName}
          record={data.record}
          colors={colors}
          onSave={onSaveProfile}
          onLink={onLinkCustomer}
          allRecords={customerRecords}
        />

        {/* Customer Summary Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }}>
          <div style={{
            background: colors.cardBg,
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Total Jobs</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#3b82f6' }}>{data.totalJobs}</div>
          </div>
          <div style={{
            background: colors.cardBg,
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Total Income</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{formatCurrency(data.totalIncome)}</div>
          </div>
          <div style={{
            background: colors.cardBg,
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Paid</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{formatCurrency(data.paidIncome)}</div>
          </div>
          <div style={{
            background: colors.cardBg,
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Unpaid</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>{formatCurrency(data.unpaidIncome)}</div>
          </div>
          <div style={{
            background: colors.cardBg,
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Issues</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#ef4444' }}>{data.totalIssues}</div>
          </div>
          <div style={{
            background: colors.cardBg,
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>Timesheets</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#8b5cf6' }}>{data.totalTimesheets}</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <button
            onClick={() => exportAccountStatement(customerName, data)}
            disabled={(data.totalJobs || 0) === 0 && (data.totalIssues || 0) === 0 && (data.totalTimesheets || 0) === 0}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: '#10b981',
              color: 'white',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}
            title="Generate an Excel workbook with Summary, Jobs, Issues, Timesheets, and Parts-seen tabs."
          >
            📊 Export Account Statement
          </button>
        </div>

        {(() => {
          // Aggregate every machine model + part number ever seen for this
          // customer across jobs, issues, and timesheets. Useful for
          // pre-visit briefing — "what equipment do they have?"
          const PN_RE = /\b\d{2,4}[-_/.]\d{1,4}[-_/.]\d{1,5}[-_/.]\d{1,4}\b/g;
          const machineCounts = new Map();
          const pnCounts = new Map();
          const bumpMachines = (text) => {
            extractMachines(text || '').forEach((m) =>
              machineCounts.set(m, (machineCounts.get(m) || 0) + 1)
            );
          };
          const bumpPns = (text) => {
            (String(text || '').match(PN_RE) || []).forEach((p) =>
              pnCounts.set(p, (pnCounts.get(p) || 0) + 1)
            );
          };
          const blob = (item) => JSON.stringify(item);
          (data.jobs || []).forEach((j) => { bumpMachines(blob(j)); bumpPns(blob(j)); });
          (data.issues || []).forEach((i) => { bumpMachines(blob(i)); bumpPns(blob(i)); });
          (data.timesheets || []).forEach((t) => { bumpMachines(blob(t)); bumpPns(blob(t)); });
          const machines = [...machineCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
          const pns = [...pnCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
          if (machines.length === 0 && pns.length === 0) return null;
          return (
            <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '16px 20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: colors.text, marginBottom: '8px' }}>Equipment profile</div>
              {machines.length > 0 && (
                <div style={{ marginBottom: pns.length > 0 ? '10px' : 0 }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.04em', color: colors.textSecondary, marginBottom: '4px' }}>Machine models</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {machines.map(([m, c]) => (
                      <span
                        key={m}
                        onClick={() => setSearchTerm(m)}
                        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', background: '#dbeafe', color: '#1d4ed8', borderRadius: '999px', fontSize: '12px', fontWeight: 600 }}
                        title={`Search ${m}`}
                      >
                        {m} <span style={{ fontSize: '10px', opacity: 0.7 }}>{c}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {pns.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.04em', color: colors.textSecondary, marginBottom: '4px' }}>Part numbers</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {pns.map(([p, c]) => (
                      <span
                        key={p}
                        onClick={() => setSearchTerm(p)}
                        style={{ cursor: 'pointer', padding: '2px 8px', background: '#ede9fe', color: '#5b21b6', borderRadius: '4px', fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600 }}
                        title={`Search ${p}`}
                      >
                        {p}
                        {c > 1 && <span style={{ marginLeft: '4px', opacity: 0.7 }}>×{c}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Parts orders — what has actually been ordered for this plant.
            Under the equipment profile, because "what does this machine take?"
            and "what did we already order for it?" are the same question two
            minutes apart. Built in the Parts Viewer; before this they existed
            only as JSON files on one laptop, so the answer lived nowhere the
            rest of the fleet could reach. */}
        <PartsOrders
          orders={data.partsOrders || []}
          customerName={customerName}
          colors={colors}
          onUpload={onUploadPartsOrder}
          onDelete={onDeletePartsOrder}
          setSearchTerm={setSearchTerm}
        />

        {data.totalJobs === 0 && data.totalIssues === 0 && data.totalTimesheets === 0
          && (data.partsOrders || []).length === 0 ? (
          <div style={{
            background: colors.cardBg,
            borderRadius: '12px',
            padding: '40px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            textAlign: 'center',
            color: colors.textSecondary
          }}>
            No data found for this customer
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Jobs */}
            {data.jobs.length > 0 && (
              <div style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleCustomerSection('jobs')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#3b82f6',
                    marginBottom: collapsedCustomerSections.jobs ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <FileText size={20} />
                  Jobs ({data.jobs.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedCustomerSections.jobs ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedCustomerSections.jobs && (
                <div className="customer-card-grid">
                  {data.jobs.map((job, index) => (
                    <div key={job.id || index} style={{
                      padding: '16px',
                      background: colors.hover,
                      borderRadius: '8px',
                      borderLeft: '4px solid #3b82f6'
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: colors.text }}>
                            {job.customer || job.customerName || 'Unknown Customer'}
                          </div>
                          {(job.sr || job.invoiceNumber) && (
                            <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span>SR #: {job.sr || job.invoiceNumber}</span>
                              {job.customerCorrected && (
                                <span title="Filed against this customer here, not in the Jobs Tracker"
                                      style={{ color: '#8b5cf6' }}>· moved here</span>
                              )}
                              {/* One company, more than one plant: a job filed
                                  under the bare company name can be put with
                                  the plant it was actually done at. Recorded
                                  here, never written back over the Jobs
                                  Tracker's own file. */}
                              {onMoveJob && (
                                <select
                                  value=""
                                  onChange={(e) => { if (e.target.value) onMoveJob(job.sr || job.invoiceNumber, e.target.value); }}
                                  title="File this job against a different customer"
                                  style={{
                                    fontSize: '11px', padding: '1px 4px', borderRadius: '4px',
                                    border: `1px solid ${colors.border || '#d1d5db'}`,
                                    background: 'transparent', color: colors.textSecondary, cursor: 'pointer',
                                  }}
                                >
                                  <option value="">Move to…</option>
                                  {moveTargets.map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                              )}
                            </div>
                          )}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: isPaid(job.paid) ? '#10b981' : '#f59e0b'
                        }}>
                          {isPaid(job.paid) ? <CheckCircle size={16} /> : <Clock size={16} />}
                          <span style={{ fontSize: '12px', fontWeight: '500' }}>
                            {isPaid(job.paid) ? 'Paid' : 'Unpaid'}
                          </span>
                        </div>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '8px',
                        fontSize: '13px'
                      }}>
                        {job.quote && (
                          <div>
                            <span style={{ color: colors.textSecondary }}>Quote: </span>
                            <span style={{ color: colors.text, fontWeight: '600' }}>{formatCurrency(job.quote)}</span>
                          </div>
                        )}
                        {job.actual && (
                          <div>
                            <span style={{ color: colors.textSecondary }}>Actual: </span>
                            <span style={{ color: '#10b981', fontWeight: '600' }}>{formatCurrency(job.actual)}</span>
                          </div>
                        )}
                        {job.date && (
                          <div>
                            <span style={{ color: colors.textSecondary }}>Date: </span>
                            <span style={{ color: colors.text }}>{job.date}</span>
                          </div>
                        )}
                        {job.year && (
                          <div>
                            <span style={{ color: colors.textSecondary }}>Year: </span>
                            <span style={{ color: colors.text }}>{job.year}</span>
                          </div>
                        )}
                        {job.customerInfo && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: colors.textSecondary }}>Info: </span>
                            <span style={{ color: colors.text }}>{job.customerInfo}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Issues */}
            {data.issues.length > 0 && (
              <div style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleCustomerSection('issues')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#ef4444',
                    marginBottom: collapsedCustomerSections.issues ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <AlertTriangle size={20} />
                  Issues / Downtime ({data.issues.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedCustomerSections.issues ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedCustomerSections.issues && (
                <div className="customer-card-grid">
                  {data.issues.map((issue, index) => {
                    // Straight to this head, in the app that recorded it.
                    // Everything the link needs is already on the row; without
                    // it, reading "Line 2 • 13" here and then looking at it
                    // meant opening CCW, picking the plant, finding the visit
                    // in a list and then finding the head.
                    const link = ccwVisitLink({
                      visitId: issue.visitId,
                      customerId: issue.customerId,
                      line: issue.line,
                      head: issue.headName,
                    });
                    return (
                    <div key={issue.id || index} style={{
                      padding: '16px',
                      background: colors.hover,
                      borderRadius: '8px',
                      borderLeft: '4px solid #ef4444'
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: '600', color: colors.text }}>
                            {link ? (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: colors.text, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                                title={`Open ${issue.line} head ${issue.headName} in CCW Issues`}
                              >
                                {issue.line} • {issue.headName || 'Head'}
                                <ExternalLink size={12} style={{ opacity: 0.7 }} />
                              </a>
                            ) : (
                              <>{issue.line} • {issue.headName || 'Head'}</>
                            )}
                          </div>
                        </div>
                        {/* Four states, not two. A head can be fixed, still
                            broken, running with a known fault, or carry no
                            issue at all — and "not fixed" was being shown for
                            all but the first, including for heads that were
                            fixed but recorded in the current shape. */}
                        {(() => {
                          const status = issue.fixedStatus || FIXED_STATUS.NOT_FIXED;
                          const tone = status === FIXED_STATUS.FIXED ? '#10b981'
                            : status === FIXED_STATUS.ACTIVE_WITH_ISSUES ? '#f59e0b'
                              : status === FIXED_STATUS.NA ? colors.textSecondary : '#ef4444';
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: tone, marginLeft: '12px' }}>
                              {status === FIXED_STATUS.FIXED ? <CheckCircle size={16} /> : <XCircle size={16} />}
                              <span style={{ fontSize: '12px', fontWeight: '500' }}>{FIXED_LABEL[status] || 'Not fixed'}</span>
                            </div>
                          );
                        })()}
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '8px',
                        fontSize: '13px'
                      }}>
                        <div>
                          <span style={{ color: colors.textSecondary }}>Date: </span>
                          {/* Visits store a full ISO timestamp; printing it raw
                              put "2024-02-20T04:12:00.000Z" on the card. */}
                          <span style={{ color: colors.text }}>{issue.date ? formatDate(issue.date) : 'N/A'}</span>
                        </div>
                        <div>
                          <span style={{ color: colors.textSecondary }}>Visit: </span>
                          {link ? (
                            <a href={link} target="_blank" rel="noopener noreferrer"
                               style={{ color: '#8b5cf6', textDecoration: 'none' }}
                               title="Open this visit in CCW Issues">
                              {issue.visitId}
                            </a>
                          ) : (
                            <span style={{ color: colors.text }}>{issue.visitId || 'N/A'}</span>
                          )}
                        </div>
                        {issue.error && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: colors.textSecondary }}>Error: </span>
                            <span style={{ color: '#ef4444', fontWeight: '500' }}>{issue.error}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
                )}
              </div>
            )}

            {/* Visit log — JTI's own service visits to this plant. Kept next
                to the jobs and issues they produced, so one screen answers
                "when were we last there, and what came of it?". */}
            {(data.visits || []).length > 0 && (
              <div style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleCustomerSection('visits')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#8b5cf6',
                    marginBottom: collapsedCustomerSections.visits ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <CalendarDays size={20} />
                  Visit log ({data.visits.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedCustomerSections.visits ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedCustomerSections.visits && (
                <div className="customer-card-grid">
                  {data.visits.map((visit, index) => {
                    const lineCount = (visit.lines || []).length;
                    const headsDown = (visit.lines || []).reduce(
                      (n, l) => n + (l.heads || []).filter((h) => h.status === 'offline').length, 0);
                    const reportNo = visit.globalData?.serviceReportNumber || visit.serviceReportNumber || '';
                    // The whole visit, opened where it was written. The customer
                    // id comes off the record this page was built from, so CCW
                    // goes straight to it.
                    const visitLink = ccwVisitLink({ visitId: visit.id, customerId: data.record?.id });
                    return (
                      <div key={visit.id || index} style={{
                        padding: '14px 16px',
                        background: colors.hover,
                        borderRadius: '8px',
                        borderLeft: '4px solid #8b5cf6'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <div style={{ fontSize: '14px', fontWeight: '600', color: colors.text }}>
                            {visitLink ? (
                              <a
                                href={visitLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: colors.text, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                                title="Open this visit in CCW Issues"
                              >
                                {visit.visitName || visit.name || 'Service visit'}
                                <ExternalLink size={12} style={{ opacity: 0.7 }} />
                              </a>
                            ) : (
                              <>{visit.visitName || visit.name || 'Service visit'}</>
                            )}
                          </div>
                          <div style={{ fontSize: '13px', color: colors.textSecondary }}>
                            {formatDate(visit.date)}
                          </div>
                        </div>
                        <div style={{ fontSize: '13px', color: colors.textSecondary, marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          {lineCount > 0 && <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>}
                          {/* Only worth saying when it is not zero — "0 heads
                              down" is noise on every clean visit. */}
                          {headsDown > 0 && <span style={{ color: '#ef4444' }}>{headsDown} head{headsDown === 1 ? '' : 's'} down</span>}
                          {reportNo && <span>Service Report: <strong style={{ color: colors.text }}>{reportNo}</strong></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            )}

            {/* Timesheets */}
            {data.timesheets.length > 0 && (
              <div style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleCustomerSection('timesheets')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#10b981',
                    marginBottom: collapsedCustomerSections.timesheets ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <Clock size={20} />
                  Timesheets ({data.timesheets.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedCustomerSections.timesheets ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedCustomerSections.timesheets && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {data.timesheets.map((timesheet, index) => (
                    <div key={timesheet.id || index} style={{
                      padding: '16px',
                      background: colors.hover,
                      borderRadius: '8px',
                      borderLeft: '4px solid #10b981'
                    }}>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: colors.text }}>
                          {timesheet.customer || timesheet.visitName || 'Unknown'}
                        </div>
                        {timesheet.visitName && (
                          <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                            Visit: {timesheet.visitName}
                          </div>
                        )}
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '8px',
                        fontSize: '13px'
                      }}>
                        {(() => {
                          // Prefer the earliest *service-report* date over the
                          // upload timestamp — that's the date the work was
                          // actually performed and what the user wants to see.
                          //
                          // THE DAYS ON THE SHEET DECIDE, when it has any. The
                          // note keys were thrown into the same pot, and a sheet
                          // that had inherited a previous visit's notes reported
                          // a range spanning both: "9/5/2024 → 5/14/2026" on a
                          // four-day visit. The timesheet app no longer copies
                          // notes forward, but documents written before that
                          // still carry them, and a visit's dates are the days
                          // worked either way. Notes are the fallback for a
                          // sheet with no days on it at all.
                          const entryDates = (timesheet.entries || [])
                            .map((e) => e?.date)
                            .filter(Boolean);
                          const reportKeys = Object.keys(timesheet.serviceReportData || {})
                            .filter((k) => /^\d{4}-\d{2}-\d{2}/.test(k));
                          const candidates = entryDates.length ? entryDates : reportKeys;
                          const sorted = candidates.sort();
                          const earliest = sorted[0];
                          const latest = sorted[sorted.length - 1];
                          const sameDay = earliest && earliest === latest;
                          const display = earliest
                            ? (sameDay ? formatDate(earliest) : `${formatDate(earliest)} → ${formatDate(latest)}`)
                            : formatDate(timesheet.timestamp || timesheet.date);
                          return (
                            <div>
                              <span style={{ color: colors.textSecondary }}>Date: </span>
                              <span style={{ fontWeight: '500', color: colors.text }}>{display}</span>
                            </div>
                          );
                        })()}
                        {timesheet.invoiceInfo?.invoiceNumber && (
                          <div>
                            <span style={{ color: colors.textSecondary }}>Invoice #: </span>
                            <span style={{ fontWeight: '500', color: colors.text }}>
                              {timesheet.invoiceInfo.invoiceNumber}
                            </span>
                          </div>
                        )}
                        {timesheet.invoiceInfo?.amount && (
                          <div>
                            <span style={{ color: colors.textSecondary }}>Amount: </span>
                            <span style={{ fontWeight: '500', color: colors.text }}>
                              {formatCurrency(timesheet.invoiceInfo.amount)}
                            </span>
                          </div>
                        )}
                        {(() => {
                          // The same rule as the date range above, for the same
                          // reason: a note keyed to a day this visit does not
                          // have belongs to a different visit that this document
                          // inherited. Sorted, too — the keys come back in
                          // whatever order Firestore stored them, so January and
                          // May were interleaved down the page.
                          const days = new Set((timesheet.entries || []).map((e) => e?.date).filter(Boolean));
                          const notes = Object.entries(timesheet.serviceReportData || {})
                            .filter(([date]) => !days.size || days.has(date))
                            .sort(([a], [b]) => String(a).localeCompare(String(b)));
                          if (!notes.length) return null;
                          return (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: colors.textSecondary, fontWeight: '500' }}>Service Report: </span>
                            <div style={{ marginTop: '8px' }}>
                              {notes.map(([date, description]) => (
                                <div key={date} style={{
                                  marginBottom: '8px',
                                  padding: '8px',
                                  background: colors.hover,
                                  borderRadius: '4px'
                                }}>
                                  <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>
                                    {date}
                                  </div>
                                  <div style={{ color: colors.text, lineHeight: '1.4' }}>
                                    {description}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

export default CustomerDetailView;
