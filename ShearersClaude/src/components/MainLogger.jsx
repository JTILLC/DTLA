import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { getDatabase, ref, set, get } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { app } from '../firebaseConfig';
import { useDates as useDatesContext } from '../context/DatesContext';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const database = getDatabase(app);
const auth = getAuth(app);

// --- Cloud paths (namespaced) ---
const DB_ROOT = 'jti-downtime';
const MAINLOGGER_PATH = `${DB_ROOT}/main-logger`;
const MAINLOGGER_DATA_PATH = `${MAINLOGGER_PATH}/data`;

const HEADS_PER_LINE = 14;

const makeDefaultHeads = () =>
  Array.from({ length: HEADS_PER_LINE }, (_, i) => ({
    head: i + 1,
    offline: 'Active',
    issues: [],  // Array of {type: string, repaired: string, replacementReason: string}
    notes: ''
  }));

// Migrate old single-issue format to new multi-issue format
const migrateHeadData = (head) => {
  // If already has issues array, return as-is
  if (head.issues && Array.isArray(head.issues)) {
    return head;
  }

  // Convert old format to new format
  const migratedHead = {
    head: head.head,
    offline: head.offline || 'Active',
    issues: [],
    notes: head.notes || ''
  };

  // If there was an old issue field and it wasn't "None", convert it
  if (head.issue && head.issue !== 'None') {
    migratedHead.issues.push({
      type: head.issue,
      repaired: head.repaired || 'Not Fixed',
      replacementReason: ''
    });
  }

  return migratedHead;
};

const issueTypes = [
  'WDU Replacement','Chute','Operator','Load Cell','Detached Head','Stepper Motor Error','Hopper Issues','Installed Wrong','Other'
];

const toYmd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const newestFiveDates = () => {
  const base = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    return toYmd(d);
  });
};

export default function MainLogger({ data, setData }) {
  // Use DatesContext
  const { dates: contextDates, setDates: setContextDates } = useDatesContext();

  // Local persistence (autosave)
  const [localData, setLocalData] = useState(() => {
    const saved = localStorage.getItem('downtimeLoggerData');
    if (!saved) return {};

    const parsedData = JSON.parse(saved);
    // Migrate data on load
    const migratedData = {};
    Object.keys(parsedData).forEach(date => {
      migratedData[date] = {};
      Object.keys(parsedData[date]).forEach(line => {
        const lineData = parsedData[date][line];
        const migratedHeads = (lineData.heads || []).map(head => migrateHeadData(head));
        migratedData[date][line] = {
          ...lineData,
          heads: migratedHeads
        };
      });
    });
    return migratedData;
  });

  const useData = data ?? localData;
  const useSetData = setData ?? setLocalData;
  const useDates = contextDates;
  const useSetDates = setContextDates;

  const { state } = useLocation();
  const [currentDay, setCurrentDay] = useState(() => state?.selectedDate || useDates[0]);
  const [currentLine, setCurrentLine] = useState(state?.selectedLine || 'Line 1');
  const [expandedDays, setExpandedDays] = useState(() => new Set([state?.selectedDate || useDates[0]]));
  const [saveStatus, setSaveStatus] = useState('');
  const [authError, setAuthError] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false); // NEW: actions dropdown
  const [viewMode, setViewMode] = useState(() => {
    // Default to table on desktop, cards on mobile
    return window.innerWidth <= 768 ? 'cards' : 'table';
  });
  const [showActiveHeads, setShowActiveHeads] = useState(false); // Collapse active heads by default

  // Firebase anon auth
  useEffect(() => {
    signInAnonymously(auth).then(() => setAuthError(null)).catch((e) => setAuthError(e.message));
  }, []);

  // Keep exactly 5 dates
  useEffect(() => {
    if (!Array.isArray(useDates) || useDates.length !== 5) {
      const fixed = newestFiveDates();
      useSetDates(fixed);
    }
  }, [useDates, useSetDates]);

  // Keep currentDay valid when dates change
  useEffect(() => {
    if (currentDay && !useDates.includes(currentDay)) {
      setCurrentDay(useDates[0]);
      setExpandedDays(new Set([useDates[0]]));
    }
  }, [useDates, currentDay]);

  // Local autosave
  useEffect(() => {
    try { localStorage.setItem('downtimeLoggerData', JSON.stringify(useData)); } catch {}
  }, [useData]);

  const showSave = (msg) => {
    setSaveStatus(msg);
    setTimeout(() => setSaveStatus(''), 1200);
  };

  // Cloud Save / Load
  const handleSaveToCloud = async () => {
    try {
      await set(ref(database, MAINLOGGER_DATA_PATH), { data: useData, dates: useDates });
      showSave('Saved');
    } catch (e) {
      console.error(e);
      showSave('Failed');
    }
  };

  const handleLoadFromCloud = async () => {
    try {
      const snap = await get(ref(database, MAINLOGGER_DATA_PATH));
      if (!snap.exists()) return alert('No cloud data');
      const payload = snap.val() || {};
      const cloudData = payload.data || {};
      const cloudDates = Array.isArray(payload.dates) && payload.dates.length === 5
        ? payload.dates
        : Object.keys(cloudData).sort((a,b)=>new Date(b)-new Date(a)).slice(0,5);

      // Migrate old data format to new format
      const migratedData = {};
      Object.keys(cloudData).forEach(date => {
        migratedData[date] = {};
        Object.keys(cloudData[date]).forEach(line => {
          const lineData = cloudData[date][line];
          const migratedHeads = (lineData.heads || []).map(head => migrateHeadData(head));
          migratedData[date][line] = {
            ...lineData,
            heads: migratedHeads
          };
        });
      });

      useSetData(migratedData);
      useSetDates(cloudDates);
      setCurrentDay(cloudDates[0]);
      setExpandedDays(new Set([cloudDates[0]]));
      alert('Loaded from cloud');
    } catch (e) {
      alert('Load failed: ' + e.message);
    }
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imp = JSON.parse(reader.result);
        const importedData = imp?.data ?? imp;
        if (!importedData || typeof importedData !== 'object') throw new Error('Invalid payload');
        useSetData(importedData);
        const keys = Object.keys(importedData).sort((a,b)=>new Date(b)-new Date(a));
        const fixed = keys.slice(0,5);
        useSetDates(fixed.length===5 ? fixed : newestFiveDates());
        setCurrentDay((fixed[0] || newestFiveDates()[0]));
        setExpandedDays(new Set([fixed[0] || newestFiveDates()[0]]));
        alert('Imported!');
      } catch (err) {
        alert('Invalid file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ data: useData, dates: useDates }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `downtime-${useDates?.[0] || toYmd(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getDayData = (date) => useData?.[date] || {};
  const updateDay = (date, updates) => {
    useSetData((prev) => ({
      ...prev,
      [date]: { ...(prev?.[date] || {}), ...updates }
    }));
  };

  const handleEditDate = (index, newDate) => {
    const oldDate = useDates[index];
    if (!newDate || oldDate === newDate) return;

    useSetData((prev) => {
      const next = { ...prev };
      if (next[oldDate]) {
        next[newDate] = { ...(next[newDate] || {}), ...next[oldDate] };
        delete next[oldDate];
      }
      return next;
    });

    const copy = [...useDates];
    copy[index] = newDate;
    copy.sort((a, b) => new Date(b) - new Date(a));
    useSetDates(copy);

    if (currentDay === oldDate) setCurrentDay(newDate);
    setExpandedDays((prev) => {
      const s = new Set(prev);
      s.delete(oldDate); s.add(newDate);
      return s;
    });
  };

  const toggleDay = (date) => {
    setExpandedDays((prev) => {
      const n = new Set(prev);
      n.has(date) ? n.delete(date) : n.add(date);
      return n;
    });
    setCurrentDay(date);
  };

  const allLines = Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`);
  const prevLine = () =>
    setCurrentLine(allLines[(allLines.indexOf(currentLine) - 1 + allLines.length) % allLines.length]);
  const nextLine = () =>
    setCurrentLine(allLines[(allLines.indexOf(currentLine) + 1) % allLines.length]);

  const entryFor = (date) =>
    (getDayData(date)[currentLine]) || { heads: makeDefaultHeads(), machineNotes: '', running: false };

  const getRowClass = (h) => {
    if (h.offline === 'Active') return 'bg-green-200 dark:bg-green-700';

    const issues = h.issues || [];

    // Purple if any WDU issue
    if (issues.some(iss => iss.type === 'WDU Replacement')) {
      return 'bg-purple-300 dark:bg-purple-700';
    }

    // Orange if all issues are fixed
    if (issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed')) {
      return 'bg-orange-200 dark:bg-orange-600';
    }

    // Red if offline with unfixed issues
    return 'bg-red-200 dark:bg-red-700';
  };

  // Categorize heads: priority (offline/has issues/has notes) vs active with no issues/notes
  const categorizeHeads = (heads) => {
    const priority = [];
    const activeEmpty = [];

    heads.forEach((h, idx) => {
      const issues = h.issues || [];
      const hasIssues = issues.length > 0;
      const hasNotes = (h.notes || '').trim() !== '';
      const isOffline = h.offline !== 'Active';

      if (isOffline || hasIssues || hasNotes) {
        priority.push({ ...h, originalIndex: idx });
      } else {
        activeEmpty.push({ ...h, originalIndex: idx });
      }
    });

    return { priority, activeEmpty };
  };

  // Reset helpers
  const resetLineForDate = (date) => {
    const dayData = getDayData(date);
    const existing = dayData[currentLine] || { running: false };
    updateDay(date, {
      [currentLine]: {
        ...existing,
        heads: makeDefaultHeads(),
        machineNotes: ''
      }
    });
  };

  const resetAllForDate = (date) => {
    const newLines = {};
    for (let i = 1; i <= 39; i++) {
      const lineKey = `Line ${i}`;
      newLines[lineKey] = { heads: makeDefaultHeads(), machineNotes: '', running: false };
    }
    updateDay(date, newLines);
  };

  const resetAllDays = () => {
    const confirmed = confirm(
      'Reset ALL days and ALL lines back to default?\nThis clears heads & notes for every line on all 5 days, and sets Running = OFF everywhere.'
    );
    if (!confirmed) return;
    useSetData((prev) => {
      const next = { ...prev };
      (useDates || []).forEach((date) => {
        const dayObj = {};
        for (let i = 1; i <= 39; i++) {
          const lineKey = `Line ${i}`;
          dayObj[lineKey] = { heads: makeDefaultHeads(), machineNotes: '', running: false };
        }
        next[date] = dayObj;
      });
      return next;
    });
    showSave('All days reset');
  };

  // Head counts next to Line selector (current line / current day)
  const offlineCount = useMemo(() => {
    const heads = entryFor(currentDay).heads || makeDefaultHeads();
    return heads.filter(h => h.offline !== 'Active').length;
  }, [currentDay, currentLine, useData]);

  const fixedCount = useMemo(() => {
    const heads = entryFor(currentDay).heads || makeDefaultHeads();
    return heads.filter(h => {
      if (h.offline === 'Active') return false;
      const issues = h.issues || [];
      return issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
    }).length;
  }, [currentDay, currentLine, useData]);

  const notFixedCount = Math.max(0, offlineCount - fixedCount);

  const headsDownGraphData = useMemo(() => ({
    labels: useDates || [],
    datasets: [
      {
        label: 'Offline',
        data: (useDates || []).map((d) =>
          (entryFor(d).heads || makeDefaultHeads()).filter((h) => h.offline !== 'Active').length
        ),
        backgroundColor: '#EF4444'
      },
      {
        label: 'Fixed',
        data: (useDates || []).map((d) =>
          (entryFor(d).heads || makeDefaultHeads()).filter((h) => {
            if (h.offline === 'Active') return false;
            const issues = h.issues || [];
            return issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
          }).length
        ),
        backgroundColor: '#3B82F6'
      }
    ]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [useDates, currentLine, useData]);

  return (
    <div className="relative max-w-4xl mx-auto p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md md:p-4 sm:p-2">
      {/* fixed status badge */}
      {saveStatus && (
        <div className="absolute top-2 right-2 px-3 py-1 rounded text-white text-xs shadow bg-slate-700/90 pointer-events-none">
          {saveStatus}
        </div>
      )}

      <h2 className="text-2xl font-semibold text-center mb-4 text-gray-900 dark:text-gray-100 sm:text-xl">Downtime Logger</h2>

      {/* Top nav + cloud + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 relative">
        <div className="flex gap-2 flex-wrap">
          <Link to="/summary" className="px-4 py-2 bg-blue-500 text-white rounded text-sm">View Summary</Link>
          <Link to="/dashboard" className="px-4 py-2 bg-indigo-500 text-white rounded text-sm">Dashboard</Link>
          <Link to="/running" className="px-4 py-2 bg-purple-500 text-white rounded text-sm">Running</Link>
          <Link to="/issues-chart" className="px-4 py-2 bg-teal-500 text-white rounded text-sm">Issues Chart</Link>

          {/* Card/Table view toggle */}
          <div className="flex gap-1 border rounded">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 rounded text-sm transition-colors ${
                viewMode === 'table'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-2 rounded text-sm transition-colors ${
                viewMode === 'cards'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Cards
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label htmlFor="import-json" className="px-3 py-2 bg-green-600 text-white rounded text-sm cursor-pointer">Import</label>
          <input id="import-json" type="file" accept=".json" hidden onChange={handleImport} />
          <button onClick={handleExport} className="px-3 py-2 bg-blue-600 text-white rounded text-sm">Export</button>
          <button onClick={handleSaveToCloud} className="px-3 py-2 bg-indigo-600 text-white rounded text-sm">Save</button>
          <button onClick={handleLoadFromCloud} className="px-3 py-2 bg-cyan-600 text-white rounded text-sm">Load</button>

          {/* Actions dropdown (Reset*) */}
          <div className="relative">
            <button
              onClick={() => setActionsOpen((v) => !v)}
              className="px-3 py-2 bg-gray-200 rounded text-sm"
              title="Reset actions"
            >
              Actions ▾
            </button>
            {actionsOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white border rounded shadow z-20">
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    if (confirm(`Reset ${currentLine} for ${currentDay}? Heads & notes will be cleared.`)) {
                      resetLineForDate(currentDay);
                    }
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100"
                >
                  Reset Line (current day)
                </button>
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    if (confirm(`Reset ALL lines for ${currentDay}? Heads & notes will be cleared and Running set to OFF.`)) {
                      resetAllForDate(currentDay);
                    }
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100"
                >
                  Reset Day (all lines)
                </button>
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    resetAllDays();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 text-red-700"
                >
                  Reset ALL Days
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Head Toggle */}
      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          Quick Head Toggle - {currentLine} ({currentDay})
        </h3>
        <div className="grid grid-cols-7 gap-2 mb-4">
          {Array.from({ length: HEADS_PER_LINE }, (_, i) => {
            const currentEntry = entryFor(currentDay);
            const currentHeads = currentEntry.heads || makeDefaultHeads();
            const head = currentHeads[i];
            const isActive = head.offline === 'Active';
            const issues = head.issues || [];
            const hasWDU = issues.some(iss => iss.type === 'WDU Replacement');
            const allFixed = issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');

            let displayText = 'Active';
            let bgColor = 'bg-green-500';
            let textColor = 'text-white';

            if (!isActive) {
              if (hasWDU) {
                displayText = 'WDU';
                bgColor = 'bg-purple-500';
                textColor = 'text-white';
              } else if (allFixed) {
                displayText = 'Fixed';
                bgColor = 'bg-orange-500';
                textColor = 'text-white';
              } else {
                displayText = 'Offline';
                bgColor = 'bg-red-500';
                textColor = 'text-white';
              }
            }

            return (
              <button
                key={i}
                onClick={() => {
                  const dayData = getDayData(currentDay);
                  const entry = dayData[currentLine] || { heads: makeDefaultHeads(), machineNotes: '', running: false };
                  const newHeads = (entry.heads || makeDefaultHeads()).map((h, idx) =>
                    idx === i ? { ...h, offline: h.offline === 'Active' ? 'Offline' : 'Active' } : h
                  );
                  updateDay(currentDay, {
                    [currentLine]: { ...entry, heads: newHeads }
                  });
                }}
                className={`px-3 py-2 rounded border border-gray-300 dark:border-gray-600 ${bgColor} ${textColor} hover:opacity-80 transition-all`}
              >
                <div className="font-semibold text-sm">Head {i + 1}</div>
                <div className="text-xs mt-1">{displayText}</div>
              </button>
            );
          })}
        </div>

        {/* Color Legend */}
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span className="dark:text-gray-200">Green = Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span className="dark:text-gray-200">Red = Offline</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-500 rounded"></div>
            <span className="dark:text-gray-200">Orange = Fixed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-purple-500 rounded"></div>
            <span className="dark:text-gray-200">Purple = WDU</span>
          </div>
        </div>
      </div>

      {/* Day cards */}
      <div className="space-y-2">
        {(useDates || []).map((date, index) => {
          const isExpanded = expandedDays.has(date);
          const dayData = getDayData(date);
          const entry = dayData[currentLine] || { heads: makeDefaultHeads(), machineNotes: '', running: false };
          const { heads, machineNotes, running } = entry;

          const updateEntry = (updater) => {
            updateDay(date, {
              [currentLine]:
                typeof updater === 'function' ? updater(entry) : { ...entry, ...updater }
            });
          };
          const updateHeadField = (i, field, value) => {
            const newHeads = (heads || makeDefaultHeads()).map((h, idx) =>
              idx === i ? { ...h, [field]: value } : h
            );
            updateEntry({ heads: newHeads });
          };

          const lineCounts = (() => {
            const off = (heads || makeDefaultHeads()).filter(h => h.offline !== 'Active');
            const fixed = off.filter(h => {
              const issues = h.issues || [];
              return issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
            });
            return { notFixed: off.length - fixed.length, fixed: fixed.length };
          })();

          return (
            <div key={date} className="border dark:border-gray-600 rounded-lg overflow-hidden">
              {/* Header */}
              <button onClick={() => toggleDay(date)} className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-sm font-medium whitespace-nowrap dark:text-gray-200">Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => { e.stopPropagation(); handleEditDate(index, e.target.value); }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm border dark:border-gray-600 dark:bg-gray-600 dark:text-gray-100 rounded px-2 py-1"
                    />
                    <span className="font-medium text-left leading-tight dark:text-gray-100 sm:text-sm">{date}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {Object.keys(dayData).filter((l) => dayData[l]?.running).length} active
                    </span>
                    <svg className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </button>

              {/* Body */}
              {isExpanded && (
                <div className="p-4 bg-white dark:bg-gray-800 space-y-4">
                  {/* Controls row */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    {/* Line & running (with counts) */}
                    <div className="md:col-span-8 flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium whitespace-nowrap dark:text-gray-100">Line:</span>
                        <select
                          value={currentLine}
                          onChange={(e) => setCurrentLine(e.target.value)}
                          className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded sm:w-44 w-48"
                        >
                          {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((line) => (
                            <option key={line} value={line}>{line}</option>
                          ))}
                        </select>

                        {/* Count badges for current line/date */}
                        <span className="px-2 py-1 rounded text-white text-xs font-semibold bg-red-600">
                          Not Fixed: {lineCounts.notFixed}
                        </span>
                        <span className="px-2 py-1 rounded text-white text-xs font-semibold bg-blue-600">
                          Fixed: {lineCounts.fixed}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="sm:text-sm dark:text-gray-100">Running:</span>
                        <button
                          onClick={() => updateEntry((ent) => ({ ...ent, running: !ent.running }))}
                          className={'px-4 py-1 rounded text-white ' + (running ? 'bg-green-500' : 'bg-red-500') + ' sm:px-3 sm:py-1 sm:text-sm'}
                        >
                          {running ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button onClick={prevLine} className="px-3 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 rounded sm:px-2 sm:py-1">Prev</button>
                        <button onClick={nextLine} className="px-3 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 rounded sm:px-2 sm:py-1">Next</button>
                      </div>
                    </div>
                  </div>

                  {/* Heads display (table or cards) */}
                  {viewMode === 'table' ? (
                    <div className="overflow-x-auto">
                      <table className="w-full table-auto border-collapse min-w-max">
                        <thead>
                          <tr className="bg-gray-100 dark:bg-gray-700">
                            {['Head', 'Status', 'Issues', 'Notes'].map((c) => (
                              <th key={c} className="p-2 text-center border dark:border-gray-600 dark:text-gray-100 sm:p-1 sm:text-sm">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const { priority, activeEmpty } = categorizeHeads(heads || makeDefaultHeads());

                            return (
                              <>
                                {/* Priority heads: offline, has issues, or has notes */}
                                {priority.map((h) => {
                                  const headIdx = h.originalIndex;
                                  const issues = h.issues || [];
                                  const rowBg = getRowClass(h);

                                  return (
                                    <React.Fragment key={headIdx}>
                                <tr className={rowBg}>
                                  <td className="p-2 text-center align-top border dark:border-gray-600 sm:p-1 sm:text-sm font-semibold">
                                    {h.head}
                                  </td>
                                  <td className="p-2 text-center align-top border dark:border-gray-600 sm:p-1 sm:text-sm">
                                    <button
                                      onClick={() => updateHeadField(headIdx, 'offline', h.offline === 'Active' ? 'Offline' : 'Active')}
                                      className={'px-4 py-1 rounded text-white ' + (h.offline === 'Active' ? 'bg-green-500' : 'bg-red-500') + ' sm:px-2 sm:py-1 sm:text-sm'}
                                    >
                                      {h.offline}
                                    </button>
                                  </td>
                                  <td className="p-2 border dark:border-gray-600">
                                    {/* Issues list */}
                                    <div className="space-y-2">
                                      {issues.map((iss, issIdx) => (
                                        <div key={issIdx} className="space-y-2">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <select
                                              value={iss.type}
                                              onChange={(e) => {
                                                const newIssues = [...issues];
                                                newIssues[issIdx] = { ...iss, type: e.target.value };
                                                updateHeadField(headIdx, 'issues', newIssues);
                                              }}
                                              className="flex-1 min-w-[150px] p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                                            >
                                              {issueTypes.map((opt) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                              ))}
                                            </select>
                                            <button
                                              onClick={() => {
                                                const newIssues = [...issues];
                                                newIssues[issIdx] = { ...iss, repaired: iss.repaired === 'Fixed' ? 'Not Fixed' : 'Fixed' };
                                                updateHeadField(headIdx, 'issues', newIssues);
                                              }}
                                              className={'px-3 py-1 rounded text-white text-sm ' + (iss.repaired === 'Fixed' ? 'bg-green-500' : 'bg-red-500')}
                                            >
                                              {iss.repaired || 'Not Fixed'}
                                            </button>
                                            <button
                                              onClick={() => {
                                                const newIssues = issues.filter((_, idx) => idx !== issIdx);
                                                updateHeadField(headIdx, 'issues', newIssues);
                                              }}
                                              className="px-2 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                                              title="Delete issue"
                                            >
                                              X
                                            </button>
                                          </div>
                                          {iss.type === 'WDU Replacement' && (
                                            <div className="flex items-center gap-2 pl-4">
                                              <span className="text-xs font-medium dark:text-gray-300">Error was:</span>
                                              <select
                                                value={iss.replacementReason || ''}
                                                onChange={(e) => {
                                                  const newIssues = [...issues];
                                                  newIssues[issIdx] = { ...iss, replacementReason: e.target.value };
                                                  updateHeadField(headIdx, 'issues', newIssues);
                                                }}
                                                className="flex-1 p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                                              >
                                                <option value="">Select error...</option>
                                                {issueTypes.filter(t => t !== 'WDU Replacement').map((opt) => (
                                                  <option key={opt} value={opt}>{opt}</option>
                                                ))}
                                              </select>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                      <button
                                        onClick={() => {
                                          const newIssues = [...issues, { type: 'Chute', repaired: 'Not Fixed', replacementReason: '' }];
                                          updateHeadField(headIdx, 'issues', newIssues);
                                        }}
                                        className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                                      >
                                        + Add Issue
                                      </button>
                                    </div>
                                  </td>
                                  <td className="p-2 align-top border dark:border-gray-600 sm:p-1 sm:text-sm">
                                    <input
                                      value={h.notes}
                                      onChange={(e) => updateHeadField(headIdx, 'notes', e.target.value)}
                                      className="w-full p-1 border rounded sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                                      placeholder="Notes..."
                                    />
                                  </td>
                                </tr>
                              </React.Fragment>
                                  );
                                })}

                                {/* Collapsible Active Heads section */}
                                {activeEmpty.length > 0 && (
                                  <>
                                    <tr>
                                      <td colSpan="4" className="p-0 border dark:border-gray-600">
                                        <button
                                          onClick={() => setShowActiveHeads(!showActiveHeads)}
                                          className="w-full p-2 text-left bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-between"
                                        >
                                          <span className="text-sm font-medium dark:text-gray-200">
                                            Active Heads with No Issues ({activeEmpty.length})
                                          </span>
                                          <svg
                                            className={`w-5 h-5 transition-transform dark:text-gray-200 ${showActiveHeads ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                      </td>
                                    </tr>
                                    {showActiveHeads && activeEmpty.map((h) => {
                                      const headIdx = h.originalIndex;
                                      const issues = h.issues || [];
                                      const rowBg = getRowClass(h);

                                      return (
                                        <React.Fragment key={headIdx}>
                                          <tr className={rowBg}>
                                            <td className="p-2 text-center align-top border dark:border-gray-600 sm:p-1 sm:text-sm font-semibold dark:text-gray-100">
                                              {h.head}
                                            </td>
                                            <td className="p-2 text-center align-top border dark:border-gray-600 sm:p-1 sm:text-sm">
                                              <button
                                                onClick={() => updateHeadField(headIdx, 'offline', h.offline === 'Active' ? 'Offline' : 'Active')}
                                                className={'px-4 py-1 rounded text-white ' + (h.offline === 'Active' ? 'bg-green-500' : 'bg-red-500') + ' sm:px-2 sm:py-1 sm:text-sm'}
                                              >
                                                {h.offline}
                                              </button>
                                            </td>
                                            <td className="p-2 border dark:border-gray-600">
                                              <div className="space-y-2">
                                                <button
                                                  onClick={() => {
                                                    const newIssues = [{ type: 'Chute', repaired: 'Not Fixed', replacementReason: '' }];
                                                    updateHeadField(headIdx, 'issues', newIssues);
                                                  }}
                                                  className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                                                >
                                                  + Add Issue
                                                </button>
                                              </div>
                                            </td>
                                            <td className="p-2 align-top border dark:border-gray-600 sm:p-1 sm:text-sm">
                                              <input
                                                value={h.notes}
                                                onChange={(e) => updateHeadField(headIdx, 'notes', e.target.value)}
                                                className="w-full p-1 border rounded sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                                                placeholder="Notes..."
                                              />
                                            </td>
                                          </tr>
                                        </React.Fragment>
                                      );
                                    })}
                                  </>
                                )}
                              </>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const { priority, activeEmpty } = categorizeHeads(heads || makeDefaultHeads());

                        return (
                          <>
                            {/* Priority heads: offline, has issues, or has notes */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                              {priority.map((h) => {
                                const headIdx = h.originalIndex;
                                const issues = h.issues || [];
                                return (
                                  <div key={headIdx} className={`p-3 rounded-lg border-2 ${getRowClass(h)}`}>
                                    <div className="font-semibold text-lg mb-2 dark:text-gray-100">Head {h.head}</div>
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium dark:text-gray-200">Status:</span>
                                        <button
                                          onClick={() => updateHeadField(headIdx, 'offline', h.offline === 'Active' ? 'Offline' : 'Active')}
                                          className={'px-4 py-1 rounded text-white ' + (h.offline === 'Active' ? 'bg-green-500' : 'bg-red-500')}
                                        >
                                          {h.offline}
                                        </button>
                                      </div>

                                      {/* Issues list */}
                                      <div>
                                        <div className="text-sm font-medium mb-2 dark:text-gray-200">Issues:</div>
                                        <div className="space-y-2">
                                          {issues.map((iss, issIdx) => (
                                            <div key={issIdx} className="p-2 bg-white dark:bg-gray-700 rounded border dark:border-gray-600 space-y-2">
                                              <div className="flex items-center gap-2">
                                                <select
                                                  value={iss.type}
                                                  onChange={(e) => {
                                                    const newIssues = [...issues];
                                                    newIssues[issIdx] = { ...iss, type: e.target.value };
                                                    updateHeadField(headIdx, 'issues', newIssues);
                                                  }}
                                                  className="flex-1 p-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-gray-100"
                                                >
                                                  {issueTypes.map((opt) => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                  ))}
                                                </select>
                                                <button
                                                  onClick={() => {
                                                    const newIssues = issues.filter((_, idx) => idx !== issIdx);
                                                    updateHeadField(headIdx, 'issues', newIssues);
                                                  }}
                                                  className="px-2 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                                                >
                                                  X
                                                </button>
                                              </div>
                                              {iss.type === 'WDU Replacement' && (
                                                <div className="space-y-1">
                                                  <label className="text-xs font-medium dark:text-gray-300">Error was:</label>
                                                  <select
                                                    value={iss.replacementReason || ''}
                                                    onChange={(e) => {
                                                      const newIssues = [...issues];
                                                      newIssues[issIdx] = { ...iss, replacementReason: e.target.value };
                                                      updateHeadField(headIdx, 'issues', newIssues);
                                                    }}
                                                    className="w-full p-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-gray-100"
                                                  >
                                                    <option value="">Select error...</option>
                                                    {issueTypes.filter(t => t !== 'WDU Replacement').map((opt) => (
                                                      <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                              )}
                                              <button
                                                onClick={() => {
                                                  const newIssues = [...issues];
                                                  newIssues[issIdx] = { ...iss, repaired: iss.repaired === 'Fixed' ? 'Not Fixed' : 'Fixed' };
                                                  updateHeadField(headIdx, 'issues', newIssues);
                                                }}
                                                className={'w-full px-3 py-1 rounded text-white text-sm ' + (iss.repaired === 'Fixed' ? 'bg-green-500' : 'bg-red-500')}
                                              >
                                                {iss.repaired || 'Not Fixed'}
                                              </button>
                                            </div>
                                          ))}
                                          <button
                                            onClick={() => {
                                              const newIssues = [...issues, { type: 'Chute', repaired: 'Not Fixed', replacementReason: '' }];
                                              updateHeadField(headIdx, 'issues', newIssues);
                                            }}
                                            className="w-full px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                                          >
                                            + Add Issue
                                          </button>
                                        </div>
                                      </div>

                                      <div>
                                        <label className="text-sm font-medium block mb-1 dark:text-gray-200">Notes:</label>
                                        <input
                                          value={h.notes}
                                          onChange={(e) => updateHeadField(headIdx, 'notes', e.target.value)}
                                          className="w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                                          placeholder="Notes..."
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Collapsible Active Heads section */}
                            {activeEmpty.length > 0 && (
                              <div className="mb-4">
                                <button
                                  onClick={() => setShowActiveHeads(!showActiveHeads)}
                                  className="w-full p-3 text-left bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex items-center justify-between border-2 border-gray-300 dark:border-gray-600"
                                >
                                  <span className="text-sm font-medium dark:text-gray-200">
                                    Active Heads with No Issues ({activeEmpty.length})
                                  </span>
                                  <svg
                                    className={`w-5 h-5 transition-transform dark:text-gray-200 ${showActiveHeads ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>

                                {showActiveHeads && (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                    {activeEmpty.map((h) => {
                                      const headIdx = h.originalIndex;
                                      const issues = h.issues || [];
                                      return (
                                        <div key={headIdx} className={`p-3 rounded-lg border-2 ${getRowClass(h)}`}>
                                          <div className="font-semibold text-lg mb-2 dark:text-gray-100">Head {h.head}</div>
                                          <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                              <span className="text-sm font-medium dark:text-gray-200">Status:</span>
                                              <button
                                                onClick={() => updateHeadField(headIdx, 'offline', h.offline === 'Active' ? 'Offline' : 'Active')}
                                                className={'px-4 py-1 rounded text-white ' + (h.offline === 'Active' ? 'bg-green-500' : 'bg-red-500')}
                                              >
                                                {h.offline}
                                              </button>
                                            </div>

                                            <div>
                                              <div className="text-sm font-medium mb-2 dark:text-gray-200">Issues:</div>
                                              <button
                                                onClick={() => {
                                                  const newIssues = [{ type: 'Chute', repaired: 'Not Fixed', replacementReason: '' }];
                                                  updateHeadField(headIdx, 'issues', newIssues);
                                                }}
                                                className="w-full px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                                              >
                                                + Add Issue
                                              </button>
                                            </div>

                                            <div>
                                              <label className="text-sm font-medium block mb-1 dark:text-gray-200">Notes:</label>
                                              <input
                                                value={h.notes}
                                                onChange={(e) => updateHeadField(headIdx, 'notes', e.target.value)}
                                                className="w-full p-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                                                placeholder="Notes..."
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </>
                  )}

                  {/* Machine notes */}
                  <div>
                    <label className="block mb-1 font-medium dark:text-gray-100 sm:text-sm">Machine Notes:</label>
                    <textarea
                      rows={3}
                      value={machineNotes}
                      onChange={(e) => updateEntry({ machineNotes: e.target.value })}
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded sm:text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tiny trend */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold mb-2 text-center dark:text-gray-100 sm:text-lg">Heads Down Per Day</h3>
        <Bar
          data={headsDownGraphData}
          options={{
            responsive: true,
            plugins: { legend: { position: 'top' }, title: { display: true, text: `Heads Status for ${currentLine}` } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
          }}
        />
      </div>

      {authError && <p className="text-red-500 text-center mt-4">{authError}</p>}
    </div>
  );
}
