import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import HeadCard from './logger/HeadCard';
import Photos from './logger/Photos';
import HeadRow from './logger/HeadRow';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { getDatabase, ref, set, get, update } from 'firebase/database';
import { app } from '../firebaseConfig';
import { HEADS_PER_LINE } from '../constants';
import { useDates as useDatesContext } from '../context/DatesContext';
import { useToast } from '../context/ToastContext';
import { sortAsc, formatDayLabel } from '../utils/stintDays';
import { historyEntriesForDate, historyUpdatesFor } from '../utils/historyEntries';
import useModalDismiss from '../utils/useModalDismiss';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const database = getDatabase(app);

// --- Cloud paths (namespaced) ---
const DB_ROOT = 'jti-downtime';
const MAINLOGGER_PATH = `${DB_ROOT}/main-logger`;
const MAINLOGGER_DATA_PATH = `${MAINLOGGER_PATH}/data`;

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

const toYmd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Rolling window: the logger shows the last WINDOW_DAYS worked days, derived
// from the data itself — logging a new day slides the window automatically.
const WINDOW_DAYS = 5;
// The live cloud doc keeps this many dates; older FINISHED days are pruned
// (their downtime lives on in Head History).
const LIVE_DOC_MAX_DATES = 12;

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// How much real content a logger doc holds. Used to decide whether a device's
// local copy is "empty" (fresh install / iOS evicted localStorage) so we never
// let a blank device autosave over a cloud doc that has actual logged work.
const contentScore = (dataObj) => {
  let score = 0;
  Object.values(dataObj || {}).forEach((day) => {
    Object.values(day || {}).forEach((entry) => {
      if (!entry) return;
      if (entry.running) score += 1;
      if ((entry.machineNotes || '').trim()) score += 1;
      (entry.heads || []).forEach((h) => {
        if (!h) return;
        if ((h.offline ?? 'Active') !== 'Active') score += 1;
        if ((h.issues || []).length) score += 1;
        if ((h.notes || '').trim()) score += 1;
      });
    });
  });
  return score;
};

export default function MainLogger({ data, setData }) {
  // Use DatesContext
  const { setDates: setContextDates } = useDatesContext();
  const toast = useToast();

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

  // The visible window: newest WINDOW_DAYS dates that exist in the data.
  const useDates = useMemo(
    () => Object.keys(useData || {}).filter(isYmd).sort((a, b) => new Date(b) - new Date(a)).slice(0, WINDOW_DAYS),
    [useData]
  );
  // Keep DatesContext in sync so Dashboard/Summary/shared views see the window
  useEffect(() => {
    setContextDates(useDates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useDates.join('|')]);

  const { state } = useLocation();
  const [currentDay, setCurrentDay] = useState(() => state?.selectedDate || useDates[0]);
  const [currentLine, setCurrentLine] = useState(state?.selectedLine || 'Line 1');
  const [expandedDays, setExpandedDays] = useState(() => new Set([state?.selectedDate || useDates[0]]));
  const [cloudState, setCloudState] = useState('idle'); // idle | saving | saved | error
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false); // actions dropdown
  const importInputRef = useRef(null);
  const [viewMode, setViewMode] = useState(() => {
    // Default to table on desktop, cards on mobile
    return window.innerWidth <= 768 ? 'cards' : 'table';
  });
  const [activeHeadsOpen, setActiveHeadsOpen] = useState(() => new Set()); // per-day "Active Heads" expansion
  const [showRepeatModal, setShowRepeatModal] = useState(false); // Repeat-offline details modal

  // Finished/locked days: { 'YYYY-MM-DD': true }. Finishing a day saves its
  // downtime to Head History and locks it against edits until unlocked.
  const [lockedDays, setLockedDays] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('downtimeLockedDays') || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try { localStorage.setItem('downtimeLockedDays', JSON.stringify(lockedDays)); } catch {}
  }, [lockedDays]);
  // Ref mirror so stable callbacks (handleUpdateField) can check locks without
  // changing identity and defeating the memoized head components.
  const lockedDaysRef = useRef(lockedDays);
  useEffect(() => { lockedDaysRef.current = lockedDays; }, [lockedDays]);

  // Free-text label per work day: { 'YYYY-MM-DD': 'Day 3' }.
  //
  // Deliberately typed rather than computed. An earlier version derived the
  // number chronologically, which is wrong here — these ~5 days a month are
  // scattered, not consecutive, so "oldest visible date = Day 1" drifts as the
  // rolling window slides and breaks across month boundaries. Free text also
  // survives a 6th or 7th day without any special-casing.
  //
  // Stored beside the data (like lockedDays) rather than inside data[date],
  // because that object is keyed by line name and a label is not a line.
  const [dayLabels, setDayLabels] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('downtimeDayLabels') || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try { localStorage.setItem('downtimeDayLabels', JSON.stringify(dayLabels)); } catch {}
  }, [dayLabels]);

  const setDayLabel = useCallback((date, label) => {
    setDayLabels((prev) => {
      const next = { ...prev };
      if (label && label.trim()) next[date] = label.trim();
      else delete next[date];      // clearing the box removes the label entirely
      return next;
    });
  }, []);

  const toggleActiveHeads = useCallback((date) => {
    setActiveHeadsOpen((prev) => {
      const n = new Set(prev);
      n.has(date) ? n.delete(date) : n.add(date);
      return n;
    });
  }, []);

  // Head history modal state
  const [historyList, setHistoryList] = useState([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyModalTitle, setHistoryModalTitle] = useState('');
  const [historyModalItems, setHistoryModalItems] = useState([]);

  // Escape-to-close + background scroll lock for the two modals
  const closeRepeatModal = useCallback(() => setShowRepeatModal(false), []);
  const closeHistoryModal = useCallback(() => setHistoryModalOpen(false), []);
  useModalDismiss(showRepeatModal, closeRepeatModal);
  useModalDismiss(historyModalOpen, closeHistoryModal);

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

  const openHeadHistory = useCallback((line, headNum) => {
    const items = historyList
      .filter(e => e.line === line && String(e.head) === String(headNum));
    setHistoryModalTitle(`${line} — Head ${headNum} • History (${items.length})`);
    setHistoryModalItems(items);
    setHistoryModalOpen(true);
  }, [historyList]);

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

  // --- Cloud hydration on startup ----------------------------------------
  // iOS Safari evicts localStorage after ~7 days without a visit, so a monthly
  // stint often starts on a device with a blank local copy. Before autosave is
  // allowed to run, check the cloud: if the cloud has real content and this
  // device has none, adopt the cloud doc instead of starting from defaults.
  // (This one-way-push-from-a-blank-device flaw is what wiped cloud data.)
  const [cloudCheckDone, setCloudCheckDone] = useState(false);
  const sessionSavedRef = useRef(false); // this session has successfully written the cloud

  // Cross-device staleness: every cloud save is stamped with savedAt, and each
  // device remembers the last stamp it has seen/written. If the cloud carries
  // a stamp this device hasn't seen (edits from another device), autosave is
  // paused and a banner asks whether to load the cloud or keep this device.
  const LAST_CLOUD_SAVEDAT_KEY = 'downtimeLastCloudSavedAt';
  const [cloudNewerInfo, setCloudNewerInfo] = useState(null); // { savedAt } | null
  const markCloudSeen = (savedAt) => {
    try { localStorage.setItem(LAST_CLOUD_SAVEDAT_KEY, savedAt || ''); } catch {}
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await get(ref(database, MAINLOGGER_DATA_PATH));
        const payload = (snap.exists() && snap.val()) || {};
        const cloudData = payload.data || {};
        if (cancelled) return;
        if (contentScore(cloudData) > 0 && contentScore(useData) === 0) {
          const migratedData = {};
          Object.keys(cloudData).forEach((date) => {
            migratedData[date] = {};
            Object.keys(cloudData[date]).forEach((line) => {
              const lineData = cloudData[date][line];
              migratedData[date][line] = { ...lineData, heads: (lineData.heads || []).map(migrateHeadData) };
            });
          });
          useSetData(migratedData);
          if (payload.lockedDays && typeof payload.lockedDays === 'object') setLockedDays(payload.lockedDays);
          if (payload.dayLabels && typeof payload.dayLabels === 'object') setDayLabels(payload.dayLabels);
          const newest = Object.keys(migratedData).filter(isYmd).sort((a, b) => new Date(b) - new Date(a))[0];
          if (newest) {
            setCurrentDay(newest);
            setExpandedDays(new Set([newest]));
          }
          markCloudSeen(payload.savedAt);
          toast.info('Restored your data from the cloud');
        } else if (payload.savedAt) {
          // Local has content too — is the cloud copy one this device hasn't seen?
          let lastSeen = null;
          try { lastSeen = localStorage.getItem(LAST_CLOUD_SAVEDAT_KEY); } catch {}
          if (payload.savedAt !== lastSeen) {
            setCloudNewerInfo({ savedAt: payload.savedAt });
          }
        }
      } catch (e) {
        console.warn('Cloud hydration check failed:', e);
      } finally {
        if (!cancelled) setCloudCheckDone(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Cloud sync status -------------------------------------------------
  // Serialised copy of what was last successfully written to the cloud. Comparing
  // the live doc against it answers the question the status chip previously
  // couldn't: "is what I'm looking at actually in the cloud yet?"
  //
  // Normally dirty lasts ~1.5s (the autosave debounce). It matters when autosave
  // is PAUSED because another device saved (cloudNewerInfo) or a write FAILED —
  // exactly when the old chip could still read "Saved" while local edits sat
  // unsynced.
  const cloudSnapshotRef = useRef(null);
  const [dirty, setDirty] = useState(false);

  const serializeDoc = useCallback(
    () => JSON.stringify({ data: useData, dates: useDates, lockedDays, dayLabels }),
    [useData, useDates, lockedDays, dayLabels]
  );

  useEffect(() => {
    if (cloudSnapshotRef.current === null) return;   // nothing saved yet this session
    setDirty(serializeDoc() !== cloudSnapshotRef.current);
  }, [serializeDoc]);

  // --- Cloud autosave ---------------------------------------------------
  // Writes the whole logger doc to the cloud. Used by both the debounced
  // autosave and the "save now" action (clicking the status chip).
  const writeCloud = async () => {
    setCloudState('saving');
    try {
      // Last line of defense: never let a blank device replace a cloud doc
      // that has real content (unless this session already owns the cloud,
      // e.g. the user just did an intentional Reset ALL Days).
      if (contentScore(useData) === 0 && !sessionSavedRef.current) {
        const snap = await get(ref(database, MAINLOGGER_DATA_PATH));
        const cloudData = ((snap.exists() && snap.val()) || {}).data || {};
        if (contentScore(cloudData) > 0) {
          setCloudState('error');
          toast.error('Autosave blocked: the cloud has data this device doesn\'t. Use Actions → Load first.', 8000);
          return;
        }
      }
      const savedAtIso = new Date().toISOString();
      await set(ref(database, MAINLOGGER_DATA_PATH), {
        data: useData,
        dates: useDates,
        lockedDays,
        dayLabels,
        savedAt: savedAtIso
      });
      markCloudSeen(savedAtIso);
      sessionSavedRef.current = true;
      cloudSnapshotRef.current = JSON.stringify({ data: useData, dates: useDates, lockedDays, dayLabels });
      setDirty(false);
      setCloudState('saved');
      setLastSavedAt(new Date());
    } catch (e) {
      console.error('Cloud save failed:', e);
      setCloudState('error');
    }
  };

  // Gate so the initial mount/hydration never pushes local data over the
  // cloud — autosave only fires for genuine user edits after the startup
  // cloud check has finished.
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (!cloudCheckDone) return; // don't autosave until the cloud check ran
    if (cloudNewerInfo) return; // paused: cloud has unseen changes — user must choose first
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    setCloudState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { writeCloud(); }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useData, useDates, lockedDays, dayLabels, cloudCheckDone, cloudNewerInfo]);

  const handleLoadFromCloud = async () => {
    try {
      const snap = await get(ref(database, MAINLOGGER_DATA_PATH));
      if (!snap.exists()) return toast.info('No cloud data found');
      const payload = snap.val() || {};
      const cloudData = payload.data || {};

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
      setLockedDays(payload.lockedDays && typeof payload.lockedDays === 'object' ? payload.lockedDays : {});
      setDayLabels(payload.dayLabels && typeof payload.dayLabels === 'object' ? payload.dayLabels : {});
      const newest = Object.keys(migratedData).filter(isYmd).sort((a, b) => new Date(b) - new Date(a))[0];
      if (newest) {
        setCurrentDay(newest);
        setExpandedDays(new Set([newest]));
      }
      markCloudSeen(payload.savedAt || new Date().toISOString());
      setCloudNewerInfo(null);
      sessionSavedRef.current = true; // local now mirrors cloud — future writes are legit
      toast.success('Loaded from cloud');
    } catch (e) {
      toast.error('Load failed: ' + e.message);
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
        const newest = Object.keys(importedData).filter(isYmd).sort((a,b)=>new Date(b)-new Date(a))[0];
        if (newest) {
          setCurrentDay(newest);
          setExpandedDays(new Set([newest]));
        }
        toast.success('Imported!');
      } catch (err) {
        toast.error('Invalid file: ' + err.message);
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

  // Central lock check for all edit paths. Returns true (and toasts) if the
  // date is finished/locked.
  const isLockedWithToast = (date) => {
    if (!lockedDaysRef.current[date]) return false;
    toast.info(`${date} is finished & locked — tap Unlock on its day card to edit`);
    return true;
  };

  const updateDay = (date, updates) => {
    if (isLockedWithToast(date)) return;
    useSetData((prev) => ({
      ...prev,
      [date]: { ...(prev?.[date] || {}), ...updates }
    }));
  };

  // Stable per-head field updater shared by HeadRow/HeadCard. Reads the latest
  // state via the functional updater so its identity never changes — that's
  // what lets the memoized head components skip re-rendering unchanged heads.
  const handleUpdateField = useCallback((date, line, i, field, value) => {
    if (lockedDaysRef.current[date]) {
      toast.info(`${date} is finished & locked — tap Unlock on its day card to edit`);
      return;
    }
    useSetData((prev) => {
      const day = prev?.[date] || {};
      const entry = day[line] || { heads: makeDefaultHeads(), machineNotes: '', running: false };
      const heads = entry.heads || makeDefaultHeads();
      const newHeads = heads.map((h, idx) => (idx === i ? { ...h, [field]: value } : h));
      return { ...prev, [date]: { ...day, [line]: { ...entry, heads: newHeads } } };
    });
  }, [useSetData, toast]);

  // Repeat-offline metadata for a head number (count + tooltip text).
  const repeatMetaFor = (headNum) => {
    const info = repeatOfflineHeads[headNum];
    if (!info) return { count: 0, title: '' };
    const title = info
      .map((x) => `${x.date}: ${x.issues.length ? x.issues.join(', ') : 'No issue specified'}`)
      .join('\n');
    return { count: info.length, title };
  };

  // Chronological display order (oldest first, today at the right)
  const orderedDates = useMemo(() => sortAsc(useDates), [useDates]);

  const todayYmd = toYmd(new Date());

  // Start logging a date: creating the key slides it into the rolling window.
  const startDay = (date) => {
    if (!useData?.[date]) {
      useSetData((prev) => ({ ...prev, [date]: {} }));
    }
    setCurrentDay(date);
    setExpandedDays(new Set([date]));
  };

  // Finish Day: push the day's downtime to Head History (idempotent child-key
  // updates — same mechanism as Summary, so no duplicates and no clobbering),
  // then lock the day. The day is NOT locked if the history write fails.
  const finishDay = async (date) => {
    const entries = historyEntriesForDate(getDayData(date), date);
    const n = entries.length;
    const summary = n
      ? `${n} downtime entr${n === 1 ? 'y' : 'ies'} (running lines) will be saved to Head History`
      : 'No downtime entries to save (only running lines count)';
    if (!confirm(`Finish ${date}?\n${summary}, then the day will be locked.`)) return;
    try {
      if (n) await update(ref(database, `${DB_ROOT}/head-history`), historyUpdatesFor(entries));
      // Prune: finished days older than the newest LIVE_DOC_MAX_DATES roll out
      // of the live doc — their downtime is archived in Head History.
      const nextLocked = { ...lockedDays, [date]: true };
      const allKeys = Object.keys(useData || {}).filter(isYmd).sort((a, b) => new Date(b) - new Date(a));
      const drop = allKeys.slice(LIVE_DOC_MAX_DATES).filter((d2) => nextLocked[d2] && d2 !== date);
      drop.forEach((d2) => { delete nextLocked[d2]; });
      setLockedDays(nextLocked);
      if (drop.length) {
        useSetData((prev) => {
          const nd = { ...prev };
          drop.forEach((d2) => { delete nd[d2]; });
          return nd;
        });
      }
      toast.success(n
        ? `${date} finished — ${n} entr${n === 1 ? 'y' : 'ies'} saved to Head History`
        : `${date} finished and locked`);
    } catch (e) {
      toast.error('Finish Day failed — day NOT locked: ' + e.message);
    }
  };

  const unlockDay = (date) => {
    if (!confirm(`Unlock ${date}?\nAre you sure? If you edit and want the changes in Head History, tap Finish Day again afterwards.`)) return;
    setLockedDays((prev) => {
      const n = { ...prev };
      delete n[date];
      return n;
    });
    toast.info(`${date} unlocked`);
  };

  const removeDay = (date) => {
    if (isLockedWithToast(date)) return;
    const confirmed = confirm(
      `Remove ${date} from the log?\nIts data will be deleted on all lines (the window slides back to the previous worked day).`
    );
    if (!confirmed) return;
    useSetData((prev) => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
    const remaining = useDates.filter((d) => d !== date);
    setCurrentDay(remaining[0]);
    setExpandedDays(new Set(remaining[0] ? [remaining[0]] : []));
  };

  const handleEditDate = (oldDate, newDate) => {
    if (!newDate || oldDate === newDate) return;
    if (isLockedWithToast(oldDate)) return; // date identifies its Head History entries

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

    // The window derives from data keys, so moving the data is all it takes.
    setCurrentDay(newDate);

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

  // Day-tab selection: focus a single day (expand it, collapse the others) and
  // point the Quick Head Toggle + line controls at it.
  const selectDay = (date) => {
    setCurrentDay(date);
    setExpandedDays(new Set([date]));
  };

  // Offline-head count for a date on the current line — shown on the day tabs.
  const offlineCountForDay = (date) => {
    const entry = getDayData(date)[currentLine] || {};
    const heads = entry.heads || [];
    return heads.filter((h) => (h.offline ?? 'Active') !== 'Active').length;
  };

  // Recently used lines — quick-jump chips beat scrolling a 39-line dropdown
  const [recentLines, setRecentLines] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('downtimeRecentLines') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    setRecentLines((prev) => {
      const next = [currentLine, ...prev.filter((l) => l !== currentLine)].slice(0, 6);
      try { localStorage.setItem('downtimeRecentLines', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [currentLine]);

  const allLines = Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`);
  const prevLine = () =>
    setCurrentLine(allLines[(allLines.indexOf(currentLine) - 1 + allLines.length) % allLines.length]);
  const nextLine = () =>
    setCurrentLine(allLines[(allLines.indexOf(currentLine) + 1) % allLines.length]);

  const entryFor = (date) =>
    (getDayData(date)[currentLine]) || { heads: makeDefaultHeads(), machineNotes: '', running: false };

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
    labels: orderedDates,
    datasets: [
      {
        label: 'Offline',
        data: orderedDates.map((d) =>
          (entryFor(d).heads || makeDefaultHeads()).filter((h) => h.offline !== 'Active').length
        ),
        backgroundColor: '#EF4444'
      },
      {
        label: 'Fixed',
        data: orderedDates.map((d) =>
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
  }), [orderedDates, currentLine, useData]);

  // Daily report PDF: every offline head (all lines, with running status),
  // its issues/fix status/notes, plus machine notes — for one date.
  const exportDailyReport = async (date) => {
    try {
      const [{ default: jsPDF }, { default: autoTable }, { loadThumbs, drawThumbRow }] =
        await Promise.all([
          import('jspdf'),
          import('jspdf-autotable'),
          import('../utils/pdfPhotos'),
        ]);
      const dayData = getDayData(date);
      const lineNum = (l) => parseInt(String(l).replace('Line ', ''), 10) || 0;
      const headRows = [];
      const machineRows = [];
      // Photos are collected as we walk the day rather than fetched per row:
      // one batched download beats dozens of sequential ones on a phone.
      const photoUrls = [];
      const addPhotos = (list) => (list || []).forEach((ph) => {
        if (ph?.url) photoUrls.push(ph.url);
      });
      let offline = 0;
      let fixedCt = 0;
      Object.keys(dayData).sort((a, b) => lineNum(a) - lineNum(b)).forEach((line) => {
        const entry = dayData[line] || {};
        (entry.heads || []).forEach((h) => {
          if (!h || (h.offline ?? 'Active') === 'Active') return;
          offline += 1;
          const issues = h.issues || [];
          const allFixed = issues.length > 0 && issues.every((iss) => iss.repaired === 'Fixed');
          if (allFixed) fixedCt += 1;
          issues.forEach((iss) => addPhotos(iss.photos));
          addPhotos(h.photos);
          const issueText = issues.length
            ? issues.map((iss) => `${iss.type}${iss.replacementReason ? ` (${iss.replacementReason})` : ''} — ${iss.repaired || 'Not Fixed'}`).join('\n')
            : 'Undetermined';
          headRows.push([line, String(h.head), allFixed ? 'Fixed' : 'Not Fixed', issueText, h.notes || '']);
        });
        if ((entry.machineNotes || '').trim()) machineRows.push([line, entry.machineNotes.trim()]);
        addPhotos(entry.notePhotos);
      });

      // Parts replaced on this date. Read once here rather than subscribed —
      // the report is a snapshot of a day that is already over.
      let partRows = [];
      try {
        const snap = await get(ref(database, 'jti-downtime/parts-log'));
        partRows = Object.values(snap.val() || {})
          .filter((e) => (e.performedAt || '').slice(0, 10) === date)
          .sort((a, b) => new Date(a.performedAt) - new Date(b.performedAt))
          .map((e) => {
            addPhotos(e.photos);
            const extra = Array.isArray(e.parts) && e.parts.length > 1
              ? ` (+${e.parts.length - 1} more)` : '';
            return [
              e.line || '',
              e.head != null ? String(e.head) : 'machine',
              e.boardType || '',
              [e.partNumber, e.partName].filter(Boolean).join(' — ') + extra
                + (e.partNumber ? (e.partVerified ? '  [manual]' : '  [unverified]') : ''),
              [e.reason, e.notes].filter(Boolean).join(' · '),
            ];
          });
      } catch (err) {
        console.warn('parts for daily report unavailable:', err?.message || err);
      }

      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text('Downtime Logger — Daily Report', 14, 18);
      doc.setFontSize(11);
      doc.text(`Date: ${date}`, 14, 26);
      doc.text(`Offline heads: ${offline}    Fixed: ${fixedCt}    Not fixed: ${offline - fixedCt}`, 14, 32);
      if (headRows.length) {
        autoTable(doc, {
          startY: 38,
          head: [['Line', 'Head', 'Status', 'Issues', 'Notes']],
          body: headRows,
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [66, 66, 66] },
          columnStyles: { 3: { cellWidth: 65 }, 4: { cellWidth: 50 } },
        });
      } else {
        doc.text('No offline heads recorded.', 14, 40);
      }
      if (machineRows.length) {
        const y = (doc.lastAutoTable?.finalY || 44) + 10;
        doc.setFontSize(13);
        doc.text('Machine Notes', 14, y);
        autoTable(doc, {
          startY: y + 4,
          head: [['Line', 'Note']],
          body: machineRows,
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [66, 66, 66] },
        });
      }
      if (partRows.length) {
        const y = (doc.lastAutoTable?.finalY || 44) + 10;
        doc.setFontSize(13);
        doc.text('Parts / boards replaced', 14, y);
        autoTable(doc, {
          startY: y + 4,
          head: [['Line', 'Head', 'Replaced', 'Part', 'Reason / notes']],
          body: partRows,
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [66, 66, 66] },
          columnStyles: { 3: { cellWidth: 55 }, 4: { cellWidth: 45 } },
        });
      }

      if (photoUrls.length) {
        const unique = [...new Set(photoUrls)];
        const { thumbs, failed, skipped } = await loadThumbs(unique);
        let y = (doc.lastAutoTable?.finalY || 44) + 10;
        if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 20; }
        doc.setFontSize(13);
        doc.text('Photos', 14, y);
        y += 4;
        if (thumbs.length) y = drawThumbRow(doc, thumbs, y);
        // Say what is missing rather than quietly showing fewer photos than
        // the day actually has.
        const notes = [
          failed ? `${failed} photo${failed === 1 ? '' : 's'} could not be loaded` : '',
          skipped ? `${skipped} more not included (limit reached)` : '',
        ].filter(Boolean);
        if (notes.length) {
          doc.setFontSize(9);
          doc.text(notes.join('; '), 14, Math.min(y + 2, doc.internal.pageSize.getHeight() - 10));
        }
      }

      doc.save(`daily-report-${date}.pdf`);
      toast.success(`Daily report exported — ${offline} offline head${offline === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error('Report export failed: ' + e.message);
    }
  };

  // One collapsible day card. Rendered in two spots: the current/selected
  // day as the working card up top, and the remaining days at the very bottom.
  const renderDayCard = (date) => {
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

          const lineCounts = (() => {
            const off = (heads || makeDefaultHeads()).filter(h => h.offline !== 'Active');
            const fixed = off.filter(h => {
              const issues = h.issues || [];
              return issues.length > 0 && issues.every(iss => iss.repaired === 'Fixed');
            });
            return { notFixed: off.length - fixed.length, fixed: fixed.length };
          })();

          return (
            <div key={date} className={`card overflow-hidden transition-shadow ${isExpanded ? 'shadow-md' : ''}`}>
              {/* Header */}
              <div className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {date === todayYmd && (
                    <span className="pill bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">Today</span>
                  )}
                  {lockedDays[date] && <span aria-label="Locked">🔒</span>}
                  {/* Free-text day label, e.g. "Day 3". Locked days show it as
                      plain text so a finished day can't be relabelled. */}
                  {lockedDays[date] ? (
                    dayLabels[date] ? (
                      <span className="pill bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-semibold">
                        {formatDayLabel(dayLabels[date])}
                      </span>
                    ) : null
                  ) : (
                    <input
                      type="text"
                      value={dayLabels[date] || ''}
                      onChange={(e) => setDayLabel(date, e.target.value)}
                      placeholder="Day #"
                      aria-label={`Day label for ${date}`}
                      title='Type a number (shows as "Day 4") or any text you like'
                      maxLength={20}
                      className="text-sm font-semibold border border-gray-300 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-100 rounded-lg px-2 py-1.5 w-20 placeholder:font-normal placeholder:text-gray-400"
                    />
                  )}
                  {!lockedDays[date] && dayLabels[date] && (
                    <span className="pill bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-semibold">
                      {formatDayLabel(dayLabels[date])}
                    </span>
                  )}
                  <DatePicker
                    selected={date ? new Date(date + 'T00:00:00') : null}
                    onChange={(newDate) => {
                      if (newDate) {
                        handleEditDate(date, toYmd(newDate));
                      }
                    }}
                    disabled={!!lockedDays[date]}
                    dateFormat="yyyy-MM-dd"
                    className="text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-100 rounded-lg px-2 py-1.5 w-32 disabled:opacity-60"
                    popperClassName="react-datepicker-dark"
                    calendarClassName="dark:bg-gray-800"
                  />
                  {lockedDays[date] && (
                    <span className="pill bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Finished</span>
                  )}
                  {lineCounts.notFixed > 0 && (
                    <span className="pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{lineCounts.notFixed} not fixed</span>
                  )}
                  {lineCounts.fixed > 0 && (
                    <span className="pill bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">{lineCounts.fixed} fixed</span>
                  )}
                  {lineCounts.notFixed === 0 && lineCounts.fixed === 0 && (
                    <span className="pill bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">all active</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => exportDailyReport(date)}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                    title={`Export daily report PDF for ${date}`}
                  >
                    PDF
                  </button>
                  {lockedDays[date] ? (
                    <button
                      onClick={() => unlockDay(date)}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60 transition-colors"
                    >
                      Unlock
                    </button>
                  ) : (
                    <button
                      onClick={() => finishDay(date)}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                    >
                      Finish Day
                    </button>
                  )}
                  <button
                    onClick={() => toggleDay(date)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-gray-600 dark:text-gray-300"
                    aria-expanded={isExpanded}
                  >
                    <span className="text-sm whitespace-nowrap">{isExpanded ? 'Collapse' : 'Expand'}</span>
                    <svg className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Body */}
              {isExpanded && (
                <div className="p-4 bg-white dark:bg-gray-800 space-y-4">
                  {lockedDays[date] && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-200">
                      <span>🔒</span>
                      <span>This day is finished and saved to Head History. Tap <b>Unlock</b> to edit it.</span>
                    </div>
                  )}
                  {/* Heads display (table on desktop / cards on mobile when viewMode === table) */}
                  {viewMode === 'table' && (
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full table-auto border-collapse min-w-max">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700/60">
                            {['Head', 'Status', 'Issues', 'Notes'].map((c) => (
                              <th key={c} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">{c}</th>
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
                                  const meta = repeatMetaFor(h.head);
                                  return (
                                    <HeadRow
                                      key={h.originalIndex}
                                      head={h}
                                      date={date}
                                      currentLine={currentLine}
                                      repeatCount={meta.count}
                                      repeatTitle={meta.title}
                                      onUpdateField={handleUpdateField}
                                      onOpenHistory={openHeadHistory}
                                    locked={!!lockedDays[date]}
                                    />
                                  );
                                })}

                                {/* Collapsible Active Heads section */}
                                {activeEmpty.length > 0 && (
                                  <>
                                    <tr>
                                      <td colSpan="4" className="p-0 border dark:border-gray-600">
                                        <button
                                          onClick={() => toggleActiveHeads(date)}
                                          className="w-full p-2 text-left bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-between"
                                        >
                                          <span className="text-sm font-medium dark:text-gray-200">
                                            Active Heads with No Issues ({activeEmpty.length})
                                          </span>
                                          <svg
                                            className={`w-5 h-5 transition-transform dark:text-gray-200 ${activeHeadsOpen.has(date) ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                      </td>
                                    </tr>
                                    {activeHeadsOpen.has(date) && activeEmpty.map((h) => {
                                      const meta = repeatMetaFor(h.head);
                                      return (
                                        <HeadRow
                                          key={h.originalIndex}
                                          head={h}
                                          date={date}
                                          currentLine={currentLine}
                                          repeatCount={meta.count}
                                          repeatTitle={meta.title}
                                          onUpdateField={handleUpdateField}
                                          onOpenHistory={openHeadHistory}
                                    locked={!!lockedDays[date]}
                                        />
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
                                const meta = repeatMetaFor(h.head);
                                return (
                                  <HeadCard
                                    key={h.originalIndex}
                                    head={h}
                                    date={date}
                                    currentLine={currentLine}
                                    repeatCount={meta.count}
                                    repeatTitle={meta.title}
                                    onUpdateField={handleUpdateField}
                                    onOpenHistory={openHeadHistory}
                                    locked={!!lockedDays[date]}
                                  />
                                );
                              })}
                            </div>

                            {/* Collapsible Active Heads section */}
                            {activeEmpty.length > 0 && (
                              <div className="mb-4">
                                <button
                                  onClick={() => toggleActiveHeads(date)}
                                  className="w-full p-3 text-left bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex items-center justify-between border-2 border-gray-300 dark:border-gray-600"
                                >
                                  <span className="text-sm font-medium dark:text-gray-200">
                                    Active Heads with No Issues ({activeEmpty.length})
                                  </span>
                                  <svg
                                    className={`w-5 h-5 transition-transform dark:text-gray-200 ${activeHeadsOpen.has(date) ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>

                                {activeHeadsOpen.has(date) && (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                    {activeEmpty.map((h) => {
                                      const meta = repeatMetaFor(h.head);
                                      return (
                                        <HeadCard
                                          key={h.originalIndex}
                                          head={h}
                                          date={date}
                                          currentLine={currentLine}
                                          repeatCount={meta.count}
                                          repeatTitle={meta.title}
                                          onUpdateField={handleUpdateField}
                                          onOpenHistory={openHeadHistory}
                                    locked={!!lockedDays[date]}
                                        />
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

                  {/* Machine notes, with photos for this line/day */}
                  <div>
                    <label className="block mb-1 font-medium dark:text-gray-100 sm:text-sm">Machine Notes:</label>
                    <textarea
                      rows={3}
                      value={machineNotes}
                      onChange={(e) => updateEntry({ machineNotes: e.target.value })}
                      className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 p-2 rounded sm:text-sm"
                    />
                    <div className="mt-2">
                      <Photos
                        photos={entry.notePhotos}
                        onChange={(next) => updateEntry({ notePhotos: next })}
                        pathPrefix={`downtime-photos/${date}/${currentLine}/notes`}
                        disabled={!!lockedDays[date]}
                        label="Notes photo"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header + actions */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Downtime Logger</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {currentLine} · {currentDay}{currentDay === todayYmd ? ' (Today)' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Card/Table view toggle — desktop only; mobile always uses cards */}
          <div className="hidden md:inline-flex p-0.5 rounded-lg bg-gray-100 dark:bg-gray-700">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              Cards
            </button>
          </div>

          {/* Cloud sync status — click to save now / retry.
              Priority order matters: a paused or failed sync must win over a
              stale "Saved", otherwise the chip reassures you while your edits
              are only on this device. */}
          <button
            onClick={writeCloud}
            title={
              cloudNewerInfo
                ? 'Another device saved newer data — choose Load or Keep above. Autosave is paused.'
                : cloudState === 'error'
                ? 'The last save failed. Click to retry.'
                : dirty
                ? 'This device has changes not in the cloud yet. Click to save now.'
                : 'Everything on this device is saved to the cloud.'
            }
            className={
              'pill transition-colors ' +
              (cloudNewerInfo
                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                : cloudState === 'error'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : cloudState === 'saving'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : dirty
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                : cloudState === 'saved'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300')
            }
          >
            {cloudNewerInfo ? (
              <>☁️ Cloud is newer · paused</>
            ) : cloudState === 'error' ? (
              <>⚠ Not saved · tap to retry</>
            ) : cloudState === 'saving' ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving…
              </>
            ) : dirty ? (
              <>● This device is ahead · tap to save</>
            ) : cloudState === 'saved' ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                In sync{lastSavedAt ? ` · ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
              </>
            ) : (
              <>Autosave on</>
            )}
          </button>

          {/* Actions dropdown (Import, Export, Load, Reset*) */}
          <div className="relative">
            <button
              onClick={() => setActionsOpen((v) => !v)}
              className="btn-secondary"
            >
              Actions
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* The file input must stay mounted even when the dropdown closes —
                if it lived inside the dropdown, closing it on click would unmount
                the input and the chosen file's change event would go nowhere.
                Opened via ref.click() (not a <label>): closing the dropdown
                unmounts the label mid-click and some browsers then cancel the
                pending label→input activation, so the dialog never opened. */}
            <input ref={importInputRef} id="import-json" type="file" accept=".json" hidden onChange={handleImport} />
            {actionsOpen && (
              <div className="absolute right-0 mt-2 w-56 card shadow-lg z-20 py-1 overflow-hidden">
                <button
                  onClick={() => {
                    importInputRef.current?.click(); // still inside the user gesture
                    setActionsOpen(false);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-100"
                >
                  Import
                </button>
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    handleExport();
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-100"
                >
                  Export
                </button>
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    handleLoadFromCloud();
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-100"
                >
                  Load
                </button>
                <hr className="my-1 border-gray-200 dark:border-gray-700" />
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    if (confirm(`Reset ${currentLine} for ${currentDay}? Heads & notes will be cleared.`)) {
                      resetLineForDate(currentDay);
                    }
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-100"
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
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-100"
                >
                  Reset Day (all lines)
                </button>
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    const d = prompt('Date to log (YYYY-MM-DD):', todayYmd);
                    if (!d) return;
                    if (isYmd(d)) startDay(d);
                    else toast.error('Use the YYYY-MM-DD format');
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-100"
                >
                  Log a Past Date…
                </button>
                {currentDay && (
                  <button
                    onClick={() => {
                      setActionsOpen(false);
                      removeDay(currentDay);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm text-red-700 dark:text-red-400"
                  >
                    Remove This Day ({currentDay})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Newer-cloud banner: another device saved after this one last synced */}
      {cloudNewerInfo && (
        <div className="card p-3 border-l-4 !border-l-indigo-500 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[220px] text-sm text-gray-800 dark:text-gray-100">
            <span className="font-semibold">☁️ Newer data in the cloud</span> — saved{' '}
            {new Date(cloudNewerInfo.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })},
            likely from another device. Autosave is paused until you choose.
          </div>
          <button
            className="btn-primary"
            onClick={() => {
              setCloudNewerInfo(null);
              handleLoadFromCloud();
            }}
          >
            Load Cloud Data
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              markCloudSeen(cloudNewerInfo.savedAt);
              setCloudNewerInfo(null);
              toast.info("Keeping this device's data — your next edit will overwrite the cloud");
            }}
          >
            Keep This Device
          </button>
        </div>
      )}

      {/* Day selector tabs — Day 1 → Day N (chronological). Tap a day to focus it. */}
      <div className="card p-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {orderedDates.map((d) => {
            const active = d === currentDay;
            const dt = new Date(d + 'T00:00:00');
            const weekday = dt.toLocaleDateString(undefined, { weekday: 'short' });
            const dayNum = dt.getDate();
            const month = dt.toLocaleDateString(undefined, { month: 'short' });
            const off = offlineCountForDay(d);
            return (
              <button
                key={d}
                onClick={() => selectDay(d)}
                aria-pressed={active}
                className={
                  'relative flex-1 min-w-[64px] flex flex-col items-center py-2 px-1 rounded-lg transition-colors ' +
                  (active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600')
                }
              >
                <span className={'text-[11px] font-bold uppercase tracking-wide ' + (active ? '' : (d === todayYmd ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-300'))}>
                  {d === todayYmd ? 'Today' : weekday}{lockedDays[d] ? ' 🔒' : ''}
                </span>
                <span className="text-lg font-bold leading-none my-0.5">{dayNum}</span>
                <span className={'text-[10px] ' + (active ? 'opacity-90' : 'opacity-60')}>{month}</span>
                {dayLabels[d] && (
                  <span className={'text-[10px] font-semibold leading-none mt-0.5 ' + (active ? 'opacity-95' : 'text-indigo-600 dark:text-indigo-300')}>
                    {formatDayLabel(dayLabels[d])}
                  </span>
                )}
                {off > 0 && (
                  <span
                    className={
                      'absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-2 ' +
                      (active ? 'bg-white text-red-600 border-indigo-600' : 'bg-red-500 text-white border-white dark:border-gray-800')
                    }
                    title={`${off} offline on ${d}`}
                  >
                    {off}
                  </span>
                )}
              </button>
            );
          })}
          {!useDates.includes(todayYmd) && (
            <button
              onClick={() => startDay(todayYmd)}
              className="flex-none min-w-[64px] flex flex-col items-center justify-center py-2 px-2 rounded-lg border-2 border-dashed border-emerald-400 dark:border-emerald-600 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
              title={`Start logging today (${todayYmd})`}
            >
              <span className="text-lg font-bold leading-none">▶</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide">Start Today</span>
            </button>
          )}
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
          <div className="card p-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium whitespace-nowrap text-gray-700 dark:text-gray-200">Line</span>
              <select
                value={currentLine}
                onChange={(e) => setCurrentLine(e.target.value)}
                className="field w-auto py-2"
              >
                {Array.from({ length: 39 }, (_, i) => `Line ${i + 1}`).map((line) => (
                  <option key={line} value={line}>{line}</option>
                ))}
              </select>
              <button onClick={prevLine} className="btn-ghost !px-3 !py-2" aria-label="Previous line">‹ Prev</button>
              <button onClick={nextLine} className="btn-ghost !px-3 !py-2" aria-label="Next line">Next ›</button>
            </div>
            <span className="pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Not Fixed: {notFixedCount}</span>
            <span className="pill bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Fixed: {fixedCount}</span>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-700 dark:text-gray-200">Running</span>
              <button
                onClick={toggleRunning}
                aria-pressed={isRunning}
                className={'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-semibold transition-colors ' + (isRunning ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-gray-400 hover:bg-gray-500 dark:bg-gray-600')}
              >
                <span className={'w-2 h-2 rounded-full ' + (isRunning ? 'bg-white' : 'bg-gray-200')} />
                {isRunning ? 'ON' : 'OFF'}
              </button>
            </div>
            {recentLines.filter((l) => l !== currentLine).length > 0 && (
              <div className="w-full flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">Recent:</span>
                {recentLines.filter((l) => l !== currentLine).slice(0, 5).map((l) => (
                  <button
                    key={l}
                    onClick={() => setCurrentLine(l)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50 transition-colors"
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Quick Head Toggle */}
      <div className="card p-4">
        <h3 className="text-base font-semibold mb-3 text-gray-900 dark:text-gray-100">
          Quick Head Toggle
          <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">tap a head to toggle online/offline</span>
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
                className={`flex flex-col items-center justify-center min-h-[3.5rem] px-2 py-2 rounded-xl ${bgColor} ${textColor} hover:opacity-90 active:scale-95 transition-all relative shadow-sm`}
                title={isRepeat ? `Head ${headNum} - ${displayText} - REPEAT: Offline on ${isRepeat.length} days\n${isRepeat.map(info => `${info.date}: ${info.issues.length > 0 ? info.issues.join(', ') : 'No issue specified'}`).join('\n')}` : `Head ${headNum} - ${displayText}`}
              >
                {isRepeat && (
                  <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-yellow-400 text-yellow-900 rounded-full flex items-center justify-center text-xs font-bold border-2 border-white shadow">
                    {isRepeat.length}
                  </div>
                )}
                <span className="font-bold text-lg leading-none">{headNum}</span>
                <span className="text-[10px] font-medium uppercase tracking-wide opacity-90 mt-0.5">{displayText}</span>
              </button>
            );
          })}
        </div>

        {/* Color Legend */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="pill bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Active</span>
          <span className="pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />Offline</span>
          <span className="pill bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" />Fixed</span>
          <span className="pill bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"><span className="w-2.5 h-2.5 rounded-full bg-purple-500" />WDU</span>
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

      {/* Current/selected day — the working card */}
      {useDates.includes(currentDay) && (
        <div className="space-y-2">{renderDayCard(currentDay)}</div>
      )}

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

      {/* Previous days — collapsed archive at the very bottom */}
      {useDates.filter((d) => d !== currentDay).length > 0 && (
        <div className="space-y-2 pt-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Previous Days</h3>
          {useDates.filter((d) => d !== currentDay).map((d) => renderDayCard(d))}
        </div>
      )}

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
