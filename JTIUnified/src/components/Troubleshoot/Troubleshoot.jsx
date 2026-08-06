import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, ChevronDown, BookOpen, History, Filter, MapPin, RefreshCw, Wrench,
} from 'lucide-react';
import rawMarkdown from './troubleshooting.md?raw';
import serviceLog from './serviceLog.json';
import { extractMachines, buildMachineList } from './facets';
import './troubleshoot.css';

const VIEW_KEY = 'jti-unified-troubleshoot-view';

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return out;
}
function highlightHtml(html, query) {
  if (!query) return html;
  const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return html.replace(/(>[^<]+)/g, (match) => match.replace(re, '<mark>$1</mark>'));
}
function highlightText(text, query) {
  if (!text) return '';
  if (!query) return escapeHtml(text);
  return highlightHtml(escapeHtml(text), query);
}

function blocksToHtml(blocks) {
  let html = '';
  let listOpen = false;
  let nestedOpen = false;
  const closeLists = () => {
    if (nestedOpen) { html += '</ul>'; nestedOpen = false; }
    if (listOpen) { html += '</ul>'; listOpen = false; }
  };
  for (const raw of blocks) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const topMatch = line.match(/^- (.*)$/);
    const nestedMatch = line.match(/^\s{2,}- (.*)$/);
    if (nestedMatch) {
      if (!listOpen) { html += '<ul>'; listOpen = true; }
      if (!nestedOpen) { html += '<ul>'; nestedOpen = true; }
      html += `<li>${renderInline(nestedMatch[1])}</li>`;
      continue;
    }
    if (topMatch) {
      if (nestedOpen) { html += '</ul>'; nestedOpen = false; }
      if (!listOpen) { html += '<ul>'; listOpen = true; }
      html += `<li>${renderInline(topMatch[1])}</li>`;
      continue;
    }
    closeLists();
    html += `<p>${renderInline(line)}</p>`;
  }
  closeLists();
  return html;
}

function parseMarkdown(md) {
  const lines = md.split('\n');
  const sections = [];
  let intro = '';
  let current = null;
  let currentSymptom = null;
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('## ')) {
    const l = lines[i].trim();
    if (l.startsWith('> ')) intro += (intro ? ' ' : '') + l.slice(2);
    i++;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim();
      current = { id: slugify(title), title, symptoms: [] };
      sections.push(current);
      currentSymptom = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('### Symptom:')) {
      const title = line.replace(/^###\s*Symptom:\s*/, '').trim();
      currentSymptom = { title, blocks: [] };
      current.symptoms.push(currentSymptom);
      continue;
    }
    if (line.startsWith('### ')) {
      const title = line.slice(4).trim();
      currentSymptom = { title, blocks: [] };
      current.symptoms.push(currentSymptom);
      continue;
    }
    if (line.startsWith('---')) continue;
    if (currentSymptom) currentSymptom.blocks.push(line);
  }
  for (const sec of sections) {
    for (const sym of sec.symptoms) {
      sym.html = blocksToHtml(sym.blocks);
      const body = sym.title + ' ' + sym.blocks.join(' ');
      sym.searchText = body.toLowerCase();
      sym.machines = extractMachines(body);
    }
  }
  return { intro, sections };
}

function customerKey(name, city, state) {
  return `${name}|${city || ''}|${state || ''}`;
}

const MONTH_ORDER = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function periodFromDate(dateLike) {
  if (!dateLike) return '';
  let d;
  if (dateLike?.toDate) d = dateLike.toDate();
  else d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function parsePeriod(period) {
  if (!period) return { year: 0, month: 0, monthName: 'Unknown' };
  const parts = period.trim().split(/\s+/);
  const monthName = parts[0] || 'Unknown';
  const year = parseInt(parts[1], 10) || 0;
  const month = MONTH_ORDER[monthName.toLowerCase()] ?? 0;
  return { year, month, monthName };
}

function groupByPeriod(entries) {
  const years = new Map();
  for (const e of entries) {
    const { year, month, monthName } = parsePeriod(e.period);
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year);
    const monthKey = `${month}|${monthName}`;
    if (!months.has(monthKey)) months.set(monthKey, { monthName, month, entries: [] });
    months.get(monthKey).entries.push(e);
  }
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({
      year,
      months: [...months.values()].sort((a, b) => b.month - a.month),
      total: [...months.values()].reduce((acc, m) => acc + m.entries.length, 0),
    }));
}

// Format a yyyy-mm-dd or ISO date for inline display.
function formatShortDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Convert a live timesheet doc into ONE merged visit-log entry per service report.
// All daily entries that share an invoice / SR number are combined into a single
// card so the user sees the full visit at a glance instead of one card per day.
function timesheetsToLogEntries(timesheets) {
  if (!Array.isArray(timesheets)) return [];
  const out = [];
  timesheets.forEach((ts, tsIdx) => {
    const customer = (ts.customer || ts.visitName || 'Unknown').trim();
    const visitName = ts.visitName || '';
    const reportMap = ts.serviceReportData || {};
    const list = Array.isArray(ts.entries) ? ts.entries : [];
    const invoice = ts.invoiceInfo?.invoiceNumber || '';
    const baseId = `ts:${ts.id || tsIdx}`;

    if (list.length === 0) {
      const period = periodFromDate(ts.timestamp || ts.date);
      let work = '';
      if (typeof reportMap === 'string') work = reportMap;
      out.push({
        idx: baseId,
        source: 'timesheet',
        customer,
        city: '',
        state: '',
        period,
        date: typeof ts.timestamp === 'string' ? ts.timestamp : '',
        dates: [],
        hours: 0,
        body: work ? [work] : (visitName ? [visitName] : []),
        invoice,
      });
      return;
    }

    // Sort entries by date so the body reads chronologically.
    const sorted = [...list].sort((a, b) => {
      const da = new Date(a.date || 0).getTime();
      const db = new Date(b.date || 0).getTime();
      return da - db;
    });

    const lines = [];
    const dates = [];
    let totalHours = 0;
    sorted.forEach((entry) => {
      const reportEntry = reportMap[entry.date];
      let work = '';
      if (typeof reportEntry === 'string') work = reportEntry;
      else if (reportEntry && typeof reportEntry === 'object') {
        work = reportEntry.serviceWork || reportEntry.work || reportEntry.notes || '';
      }
      const hrs = parseFloat(entry.hours || 0) || 0;
      totalHours += hrs;
      if (entry.date) dates.push(entry.date);
      const stamp = entry.date ? formatShortDate(entry.date) : '';
      const hoursLabel = hrs ? `${hrs}h` : '';
      const meta = [stamp, hoursLabel].filter(Boolean).join(' · ');
      if (work) {
        lines.push(meta ? `**${meta}** — ${work}` : work);
      } else if (meta) {
        lines.push(`**${meta}**`);
      }
    });

    const firstDate = sorted[0]?.date || ts.timestamp;
    const period = periodFromDate(firstDate);

    out.push({
      idx: baseId,
      source: 'timesheet',
      customer,
      city: '',
      state: '',
      period,
      date: firstDate || '',
      dates,
      hours: totalHours,
      body: lines.length ? lines : (visitName ? [visitName] : []),
      invoice,
    });
  });
  return out;
}

export default function Troubleshoot({
  timesheets,
  timesheetsLoading,
  darkMode,
  colors,
  onRefreshTimesheets,
}) {
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || 'reference'; } catch { return 'reference'; }
  });
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [customerKeyFilter, setCustomerKeyFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState(new Set());
  const [sourceFilter, setSourceFilter] = useState('all'); // all | doc | timesheet
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [collapsedYears, setCollapsedYears] = useState(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState(new Set());
  const periodsInitializedRef = useRef(false);
  const sectionRefs = useRef({});

  const { intro, sections } = useMemo(() => parseMarkdown(rawMarkdown), []);

  // Build the merged visit log: docx historical + live timesheets.
  const docEntries = useMemo(() => {
    return (serviceLog.entries || []).map((e, idx) => {
      const bodyText = (e.body || []).join(' ');
      return {
        ...e,
        idx: `doc:${idx}`,
        source: 'doc',
        bodyText,
        machines: extractMachines(`${e.customer} ${bodyText}`),
        key: customerKey(e.customer, e.city, e.state),
      };
    });
  }, []);

  const timesheetEntries = useMemo(() => {
    const flat = timesheetsToLogEntries(timesheets);
    return flat.map((e) => {
      const bodyText = (e.body || []).join(' ');
      return {
        ...e,
        bodyText,
        machines: extractMachines(`${e.customer} ${bodyText}`),
        key: customerKey(e.customer, e.city, e.state),
      };
    });
  }, [timesheets]);

  const allEntries = useMemo(
    () => [...timesheetEntries, ...docEntries],
    [timesheetEntries, docEntries]
  );

  const customerOptions = useMemo(() => {
    const map = new Map();
    for (const c of serviceLog.customers || []) {
      map.set(customerKey(c.customer, c.city, c.state), { ...c });
    }
    // Add timesheet customers (no city/state available unless added later).
    for (const e of timesheetEntries) {
      const key = e.key;
      if (!map.has(key)) {
        map.set(key, { customer: e.customer, city: e.city || '', state: e.state || '', count: 0 });
      }
      map.get(key).count += 1;
    }
    return [...map.values()];
  }, [timesheetEntries]);

  const stateOptions = useMemo(() => {
    const set = new Set();
    customerOptions.forEach((c) => c.state && set.add(c.state));
    return [...set].sort();
  }, [customerOptions]);

  const filteredCustomerOptions = useMemo(() => {
    if (!stateFilter) return customerOptions;
    return customerOptions.filter((c) => c.state === stateFilter);
  }, [customerOptions, stateFilter]);

  const allSymptoms = useMemo(() => sections.flatMap((s) => s.symptoms), [sections]);
  const machineList = useMemo(
    () => buildMachineList(allSymptoms, allEntries),
    [allSymptoms, allEntries]
  );

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
  }, [view]);

  const toggleMachine = (m) => {
    setMachineFilter((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

  const clearFilters = () => {
    setCustomerKeyFilter('');
    setStateFilter('');
    setMachineFilter(new Set());
    setSourceFilter('all');
  };

  const customerNameForKey = (key) => {
    const opt = customerOptions.find((c) => customerKey(c.customer, c.city, c.state) === key);
    if (!opt) return '';
    return opt.city ? `${opt.customer} — ${opt.city}, ${opt.state}` : opt.customer;
  };
  const customerNameLowerForKey = (key) => {
    const opt = customerOptions.find((c) => customerKey(c.customer, c.city, c.state) === key);
    return opt ? opt.customer.toLowerCase() : '';
  };

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cust = customerKeyFilter ? customerNameLowerForKey(customerKeyFilter) : '';
    return sections
      .map((sec) => ({
        ...sec,
        symptoms: sec.symptoms.filter((s) => {
          if (q && !s.searchText.includes(q) && !sec.title.toLowerCase().includes(q)) return false;
          if (machineFilter.size > 0 && !s.machines.some((m) => machineFilter.has(m))) return false;
          if (cust && !s.searchText.includes(cust)) return false;
          return true;
        }),
      }))
      .filter((sec) => sec.symptoms.length > 0);
  }, [sections, query, customerKeyFilter, machineFilter, customerOptions]);

  const totalRefMatches = useMemo(
    () => filteredSections.reduce((acc, s) => acc + s.symptoms.length, 0),
    [filteredSections]
  );

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEntries.filter((e) => {
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
      if (customerKeyFilter && e.key !== customerKeyFilter) return false;
      if (stateFilter && e.state !== stateFilter) return false;
      if (machineFilter.size > 0 && !e.machines.some((m) => machineFilter.has(m))) return false;
      if (q) {
        const blob = `${e.customer} ${e.city} ${e.state} ${e.period} ${e.bodyText} ${e.invoice || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [allEntries, query, customerKeyFilter, stateFilter, machineFilter, sourceFilter]);

  const groupedEntries = useMemo(() => groupByPeriod(filteredEntries), [filteredEntries]);

  useEffect(() => {
    if (periodsInitializedRef.current) return;
    if (allEntries.length === 0) return;
    const allGroups = groupByPeriod(allEntries);
    const years = new Set(allGroups.map((g) => g.year));
    const months = new Set();
    allGroups.forEach((g) => g.months.forEach((m) => months.add(`${g.year}|${m.monthName}`)));
    setCollapsedYears(years);
    setCollapsedMonths(months);
    periodsInitializedRef.current = true;
  }, [allEntries]);

  const activeFilterCount =
    (customerKeyFilter ? 1 : 0) + (stateFilter ? 1 : 0) +
    machineFilter.size + (sourceFilter !== 'all' ? 1 : 0);

  const isFiltering = !!query || activeFilterCount > 0;
  const effectivelyCollapsedYear = (year) => !isFiltering && collapsedYears.has(year);
  const effectivelyCollapsedMonth = (year, monthName) =>
    !isFiltering && collapsedMonths.has(`${year}|${monthName}`);

  useEffect(() => {
    if (view !== 'reference' || query) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.target.offsetTop - b.target.offsetTop);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-72px 0px -60% 0px', threshold: [0, 1] }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [filteredSections, query, view]);

  const toggleCollapsed = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const toggleEntry = (idx) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };
  const toggleYear = (y) => {
    setCollapsedYears((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });
  };
  const toggleMonth = (key) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const expandAllPeriods = () => {
    setCollapsedYears(new Set());
    setCollapsedMonths(new Set());
  };
  const collapseAllPeriods = () => {
    const years = new Set(groupedEntries.map((g) => g.year));
    const months = new Set();
    groupedEntries.forEach((g) =>
      g.months.forEach((m) => months.add(`${g.year}|${m.monthName}`))
    );
    setCollapsedYears(years);
    setCollapsedMonths(months);
  };

  const handleTocClick = (e, id) => {
    e.preventDefault();
    const el = sectionRefs.current[id];
    if (!el) return;
    setCollapsed((c) => ({ ...c, [id]: false }));
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveId(id);
  };

  const filtersPanel = (
    <div className="tshoot-filters-panel">
      <div className="tshoot-filter-group">
        <div className="tshoot-filter-label">Source</div>
        <div className="tshoot-machine-pills">
          {[
            { value: 'all', label: 'All' },
            { value: 'timesheet', label: 'Timesheet' },
            { value: 'doc', label: 'Doc archive' },
          ].map((opt) => (
            <button
              key={opt.value}
              className={`tshoot-pill ${sourceFilter === opt.value ? 'active' : ''}`}
              onClick={() => setSourceFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="tshoot-filter-group">
        <div className="tshoot-filter-label">State</div>
        <select
          className="tshoot-filter-select"
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value);
            if (e.target.value && customerKeyFilter) {
              const opt = customerOptions.find((c) => customerKey(c.customer, c.city, c.state) === customerKeyFilter);
              if (opt && opt.state !== e.target.value) setCustomerKeyFilter('');
            }
          }}
        >
          <option value="">All states</option>
          {stateOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>
      <div className="tshoot-filter-group">
        <div className="tshoot-filter-label">Customer ({filteredCustomerOptions.length})</div>
        <select
          className="tshoot-filter-select"
          value={customerKeyFilter}
          onChange={(e) => setCustomerKeyFilter(e.target.value)}
        >
          <option value="">All customers</option>
          {filteredCustomerOptions
            .slice()
            .sort((a, b) => a.customer.localeCompare(b.customer))
            .map((c) => {
              const k = customerKey(c.customer, c.city, c.state);
              const label = c.city
                ? `${c.customer} — ${c.city}, ${c.state} (${c.count})`
                : `${c.customer} (${c.count})`;
              return <option key={k} value={k}>{label}</option>;
            })}
        </select>
      </div>
      <div className="tshoot-filter-group">
        <div className="tshoot-filter-label">Machine model</div>
        <div className="tshoot-machine-pills">
          {machineList.length === 0 && <div className="tshoot-filter-hint">No models detected.</div>}
          {machineList.map((m) => (
            <button
              key={m.name}
              className={`tshoot-pill ${machineFilter.has(m.name) ? 'active' : ''}`}
              onClick={() => toggleMachine(m.name)}
            >
              {m.name} <span className="tshoot-pill-count">{m.count}</span>
            </button>
          ))}
        </div>
      </div>
      {activeFilterCount > 0 && (
        <button className="tshoot-link-btn" onClick={clearFilters}>Clear filters</button>
      )}
    </div>
  );

  return (
    <div
      className={`tshoot-root ${darkMode ? 'tshoot-dark' : 'tshoot-light'}`}
      style={{ background: colors.cardBg, color: colors.text, border: `1px solid ${colors.border}` }}
    >
      <div className="tshoot-header" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <div className="tshoot-header-row">
          <div className="tshoot-title">
            <Wrench size={18} />
            <span>Troubleshooting</span>
          </div>
          <div className="tshoot-search-wrap">
            <Search size={16} className="tshoot-search-icon" />
            <input
              className="tshoot-search-input"
              type="search"
              placeholder={view === 'history' ? 'Search visit notes…' : 'Search symptoms, causes, fixes…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query && (
              <button className="tshoot-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={16} />
              </button>
            )}
          </div>
          <button
            className="tshoot-icon-btn tshoot-filter-toggle"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Toggle filters"
          >
            <Filter size={18} />
            {activeFilterCount > 0 && <span className="tshoot-filter-badge">{activeFilterCount}</span>}
          </button>
          {onRefreshTimesheets && (
            <button
              className="tshoot-icon-btn"
              onClick={onRefreshTimesheets}
              aria-label="Reload timesheets"
              title="Reload timesheet entries"
              disabled={timesheetsLoading}
            >
              <RefreshCw size={16} style={{ animation: timesheetsLoading ? 'tshoot-spin 1s linear infinite' : 'none' }} />
            </button>
          )}
        </div>
        <div className="tshoot-tabs">
          <button className={`tshoot-tab ${view === 'reference' ? 'active' : ''}`} onClick={() => setView('reference')}>
            <BookOpen size={14} /> Reference
          </button>
          <button className={`tshoot-tab ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
            <History size={14} /> Visit Log
            <span className="tshoot-tab-count">{allEntries.length}</span>
          </button>
        </div>
        {showFilters && <div className="tshoot-filters-mobile">{filtersPanel}</div>}
      </div>

      <div className="tshoot-body">
        <aside className="tshoot-sidebar">
          {view === 'reference' && (
            <nav className="tshoot-toc" aria-label="Sections">
              <div className="tshoot-toc-title">Sections</div>
              {sections.map((sec) => (
                <a
                  key={sec.id}
                  href={`#tshoot-${sec.id}`}
                  className={activeId === sec.id ? 'active' : ''}
                  onClick={(e) => handleTocClick(e, sec.id)}
                >
                  {sec.title}
                </a>
              ))}
            </nav>
          )}
          {filtersPanel}
        </aside>

        {view === 'reference' ? (
          <main className="tshoot-content">
            <div className="tshoot-intro">
              <h2>Service Work Troubleshooting</h2>
              {intro && <p>{intro}</p>}
            </div>

            {(query || activeFilterCount > 0) && (
              <div className="tshoot-results-meta">
                {totalRefMatches > 0
                  ? `${totalRefMatches} symptom${totalRefMatches === 1 ? '' : 's'} match`
                  : 'No reference matches'}
                {customerKeyFilter && ` · ${customerNameForKey(customerKeyFilter)}`}
                {stateFilter && ` · state: ${stateFilter}`}
                {machineFilter.size > 0 && ` · ${[...machineFilter].join(', ')}`}
              </div>
            )}

            {filteredSections.length === 0 ? (
              <div className="tshoot-empty">
                Nothing here matches. Try the Visit Log tab — it has the raw notes for this customer.
              </div>
            ) : (
              filteredSections.map((sec) => {
                const isCollapsed = !!collapsed[sec.id];
                return (
                  <section
                    key={sec.id}
                    id={`tshoot-${sec.id}`}
                    ref={(el) => (sectionRefs.current[sec.id] = el)}
                    className={`tshoot-section ${isCollapsed ? 'collapsed' : ''}`}
                  >
                    <h3 onClick={() => toggleCollapsed(sec.id)}>
                      <ChevronDown size={18} className="tshoot-chevron" />
                      {sec.title}
                    </h3>
                    <div className="tshoot-section-body">
                      {sec.symptoms.map((sym, idx) => (
                        <div key={idx} className="tshoot-symptom">
                          <div
                            className="tshoot-symptom-title"
                            dangerouslySetInnerHTML={{ __html: highlightHtml(escapeHtml(sym.title), query) }}
                          />
                          {sym.machines.length > 0 && (
                            <div className="tshoot-symptom-tags">
                              {sym.machines.map((m) => (
                                <span key={m} className={`tshoot-tag ${machineFilter.has(m) ? 'active' : ''}`}>{m}</span>
                              ))}
                            </div>
                          )}
                          <div
                            className="tshoot-symptom-content"
                            dangerouslySetInnerHTML={{ __html: highlightHtml(sym.html, query) }}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </main>
        ) : (
          <main className="tshoot-content">
            <div className="tshoot-intro">
              <h2>Visit Log</h2>
              <p>
                {timesheetEntries.length} live timesheet entries + {docEntries.length} historical visits from
                <code style={{ marginLeft: 4 }}>Service Work Master List.docx</code>.
                {timesheetsLoading && ' (loading timesheets…)'}
              </p>
            </div>

            <div className="tshoot-results-meta">
              {`${filteredEntries.length} of ${allEntries.length} visits`}
              {query && ` matching "${query}"`}
              {customerKeyFilter && ` · ${customerNameForKey(customerKeyFilter)}`}
              {stateFilter && ` · state: ${stateFilter}`}
              {machineFilter.size > 0 && ` · ${[...machineFilter].join(', ')}`}
              {sourceFilter !== 'all' && ` · ${sourceFilter}`}
            </div>

            {filteredEntries.length === 0 ? (
              <div className="tshoot-empty">No matching visits.</div>
            ) : (
              <>
                <div className="tshoot-period-actions">
                  <button className="tshoot-link-btn" onClick={expandAllPeriods}>Expand all</button>
                  <span className="tshoot-period-actions-sep">·</span>
                  <button className="tshoot-link-btn" onClick={collapseAllPeriods}>Collapse all</button>
                  {isFiltering && <span className="tshoot-filter-hint" style={{ marginLeft: 'auto' }}>Auto-expanded while filtering</span>}
                </div>
                <div className="tshoot-period-list">
                  {groupedEntries.map((g) => {
                    const yearCollapsed = effectivelyCollapsedYear(g.year);
                    return (
                      <div key={g.year} className="tshoot-period-year">
                        <button
                          className={`tshoot-period-year-head ${yearCollapsed ? 'collapsed' : ''}`}
                          onClick={() => toggleYear(g.year)}
                        >
                          <ChevronDown size={16} className="tshoot-chevron" />
                          <span className="tshoot-period-year-label">{g.year || 'Unknown year'}</span>
                          <span className="tshoot-period-count">{g.total} visit{g.total === 1 ? '' : 's'}</span>
                        </button>
                        {!yearCollapsed && (
                          <div className="tshoot-period-months">
                            {g.months.map((m) => {
                              const monthCollapsed = effectivelyCollapsedMonth(g.year, m.monthName);
                              return (
                                <div key={m.monthName} className="tshoot-period-month">
                                  <button
                                    className={`tshoot-period-month-head ${monthCollapsed ? 'collapsed' : ''}`}
                                    onClick={() => toggleMonth(`${g.year}|${m.monthName}`)}
                                  >
                                    <ChevronDown size={14} className="tshoot-chevron" />
                                    <span>{m.monthName}</span>
                                    <span className="tshoot-period-count">{m.entries.length}</span>
                                  </button>
                                  {!monthCollapsed && (
                                    <div className="tshoot-history-list">
                                      {m.entries.map((e) => {
                                        const isOpen = expanded.has(e.idx);
                                        const preview = e.bodyText.slice(0, 240);
                                        return (
                                          <div key={e.idx} className={`tshoot-history-card src-${e.source}`}>
                                            <div className="tshoot-history-head" onClick={() => toggleEntry(e.idx)} style={{ cursor: 'pointer' }}>
                                              <div>
                                                <div
                                                  className="tshoot-history-customer"
                                                  dangerouslySetInnerHTML={{ __html: highlightText(e.customer, query) }}
                                                />
                                                {(e.city || e.state) && (
                                                  <div className="tshoot-history-sub">
                                                    <MapPin size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
                                                    <span dangerouslySetInnerHTML={{ __html: highlightText(`${e.city || ''}${e.city && e.state ? ', ' : ''}${e.state || ''}`, query) }} />
                                                  </div>
                                                )}
                                              </div>
                                              <div className="tshoot-history-meta">
                                                <span className={`tshoot-source-badge tshoot-source-${e.source}`}>
                                                  {e.source === 'timesheet' ? 'Live' : 'Doc'}
                                                </span>
                                                {e.invoice && (
                                                  <span
                                                    className="tshoot-sr-tag"
                                                    dangerouslySetInnerHTML={{ __html: 'SR ' + highlightText(String(e.invoice), query) }}
                                                  />
                                                )}
                                                {e.dates && e.dates.length > 1 && (
                                                  <span title={e.dates.join(', ')}>
                                                    {formatShortDate(e.dates[0])}–{formatShortDate(e.dates[e.dates.length - 1])}
                                                  </span>
                                                )}
                                                {e.hours > 0 && <span>{e.hours}h</span>}
                                                <ChevronDown size={14} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
                                              </div>
                                            </div>
                                            {e.machines.length > 0 && (
                                              <div className="tshoot-symptom-tags">
                                                {e.machines.map((mm) => (
                                                  <span key={mm} className={`tshoot-tag ${machineFilter.has(mm) ? 'active' : ''}`}>{mm}</span>
                                                ))}
                                              </div>
                                            )}
                                            {!isOpen && e.bodyText && (
                                              <div
                                                className="tshoot-history-work tshoot-history-preview"
                                                dangerouslySetInnerHTML={{ __html: highlightText(preview + (e.bodyText.length > 240 ? '…' : ''), query) }}
                                              />
                                            )}
                                            {isOpen && e.body && e.body.length > 0 && (
                                              <div className="tshoot-history-work">
                                                {e.body.map((line, i) => {
                                                  const html = highlightHtml(renderInline(line), query);
                                                  return (
                                                    <p
                                                      key={i}
                                                      style={{ margin: '0 0 6px' }}
                                                      dangerouslySetInnerHTML={{ __html: html }}
                                                    />
                                                  );
                                                })}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
