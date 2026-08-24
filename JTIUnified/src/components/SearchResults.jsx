import React, { useState, useMemo, useEffect } from 'react';
import { AlertTriangle, Building2, CheckCircle, ChevronDown, Clock, ExternalLink, FileText, Package, Paperclip, Search, Settings, XCircle } from 'lucide-react';
import { isPaid } from '../utils/format';
import HighlightText from './HighlightText';
import { ccwVisitLink } from '../utils/ccwLink';
import { FIXED_STATUS } from '../utils/headIssue';

  const SearchResults = ({ results, loading, setSearchTerm, colors }) => {
    const [collapsedSections, setCollapsedSections] = useState({
      jobs: false,
      issues: false,
      timesheets: false,
      headHistory: false,
      parts: false,
      boards: false,
      diagrams: false,
      partsOrders: false,
      packets: false,
      customers: false,
    });
    const [expandedId, setExpandedId] = useState(null);

    // Date-range filter state (persisted per session)
    const [datePreset, setDatePreset] = useState(() => {
      return localStorage.getItem('jti-search-date-preset') || 'all';
    });
    const [customFrom, setCustomFrom] = useState(() => localStorage.getItem('jti-search-from') || '');
    const [customTo, setCustomTo] = useState(() => localStorage.getItem('jti-search-to') || '');

    useEffect(() => { localStorage.setItem('jti-search-date-preset', datePreset); }, [datePreset]);
    useEffect(() => { localStorage.setItem('jti-search-from', customFrom); }, [customFrom]);
    useEffect(() => { localStorage.setItem('jti-search-to', customTo); }, [customTo]);

    const toggleSection = (section) => {
      setCollapsedSections(prev => ({
        ...prev,
        [section]: !prev[section]
      }));
    };

    const toggleExpanded = (id) => setExpandedId(prev => (prev === id ? null : id));

    // Resolve a Date for any result item, checking the common date-ish fields
    const itemDate = (item) => {
      if (!item) return null;
      const raw =
        item.date?.toDate?.() ??
        item.timestamp?.toDate?.() ??
        item.visitDate?.toDate?.() ??
        item.date ??
        item.timestamp ??
        item.visitDate ??
        null;
      if (!raw) return null;
      const d = raw instanceof Date ? raw : new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    // Compute active date range from preset + custom inputs
    const dateFilter = useMemo(() => {
      if (datePreset === 'all') return null;
      const now = new Date();
      if (datePreset === 'custom') {
        return {
          from: customFrom ? new Date(`${customFrom}T00:00:00`) : null,
          to: customTo ? new Date(`${customTo}T23:59:59`) : null,
        };
      }
      const daysMap = { '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[datePreset];
      if (!days) return null;
      const from = new Date(now);
      from.setDate(from.getDate() - days);
      return { from, to: now };
    }, [datePreset, customFrom, customTo]);

    const inRange = (item) => {
      if (!dateFilter) return true;
      const d = itemDate(item);
      if (!d) return false; // items missing a parseable date are excluded when filtering
      if (dateFilter.from && d < dateFilter.from) return false;
      if (dateFilter.to && d > dateFilter.to) return false;
      return true;
    };

    // Filtered result slices
    const filteredJobs = useMemo(() => (results?.jobs || []).filter(inRange), [results?.jobs, dateFilter]);
    const filteredIssues = useMemo(() => (results?.issues || []).filter(inRange), [results?.issues, dateFilter]);
    const filteredTimesheets = useMemo(() => (results?.timesheets || []).filter(inRange), [results?.timesheets, dateFilter]);
    const filteredHistory = useMemo(() => (results?.headHistory || []).filter(inRange), [results?.headHistory, dateFilter]);
    // Inventory parts/boards and Parts Manual diagrams don't have meaningful
    // dates for the date-range filter, so they pass through unfiltered.
    const filteredParts = results?.parts || [];
    const filteredBoards = results?.boards || [];
    const filteredDiagrams = results?.diagrams || [];
    // A parts order DOES have a date — the day it was built — so it honours the
    // range like a job or a visit does.
    const filteredOrders = useMemo(
      () => (results?.partsOrders || []).filter((o) => inRange({ date: o.orderedAt })),
      [results?.partsOrders, dateFilter]);
    // Packets and customer records have no single date to filter on either — a
    // packet spans the whole job and a customer record is not an event.
    const filteredPackets = results?.packets || [];
    const filteredCustomers = results?.customers || [];
    const filteredTotal =
      filteredJobs.length + filteredIssues.length + filteredTimesheets.length +
      filteredHistory.length + filteredParts.length + filteredBoards.length +
      filteredDiagrams.length + filteredOrders.length + filteredPackets.length +
      filteredCustomers.length;

    // camelCase → "Title Case"; snake_case → "Title Case"
    const humanize = (key) => {
      if (!key) return '';
      return String(key)
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
    };

    // Looks like a date string (YYYY-MM-DD or ISO)
    const looksLikeDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);

    // Is a field worth hiding? null / undefined / '' / NaN / empty arrays / empty objects
    const isEmpty = (v) => {
      if (v === null || v === undefined || v === '') return true;
      if (typeof v === 'number' && Number.isNaN(v)) return true;
      if (Array.isArray(v) && v.length === 0) return true;
      if (typeof v === 'object' && !v?.toDate && !Array.isArray(v)) {
        return Object.keys(v).length === 0;
      }
      return false;
    };

    // Primitive formatter (strings, numbers, booleans, dates)
    const formatPrimitive = (v) => {
      if (v === null || v === undefined || v === '') return '—';
      if (v?.toDate) {
        try { return v.toDate().toLocaleString(); } catch { /* fallthrough */ }
      }
      if (v instanceof Date) return v.toLocaleString();
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'number') return v.toLocaleString();
      if (looksLikeDate(v)) {
        const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
        if (!isNaN(d.getTime())) {
          return v.length === 10
            ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
            : d.toLocaleString();
        }
      }
      return String(v);
    };

    // Recursive value renderer — returns React nodes
    const renderValue = (v, depth = 0, parentKey = '') => {
      if (isEmpty(v)) return <span style={{ color: colors.textSecondary }}>—</span>;

      // Firestore Timestamp / Date / primitives
      if (v?.toDate || v instanceof Date || typeof v !== 'object') {
        const isLongString = typeof v === 'string' && (v.length > 80 || v.includes('\n'));
        if (isLongString) {
          return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</div>;
        }
        return <span>{formatPrimitive(v)}</span>;
      }

      // Is this date string / Date within the active filter window?
      const withinFilter = (dateLike) => {
        if (!dateFilter) return true;
        if (!dateLike) return true; // no date → keep (don't hide things we can't place)
        const d = dateLike instanceof Date
          ? dateLike
          : new Date(typeof dateLike === 'string' && dateLike.length === 10 ? `${dateLike}T00:00:00` : dateLike);
        if (isNaN(d.getTime())) return true;
        if (dateFilter.from && d < dateFilter.from) return false;
        if (dateFilter.to && d > dateFilter.to) return false;
        return true;
      };

      // Special case: serviceReportData is an object of { "YYYY-MM-DD": "long text" }
      if (parentKey === 'serviceReportData' && !Array.isArray(v)) {
        const allEntries = Object.entries(v).filter(([, text]) => text && String(text).trim());
        const entries = allEntries.filter(([date]) => withinFilter(date));
        const sorted = [...entries].sort(([a], [b]) => b.localeCompare(a));
        const hiddenCount = allEntries.length - entries.length;
        if (sorted.length === 0 && hiddenCount === 0) return <span style={{ color: colors.textSecondary }}>—</span>;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {sorted.map(([date, text]) => (
              <div
                key={date}
                style={{
                  padding: '8px 10px',
                  background: colors.hover,
                  borderLeft: '3px solid #3b82f6',
                  borderRadius: '4px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#1d4ed8', marginBottom: '4px' }}>
                  {formatPrimitive(date)}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: colors.text }}>
                  {text}
                </div>
              </div>
            ))}
            {hiddenCount > 0 && (
              <div style={{ fontSize: '11px', color: colors.textSecondary, fontStyle: 'italic', padding: '4px 10px' }}>
                {hiddenCount} older {hiddenCount === 1 ? 'entry' : 'entries'} hidden by the date filter.
              </div>
            )}
          </div>
        );
      }

      // Arrays
      if (Array.isArray(v)) {
        // array of primitives
        if (v.every(x => x === null || typeof x !== 'object')) {
          return <span>{v.map(formatPrimitive).join(', ')}</span>;
        }
        // array of objects — filter by per-item date if present, then render each as a card
        const allItems = v;
        const items = allItems.filter(item => {
          if (!dateFilter || !item || typeof item !== 'object') return true;
          const itemD = itemDate(item);
          return withinFilter(itemD);
        });
        const hiddenCount = allItems.length - items.length;
        if (items.length === 0 && hiddenCount === 0) return <span style={{ color: colors.textSecondary }}>—</span>;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {items.map((item, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 10px',
                  background: colors.hover,
                  border: '1px solid #e5e7eb',
                  borderRadius: '4px',
                }}
              >
                <div style={{ fontSize: '10px', textTransform: 'uppercase', color: colors.textSecondary, fontWeight: 600, marginBottom: '4px', letterSpacing: '0.04em' }}>
                  {humanize(parentKey.replace(/s$/, '') || 'Item')} {i + 1}
                </div>
                {renderObjectAsGrid(item, depth + 1)}
              </div>
            ))}
            {hiddenCount > 0 && (
              <div style={{ fontSize: '11px', color: colors.textSecondary, fontStyle: 'italic', padding: '4px 10px' }}>
                {hiddenCount} {hiddenCount === 1 ? 'item' : 'items'} hidden by the date filter.
              </div>
            )}
          </div>
        );
      }

      // Plain object
      return renderObjectAsGrid(v, depth + 1);
    };

    // Render object entries as a two-column grid (label | value)
    const renderObjectAsGrid = (obj, depth = 0) => {
      const entries = Object.entries(obj).filter(([, v]) => !isEmpty(v));
      if (entries.length === 0) {
        return <span style={{ color: colors.textSecondary }}>—</span>;
      }
      return (
        <div style={{
          display: 'grid',
          gridTemplateColumns: depth === 0 ? 'minmax(140px, 200px) 1fr' : 'minmax(100px, 160px) 1fr',
          columnGap: '12px',
          rowGap: '6px',
          fontSize: '12px',
          color: colors.text,
        }}>
          {entries.map(([k, v]) => (
            <React.Fragment key={k}>
              <div style={{ color: colors.textSecondary, fontWeight: 500 }}>{humanize(k)}</div>
              <div style={{ wordBreak: 'break-word' }}>{renderValue(v, depth, k)}</div>
            </React.Fragment>
          ))}
        </div>
      );
    };

    // Public entry point — top-level details for one record
    const renderDetails = (item, { skip = [] } = {}) => {
      const skipSet = new Set(['matchedFields', '_id', 'path', 'id', 'visitId', 'customerId', ...skip]);
      const entries = Object.entries(item).filter(([k, v]) => !skipSet.has(k) && !isEmpty(v));
      if (entries.length === 0) {
        return <div style={{ color: colors.textSecondary, fontSize: '12px' }}>No additional fields.</div>;
      }
      return (
        <div style={{
          fontSize: '12px',
          color: colors.text,
          background: colors.cardBg,
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          padding: '12px 14px',
          display: 'grid',
          gridTemplateColumns: 'minmax(140px, 200px) 1fr',
          columnGap: '12px',
          rowGap: '8px',
        }}>
          {entries.map(([k, v]) => (
            <React.Fragment key={k}>
              <div style={{ color: colors.textSecondary, fontWeight: 600, fontSize: '12px' }}>{humanize(k)}</div>
              <div style={{ wordBreak: 'break-word' }}>{renderValue(v, 0, k)}</div>
            </React.Fragment>
          ))}
        </div>
      );
    };

    const datePresets = [
      { key: 'all', label: 'All time' },
      { key: '30d', label: 'Last 30 days' },
      { key: '90d', label: 'Last 90 days' },
      { key: '1y', label: 'Last year' },
      { key: 'custom', label: 'Custom…' },
    ];

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
          Searching...
        </div>
      );
    }

    if (!results) return null;

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
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '8px',
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: colors.text,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Search size={24} />
            Search Results for "{results.searchTerm}"
          </h2>
          <span style={{ fontSize: '14px', color: colors.textSecondary }}>
            {filteredTotal} of {results.totalResults} result{results.totalResults !== 1 ? 's' : ''}
            {datePreset !== 'all' ? ' (filtered)' : ''}
          </span>
        </div>

        {/* Date-range filter bar */}
        <div style={{
          background: colors.cardBg,
          borderRadius: '10px',
          padding: '10px 12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          border: '1px solid #e5e7eb',
          marginBottom: '16px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: colors.text, marginRight: '4px' }}>
            Date:
          </span>
          {datePresets.map(p => (
            <button
              key={p.key}
              onClick={() => setDatePreset(p.key)}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 500,
                borderRadius: '999px',
                border: '1px solid',
                borderColor: datePreset === p.key ? '#3b82f6' : '#d1d5db',
                background: datePreset === p.key ? '#dbeafe' : colors.cardBg,
                color: datePreset === p.key ? '#1d4ed8' : '#374151',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {p.label}
            </button>
          ))}
          {datePreset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginLeft: '4px' }}>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                max={customTo || undefined}
                style={{
                  padding: '3px 8px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  color: colors.text,
                }}
                aria-label="From date"
              />
              <span style={{ color: colors.textSecondary, fontSize: '12px' }}>→</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                min={customFrom || undefined}
                style={{
                  padding: '3px 8px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  color: colors.text,
                }}
                aria-label="To date"
              />
              {(customFrom || customTo) && (
                <button
                  onClick={() => { setCustomFrom(''); setCustomTo(''); }}
                  style={{
                    padding: '3px 8px',
                    fontSize: '11px',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'transparent',
                    color: colors.textSecondary,
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
          {datePreset !== 'all' && datePreset !== 'custom' && (
            <button
              onClick={() => setDatePreset('all')}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              Clear filter
            </button>
          )}
        </div>

        {results.totalResults === 0 ? (
          <div style={{
            background: colors.cardBg,
            borderRadius: '12px',
            padding: '40px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            textAlign: 'center',
            color: colors.textSecondary
          }}>
            No results found for "{results.searchTerm}"
          </div>
        ) : filteredTotal === 0 ? (
          <div style={{
            background: colors.cardBg,
            borderRadius: '12px',
            padding: '32px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            textAlign: 'center',
            color: colors.textSecondary
          }}>
            No results in this date range.{' '}
            <button
              onClick={() => setDatePreset('all')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#3b82f6',
                cursor: 'pointer',
                fontWeight: 600,
                padding: 0,
              }}
            >
              Clear filter
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Jobs Results */}
            {filteredJobs.length > 0 && (
              <div style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleSection('jobs')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#3b82f6',
                    marginBottom: collapsedSections.jobs ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <FileText size={20} />
                  {(() => {
                    // Reserved numbers are counted apart. They have no job
                    // record, so they have no invoice either — folding them
                    // into "unpaid" reports money owed on work nobody has
                    // billed for yet.
                    const billable = filteredJobs.filter(j => !j.reservedOnly);
                    const held = filteredJobs.length - billable.length;
                    const paid = billable.filter(j => isPaid(j.paid)).length;
                    const unpaid = billable.length - paid;
                    const parts = [
                      billable.length > 0 ? `${paid} paid, ${unpaid} unpaid` : '',
                      held > 0 ? `${held} reserved` : '',
                    ].filter(Boolean).join(' · ');
                    return `Jobs (${filteredJobs.length}${parts ? ` — ${parts}` : ''})`;
                  })()}
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedSections.jobs ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedSections.jobs && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {filteredJobs.map((job, index) => {
                    const rowId = `jobs:${job.id || index}`;
                    const isExpanded = expandedId === rowId;
                    const d = itemDate(job);
                    return (
                    <div
                      key={job.id || index}
                      onClick={() => toggleExpanded(rowId)}
                      style={{
                        padding: '16px',
                        background: isExpanded ? colors.border : colors.hover,
                        borderRadius: '8px',
                        borderLeft: '4px solid #3b82f6',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => !isExpanded && (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={(e) => !isExpanded && (e.currentTarget.style.background = colors.hover)}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px',
                        gap: '8px',
                      }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: colors.text }}>
                            {job.customer || job.customerName || 'Unknown Customer'}
                          </div>
                          {(job.sr || job.invoiceNumber || job.serviceReportNumber || job.reportNumber) && (
                            <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                              SR #: {job.sr || job.invoiceNumber || job.serviceReportNumber || job.reportNumber}
                            </div>
                          )}
                          {d && (
                            <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                              {d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </div>
                          )}
                        </div>
                        {/* A reserved number has no job record yet, so paid /
                            unpaid is not a question it can answer — showing
                            "Unpaid" would invent an invoice that does not
                            exist. It says what it actually is instead. */}
                        {job.reservedOnly ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#8b5cf6' }}>
                            <Clock size={16} />
                            <span style={{ fontSize: '12px', fontWeight: '500' }}>Reserved</span>
                          </div>
                        ) : (
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
                        )}
                      </div>

                      {job.reservedOnly && (
                        <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '8px' }}>
                          This number is reserved, but it has no record in the Jobs Tracker yet —
                          that is the next step on its packet page.
                        </div>
                      )}

                      {/* Matched Fields with Highlighting */}
                      {job.matchedFields && job.matchedFields.length > 0 && (
                        <div style={{
                          background: '#fefce8',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          marginBottom: '8px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: '600', color: '#854d0e', marginBottom: '4px' }}>
                            Matches found:
                          </div>
                          {job.matchedFields.slice(0, 5).map((match, i) => (
                            <div key={i} style={{ color: '#713f12', marginBottom: '2px' }}>
                              <span style={{ color: '#a16207' }}>{match.field}: </span>
                              <HighlightText text={match.value} searchTerm={results.searchTerm} />
                            </div>
                          ))}
                          {job.matchedFields.length > 5 && (
                            <div style={{ color: '#a16207', fontStyle: 'italic' }}>
                              +{job.matchedFields.length - 5} more matches
                            </div>
                          )}
                        </div>
                      )}

                      {isExpanded ? (
                        <div style={{ marginTop: '10px' }} onClick={e => e.stopPropagation()}>
                          {renderDetails(job)}
                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => {
                                setSelectedCustomer(job.customer || job.customerName);
                                setSearchResults(null);
                                setSearchTerm('');
                              }}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 500,
                                borderRadius: '6px',
                                border: '1px solid #3b82f6',
                                background: '#3b82f6',
                                color: 'white',
                                cursor: 'pointer',
                              }}
                            >
                              Go to customer
                            </button>
                            <button
                              onClick={() => setExpandedId(null)}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 500,
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                background: colors.cardBg,
                                color: colors.text,
                                cursor: 'pointer',
                              }}
                            >
                              Collapse
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '11px', color: colors.textSecondary, marginTop: '8px' }}>
                          Click to view details for this {d ? d.toLocaleDateString() : 'record'}
                        </div>
                      )}
                    </div>
                  );})}
                </div>
                )}
              </div>
            )}

            {/* Issues Results */}
            {filteredIssues.length > 0 && (
              <div style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleSection('issues')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#ef4444',
                    marginBottom: collapsedSections.issues ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <AlertTriangle size={20} />
                  {(() => {
                    const fixed = filteredIssues.filter(i => i.fixed === true || /^(yes|true|fixed)$/i.test(String(i.fixed||'').trim())).length;
                    const open = filteredIssues.length - fixed;
                    return `Issues / Downtime (${filteredIssues.length}${filteredIssues.length > 0 ? ` — ${open} open, ${fixed} fixed` : ''})`;
                  })()}
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedSections.issues ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedSections.issues && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {filteredIssues.map((issue, index) => {
                    const rowId = `issues:${issue.id || index}`;
                    const isExpanded = expandedId === rowId;
                    const d = itemDate(issue);
                    // From the issues list, like the customer page — the old
                    // top-level `fixed` field is legacy and empty on anything
                    // recorded since CCW moved to a list of issues per head.
                    const isFixed = issue.fixedStatus === FIXED_STATUS.FIXED;
                    return (
                    <div
                      key={issue.id || index}
                      onClick={() => toggleExpanded(rowId)}
                      style={{
                        padding: '16px',
                        background: isExpanded ? colors.border : colors.hover,
                        borderRadius: '8px',
                        borderLeft: '4px solid #ef4444',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => !isExpanded && (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={(e) => !isExpanded && (e.currentTarget.style.background = colors.hover)}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px',
                        gap: '8px',
                      }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: colors.text }}>
                            {issue.customer || 'Unknown Customer'}
                          </div>
                          <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                            {issue.line} • {issue.headName || 'Head'}
                          </div>
                          {d && (
                            <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                              {d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </div>
                          )}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: isFixed ? '#10b981' : '#ef4444',
                          marginLeft: '12px'
                        }}>
                          {isFixed ? <CheckCircle size={16} /> : <XCircle size={16} />}
                          <span style={{ fontSize: '12px', fontWeight: '500' }}>
                            {isFixed ? 'Fixed' : 'Not Fixed'}
                          </span>
                        </div>
                      </div>

                      {/* Matched Fields with Highlighting */}
                      {issue.matchedFields && issue.matchedFields.length > 0 && (
                        <div style={{
                          background: '#fefce8',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          marginBottom: '8px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: '600', color: '#854d0e', marginBottom: '4px' }}>
                            Matches found:
                          </div>
                          {issue.matchedFields.slice(0, 5).map((match, i) => (
                            <div key={i} style={{ color: '#713f12', marginBottom: '2px' }}>
                              <span style={{ color: '#a16207' }}>{match.field}: </span>
                              <HighlightText text={match.value} searchTerm={results.searchTerm} />
                            </div>
                          ))}
                          {issue.matchedFields.length > 5 && (
                            <div style={{ color: '#a16207', fontStyle: 'italic' }}>
                              +{issue.matchedFields.length - 5} more matches
                            </div>
                          )}
                        </div>
                      )}

                      {isExpanded ? (
                        <div style={{ marginTop: '10px' }} onClick={e => e.stopPropagation()}>
                          {renderDetails(issue)}
                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            {issue.visitId && (
                              <button
                                onClick={() => {
                                  // Same builder the customer page uses, so the
                                  // two cannot drift — and it carries the
                                  // customer id, which this one was leaving out
                                  // and making CCW search every plant for.
                                  window.open(ccwVisitLink({
                                    visitId: issue.visitId,
                                    customerId: issue.customerId,
                                    line: issue.line,
                                    head: issue.headName,
                                  }), '_blank');
                                }}
                                style={{
                                  padding: '6px 12px',
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  borderRadius: '6px',
                                  border: '1px solid #ef4444',
                                  background: '#ef4444',
                                  color: 'white',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <ExternalLink size={12} /> Open in Weigher Issues
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedCustomer(issue.customer);
                                setSearchResults(null);
                                setSearchTerm('');
                              }}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 500,
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                background: colors.cardBg,
                                color: colors.text,
                                cursor: 'pointer',
                              }}
                            >
                              Go to customer
                            </button>
                            <button
                              onClick={() => setExpandedId(null)}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 500,
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                background: colors.cardBg,
                                color: colors.text,
                                cursor: 'pointer',
                              }}
                            >
                              Collapse
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '11px', color: colors.textSecondary, marginTop: '8px' }}>
                          Click to view details for this {d ? d.toLocaleDateString() : 'record'}
                        </div>
                      )}
                    </div>
                  );})}
                </div>
                )}
              </div>
            )}

            {/* Timesheets Results */}
            {filteredTimesheets.length > 0 && (
              <div style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleSection('timesheets')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#10b981',
                    marginBottom: collapsedSections.timesheets ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <Clock size={20} />
                  Timesheets ({filteredTimesheets.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedSections.timesheets ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedSections.timesheets && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {filteredTimesheets.map((timesheet, index) => {
                    const rowId = `timesheets:${timesheet.id || index}`;
                    const isExpanded = expandedId === rowId;
                    const d = itemDate(timesheet);
                    return (
                    <div
                      key={timesheet.id || index}
                      onClick={() => toggleExpanded(rowId)}
                      style={{
                        padding: '16px',
                        background: isExpanded ? colors.border : colors.hover,
                        borderRadius: '8px',
                        borderLeft: '4px solid #10b981',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => !isExpanded && (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={(e) => !isExpanded && (e.currentTarget.style.background = colors.hover)}
                    >
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: colors.text }}>
                          {timesheet.customer || timesheet.visitName || 'Unknown'}
                        </div>
                        {timesheet.visitName && (
                          <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                            Visit: {timesheet.visitName}
                          </div>
                        )}
                        {d && (
                          <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                            {d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </div>
                        )}
                      </div>

                      {/* Matched Fields with Highlighting */}
                      {timesheet.matchedFields && timesheet.matchedFields.length > 0 && (
                        <div style={{
                          background: '#fefce8',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          marginBottom: '8px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: '600', color: '#854d0e', marginBottom: '4px' }}>
                            Matches found:
                          </div>
                          {timesheet.matchedFields.slice(0, 5).map((match, i) => (
                            <div key={i} style={{ color: '#713f12', marginBottom: '2px' }}>
                              <span style={{ color: '#a16207' }}>{match.field}: </span>
                              <HighlightText text={match.value} searchTerm={results.searchTerm} />
                            </div>
                          ))}
                          {timesheet.matchedFields.length > 5 && (
                            <div style={{ color: '#a16207', fontStyle: 'italic' }}>
                              +{timesheet.matchedFields.length - 5} more matches
                            </div>
                          )}
                        </div>
                      )}

                      {isExpanded ? (
                        <div style={{ marginTop: '10px' }} onClick={e => e.stopPropagation()}>
                          {renderDetails(timesheet)}
                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            {timesheet.id && (
                              <button
                                onClick={() => window.open(`https://jti-timesheet.pages.dev/?id=${timesheet.id}`, '_blank')}
                                style={{
                                  padding: '6px 12px',
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  borderRadius: '6px',
                                  border: '1px solid #10b981',
                                  background: '#10b981',
                                  color: 'white',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <ExternalLink size={12} /> Open in Timesheet
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedCustomer(timesheet.customer || timesheet.visitName);
                                setSearchResults(null);
                                setSearchTerm('');
                              }}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 500,
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                background: colors.cardBg,
                                color: colors.text,
                                cursor: 'pointer',
                              }}
                            >
                              Go to customer
                            </button>
                            <button
                              onClick={() => setExpandedId(null)}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 500,
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                background: colors.cardBg,
                                color: colors.text,
                                cursor: 'pointer',
                              }}
                            >
                              Collapse
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '11px', color: colors.textSecondary, marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <ExternalLink size={12} />
                          Click to view details for this {d ? d.toLocaleDateString() : 'visit'}
                        </div>
                      )}
                    </div>
                  );})}
                </div>
                )}
              </div>
            )}

            {/* Head History Results */}
            {filteredHistory.length > 0 && (
              <div style={{
                background: colors.cardBg,
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <h3
                  onClick={() => toggleSection('headHistory')}
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#8b5cf6',
                    marginBottom: collapsedSections.headHistory ? '0' : '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <Settings size={20} />
                  Head History ({filteredHistory.length})
                  <ChevronDown
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      transform: collapsedSections.headHistory ? 'rotate(-90deg)' : 'rotate(0)',
                      transition: 'transform 0.2s'
                    }}
                  />
                </h3>
                {!collapsedSections.headHistory && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {filteredHistory.map((entry, index) => {
                    const rowId = `history:${entry.path || index}`;
                    const isExpanded = expandedId === rowId;
                    const d = itemDate(entry);
                    return (
                    <div
                      key={entry.path || index}
                      onClick={() => toggleExpanded(rowId)}
                      style={{
                        padding: '16px',
                        background: isExpanded ? colors.border : colors.hover,
                        borderRadius: '8px',
                        borderLeft: `4px solid ${entry.status?.toLowerCase() === 'offline' ? '#ef4444' : '#8b5cf6'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => !isExpanded && (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={(e) => !isExpanded && (e.currentTarget.style.background = colors.hover)}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px'
                      }}>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: colors.text }}>
                            {entry.customer}
                          </div>
                          <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                            {entry.line ? `Line ${entry.line}` : 'Head History'} {entry.data?.head ? `• ${entry.data.head}` : ''}
                          </div>
                          {entry.date && (
                            <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                              Date: {entry.date}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {entry.status && (
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              color: entry.status.toLowerCase() === 'offline' ? '#ef4444' : '#10b981'
                            }}>
                              {entry.status.toLowerCase() === 'offline' ? <XCircle size={16} /> : <CheckCircle size={16} />}
                              <span style={{ fontSize: '12px', fontWeight: '500' }}>
                                {entry.status}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Repair Status */}
                      {entry.repairStatus && (
                        <div style={{
                          fontSize: '12px',
                          color: entry.repairStatus.toLowerCase() === 'fixed' ? '#92400e' : '#991b1b',
                          marginBottom: '8px',
                          padding: '4px 8px',
                          background: entry.repairStatus.toLowerCase() === 'fixed' ? '#fef3c7' : '#fee2e2',
                          borderRadius: '4px',
                          display: 'inline-block'
                        }}>
                          Repair: {entry.repairStatus}
                        </div>
                      )}

                      {/* Error */}
                      {entry.error && (
                        <div style={{
                          fontSize: '12px',
                          color: '#dc2626',
                          marginBottom: '8px',
                          padding: '8px',
                          background: '#fee2e2',
                          borderRadius: '4px'
                        }}>
                          <strong>Error:</strong> {entry.error}
                        </div>
                      )}

                      {/* Notes */}
                      {entry.data?.notes && (
                        <div style={{
                          fontSize: '12px',
                          color: colors.text,
                          marginBottom: '8px',
                          padding: '8px',
                          background: colors.cardBg,
                          borderRadius: '4px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <strong>Notes:</strong> {entry.data.notes}
                        </div>
                      )}

                      {/* Machine Notes */}
                      {entry.data?.machineNotes && (
                        <div style={{
                          fontSize: '12px',
                          color: colors.text,
                          marginBottom: '8px',
                          padding: '8px',
                          background: colors.cardBg,
                          borderRadius: '4px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <strong>Machine Notes:</strong> {entry.data.machineNotes}
                        </div>
                      )}

                      {/* Matched Fields with Highlighting */}
                      {entry.matchedFields && entry.matchedFields.length > 0 && (
                        <div style={{
                          background: '#fefce8',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: '600', color: '#854d0e', marginBottom: '4px' }}>
                            Matches found:
                          </div>
                          {entry.matchedFields.slice(0, 5).map((match, i) => (
                            <div key={i} style={{ color: '#713f12', marginBottom: '2px' }}>
                              <span style={{ color: '#a16207' }}>{match.field}: </span>
                              <HighlightText text={match.value} searchTerm={results.searchTerm} />
                            </div>
                          ))}
                          {entry.matchedFields.length > 5 && (
                            <div style={{ color: '#a16207', fontStyle: 'italic' }}>
                              +{entry.matchedFields.length - 5} more matches
                            </div>
                          )}
                        </div>
                      )}

                      {isExpanded ? (
                        <div style={{ marginTop: '10px' }} onClick={e => e.stopPropagation()}>
                          {renderDetails(entry)}
                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            {entry.customer && (
                              <button
                                onClick={() => {
                                  setSelectedCustomer(entry.customer);
                                  setSearchResults(null);
                                  setSearchTerm('');
                                }}
                                style={{
                                  padding: '6px 12px',
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  borderRadius: '6px',
                                  border: '1px solid #8b5cf6',
                                  background: '#8b5cf6',
                                  color: 'white',
                                  cursor: 'pointer',
                                }}
                              >
                                Go to customer
                              </button>
                            )}
                            <button
                              onClick={() => setExpandedId(null)}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                fontWeight: 500,
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                background: colors.cardBg,
                                color: colors.text,
                                cursor: 'pointer',
                              }}
                            >
                              Collapse
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '11px', color: colors.textSecondary, marginTop: '8px' }}>
                          Click to view details for this {d ? d.toLocaleDateString() : 'record'}
                        </div>
                      )}
                    </div>
                  );})}
                </div>
                )}
              </div>
            )}

            {/* Job packets — receipts, invoices and POs held against a job.
                A receipt is findable by the vendor read off the photo, so
                "where did that Hertz charge go?" has an answer. */}
            {filteredPackets.length > 0 && (
              <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3
                  onClick={() => toggleSection('packets')}
                  style={{ fontSize: '16px', fontWeight: '600', color: '#db2777', marginBottom: collapsedSections.packets ? '0' : '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <Paperclip size={20} />
                  Job Packets ({filteredPackets.length})
                  <ChevronDown size={18} style={{ marginLeft: 'auto', transform: collapsedSections.packets ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </h3>
                {!collapsedSections.packets && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {filteredPackets.map((pk) => (
                      <a
                        key={pk.sr}
                        href={`/packet/${pk.sr}`}
                        style={{ padding: '14px', background: colors.inputBg || colors.cardBg, borderRadius: '8px', borderLeft: '4px solid #db2777', display: 'block', textDecoration: 'none' }}
                      >
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#db2777' }}>
                          <HighlightText text={pk.sr} searchTerm={results.searchTerm} />
                          <span style={{ color: colors.textSecondary, fontWeight: 400, fontSize: '12px', marginLeft: '8px' }}>
                            {pk.fileCount} file{pk.fileCount === 1 ? '' : 's'}
                            {pk.sentAt ? ' · sent' : pk.builtAt ? ' · built' : ''}
                          </span>
                        </div>
                        {pk.files.map((f, i) => (
                          <div key={i} style={{ fontSize: '12px', color: colors.text, marginTop: '5px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ color: colors.textSecondary }}>{f.kind === 'receipts' ? 'Receipt' : f.kind}</span>
                            {f.vendor && <strong><HighlightText text={f.vendor} searchTerm={results.searchTerm} /></strong>}
                            {f.category && <span><HighlightText text={f.category} searchTerm={results.searchTerm} /></span>}
                            {f.amount && <span style={{ fontVariantNumeric: 'tabular-nums' }}>${f.amount}</span>}
                            <span style={{ color: colors.textSecondary }}><HighlightText text={f.name} searchTerm={results.searchTerm} /></span>
                          </div>
                        ))}
                        {pk.matches.map((m, i) => (
                          <div key={`m${i}`} style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '4px' }}>
                            {m.field}: <HighlightText text={m.value} searchTerm={results.searchTerm} />
                          </div>
                        ))}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* The customer directory. Searching a contact or an AP email
                should name the customer they belong to. */}
            {filteredCustomers.length > 0 && (
              <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3
                  onClick={() => toggleSection('customers')}
                  style={{ fontSize: '16px', fontWeight: '600', color: '#0ea5e9', marginBottom: collapsedSections.customers ? '0' : '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <Building2 size={20} />
                  Customers ({filteredCustomers.length})
                  <ChevronDown size={18} style={{ marginLeft: 'auto', transform: collapsedSections.customers ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </h3>
                {!collapsedSections.customers && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {filteredCustomers.map((c, ci) => (
                      <div
                        key={`${c.name}-${ci}`}
                        onClick={() => setSearchTerm && setSearchTerm(c.name)}
                        style={{ padding: '14px', background: colors.inputBg || colors.cardBg, borderRadius: '8px', borderLeft: '4px solid #0ea5e9', cursor: 'pointer' }}
                      >
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#0369a1' }}>
                          <HighlightText text={c.name} searchTerm={results.searchTerm} />
                          {(c.city || c.state) && (
                            <span style={{ color: colors.textSecondary, fontWeight: 400, fontSize: '12px', marginLeft: '8px' }}>
                              {[c.city, c.state].filter(Boolean).join(', ')}
                            </span>
                          )}
                        </div>
                        {c.matches.map((m, i) => (
                          <div key={i} style={{ fontSize: '12px', color: colors.text, marginTop: '4px' }}>
                            <span style={{ color: colors.textSecondary }}>{m.field}: </span>
                            <HighlightText text={m.value} searchTerm={results.searchTerm} />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inventory: Parts */}
            {filteredParts.length > 0 && (
              <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3
                  onClick={() => toggleSection('parts')}
                  style={{ fontSize: '16px', fontWeight: '600', color: '#06b6d4', marginBottom: collapsedSections.parts ? '0' : '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <Settings size={20} />
                  Inventory Parts ({filteredParts.length})
                  <ChevronDown size={18} style={{ marginLeft: 'auto', transform: collapsedSections.parts ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </h3>
                {!collapsedSections.parts && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {filteredParts.map((part) => (
                      <div
                        key={part.id}
                        onClick={() => window.open('https://jti-inventory.pages.dev/', '_blank')}
                        style={{ padding: '14px', background: '#ecfeff', borderRadius: '8px', borderLeft: '4px solid #06b6d4', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '15px', fontWeight: '600', color: '#0e7490' }}>
                              <HighlightText text={part.name || 'Unnamed part'} searchTerm={results.searchTerm} />
                            </div>
                            <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                              {part.sku && (<span>SKU: <strong style={{ color: colors.text }}><HighlightText text={part.sku} searchTerm={results.searchTerm} /></strong></span>)}
                              {part.category && (<span>Category: <HighlightText text={part.category} searchTerm={results.searchTerm} /></span>)}
                              {part.location && (<span>Location: <HighlightText text={part.location} searchTerm={results.searchTerm} /></span>)}
                              {typeof part.quantity === 'number' && (<span>Qty: <strong style={{ color: colors.text }}>{part.quantity}</strong></span>)}
                            </div>
                            {part.customers && part.customers.length > 0 && (
                              <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '4px' }}>
                                Customer{part.customers.length === 1 ? '' : 's'}: <HighlightText text={part.customers.join(', ')} searchTerm={results.searchTerm} />
                              </div>
                            )}
                            {part.notes && (
                              <div style={{ fontSize: '12px', color: colors.text, marginTop: '6px', whiteSpace: 'pre-wrap' }}>
                                <HighlightText text={part.notes} searchTerm={results.searchTerm} />
                              </div>
                            )}
                          </div>
                          {part.photoUrl && (
                            <img src={part.photoUrl} alt="" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inventory: Boards */}
            {filteredBoards.length > 0 && (
              <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3
                  onClick={() => toggleSection('boards')}
                  style={{ fontSize: '16px', fontWeight: '600', color: '#0891b2', marginBottom: collapsedSections.boards ? '0' : '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <Settings size={20} />
                  Circuit Boards ({filteredBoards.length})
                  <ChevronDown size={18} style={{ marginLeft: 'auto', transform: collapsedSections.boards ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </h3>
                {!collapsedSections.boards && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {filteredBoards.map((board) => (
                      <div
                        key={board.id}
                        onClick={() => window.open('https://jti-inventory.pages.dev/', '_blank')}
                        style={{ padding: '14px', background: colors.hover, borderRadius: '8px', borderLeft: '4px solid #0891b2', cursor: 'pointer' }}
                      >
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#0e7490' }}>
                          <HighlightText text={board.name || 'Unnamed board'} searchTerm={results.searchTerm} />
                        </div>
                        <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                          {board.model && (<span>Model: <HighlightText text={board.model} searchTerm={results.searchTerm} /></span>)}
                          {board.revision && (<span>Rev: <HighlightText text={board.revision} searchTerm={results.searchTerm} /></span>)}
                          {board.serial && (<span>Board #: <strong style={{ color: colors.text }}><HighlightText text={board.serial} searchTerm={results.searchTerm} /></strong></span>)}
                          {board.location && (<span>Location: <HighlightText text={board.location} searchTerm={results.searchTerm} /></span>)}
                        </div>
                        {board.customers && board.customers.length > 0 && (
                          <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '4px' }}>
                            Customer{board.customers.length === 1 ? '' : 's'}: <HighlightText text={board.customers.join(', ')} searchTerm={results.searchTerm} />
                          </div>
                        )}
                        {board.notes && (
                          <div style={{ fontSize: '12px', color: colors.text, marginTop: '6px', whiteSpace: 'pre-wrap' }}>
                            <HighlightText text={board.notes} searchTerm={results.searchTerm} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Parts Manual: Diagrams */}
            {filteredDiagrams.length > 0 && (
              <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3
                  onClick={() => toggleSection('diagrams')}
                  style={{ fontSize: '16px', fontWeight: '600', color: '#ec4899', marginBottom: collapsedSections.diagrams ? '0' : '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <FileText size={20} />
                  Parts Manual ({filteredDiagrams.length})
                  <ChevronDown size={18} style={{ marginLeft: 'auto', transform: collapsedSections.diagrams ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </h3>
                {!collapsedSections.diagrams && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {filteredDiagrams.map((d) => (
                      <div
                        key={d.id}
                        onClick={() => window.open(`https://jti-parts.pages.dev/?diagram=${encodeURIComponent(d.id)}`, '_blank')}
                        style={{ padding: '14px', background: '#fdf2f8', borderRadius: '8px', borderLeft: '4px solid #ec4899', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                          <div>
                            <div style={{ fontSize: '15px', fontWeight: '600', color: '#9d174d' }}>
                              <HighlightText text={d.name} searchTerm={results.searchTerm} />
                            </div>
                            {d.customer && (
                              <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                                <HighlightText text={d.customer} searchTerm={results.searchTerm} />
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                            {d.matchedParts.length > 0
                              ? `${d.matchedParts.length} matching part${d.matchedParts.length === 1 ? '' : 's'} of ${d.totalParts}`
                              : `${d.totalParts} parts`}
                          </div>
                        </div>
                        {d.matchedParts.length > 0 && (
                          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {d.matchedParts.slice(0, 8).map((mp, i) => (
                              <div key={i} style={{ padding: '8px 10px', background: colors.cardBg, borderRadius: '6px', fontSize: '12px', color: colors.text }}>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                                  {mp.hotspotKey != null && /^\d+$/.test(String(mp.hotspotKey)) && (
                                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', background: '#f3f4f6', color: colors.textSecondary, borderRadius: '4px' }}>
                                      #{mp.hotspotKey}
                                    </span>
                                  )}
                                  {mp.partNumber && (
                                    <strong style={{ color: '#9d174d', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                                      <HighlightText text={String(mp.partNumber)} searchTerm={results.searchTerm} />
                                    </strong>
                                  )}
                                  {mp.qty && (
                                    <span style={{ color: colors.textSecondary }}>× {mp.qty}</span>
                                  )}
                                </div>
                                {(mp.partName || mp.description) && (
                                  <div style={{ marginTop: '3px', color: colors.text }}>
                                    {mp.partName && (
                                      <HighlightText text={mp.partName} searchTerm={results.searchTerm} />
                                    )}
                                    {mp.description && mp.description !== mp.partName && (
                                      <span style={{ color: colors.textSecondary, marginLeft: mp.partName ? '6px' : 0 }}>
                                        {mp.partName && '— '}
                                        <HighlightText text={mp.description} searchTerm={results.searchTerm} />
                                      </span>
                                    )}
                                  </div>
                                )}
                                {mp.allPartNumbers && mp.allPartNumbers.length > 1 && (
                                  <div style={{ marginTop: '4px', fontSize: '11px', color: colors.textSecondary }}>
                                    Also: {mp.allPartNumbers.slice(1).map((pn, j) => (
                                      <span key={j} style={{ marginRight: '8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                                        <HighlightText text={pn} searchTerm={results.searchTerm} />
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                            {d.matchedParts.length > 8 && (
                              <div style={{ fontSize: '11px', color: colors.textSecondary, textAlign: 'center' }}>
                                +{d.matchedParts.length - 8} more — open the diagram to view
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Parts orders — what was actually ordered for a plant.
                Sits under the manuals because that is where the parts were
                picked from, and answers the question the manual cannot: not
                "what does this machine take?" but "did we already order it?" */}
            {filteredOrders.length > 0 && (
              <div style={{ background: colors.cardBg, borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3
                  onClick={() => toggleSection('partsOrders')}
                  style={{ fontSize: '16px', fontWeight: '600', color: '#0d9488', marginBottom: collapsedSections.partsOrders ? '0' : '16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <Package size={20} />
                  Parts orders ({filteredOrders.length})
                  <ChevronDown size={18} style={{ marginLeft: 'auto', transform: collapsedSections.partsOrders ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                </h3>
                {!collapsedSections.partsOrders && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {filteredOrders.map((o) => (
                      <div key={o.id} style={{ padding: '14px', background: colors.hover, borderRadius: '8px', borderLeft: '4px solid #0d9488' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '15px', fontWeight: '600', color: colors.text }}>
                            <HighlightText text={o.customer || 'Parts order'} searchTerm={results.searchTerm} />
                          </div>
                          <div style={{ fontSize: '12px', color: colors.textSecondary }}>
                            {o.orderedAt ? new Date(o.orderedAt).toLocaleDateString() : ''}
                            {' · '}
                            {o.itemCount} line{o.itemCount === 1 ? '' : 's'} · {o.totalQuantity} ordered
                          </div>
                        </div>
                        {o.diagrams?.length > 0 && (
                          <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                            {o.diagrams.join(' · ')}
                          </div>
                        )}
                        {/* The lines that matched, not the whole order: a
                            search for one part code should not print eighty
                            rows to show you the one you asked about. */}
                        {o.matchedItems?.length > 0 && (
                          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {o.matchedItems.slice(0, 8).map((it, i) => (
                              <div key={i} style={{ padding: '8px 10px', background: colors.cardBg, borderRadius: '6px', fontSize: '12px', color: colors.text, display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                                {it.partCode && (
                                  <strong style={{ color: '#0f766e', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                                    <HighlightText text={it.partCode} searchTerm={results.searchTerm} />
                                  </strong>
                                )}
                                <span><HighlightText text={it.partName} searchTerm={results.searchTerm} /></span>
                                <span style={{ marginLeft: 'auto', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                                  ordered {it.orderQty}
                                </span>
                              </div>
                            ))}
                            {o.matchedItems.length > 8 && (
                              <div style={{ fontSize: '11px', color: colors.textSecondary }}>
                                +{o.matchedItems.length - 8} more on this order
                              </div>
                            )}
                          </div>
                        )}
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

export default SearchResults;
