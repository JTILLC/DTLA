import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Sun, Moon, ChevronDown, BookOpen, History, Filter, MapPin, Mail, Paperclip, Layers } from 'lucide-react';
import rawMarkdown from './troubleshooting.md?raw';
import serviceLog from './serviceLog.json';
import emailData from './emails.json';
import { extractMachines, buildMachineList } from './facets';

const THEME_KEY = 'jti-troubleshoot-theme';
const VIEW_KEY = 'jti-troubleshoot-view';

// Attachment kinds for the Emails filter. Photos of a fault are by far the most
// common attachment, so they are worth separating from paperwork.
const ATTACHMENT_KINDS = [
  { id: 'image', label: 'Photos', exts: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.heic', '.tif', '.tiff', '.webp'] },
  { id: 'pdf', label: 'PDFs', exts: ['.pdf'] },
  { id: 'doc', label: 'Docs', exts: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.rtf'] },
  { id: 'media', label: 'Video', exts: ['.mov', '.mp4', '.avi', '.wmv', '.m4v'] },
];

function attachmentKind(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'other';
  const ext = filename.slice(dot).toLowerCase();
  const hit = ATTACHMENT_KINDS.find((k) => k.exts.includes(ext));
  return hit ? hit.id : 'other';
}

function formatEmailDate(iso) {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  return `${name}|${city}|${state}`;
}

const MONTH_ORDER = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parsePeriod(period) {
  if (!period) return { year: 0, month: 0, monthName: 'Unknown' };
  const parts = period.trim().split(/\s+/);
  const monthName = parts[0] || 'Unknown';
  const year = parseInt(parts[1], 10) || 0;
  const month = MONTH_ORDER[monthName.toLowerCase()] ?? 0;
  return { year, month, monthName };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Visits are recorded per month ("April 2008"), emails carry a full timestamp.
// The combined timeline groups on month, so emails get folded down to match.
function isoToPeriod(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

// Most visit entries open with a date range like "04/21/2008 – 04/22/2008".
// Pulling the day out lets visits interleave with emails inside a month rather
// than all sinking to the bottom of it.
const VISIT_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;

function visitTimestamp(entry) {
  const first = (entry.body && entry.body[0]) || '';
  const m = VISIT_DATE_RE.exec(first);
  if (m) {
    const t = new Date(+m[3], +m[1] - 1, +m[2]).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const { year, month } = parsePeriod(entry.period);
  return new Date(year || 1970, month || 0, 1).getTime();
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

export default function App() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
  });
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || 'reference'; } catch { return 'reference'; }
  });
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [customerKeyFilter, setCustomerKeyFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [collapsedYears, setCollapsedYears] = useState(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState(new Set());
  const [expandedThreads, setExpandedThreads] = useState(new Set());
  // '' = any thread; 'any' = must have at least one file; otherwise a kind id.
  const [attachmentFilter, setAttachmentFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'visits' | 'emails'
  const periodsInitializedRef = useRef(false);
  const sectionRefs = useRef({});

  const { intro, sections } = useMemo(() => parseMarkdown(rawMarkdown), []);

  // Enrich service log entries with machine tags + searchable blob.
  const logEntries = useMemo(() => {
    return (serviceLog.entries || []).map((e, idx) => {
      const bodyText = (e.body || []).join(' ');
      return {
        ...e,
        idx,
        bodyText,
        machines: extractMachines(`${e.customer} ${bodyText}`),
        key: customerKey(e.customer, e.city, e.state),
      };
    });
  }, []);

  const customerOptions = useMemo(() => {
    const map = new Map();
    for (const c of serviceLog.customers || []) {
      map.set(customerKey(c.customer, c.city, c.state), c);
    }
    return [...map.values()];
  }, []);

  const stateOptions = useMemo(() => {
    const set = new Set();
    customerOptions.forEach((c) => set.add(c.state));
    return [...set].sort();
  }, [customerOptions]);

  const filteredCustomerOptions = useMemo(() => {
    if (!stateFilter) return customerOptions;
    return customerOptions.filter((c) => c.state === stateFilter);
  }, [customerOptions, stateFilter]);

  // Email threads pulled from the Outlook backup.pst export. Tagged with the
  // same machine tokens as the reference and visit log so one filter spans all
  // three views.
  const emailThreads = useMemo(() => {
    return (emailData.threads || []).map((t) => {
      const bodyText = t.messages.map((m) => m.body).join('\n');
      const files = t.messages.flatMap((m) => m.attachments);
      const blob = `${t.subject} ${t.participants.join(' ')} ${t.partNumbers.join(' ')} ${bodyText} ${files.join(' ')}`;
      return {
        ...t,
        bodyText,
        files,
        attachmentKinds: new Set(files.map(attachmentKind)),
        searchText: blob.toLowerCase(),
        machines: extractMachines(blob),
      };
    });
  }, []);

  const allSymptoms = useMemo(() => sections.flatMap((s) => s.symptoms), [sections]);
  const machineList = useMemo(
    () => buildMachineList(allSymptoms, logEntries, emailThreads),
    [allSymptoms, logEntries, emailThreads]
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

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
    setAttachmentFilter('');
    setSourceFilter('all');
  };

  const customerNameForKey = (key) => {
    const opt = customerOptions.find((c) => customerKey(c.customer, c.city, c.state) === key);
    return opt ? `${opt.customer} — ${opt.city}, ${opt.state}` : '';
  };

  const customerNameLowerForKey = (key) => {
    const opt = customerOptions.find((c) => customerKey(c.customer, c.city, c.state) === key);
    return opt ? opt.customer.toLowerCase() : '';
  };

  // Reference filtering
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

  // History (visit log) filtering
  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logEntries.filter((e) => {
      if (customerKeyFilter && e.key !== customerKeyFilter) return false;
      if (stateFilter && e.state !== stateFilter) return false;
      if (machineFilter.size > 0 && !e.machines.some((m) => machineFilter.has(m))) return false;
      if (q) {
        const blob = `${e.customer} ${e.city} ${e.state} ${e.period} ${e.bodyText}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [logEntries, query, customerKeyFilter, stateFilter, machineFilter]);

  // Email filtering. There is no structured customer/state field on an email,
  // so those filters fall back to a text match on the thread body.
  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cust = customerKeyFilter ? customerNameLowerForKey(customerKeyFilter) : '';
    return emailThreads.filter((t) => {
      if (attachmentFilter === 'any' && t.attachmentCount === 0) return false;
      if (attachmentFilter && attachmentFilter !== 'any' && !t.attachmentKinds.has(attachmentFilter)) return false;
      if (machineFilter.size > 0 && !t.machines.some((m) => machineFilter.has(m))) return false;
      if (cust && !t.searchText.includes(cust)) return false;
      if (stateFilter && !t.searchText.includes(stateFilter.toLowerCase())) return false;
      if (q && !t.searchText.includes(q)) return false;
      return true;
    });
  }, [emailThreads, query, customerKeyFilter, stateFilter, machineFilter, attachmentFilter, customerOptions]);

  // Combined timeline: the master service list and the email archive in one
  // chronological stream. Both sides reuse the already-filtered lists, so every
  // filter and the search box apply here exactly as they do on their own tabs.
  const timelineItems = useMemo(() => {
    const items = [];
    // An attachment filter is inherently email-only — visits carry no files, so
    // leaving them in would look like the filter had silently failed.
    const wantVisits = sourceFilter !== 'emails' && !attachmentFilter;
    const wantEmails = sourceFilter !== 'visits';
    if (wantVisits) {
      for (const e of filteredEntries) {
        items.push({ kind: 'visit', id: `v${e.idx}`, period: e.period, ts: visitTimestamp(e), entry: e });
      }
    }
    if (wantEmails) {
      for (const t of filteredThreads) {
        items.push({
          kind: 'email',
          id: `e-${t.key}`,
          period: isoToPeriod(t.end) || 'Unknown',
          ts: new Date(t.end).getTime() || 0,
          thread: t,
        });
      }
    }
    items.sort((a, b) => b.ts - a.ts);
    return items;
  }, [filteredEntries, filteredThreads, sourceFilter, attachmentFilter]);

  const timelineGrouped = useMemo(() => groupByPeriod(timelineItems), [timelineItems]);
  const timelineCounts = useMemo(() => ({
    visits: timelineItems.filter((i) => i.kind === 'visit').length,
    emails: timelineItems.filter((i) => i.kind === 'email').length,
  }), [timelineItems]);

  // Counts for the attachment pills, so an empty option is visible up front.
  const attachmentCounts = useMemo(() => {
    const counts = { any: 0 };
    ATTACHMENT_KINDS.forEach((k) => { counts[k.id] = 0; });
    for (const t of emailThreads) {
      if (t.attachmentCount > 0) counts.any += 1;
      ATTACHMENT_KINDS.forEach((k) => {
        if (t.attachmentKinds.has(k.id)) counts[k.id] += 1;
      });
    }
    return counts;
  }, [emailThreads]);

  const toggleThread = (key) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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
  // The attachment filter only applies to the Emails view, so it only counts
  // toward the badge there — otherwise the badge would advertise a control the
  // current tab doesn't show.
  const activeFilterCount =
    (customerKeyFilter ? 1 : 0) + (stateFilter ? 1 : 0) + machineFilter.size +
    ((view === 'emails' || view === 'timeline') && attachmentFilter ? 1 : 0) +
    (view === 'timeline' && sourceFilter !== 'all' ? 1 : 0);

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

  const groupedEntries = useMemo(() => groupByPeriod(filteredEntries), [filteredEntries]);

  // On first render with data, collapse every year/month so navigation starts compact.
  useEffect(() => {
    if (periodsInitializedRef.current) return;
    if (logEntries.length === 0) return;
    const allGroups = groupByPeriod(logEntries);
    const years = new Set(allGroups.map((g) => g.year));
    const months = new Set();
    allGroups.forEach((g) => g.months.forEach((m) => months.add(`${g.year}|${m.monthName}`)));
    setCollapsedYears(years);
    setCollapsedMonths(months);
    periodsInitializedRef.current = true;
  }, [logEntries]);

  const isFiltering = !!query || activeFilterCount > 0;
  const effectivelyCollapsedYear = (year) => !isFiltering && collapsedYears.has(year);
  const effectivelyCollapsedMonth = (year, monthName) =>
    !isFiltering && collapsedMonths.has(`${year}|${monthName}`);

  const handleTocClick = (e, id) => {
    e.preventDefault();
    const el = sectionRefs.current[id];
    if (!el) return;
    setCollapsed((c) => ({ ...c, [id]: false }));
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveId(id);
  };

  // Card renderers are shared by the Visit Log, Emails and Timeline views so the
  // three tabs cannot drift apart visually.
  const renderVisitCard = (e) => {
    const isOpen = expanded.has(e.idx);
    const preview = e.bodyText.slice(0, 240);
    return (
      <div key={`v${e.idx}`} className="history-card">
        <div className="history-head" onClick={() => toggleEntry(e.idx)} style={{ cursor: 'pointer' }}>
          <div>
            <div
              className="history-customer"
              dangerouslySetInnerHTML={{ __html: highlightText(e.customer, query) }}
            />
            <div className="history-sub">
              <MapPin size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
              <span dangerouslySetInnerHTML={{ __html: highlightText(`${e.city}, ${e.state}`, query) }} />
            </div>
          </div>
          <div className="history-meta">
            <ChevronDown size={14} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
          </div>
        </div>
        {e.machines.length > 0 && (
          <div className="symptom-tags">
            {e.machines.map((mm) => (
              <span key={mm} className={`tag ${machineFilter.has(mm) ? 'active' : ''}`}>{mm}</span>
            ))}
          </div>
        )}
        {!isOpen && e.bodyText && (
          <div
            className="history-work history-preview"
            dangerouslySetInnerHTML={{ __html: highlightText(preview + (e.bodyText.length > 240 ? '…' : ''), query) }}
          />
        )}
        {isOpen && e.body && e.body.length > 0 && (
          <div className="history-work">
            {e.body.map((line, i) => (
              <p
                key={i}
                style={{ margin: '0 0 6px' }}
                dangerouslySetInnerHTML={{ __html: highlightText(line, query) }}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderEmailCard = (t) => {
    const isOpen = expandedThreads.has(t.key);
    const preview = t.messages[0].body.slice(0, 240);
    return (
      <div key={`e-${t.key}`} className="email-thread">
        <div className="email-head" onClick={() => toggleThread(t.key)}>
          <div className="email-head-main">
            <div
              className="email-subject"
              dangerouslySetInnerHTML={{ __html: highlightText(t.subject, query) }}
            />
            <div className="email-sub">
              <span>{formatEmailDate(t.end)}</span>
              <span className="email-dot">·</span>
              <span dangerouslySetInnerHTML={{ __html: highlightText(t.participants.join(', '), query) }} />
              {t.count > 1 && (
                <>
                  <span className="email-dot">·</span>
                  <span>{t.count} msgs</span>
                </>
              )}
              {t.attachmentCount > 0 && (
                <>
                  <span className="email-dot">·</span>
                  <span><Paperclip size={11} style={{ verticalAlign: '-1px' }} /> {t.attachmentCount}</span>
                </>
              )}
            </div>
          </div>
          <ChevronDown
            size={14}
            style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
          />
        </div>

        {(t.machines.length > 0 || t.partNumbers.length > 0) && (
          <div className="symptom-tags">
            {t.machines.map((mm) => (
              <span key={mm} className={`tag ${machineFilter.has(mm) ? 'active' : ''}`}>{mm}</span>
            ))}
            {t.partNumbers.map((pn) => (
              <span key={pn} className="tag tag-pn">{pn}</span>
            ))}
          </div>
        )}

        {!isOpen && (
          <div
            className="history-work history-preview"
            dangerouslySetInnerHTML={{ __html: highlightText(preview + (t.messages[0].body.length > 240 ? '…' : ''), query) }}
          />
        )}

        {isOpen && (
          <div className="email-messages">
            {t.messages.map((m) => (
              <div key={m.id} className="email-message">
                <div className="email-message-head">
                  <strong dangerouslySetInnerHTML={{ __html: highlightText(m.from, query) }} />
                  <span className="email-dot">·</span>
                  <span>{formatEmailDate(m.date)}</span>
                </div>
                <div
                  className="email-body"
                  dangerouslySetInnerHTML={{ __html: highlightText(m.body, query) }}
                />
                {m.attachments.length > 0 && (
                  <div className="email-attachments">
                    {m.attachments.map((a, i) => (
                      <span key={i} className="email-attachment">
                        <Paperclip size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />{a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const filtersPanel = (
    <div className="filters-panel">
      <div className="filter-group">
        <div className="filter-label">State</div>
        <select className="filter-select" value={stateFilter} onChange={(e) => {
          setStateFilter(e.target.value);
          // If currently selected customer is in another state, clear it.
          if (e.target.value && customerKeyFilter) {
            const opt = customerOptions.find((c) => customerKey(c.customer, c.city, c.state) === customerKeyFilter);
            if (opt && opt.state !== e.target.value) setCustomerKeyFilter('');
          }
        }}>
          <option value="">All states</option>
          {stateOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="filter-group">
        <div className="filter-label">Customer ({filteredCustomerOptions.length})</div>
        <select
          className="filter-select"
          value={customerKeyFilter}
          onChange={(e) => setCustomerKeyFilter(e.target.value)}
        >
          <option value="">All customers</option>
          {filteredCustomerOptions
            .slice()
            .sort((a, b) => a.customer.localeCompare(b.customer))
            .map((c) => {
              const k = customerKey(c.customer, c.city, c.state);
              return (
                <option key={k} value={k}>
                  {c.customer} — {c.city}, {c.state} ({c.count})
                </option>
              );
            })}
        </select>
      </div>
      {view === 'timeline' && (
        <div className="filter-group">
          <div className="filter-label">Source</div>
          <div className="machine-pills">
            {[
              { id: 'all', label: 'Everything' },
              { id: 'visits', label: 'Visits' },
              { id: 'emails', label: 'Emails' },
            ].map((s) => (
              <button
                key={s.id}
                className={`pill ${sourceFilter === s.id ? 'active' : ''}`}
                onClick={() => setSourceFilter(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {attachmentFilter && sourceFilter !== 'emails' && (
            <div className="filter-hint">Attachment filter hides visits — they carry no files.</div>
          )}
        </div>
      )}
      {(view === 'emails' || view === 'timeline') && (
        <div className="filter-group">
          <div className="filter-label">Attachments</div>
          <div className="machine-pills">
            <button
              className={`pill ${attachmentFilter === 'any' ? 'active' : ''}`}
              onClick={() => setAttachmentFilter(attachmentFilter === 'any' ? '' : 'any')}
            >
              <Paperclip size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
              Has files <span className="pill-count">{attachmentCounts.any}</span>
            </button>
            {ATTACHMENT_KINDS.map((k) => (
              <button
                key={k.id}
                className={`pill ${attachmentFilter === k.id ? 'active' : ''}`}
                disabled={attachmentCounts[k.id] === 0}
                onClick={() => setAttachmentFilter(attachmentFilter === k.id ? '' : k.id)}
              >
                {k.label} <span className="pill-count">{attachmentCounts[k.id]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="filter-group">
        <div className="filter-label">Machine model</div>
        <div className="machine-pills">
          {machineList.length === 0 && <div className="filter-hint">No models detected.</div>}
          {machineList.map((m) => (
            <button
              key={m.name}
              className={`pill ${machineFilter.has(m.name) ? 'active' : ''}`}
              onClick={() => toggleMachine(m.name)}
            >
              {m.name} <span className="pill-count">{m.count}</span>
            </button>
          ))}
        </div>
      </div>
      {activeFilterCount > 0 && (
        <button className="link-btn" onClick={clearFilters}>Clear filters</button>
      )}
    </div>
  );

  return (
    <div>
      <header className="shell-header">
        <div className="shell-header-row">
          <span className="brand">JTI<span className="brand-suffix"> Troubleshoot</span></span>
          <div className="search-wrap">
            <Search size={16} className="search-icon" />
            <input
              className="search-input"
              type="search"
              placeholder={
                view === 'history' ? 'Search visit notes…'
                  : view === 'emails' ? 'Search emails, senders, part numbers…'
                  : view === 'timeline' ? 'Search visits and emails…'
                  : 'Search symptoms, causes, fixes…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={16} />
              </button>
            )}
          </div>
          <button
            className="icon-btn filter-toggle"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Toggle filters"
            title="Filters"
          >
            <Filter size={18} />
            {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
          </button>
          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="tabs">
          <button className={`tab ${view === 'reference' ? 'active' : ''}`} onClick={() => setView('reference')}>
            <BookOpen size={14} /> Reference
          </button>
          <button className={`tab ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')}>
            <Layers size={14} /> Timeline
            <span className="tab-count">{logEntries.length + emailThreads.length}</span>
          </button>
          <button className={`tab ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
            <History size={14} /> Visit Log
            <span className="tab-count">{logEntries.length}</span>
          </button>
          <button className={`tab ${view === 'emails' ? 'active' : ''}`} onClick={() => setView('emails')}>
            <Mail size={14} /> Emails
            <span className="tab-count">{emailThreads.length}</span>
          </button>
        </div>
        {showFilters && <div className="filters-mobile">{filtersPanel}</div>}
      </header>

      <div className="shell-body">
        <aside className="sidebar">
          {view === 'reference' && (
            <nav className="toc" aria-label="Sections">
              <div className="toc-title">Sections</div>
              {sections.map((sec) => (
                <a
                  key={sec.id}
                  href={`#${sec.id}`}
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
          <main className="content">
            <div className="intro">
              <h1>Service Work Troubleshooting</h1>
              {intro && <p style={{ margin: 0 }}>{intro}</p>}
            </div>

            {(query || activeFilterCount > 0) && (
              <div className="results-meta">
                {totalRefMatches > 0
                  ? `${totalRefMatches} symptom${totalRefMatches === 1 ? '' : 's'} match`
                  : 'No reference matches'}
                {customerKeyFilter && ` · ${customerNameForKey(customerKeyFilter)}`}
                {stateFilter && ` · state: ${stateFilter}`}
                {machineFilter.size > 0 && ` · ${[...machineFilter].join(', ')}`}
              </div>
            )}

            {filteredSections.length === 0 ? (
              <div className="empty">
                Nothing here matches. Try the Visit Log tab — it has the raw service notes for this customer.
              </div>
            ) : (
              filteredSections.map((sec) => {
                const isCollapsed = !!collapsed[sec.id];
                return (
                  <section
                    key={sec.id}
                    id={sec.id}
                    ref={(el) => (sectionRefs.current[sec.id] = el)}
                    className={`section ${isCollapsed ? 'collapsed' : ''}`}
                  >
                    <h2 onClick={() => toggleCollapsed(sec.id)}>
                      <ChevronDown size={18} className="chevron" />
                      {sec.title}
                    </h2>
                    <div className="section-body">
                      {sec.symptoms.map((sym, idx) => (
                        <div key={idx} className="symptom">
                          <div
                            className="symptom-title"
                            dangerouslySetInnerHTML={{
                              __html: highlightHtml(escapeHtml(sym.title), query),
                            }}
                          />
                          {sym.machines.length > 0 && (
                            <div className="symptom-tags">
                              {sym.machines.map((m) => (
                                <span key={m} className={`tag ${machineFilter.has(m) ? 'active' : ''}`}>{m}</span>
                              ))}
                            </div>
                          )}
                          <div
                            className="symptom-content"
                            dangerouslySetInnerHTML={{
                              __html: highlightHtml(sym.html, query),
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </main>
        ) : view === 'timeline' ? (
          <main className="content">
            <div className="intro">
              <h1>Timeline</h1>
              <p style={{ margin: 0 }}>
                Every service visit from <code>Service Work Master List.docx</code> and every
                troubleshooting email from the Outlook <code>backup.pst</code> archive, merged into
                one chronology.
              </p>
            </div>

            <div className="results-meta">
              {`${timelineCounts.visits} visit${timelineCounts.visits === 1 ? '' : 's'} · ${timelineCounts.emails} email thread${timelineCounts.emails === 1 ? '' : 's'}`}
              {query && ` matching "${query}"`}
              {customerKeyFilter && ` · ${customerNameForKey(customerKeyFilter)}`}
              {stateFilter && ` · state: ${stateFilter}`}
              {machineFilter.size > 0 && ` · ${[...machineFilter].join(', ')}`}
              {attachmentFilter && ` · ${attachmentFilter === 'any'
                ? 'with attachments'
                : ATTACHMENT_KINDS.find((k) => k.id === attachmentFilter)?.label}`}
            </div>

            {timelineItems.length === 0 ? (
              <div className="empty">Nothing matches in either source.</div>
            ) : (
              <>
                <div className="period-actions">
                  <button className="link-btn" onClick={expandAllPeriods}>Expand all</button>
                  <span className="period-actions-sep">·</span>
                  <button className="link-btn" onClick={collapseAllPeriods}>Collapse all</button>
                  {isFiltering && <span className="filter-hint" style={{ marginLeft: 'auto' }}>Auto-expanded while filtering</span>}
                </div>
                <div className="period-list">
                  {timelineGrouped.map((g) => {
                    const yearCollapsed = effectivelyCollapsedYear(g.year);
                    return (
                      <div key={g.year} className="period-year">
                        <button
                          className={`period-year-head ${yearCollapsed ? 'collapsed' : ''}`}
                          onClick={() => toggleYear(g.year)}
                        >
                          <ChevronDown size={16} className="chevron" />
                          <span className="period-year-label">{g.year || 'Unknown year'}</span>
                          <span className="period-count">{g.total} item{g.total === 1 ? '' : 's'}</span>
                        </button>
                        {!yearCollapsed && (
                          <div className="period-months">
                            {g.months.map((m) => {
                              const monthCollapsed = effectivelyCollapsedMonth(g.year, m.monthName);
                              return (
                                <div key={m.monthName} className="period-month">
                                  <button
                                    className={`period-month-head ${monthCollapsed ? 'collapsed' : ''}`}
                                    onClick={() => toggleMonth(`${g.year}|${m.monthName}`)}
                                  >
                                    <ChevronDown size={14} className="chevron" />
                                    <span>{m.monthName}</span>
                                    <span className="period-count">{m.entries.length}</span>
                                  </button>
                                  {!monthCollapsed && (
                                    <div className="history-list">
                                      {m.entries.map((item) => (
                                        <div key={item.id} className="timeline-item">
                                          <span className={`source-chip ${item.kind}`}>
                                            {item.kind === 'visit'
                                              ? <><MapPin size={10} /> Visit</>
                                              : <><Mail size={10} /> Email</>}
                                          </span>
                                          {item.kind === 'visit'
                                            ? renderVisitCard(item.entry)
                                            : renderEmailCard(item.thread)}
                                        </div>
                                      ))}
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
        ) : view === 'emails' ? (
          <main className="content">
            <div className="intro">
              <h1>Emails</h1>
              <p style={{ margin: 0 }}>
                {emailData.messageCount} troubleshooting emails in {emailData.threadCount} threads,
                filtered from {emailData.sourceCount.toLocaleString()} messages in the Outlook{' '}
                <code>backup.pst</code> archive.
              </p>
            </div>

            <div className="results-meta">
              {`${filteredThreads.length} of ${emailThreads.length} threads`}
              {query && ` matching "${query}"`}
              {attachmentFilter && ` · ${attachmentFilter === 'any'
                ? 'with attachments'
                : ATTACHMENT_KINDS.find((k) => k.id === attachmentFilter)?.label}`}
              {customerKeyFilter && ` · ${customerNameForKey(customerKeyFilter)}`}
              {stateFilter && ` · state: ${stateFilter}`}
              {machineFilter.size > 0 && ` · ${[...machineFilter].join(', ')}`}
            </div>

            {filteredThreads.length === 0 ? (
              <div className="empty">No matching emails.</div>
            ) : (
              <div className="email-list">
                {filteredThreads.map(renderEmailCard)}
              </div>
            )}
          </main>
        ) : (
          <main className="content">
            <div className="intro">
              <h1>Visit Log</h1>
              <p style={{ margin: 0 }}>
                {serviceLog.totalEntries} service visits across {serviceLog.totalCustomers} customer locations,
                extracted from <code>Service Work Master List.docx</code>.
              </p>
            </div>

            <div className="results-meta">
              {`${filteredEntries.length} of ${logEntries.length} visits`}
              {query && ` matching "${query}"`}
              {customerKeyFilter && ` · ${customerNameForKey(customerKeyFilter)}`}
              {stateFilter && ` · state: ${stateFilter}`}
              {machineFilter.size > 0 && ` · ${[...machineFilter].join(', ')}`}
            </div>

            {filteredEntries.length === 0 ? (
              <div className="empty">No matching visits.</div>
            ) : (
              <>
                <div className="period-actions">
                  <button className="link-btn" onClick={expandAllPeriods}>Expand all</button>
                  <span className="period-actions-sep">·</span>
                  <button className="link-btn" onClick={collapseAllPeriods}>Collapse all</button>
                  {isFiltering && <span className="filter-hint" style={{ marginLeft: 'auto' }}>Auto-expanded while filtering</span>}
                </div>
                <div className="period-list">
                  {groupedEntries.map((g) => {
                    const yearCollapsed = effectivelyCollapsedYear(g.year);
                    return (
                      <div key={g.year} className="period-year">
                        <button
                          className={`period-year-head ${yearCollapsed ? 'collapsed' : ''}`}
                          onClick={() => toggleYear(g.year)}
                        >
                          <ChevronDown size={16} className="chevron" />
                          <span className="period-year-label">{g.year || 'Unknown year'}</span>
                          <span className="period-count">{g.total} visit{g.total === 1 ? '' : 's'}</span>
                        </button>
                        {!yearCollapsed && (
                          <div className="period-months">
                            {g.months.map((m) => {
                              const monthCollapsed = effectivelyCollapsedMonth(g.year, m.monthName);
                              return (
                                <div key={m.monthName} className="period-month">
                                  <button
                                    className={`period-month-head ${monthCollapsed ? 'collapsed' : ''}`}
                                    onClick={() => toggleMonth(`${g.year}|${m.monthName}`)}
                                  >
                                    <ChevronDown size={14} className="chevron" />
                                    <span>{m.monthName}</span>
                                    <span className="period-count">{m.entries.length}</span>
                                  </button>
                                  {!monthCollapsed && (
                                    <div className="history-list">
                                      {m.entries.map(renderVisitCard)}
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
