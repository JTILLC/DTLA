import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { getDatabase, ref, set, get } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { app } from '../firebaseConfig';
import { useDates as useDatesContext } from '../context/DatesContext';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

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
  const [actionsOpen, setActionsOpen] = useState(false); // actions dropdown
  const [navigationOpen, setNavigationOpen] = useState(false); // navigation dropdown
  const [viewMode, setViewMode] = useState(() => {
    // Default to table on desktop, cards on mobile
    return window.innerWidth <= 768 ? 'cards' : 'table';
  });
  const [showActiveHeads, setShowActiveHeads] = useState(false); // Collapse active heads by default
  const [showRepeatModal, setShowRepeatModal] = useState(false); // Repeat-offline details modal

  // Head history modal state
  const [historyList, setHistoryList] = useState([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyModalTitle, setHistoryModalTitle] = useState('');
  const [historyModalItems, setHistoryModalItems] = useState([]);

  // Load head history from Firebase for modal lookups
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await get(ref(database, `${DB_ROOT}/head-history`));
        if (snap.exists() && !cancelled) {
          const val = snap.val();
          const arr = Array.isArray(val) ? val.filter(Boolean) : Object.values(val || {});
          setHistoryList(arr.filter(e => e && e.date).sort((a, b) => new Date(b.date) - new Date(a.date)));
        }
      } catch (e) {
        console.warn('Head history load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const openHeadHistory = (line, headNum) => {
    const items = historyList
      .filter(e => e.line === line && String(e.head) === String(headNum));
    setHistoryModalTitle(`${line} — Head ${headNum} • History (${items.length})`);
    setHistoryModalItems(items);
    setHistoryModalOpen(true);
  };

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
        // Move data from old date to new date
        next[newDate] = { ...(next[newDate] || {}), ...next[oldDate] };
        delete next[oldDate];
      } else {
        // Ensure new date has a data entry even if old date had none
        // This ensures the date shows up in Summary and other views
        next[newDate] = next[newDate] || {};
      }
      return next;
    });

    // Update dates array
    const copy = [...useDates];
    copy[index] = newDate;
    copy.sort((a, b) => new Date(b) - new Date(a));

    // Always update currentDay to the new date so the Quick Toggle
    // immediately reflects the date the user just edited
    // This must happen BEFORE useSetDates to avoid the useEffect resetting it
    setCurrentDay(newDate);

    useSetDates(copy);

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

  // Detect repeat offline heads across all dates for current line
  const repeatOfflineHeads = useMemo(() => {
    const headOfflineInfo = {}; // { headNumber: [{ date, issues: [...] }, ...] }

    useDates.forEach(date => {
      const dayData = getDayData(date);
      const entry = dayData[currentLine] || { heads: makeDefaultHeads() };
      const heads = entry.heads || makeDefaultHeads();

      heads.forEach((h, idx) => {
        if (h.offline !== 'Active') {
          const headNum = idx + 1;
          if (!headOfflineInfo[headNum]) {
            headOfflineInfo[headNum] = [];
          }
          // Collect issues for this date
          const issues = h.issues || [];
          const issueList = issues.length > 0
            ? issues.map(iss => iss.type).filter(Boolean)
            : [];
          headOfflineInfo[headNum].push({ date, issues: issueList });
        }
      });
    });

    // Filter to only heads that are offline 2+ times
    const repeats = {};
    Object.keys(headOfflineInfo).forEach(headNum => {
      if (headOfflineInfo[headNum].length >= 2) {
        repeats[headNum] = headOfflineInfo[headNum];
      }
    });

    return repeats;
  }, [useDates, currentLine, useData]);

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
          {/* Navigation dropdown */}
          <div className="relative">
            <button
              onClick={() => setNavigationOpen((v) => !v)}
              className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
            >
              Navigation ▾
            </button>
            {navigationOpen && (
              <div className="absolute left-0 mt-2 w-48 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded shadow-lg z-20">
                <Link
                  to="/summary"
                  onClick={() => setNavigationOpen(false)}
                  className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                >
                  View Summary
                </Link>
                <Link
                  to="/dashboard"
                  onClick={() => setNavigationOpen(false)}
                  className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                >
                  Dashboard
                </Link>
                <Link
                  to="/running"
                  onClick={() => setNavigationOpen(false)}
                  className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                >
                  Running
                </Link>
                <Link
                  to="/issues-chart"
                  onClick={() => setNavigationOpen(false)}
                  className="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                >
                  Issues Chart
                </Link>
              </div>
            )}
          </div>

          {/* Card/Table view toggle — hidden on mobile; mobile always uses cards */}
          <div className="hidden md:flex gap-1 border rounded">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 rounded text-sm transition-colors ${
                viewMode === 'table'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-2 rounded text-sm transition-colors ${
                viewMode === 'cards'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Cards
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={handleSaveToCloud} className="px-3 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">Save</button>

          {/* Actions dropdown (Import, Export, Load, Reset*) */}
          <div className="relative">
            <button
              onClick={() => setActionsOpen((v) => !v)}
              className="px-3 py-2 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Actions ▾
            </button>
            {actionsOpen && (
              <div className="absolute left-0 mt-2 w-56 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded shadow-lg z-20">
                <label
                  htmlFor="import-json"
                  className="block w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer dark:text-gray-100"
                  onClick={() => setActionsOpen(false)}
                >
                  Import
                </label>
                <input id="import-json" type="file" accept=".json" hidden onChange={handleImport} />
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    handleExport();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:text-gray-100"
                >
                  Export
                </button>
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    handleLoadFromCloud();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:text-gray-100"
                >
                  Load
                </button>
                <hr className="my-1 border-gray-200 dark:border-gray-600" />
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    if (confirm(`Reset ${currentLine} for ${currentDay}? Heads & notes will be cleared.`)) {
                      resetLineForDate(currentDay);
                    }
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:text-gray-100"
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
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:text-gray-100"
                >
                  Reset Day (all lines)
                </button>
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    resetAllDays();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-red-700 dark:text-red-400"
                >
                  Reset ALL Days
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Persistent line controls — above the Quick Head Toggle. Acts on currentDay/currentLine. */}
      {(() => {
        const currentEntry = entryFor(currentDay);
        const currentHeads = currentEntry.heads || makeDefaultHeads();
        const off = currentHeads.filter(h => h.offline !== 'Active');
        const fixedCount = off.filter(h => {
          const issues = h.issues || [];
          return issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
        }).length;
        const notFixedCount = off.length - fixedCount;
        const isRunning = !!currentEntry.running;
        const toggleRunning = () => {
          const dayData = getDayData(currentDay);
          const entry = dayData[currentLine] || { heads: makeDefaultHeads(), machineNotes: '', running: false };
          updateDay(currentDay, { [currentLine]: { ...entry, running: !entry.running } });
        };
        return (
          <div className="mb-4 p-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium whitespace-nowrap dark:text-gray-100">Line:</span>
              <select
                value={currentLine}
                onChange={(e) => setCurrentLine(e.target.value)}
                className="border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded"
              >
                {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((line) => (
                  <option key={line} value={line}>{line}</option>
                ))}
              </select>
            </div>
            <button onClick={prevLine} className="px-3 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 rounded">Prev</button>
            <button onClick={nextLine} className="px-3 py-1 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 rounded">Next</button>
            <span className="px-2 py-1 rounded text-white text-xs font-semibold bg-red-600">Not Fixed: {notFixedCount}</span>
            <span className="px-2 py-1 rounded text-white text-xs font-semibold bg-blue-600">Fixed: {fixedCount}</span>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm dark:text-gray-100">Running:</span>
              <button
                onClick={toggleRunning}
                className={'px-4 py-1 rounded text-white text-sm ' + (isRunning ? 'bg-green-500' : 'bg-red-500')}
              >
                {isRunning ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        );
      })()}

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
            const headNum = i + 1;
            const isRepeat = repeatOfflineHeads[headNum];

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
                className={`px-3 py-2 rounded border border-gray-300 dark:border-gray-600 ${bgColor} ${textColor} hover:opacity-80 transition-all relative`}
                title={isRepeat ? `Head ${headNum} - ${displayText} - REPEAT: Offline on ${isRepeat.length} days\n${isRepeat.map(info => `${info.date}: ${info.issues.length > 0 ? info.issues.join(', ') : 'No issue specified'}`).join('\n')}` : `Head ${headNum} - ${displayText}`}
              >
                {isRepeat && (
                  <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-white">
                    {isRepeat.length}
                  </div>
                )}
                <div className="font-bold text-lg">{headNum}</div>
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

      {/* Repeat Offline Heads — compact icon button. Click to see details. */}
      {Object.keys(repeatOfflineHeads).length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowRepeatModal(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-500 dark:border-yellow-600 text-yellow-800 dark:text-yellow-200 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors"
            title="View repeat-offline heads"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium">
              {Object.keys(repeatOfflineHeads).length} repeat-offline head{Object.keys(repeatOfflineHeads).length === 1 ? '' : 's'}
            </span>
          </button>
        </div>
      )}

      {/* Repeat Offline modal */}
      {showRepeatModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4"
          onClick={() => setShowRepeatModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h3 className="font-semibold text-lg text-yellow-800 dark:text-yellow-300 flex items-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Repeat Offline Issues — {currentLine}
              </h3>
              <button
                onClick={() => setShowRepeatModal(false)}
                className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                The following heads have been offline on multiple days:
              </p>
              {Object.entries(repeatOfflineHeads).map(([headNum, dateInfos]) => (
                <div key={headNum} className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-400 dark:border-yellow-700">
                  <div className="font-bold text-base mb-2 dark:text-gray-100">
                    Head {headNum} — Offline on {dateInfos.length} days
                  </div>
                  <div className="space-y-1">
                    {dateInfos.map(({ date, issues }) => (
                      <div key={date} className="flex items-start gap-2 text-sm">
                        <span className="font-semibold min-w-[90px] dark:text-gray-200">{date}:</span>
                        <span className={issues.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}>
                          {issues.length > 0 ? issues.join(', ') : 'No issue specified'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
              <div className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-sm font-medium whitespace-nowrap dark:text-gray-200">Date</label>
                  <DatePicker
                    selected={date ? new Date(date + 'T00:00:00') : null}
                    onChange={(newDate) => {
                      if (newDate) {
                        const formatted = newDate.toISOString().split('T')[0];
                        handleEditDate(index, formatted);
                      }
                    }}
                    dateFormat="yyyy-MM-dd"
                    className="text-sm border dark:border-gray-600 dark:bg-gray-600 dark:text-gray-100 rounded px-2 py-1 w-32"
                    popperClassName="react-datepicker-dark"
                    calendarClassName="dark:bg-gray-800"
                  />
                  <span className="font-medium text-left leading-tight dark:text-gray-100 sm:text-sm">{date}</span>
                </div>
                <button
                  onClick={() => toggleDay(date)}
                  className="flex items-center gap-2 px-3 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <span className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    {Object.keys(dayData).filter((l) => dayData[l]?.running).length} active
                  </span>
                  <svg className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              {isExpanded && (
                <div className="p-4 bg-white dark:bg-gray-800 space-y-4">
                  {/* Heads display (table on desktop / cards on mobile when viewMode === table) */}
                  {viewMode === 'table' && (
                    <div className="hidden md:block overflow-x-auto">
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
                                  const isRepeat = repeatOfflineHeads[h.head];

                                  return (
                                    <React.Fragment key={headIdx}>
                                <tr className={rowBg}>
                                  <td className="p-2 text-center align-top border dark:border-gray-600 sm:p-1 sm:text-sm font-semibold">
                                    <div className="flex flex-col items-center gap-1">
                                      <span>{h.head}</span>
                                      <button
                                        onClick={() => openHeadHistory(currentLine, h.head)}
                                        className="px-1.5 py-0.5 bg-teal-600 text-white text-xs rounded hover:bg-teal-700"
                                        title={`View history for Head ${h.head}`}
                                      >
                                        Hx
                                      </button>
                                      {isRepeat && (
                                        <span
                                          className="px-2 py-0.5 bg-yellow-500 text-white text-xs font-bold rounded cursor-help"
                                          title={`Offline on ${isRepeat.length} days:\n${isRepeat.map(info => `${info.date}: ${info.issues.length > 0 ? info.issues.join(', ') : 'No issue specified'}`).join('\n')}`}
                                        >
                                          REPEAT ×{isRepeat.length}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-2 text-center align-top border dark:border-gray-600 sm:p-1 sm:text-sm">
                                    <button
                                      onClick={() => updateHeadField(headIdx, 'offline', h.offline === 'Active' ? 'Offline' : 'Active')}
                                      className={'px-4 py-1 rounded text-white ' + (h.offline === 'Active' ? 'bg-green-500' : 'bg-red-500') + ' sm:px-2 sm:py-1 sm:text-sm'}
                                      title={h.offline}
                                    >
                                      &nbsp;
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
                                      const isRepeat = repeatOfflineHeads[h.head];

                                      return (
                                        <React.Fragment key={headIdx}>
                                          <tr className={rowBg}>
                                            <td className="p-2 text-center align-top border dark:border-gray-600 sm:p-1 sm:text-sm font-semibold dark:text-gray-100">
                                              <div className="flex flex-col items-center gap-1">
                                                <span>{h.head}</span>
                                                <button
                                                  onClick={() => openHeadHistory(currentLine, h.head)}
                                                  className="px-1.5 py-0.5 bg-teal-600 text-white text-xs rounded hover:bg-teal-700"
                                                  title={`View history for Head ${h.head}`}
                                                >
                                                  Hx
                                                </button>
                                                {isRepeat && (
                                                  <span
                                                    className="px-2 py-0.5 bg-yellow-500 text-white text-xs font-bold rounded cursor-help"
                                                    title={`Offline on ${isRepeat.length} days:\n${isRepeat.map(info => `${info.date}: ${info.issues.length > 0 ? info.issues.join(', ') : 'No issue specified'}`).join('\n')}`}
                                                  >
                                                    REPEAT ×{isRepeat.length}
                                                  </span>
                                                )}
                                              </div>
                                            </td>
                                            <td className="p-2 text-center align-top border dark:border-gray-600 sm:p-1 sm:text-sm">
                                              <button
                                                onClick={() => updateHeadField(headIdx, 'offline', h.offline === 'Active' ? 'Offline' : 'Active')}
                                                className={'px-4 py-1 rounded text-white ' + (h.offline === 'Active' ? 'bg-green-500' : 'bg-red-500') + ' sm:px-2 sm:py-1 sm:text-sm'}
                                                title={h.offline}
                                              >
                                                &nbsp;
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
                  )}
                  <div className={viewMode === 'table' ? 'md:hidden' : ''}>
                    {(() => {
                      const { priority, activeEmpty } = categorizeHeads(heads || makeDefaultHeads());

                        return (
                          <>
                            {/* Priority heads: offline, has issues, or has notes */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                              {priority.map((h) => {
                                const headIdx = h.originalIndex;
                                const issues = h.issues || [];
                                const isRepeat = repeatOfflineHeads[h.head];
                                return (
                                  <div key={headIdx} className={`p-3 rounded-lg border-2 ${getRowClass(h)}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-lg dark:text-gray-100">Head {h.head}</span>
                                        <button
                                          onClick={() => openHeadHistory(currentLine, h.head)}
                                          className="px-1.5 py-0.5 bg-teal-600 text-white text-xs rounded hover:bg-teal-700"
                                          title={`View history for Head ${h.head}`}
                                        >
                                          Hx
                                        </button>
                                      </div>
                                      {isRepeat && (
                                        <span
                                          className="px-2 py-1 bg-yellow-500 text-white text-xs font-bold rounded cursor-help"
                                          title={`Offline on ${isRepeat.length} days:\n${isRepeat.map(info => `${info.date}: ${info.issues.length > 0 ? info.issues.join(', ') : 'No issue specified'}`).join('\n')}`}
                                        >
                                          REPEAT ×{isRepeat.length}
                                        </span>
                                      )}
                                    </div>
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
                                      const isRepeat = repeatOfflineHeads[h.head];
                                      return (
                                        <div key={headIdx} className={`p-3 rounded-lg border-2 ${getRowClass(h)}`}>
                                          <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                              <span className="font-semibold text-lg dark:text-gray-100">Head {h.head}</span>
                                              <button
                                                onClick={() => openHeadHistory(currentLine, h.head)}
                                                className="px-1.5 py-0.5 bg-teal-500 text-white text-xs font-bold rounded hover:bg-teal-600"
                                                title="View head history"
                                              >Hx</button>
                                            </div>
                                            {isRepeat && (
                                              <span
                                                className="px-2 py-1 bg-yellow-500 text-white text-xs font-bold rounded cursor-help"
                                                title={`Offline on ${isRepeat.length} days:\n${isRepeat.map(info => `${info.date}: ${info.issues.length > 0 ? info.issues.join(', ') : 'No issue specified'}`).join('\n')}`}
                                              >
                                                REPEAT ×{isRepeat.length}
                                              </span>
                                            )}
                                          </div>
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
                  </div>

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

      {/* Head History Modal */}
      {historyModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setHistoryModalOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h3 className="text-lg font-bold dark:text-gray-100">{historyModalTitle}</h3>
              <button onClick={() => setHistoryModalOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl font-bold">×</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {historyModalItems.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">No history found for this head.</p>
              ) : (
                <div className="space-y-3">
                  {historyModalItems.map((item, idx) => (
                    <div key={idx} className="p-3 rounded border dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-sm dark:text-gray-100">{item.date}</span>
                        {item.repaired && (
                          <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${item.repaired === 'Fixed' ? 'bg-green-500' : 'bg-red-500'}`}>
                            {item.repaired}
                          </span>
                        )}
                      </div>
                      {item.issue && (
                        <div className="text-sm dark:text-gray-300 mt-1">
                          <span className="font-medium">Issue:</span> {item.issue}
                        </div>
                      )}
                      {item.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
