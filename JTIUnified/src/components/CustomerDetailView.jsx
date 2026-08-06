import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, Clock, FileText, Search, Users, X, XCircle } from 'lucide-react';
import { isPaid } from '../utils/format';
import { extractMachines } from './Troubleshoot/facets';
import { exportAccountStatement } from '../utils/exportAccountStatement';

  const CustomerDetailView = ({ data, customerName, loading, onClear, setSearchTerm, colors }) => {
    const [collapsedCustomerSections, setCollapsedCustomerSections] = useState({
      jobs: false,
      issues: false,
      timesheets: false
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

        {data.totalJobs === 0 && data.totalIssues === 0 && data.totalTimesheets === 0 ? (
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                            <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                              SR #: {job.sr || job.invoiceNumber}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {data.issues.map((issue, index) => (
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
                            {issue.line} • {issue.headName || 'Head'}
                          </div>
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? '#10b981' : '#ef4444',
                          marginLeft: '12px'
                        }}>
                          {issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                          <span style={{ fontSize: '12px', fontWeight: '500' }}>
                            {issue.fixed === true || issue.fixed === 'Yes' || issue.fixed === 'fixed' || issue.fixed === 'Fixed' ? 'Fixed' : 'Not Fixed'}
                          </span>
                        </div>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '8px',
                        fontSize: '13px'
                      }}>
                        <div>
                          <span style={{ color: colors.textSecondary }}>Date: </span>
                          <span style={{ color: colors.text }}>{issue.date || 'N/A'}</span>
                        </div>
                        <div>
                          <span style={{ color: colors.textSecondary }}>Visit: </span>
                          <span style={{ color: colors.text }}>{issue.visitId || 'N/A'}</span>
                        </div>
                        {issue.error && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: colors.textSecondary }}>Error: </span>
                            <span style={{ color: '#ef4444', fontWeight: '500' }}>{issue.error}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
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
                          const entryDates = (timesheet.entries || [])
                            .map((e) => e?.date)
                            .filter(Boolean);
                          const reportKeys = Object.keys(timesheet.serviceReportData || {})
                            .filter((k) => /^\d{4}-\d{2}-\d{2}/.test(k));
                          const candidates = [...entryDates, ...reportKeys];
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
                        {timesheet.serviceReportData && Object.keys(timesheet.serviceReportData).length > 0 && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: colors.textSecondary, fontWeight: '500' }}>Service Report: </span>
                            <div style={{ marginTop: '8px' }}>
                              {Object.entries(timesheet.serviceReportData).map(([date, description]) => (
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
                        )}
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
