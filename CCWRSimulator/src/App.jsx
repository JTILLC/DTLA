import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import navmap from './data/navmap.json';
import { initialFeeder, migrateFeeder, toggleParam, selectFeeder, adjust, readDefault, setDfField, dfFieldSpec } from './utils/feeder';
import { initialPans, togglePan, toggleTable, selectAllHeads, selectTable, ensurePan,
  nothingSelected, describe as describeSel, describeHeads } from './utils/panSelect';
import lessons from './data/lessons';
import screenInfo from './data/screenInfo';
import Rcu from './components/Rcu';
import InfoPanel from './components/InfoPanel';
import LessonPanel from './components/LessonPanel';
import ScreenIndex from './components/ScreenIndex';
import { drawers, drawerScreens, conditionsMet } from './utils/navGraph';
import { initialFlags, applySets, toggleFlag, REQUIRE_MESSAGES } from './utils/machineState';
import { toggleDeactivated } from './utils/production';
import { initialManagers, migrateManagers, managerOf, pickRow, canCopy, copyItem, wipeMemory, initialPick } from './utils/presetManager';
import { initialTiming, migrateTiming, selectRow, setSection, setDthPick, ensureVisible, rowOf, rowLabel,
  current as timingCurrent, step as timingStep, enter as timingEnter } from './utils/timing';

const STORAGE_KEY = 'ccwr-sim-v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupted or unavailable storage — start fresh, never crash */
  }
  return {};
}

export default function App() {
  const saved = useRef(loadState()).current;

  const [screen, setScreen] = useState(
    navmap.screens[saved.screen] ? saved.screen : 'main-menu'
  );
  const MODES = ['explore', 'lessons', 'free'];
  const [mode, setMode] = useState(MODES.includes(saved.mode) ? saved.mode : 'explore');
  /* Free mode: nothing steers and nothing is withheld. Every screen is one tap
     away from the index, and the power gate is off — for a trainer who wants to
     put a particular screen in front of somebody without walking the menu tree
     to reach it. It does not pretend the machine behaves this way; the mode is
     labeled, and Explore remains the faithful one. */
  const freeMode = mode === 'free';
  const [showHotspots, setShowHotspots] = useState(saved.showHotspots ?? true);
  const [activeLessonId, setActiveLessonId] = useState(saved.activeLessonId ?? null);
  const [stepIndex, setStepIndex] = useState(saved.stepIndex ?? 0);
  const [progress, setProgress] = useState(saved.progress ?? {});
  const [completed, setCompleted] = useState(saved.completed ?? []);
  const [openDrawer, setOpenDrawer] = useState(null); // null | 'machineSet' | 'selectTotal'
  const [history, setHistory] = useState([]);
  const [hint, setHint] = useState(null);
  const [wrongFlash, setWrongFlash] = useState(0);

  /* Control power. The real unit boots with it off: Stop and Start are
     dimmed and dead until the Power key is pressed (observed on the running
     original — pressing Start cold does nothing at all). */
  const [powerOn, setPowerOn] = useState(saved.powerOn ?? false);
  /* Which preset the Select Preset screen has loaded. The captured machine is
     running preset 1, so that is where it starts. */
  const [loadedPreset, setLoadedPreset] = useState(saved.loadedPreset ?? 1);
  /* Zero Adjustment selection. The real menu opens with every weigh hopper
     selected and the dispersion table not — blue means selected, and Start
     only runs on what is selected. */
  /* ONE of 'wh' | 'df' | null. Operation Manual 4.4.6 zeroes the weigh hoppers
     and then the dispersion table as separate operations, so selecting one
     clears the other — they are never both blue. */
  /* Zero Adjustment: a set of weigh hoppers OR the dispersion pan, never both
     (see utils/panSelect.js). Individual pans are tappable. */
  const [selection, setSelection] = useState(
    () => (saved.selection && Array.isArray(saved.selection.heads)
      ? saved.selection : initialPans()));
  const [zeroing, setZeroing] = useState(false);
  /* Feeder adjustment values: per head for RF, single for DF (6.12). */
  const [feeder, setFeeder] = useState(
    () => (saved.feeder ? migrateFeeder(saved.feeder, navmap.feederAdjust)
      : initialFeeder(navmap.feederAdjust)));
  /* Timing Adjustment: the selected row and the seven intervals (6.13). */
  const [timing, setTiming] = useState(
    () => (saved.timing ? migrateTiming(saved.timing, navmap.timingAdjust)
      : initialTiming(navmap.timingAdjust)));
  /* Production: heads deactivated by a tap on the Combination screen while
     stopped. They go grey with a yellow star and never join a combination. */
  const [deactivated, setDeactivated] = useState(
    () => (Array.isArray(saved.deactivated) ? saved.deactivated : []));
  /* The copy managers (Preset Manager, Machine Set Mngr): each its two
     stores' ten slots, and the rows picked as copy source and destination. */
  const [managers, setManagers] = useState(
    () => (saved.managers ? migrateManagers(saved.managers, navmap.copyManagers) : initialManagers(navmap.copyManagers)));
  const zeroTimer = useRef(null);
  const [powerBusy, setPowerBusy] = useState(false); // the "Please wait" pop-up
  /* The machine's state beyond power: access level, running or stopped,
     draining, the lamps, Average Control. Keys set and test these
     (utils/machineState.js), and the artwork answers to them. */
  const [flags, setFlags] = useState(() => ({ ...initialFlags(), ...(saved.flags || {}) }));
  /* What has been typed on an open keypad or keyboard. */
  const [typed, setTyped] = useState('');
  const [blink, setBlink] = useState(false);
  const autoTimer = useRef(null);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);
  const powerTimer = useRef(null);

  const showNotice = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  /* Taps arrive faster than React re-renders — three pans tapped in quick
     succession all read the same closed-over selection and two of them are
     lost. The ref always holds the latest, so each tap builds on the one
     before it, and the notice can still name the result. */
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const applySelection = useCallback((fn, message) => {
    const next = fn(selectionRef.current);
    selectionRef.current = next;
    setSelection(next);
    if (message) showNotice(message(next));
  }, [showNotice]);

  useEffect(() => () => {
    clearTimeout(noticeTimer.current);
    clearTimeout(powerTimer.current);
    clearTimeout(zeroTimer.current);
  }, []);

  const lesson = lessons.find((l) => l.id === activeLessonId) || null;
  const step = lesson && stepIndex < lesson.steps.length ? lesson.steps[stepIndex] : null;
  /* A part-finished lesson used to keep intercepting taps after you switched
     back to Explore: every key that was not its next step flashed red and did
     nothing, which looks exactly like a broken screen. A lesson only steers
     while you are actually in Lessons. */
  const lessonActive = mode === 'lessons' && Boolean(step);

  /* Persist everything that matters — a reload or a closed iPad never
     loses the trainee's place. */
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          screen, mode, showHotspots,
          activeLessonId, stepIndex, progress, completed, powerOn, loadedPreset,
          selection, feeder, flags, timing, deactivated, managers,
        })
      );
    } catch {
      /* storage full/unavailable: keep running */
    }
  }, [screen, mode, showHotspots, activeLessonId, stepIndex, progress, completed,
      powerOn, loadedPreset, selection, feeder, flags, timing, deactivated, managers]);

  /* A lesson step always happens on its own screen. */
  useEffect(() => {
    if (step && step.screen !== screen) setScreen(step.screen);
    setOpenDrawer(null);
    setHint(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLessonId, stepIndex]);

  /* Prefetch the screens one tap away so navigation feels instant. */
  useEffect(() => {
    const targets = new Set(
      (navmap.screens[screen]?.hotspots || []).map((h) => h.to).filter(Boolean)
    );
    for (const drawer of drawers(navmap)) {
      if (drawerScreens(drawer).includes(screen)) {
        for (const item of drawer.items) {
          if (item.to) targets.add(item.to);
        }
      }
    }
    for (const t of targets) {
      if (!navmap.screens[t]) continue;
      const img = new Image();
      img.src = `/${navmap.screens[t].image}`;
    }
  }, [screen]);

  const navigate = useCallback((to) => {
    // A screen that opens on a pop-up (Preset Manager's "Loading preset
    // data") lands on that state first; the pop-up clears itself.
    // ... but coming back from one of its own pop-ups is not entering it:
    // the program does not reload the presets after a Copy or a list pick.
    const fromOwnState = navmap.screens[screen]?.parent === to;
    const dest = (!fromOwnState && navmap.screens[to]?.onEnter) || to;
    setHistory((h) => [...h.slice(-49), screen]);
    setScreen(dest);
    setOpenDrawer(null);
  }, [screen]);

  /* Wait pop-ups clear themselves — power-up, zero adjustment, the wizard's
     "In WH Zero Adjst." — and may change the machine when they do (a
     finished zero adjustment deselects everything). */
  useEffect(() => {
    const s = navmap.screens[screen];
    clearTimeout(autoTimer.current);
    if (!s?.autoNext) return undefined;
    autoTimer.current = setTimeout(() => {
      if (s.sets) {
        setFlags((f) => applySets(f, s.sets));
        if (s.sets.zeroDone) {
          setSelection({ heads: [], table: false });
          showNotice('Zero adjustment complete. Confirm each hopper reads 0.0 ±0.1 g (4.4.6).');
        }
      }
      setScreen(s.autoNext.to);
    }, s.autoNext.ms);
    return () => clearTimeout(autoTimer.current);
  }, [screen, showNotice]);

  /* A keypad opens showing the value it holds — a fixed seed for the ones
     whose artwork cannot change, the live value for the DF target weight. */
  useEffect(() => {
    const s = navmap.screens[screen];
    if (!s?.keypad) return;
    if (s.keypad.seedFrom === 'timing') setTyped(String(timingCurrent(timing, navmap.timingAdjust)));
    else if (s.keypad.seedFrom) setTyped(String(feeder[s.keypad.seedFrom] ?? ''));
    else setTyped(s.keypad.seed || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const advanceLesson = useCallback(() => {
    const next = stepIndex + 1;
    setStepIndex(next);
    setProgress((p) => ({ ...p, [activeLessonId]: next }));
    if (lesson && next >= lesson.steps.length) {
      setCompleted((c) => (c.includes(activeLessonId) ? c : [...c, activeLessonId]));
      setProgress((p) => ({ ...p, [activeLessonId]: 0 }));
    }
    setHint(null);
  }, [stepIndex, activeLessonId, lesson]);

  const togglePower = useCallback(() => {
    if (powerBusy) return;
    if (powerOn) {
      /* Observed on the running original: switching OFF is instant — no
         pop-up — and works from any screen. Mid-production, one press
         stops the machine AND cuts power in the same stroke. */
      setPowerOn(false);
      setFlags((f) => ({ ...f, running: false, drain: false }));
      return;
    }
    /* Observed: powering ON shows "Please wait a moment." with an hourglass
       and a progress bar for about ten seconds, the whole bottom bar
       (HOME included) locked out. The simulator plays the same sequence,
       shortened. */
    setPowerBusy(true);
    powerTimer.current = setTimeout(() => {
      setPowerBusy(false);
      setPowerOn(true);
    }, 3800);
  }, [powerBusy, powerOn]);

  const POWER_MSG =
    'The machine is not powered on — press the Power key first. On the ' +
    'real unit this key is dimmed and completely dead until power is on.';

  const handleTap = useCallback((evt) => {
    if (powerBusy) return; // everything is locked out during power-up

    if (evt.type === 'power') {
      if (lessonActive && step.kind === 'tap-power') {
        /* The step's goal is power ON. If a resumed lesson already has it
           on, don't toggle it back off — just move on. */
        if (!powerOn) togglePower();
        advanceLesson();
        return;
      }
      togglePower(); // the Power key stays a real, working control mid-lesson
      return;
    }

    if (evt.type === 'feeder-select') {
      setFeeder((f) => selectFeeder(f, evt.which));
      showNotice(evt.which === 'rf'
        ? 'Radial feeders — one behind each pool hopper, so the head strip applies.'
        : 'Dispersion feeder — a single feeder, so there is no head to pick.');
      return;
    }
    if (evt.type === 'feeder-head') {
      /* The preset screen's head strip. The heads shown are the shared pan
         selection, so a tap has to go through it — toggling a private list
         changed nothing on screen. */
      handleTap({ type: 'feeder-pan', no: evt.no });
      return;
    }
    if (evt.type === 'feeder-param') {
      setFeeder((f) => toggleParam(f, evt.which));
      return;
    }
    if (evt.type === 'feeder-adjust') {
      // The pans selected on Zero Adjustment are the pans adjusted here.
      const live = { ...feeder, heads: selection.table ? [] : selection.heads };
      const { reason } = adjust(live, navmap.feederAdjust, evt.direction);
      if (reason === 'no-param') {
        showNotice('Light the Time or AMP lamp key first — step 2 of 6.12. '
          + 'The arrows only move a value that is lit.');
      } else if (reason === 'no-head') {
        showNotice('No head is selected. Press the head numbers to adjust; '
          + 'they turn blue (6.12).');
      }
      setFeeder((f) => adjust({ ...f, heads: live.heads }, navmap.feederAdjust,
        evt.direction).state);
      return;
    }

    if (evt.type === 'feeder-pan') {
      /* A head tapped on Production's trough or ring. The heads are the radial
         feeders' business: with the dispersion feeder picked (the ① on the
         disc) nothing was lighting, so the tap goes back to RF with that head
         lit — the head strip is how you come back, the disc is how you go. */
      if (zeroing) return;
      if (feeder.feeder === 'df') {
        setFeeder((f) => selectFeeder(f, 'rf'));
        applySelection(
          (cur) => ensurePan(cur, evt.no),
          (next) => `Back to the radial feeders — ${describeHeads(next)} selected. `
            + 'The ① on the disc picks DF; tapping a head picks RF.',
        );
      } else {
        applySelection(
          (cur) => togglePan(cur, evt.no),
          (next) => (nothingSelected(next)
            ? 'No head selected — Increase and Decrease have nothing to move.'
            : `Selected: ${describeHeads(next)}. Blue heads are the ones Increase and Decrease move (6.12).`),
        );
      }
      return;
    }

    if (evt.type === 'timing-row') {
      const row = rowOf(navmap.timingAdjust, evt.key);
      const next = selectRow(timing, evt.key);
      setTiming(next);
      showNotice(`${rowLabel(row, next)}: ${row.desc} The arrows and Entr now act on this row.`);
      return;
    }
    if (evt.type === 'timing-step') {
      const ta = navmap.timingAdjust;
      const { state: next, changed } = timingStep(timing, ta, evt.delta);
      setTiming(next);
      const label = rowLabel(rowOf(ta, timing.sel), timing);
      showNotice(changed === 0
        ? `${label} is already at ${timingCurrent(next, ta)} ms — the arrows stop at ${evt.delta < 0 ? ta.min : ta.max}.`
        : `${label} ${changed > 0 ? '+' : ''}${changed} ms → ${timingCurrent(next, ta)} ms.`);
      return;
    }
    if (evt.type === 'timing-section') {
      const sec = navmap.timingAdjust.sections[String(evt.section)];
      setTiming((t) => setSection(t, evt.section));
      showNotice(`${sec.label} — heads ${sec.heads}. ${evt.section === 1
        ? 'This section adjusts TH1 and owns DTH1 and DTH2.'
        : 'This section adjusts TH2 and owns DTH3 and DTH4.'} The other section keeps its own numbers.`);
      return;
    }
    if (evt.type === 'timing-dth') {
      setTiming((t) => setDthPick(t, evt.pick));
      showNotice(`The IS-DTH row now edits DTH${(timing.section - 1) * 2 + evt.pick + 1}.`);
      return;
    }
    if (evt.type === 'machine-option') {
      /* Which units the machine has. Not a key on the RCU: a trainer's choice
         of machine, so it lives in the app bar. */
      const flag = { bh: 'optBH', th: 'optTH', dth: 'optDTH' }[evt.option];
      const nextFlags = toggleFlag(flags, flag);
      setFlags(nextFlags);
      setTiming((t) => ensureVisible(t, navmap.timingAdjust,
        { bh: nextFlags.optBH, th: nextFlags.optTH, dth: nextFlags.optDTH }));
      const opt = navmap.timingAdjust.options[evt.option];
      showNotice(`${opt.name} ${nextFlags[flag] ? 'added' : 'removed'}. ${opt.note}`);
      return;
    }

    if (evt.type === 'manager-row') {
      const spec = navmap.copyManagers[evt.mgr];
      const next = pickRow(managers[evt.mgr].pick, evt.side, evt.no);
      setManagers((m) => ({ ...m, [evt.mgr]: { ...m[evt.mgr], pick: next } }));
      const store = spec.stores[flags[spec.flags[evt.side]]];
      showNotice(next[evt.side]
        ? `${evt.side === 'src' ? 'Copy source' : 'Copy destination'}: ${store} slot ${evt.no}${canCopy(next) ? ' — Copy is live.' : evt.side === 'src' ? '. Now pick the destination slot on the right.' : '. Now pick the source on the left.'}`
        : 'Row cleared.');
      return;
    }
    if (evt.type === 'head-deactivate') {
      /* Stopped, a tap deactivates a head or brings it back; running, the
         program ignores the hoppers, so say what to do. */
      if (flags.running) {
        setWrongFlash((n) => n + 1);
        showNotice('Press Stop first, then tap the head to deactivate it. Tap a deactivated head, stopped, to bring it back.');
        return;
      }
      const next = toggleDeactivated(deactivated, evt.no);
      setDeactivated(next);
      showNotice(next.includes(evt.no)
        ? `Head ${evt.no} deactivated — grey with a yellow star, and left out of every combination. Stopped, tap it again to bring it back.`
        : `Head ${evt.no} back online.`);
      return;
    }

    if (evt.type === 'feeder-deselect') {
      /* The trainer's Deselect key: head 1 alone, on the radial feeders. */
      setFeeder((f) => selectFeeder(f, 'rf'));
      applySelection(() => ({ heads: [1], table: false }),
        () => 'Selection cleared to head 1. Tap heads to add them again.');
      return;
    }

    if (evt.type === 'hdrv-param') {
      const unit = navmap.hdrvParameter?.units?.[evt.unit] || 'this unit';
      const opt = navmap.hdrvParameter?.options.find((o) => o.no === evt.no);
      setFlags((f) => ({ ...f, hdrvParam: { ...(f.hdrvParam || {}), [evt.unit]: evt.no } }));
      setOpenDrawer(null);
      showNotice(`${unit}: Parameter ${evt.no} — ${opt?.desc || ''}. Three drive-parameter sets `
        + 'exist per unit and the preset chooses one (Service 4.4.3.2.1).');
      return;
    }

    if (evt.type === 'pan' || evt.type === 'pan-table') {
      if (zeroing) return;
      applySelection(
        (cur) => (evt.type === 'pan-table' ? toggleTable(cur) : togglePan(cur, evt.no)),
        (next) => (nothingSelected(next)
          ? 'Nothing selected. Start has nothing to zero.'
          : `Selected: ${describeSel(next)}. Blue means selected; Start zeroes `
            + 'only what is blue.'),
      );
      return;
    }

    if (evt.type === 'select') {
      if (zeroing) return;
      applySelection(
        (cur) => (evt.which === 'df' ? selectTable(cur) : selectAllHeads(cur)),
        (next) => (nothingSelected(next)
          ? 'Cleared. Start has nothing to zero.'
          : `Selected: ${describeSel(next)}. The weigh hoppers and the dispersion `
            + 'table are zeroed as two separate steps (4.4.6), so picking one clears the other.'),
      );
      return;
    }

    if (evt.type === 'zero-start') {
      if (zeroing) return;
      if (!powerOn) {
        setWrongFlash((n) => n + 1);
        showNotice(POWER_MSG);
        return;
      }
      if (nothingSelected(selection)) {
        setWrongFlash((n) => n + 1);
        showNotice('Nothing is selected. Tap the pans you want, or press Slct All '
          + 'WH / Slct All DF — Start only zeroes what is shown in blue.');
        return;
      }
      // 4.4.6: "Please wait a moment." with its progress bar comes up over the
      // hoppers — the same pop-up as power-up — and when it clears the
      // selection has gone and Start is dark again. The pop-up is a captured
      // state that clears itself (autoNext) and deselects (sets.zeroDone).
      navigate('zero-adjust@starting');
      return;
    }

    if (evt.type === 'preset') {
      const tile = navmap.presetTiles.tiles.find((t) => t.no === evt.no);
      setLoadedPreset(evt.no);
      showNotice(
        tile?.configured
          ? `Preset ${tile.no} loaded — ${tile.name}, ${tile.target} at ${tile.speed}.`
          : `Preset ${evt.no} loaded. It is empty on this machine (0.0 g), so `
            + 'there is nothing to run — on a real unit you would set it up in the Preset menu first.',
      );
      return;
    }

    /* Keys that need the machine in a state: power on, stopped, Maintenance
       level, draining. Each says why it is dead (utils/machineState.js). */
    if (evt.requires && !conditionsMet(evt.requires, { ...flags, power: powerOn }, freeMode)) {
      setWrongFlash((n) => n + 1);
      const why = evt.requires.find((r) => !conditionsMet([r], { ...flags, power: powerOn }, false));
      showNotice(REQUIRE_MESSAGES[why] || `This key needs: ${why}.`);
      return;
    }

    /* Keypads and keyboards, the help blink, lamps, and keys that only change
       the machine's state. */
    if (evt.action === 'key') { setTyped((t) => t + evt.char); return; }
    if (evt.action === 'bs') { setTyped((t) => t.slice(0, -1)); return; }
    if (evt.action === 'clr') { setTyped(''); return; }
    if (evt.action === 'blink') {
      setBlink((b) => !b);
      showNotice('The ? key: every key you can press blinks until you press ? again.');
      return;
    }
    if (evt.action === 'inert') {
      setWrongFlash((n) => n + 1);
      showNotice(evt.note || 'This key does nothing here.');
      return;
    }
    if (evt.action === 'password') {
      // The keyboard commits the level that was picked on the list. 123 is the
      // Maintenance password from the Operation Manual; the demo accepts it
      // for every level, and rejects an empty entry.
      if (typed === '123') {
        setFlags((f) => ({ ...f, level: f.pendingLevel || f.level, pendingLevel: null }));
        showNotice('Access level set. Maintenance shows four yellow dots, and the Main Menu gains the Preset key and the Machine Set drawer.');
        navigate('main-menu');
      } else {
        setWrongFlash((n) => n + 1);
        showNotice(typed ? 'Wrong password. The Maintenance password is 1 2 3.' : 'Enter the password first — an empty entry is rejected.');
      }
      return;
    }
    if (evt.action === 'zero-start') {
      handleTap({ type: 'zero-start' });
      return;
    }
    if (evt.requiresPick && !canCopy(managers[evt.requiresPick].pick)) {
      const what = navmap.copyManagers[evt.requiresPick].what;
      setWrongFlash((n) => n + 1);
      showNotice(`Copy needs a source row (left) and a destination row (right) first. The source is where the ${what} is read from; the destination is where it is written.`);
      return;
    }
    if (evt.action === 'copy-write' || evt.action === 'copy-init') {
      const mgr = managerOf(navmap.copyManagers, navmap.screens, screen);
      const spec = navmap.copyManagers[mgr];
      const { stores, pick } = managers[mgr];
      const srcStore = flags[spec.flags.src];
      const dstStore = flags[spec.flags.dst];
      if (evt.action === 'copy-write') {
        const name = stores[srcStore][pick.src - 1];
        setManagers((m) => ({ ...m, [mgr]: { ...m[mgr], stores: copyItem(stores, pick, srcStore, dstStore) } }));
        showNotice(`Copied ${name ? `"${name}"` : `the empty ${spec.what}`} from ${spec.stores[srcStore]} slot ${pick.src} to ${spec.stores[dstStore]} slot ${pick.dst}`
          + (name ? '.' : ` — the slot is now empty. That is how a ${spec.what} is removed on the machine.`));
      } else {
        setManagers((m) => ({ ...m, [mgr]: { stores: wipeMemory(stores), pick: initialPick() } }));
        showNotice('Memory initialised: every Memory slot is empty. The Card keeps what it holds.');
      }
      navigate(evt.to);
      return;
    }
    if (evt.action === 'read-default') {
      const { time, amp } = navmap.feederAdjust.defaults;
      setFeeder((f) => readDefault(f, navmap.feederAdjust));
      showNotice(`Defaults read: every radial feeder and the dispersion feeder are back to `
        + `time ${time.toFixed(1)} and amplitude ${amp.toFixed(1)}.`);
      navigate(evt.to);
      return;
    }
    if (evt.toggles) {
      setFlags((f) => toggleFlag(f, evt.toggles));
    }
    if (evt.sets) {
      if (evt.sets.power === false) setPowerOn(false);
      setFlags((f) => applySets(f, evt.sets));
    }
    if (evt.action === 'enter' || evt.action === 'cancel') {
      if (evt.action === 'enter' && evt.commit === 'timing') {
        const ta = navmap.timingAdjust;
        const { state: next, reason } = timingEnter(timing, ta, typed);
        setTiming(next);
        const label = rowLabel(rowOf(ta, timing.sel), timing);
        const { min, max } = ta.keypad;
        showNotice(reason === 'empty'
          ? `Nothing entered — ${label} is unchanged.`
          : reason === 'clamped'
            ? `Held to the keypad's limits (Minimum ${min}, Maximum ${max}): ${label} ${timingCurrent(next, ta)} ms.`
            : `${label} set to ${timingCurrent(next, ta)} ms.`);
      } else if (evt.action === 'enter' && evt.commit) {
        /* The DF keypads chain: Target Wt, then Upper Limit(%), then Lower
           Limit(%) (seen on the running program). Each Enter commits its own
           field and opens the next; the last returns to the screen. */
        const field = evt.commit;
        const { state: next, reason } = setDfField(feeder, field, typed, navmap.feederAdjust);
        setFeeder(next);
        const { min, max } = dfFieldSpec(field, navmap.feederAdjust);
        const name = { dfTargetWt: 'DF target weight', dfUpperPct: 'DF upper limit', dfLowerPct: 'DF lower limit' }[field];
        const unit = field === 'dfTargetWt' ? '' : '%';
        const then = field === 'dfTargetWt' ? ' Next it asks the upper limit in %.'
          : field === 'dfUpperPct' ? ' Next it asks the lower limit in %.'
            : ' That is the last step; the value shows on the Target Wt key whenever DF is picked.';
        showNotice((reason === 'empty'
          ? `Nothing entered — the ${name} is unchanged.`
          : reason === 'clamped'
            ? `Held to the keypad's limits (Minimum ${min}, Maximum ${max}): ${name} ${next[field]}${unit}.`
            : `${name} set to ${next[field]}${unit}.`) + then);
      } else if (evt.action === 'enter') {
        showNotice(`Entered: ${typed || '(nothing)'}. On the machine this is now the value; the artwork here keeps showing what it showed.`);
      }
      navigate(evt.to);
      return;
    }
    if (!evt.to) return;

    /* The one gating rule: a key the original dims with power off must not
       navigate, and says why (data-driven via requiresPower in navmap). */
    if (evt.type === 'nav' && evt.requiresPower && !powerOn && !freeMode) {
      setWrongFlash((n) => n + 1);
      if (lessonActive) setHint(POWER_MSG);
      else showNotice(POWER_MSG);
      return;
    }

    if (lessonActive) {
      if (step.kind === 'tap-nav' && evt.type === 'nav' && evt.to === step.to) {
        navigate(evt.to);
        advanceLesson();
      } else if (step.kind === 'tap-spot' && evt.type === 'spot') {
        advanceLesson();
      } else {
        setWrongFlash((n) => n + 1);
        setHint(
          step.kind === 'read'
            ? 'Read the panel, then press Continue.'
            : step.kind === 'tap-power'
              ? 'Press the Power key — bottom bar, between the message area and Stop.'
              : 'Not that key — follow the highlighted one.'
        );
      }
      return;
    }
    if (evt.type === 'nav') navigate(evt.to);
  }, [powerBusy, powerOn, togglePower, showNotice, lessonActive, step, navigate,
      advanceLesson, selection, loadedPreset, freeMode, zeroing, setWrongFlash, feeder,
      applySelection, flags, typed, timing, deactivated, managers]);

  const startLesson = useCallback((id, at) => {
    setActiveLessonId(id);
    setStepIndex(at);
    setMode('lessons');
    setHint(null);
  }, []);

  const exitLesson = useCallback(() => {
    /* Leaving is never destructive: progress stays in `progress`. */
    setActiveLessonId(null);
    setHint(null);
  }, []);

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setScreen(h[h.length - 1]);
      return h.slice(0, -1);
    });
    setOpenDrawer(null);
  }, []);

  const highlight = useMemo(() => {
    if (!step) return null;
    if (step.kind === 'tap-nav') return { kind: 'nav', to: step.to, via: step.via };
    if (step.kind === 'tap-spot') return { kind: 'spot', rect: step.rect, label: step.label };
    if (step.kind === 'tap-power') return { kind: 'power' };
    return null;
  }, [step]);

  const title = screenInfo[screen]?.title
    || navmap.screens[screen]?.label
    || screen;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">
          CCW-R RCU Simulator<small>{title}</small>
        </span>
        <span
          className={'power-pill' + (powerOn ? ' power-pill--on' : '')}
          title="Control power state — toggle it with the Power key on the RCU's bottom bar"
        >
          {powerBusy ? 'POWERING UP…' : powerOn ? 'POWER ON' : 'POWER OFF'}
        </span>
        <div className="toolbar-row">
          {!lessonActive && (
            <button className="btn btn--ghost" onClick={goBack} disabled={!history.length}>
              ← Back
            </button>
          )}
          <button
            className={'btn' + (showHotspots ? ' btn--on' : '')}
            onClick={() => setShowHotspots((v) => !v)}
            title="Outline the tappable areas"
          >
            Hotspots
          </button>
          {/* Which units the machine has. The program is a plain 14-head
              single section; a real line may have boosters, a timing hopper,
              diverting timing hoppers - each adds its Timing Adjustment rows. */}
          <div className="seg seg--machine" role="group" aria-label="Machine units">
            {Object.entries(navmap.timingAdjust.options).map(([key, opt]) => {
              const on = flags[{ bh: 'optBH', th: 'optTH', dth: 'optDTH' }[key]];
              return (
                <button
                  key={key}
                  type="button"
                  className={on ? 'is-active' : ''}
                  title={`${opt.name}: ${opt.note}`}
                  aria-pressed={on}
                  onClick={() => handleTap({ type: 'machine-option', option: key })}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="seg" role="tablist">
            <button
              role="tab"
              className={mode === 'explore' ? 'is-active' : ''}
              onClick={() => setMode('explore')}
            >
              Explore
            </button>
            <button
              role="tab"
              className={mode === 'lessons' ? 'is-active' : ''}
              onClick={() => setMode('lessons')}
            >
              Lessons
            </button>
            <button
              role="tab"
              className={mode === 'free' ? 'is-active' : ''}
              onClick={() => {
                setMode('free');
                setPowerOn(false);   // a machine you have just walked up to is cold
                setPowerBusy(false);
              }}
              title="Jump straight to any screen, with nothing gated"
            >
              Free
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <Rcu
          navmap={navmap}
          slug={screen}
          showHotspots={showHotspots}
          highlight={highlight}
          lessonActive={lessonActive}
          openDrawer={openDrawer}
          onToggleDrawer={(name) => setOpenDrawer((v) => (v === name ? null : name))}
          onTap={handleTap}
          wrongFlash={wrongFlash}
          powerOn={powerOn}
          powerBusy={powerBusy}
          gatingOff={freeMode}
          loadedPreset={loadedPreset}
          selection={selection}
          feeder={feeder && { ...feeder, heads: selection.table ? [] : selection.heads }}
          flags={{ ...flags, power: powerOn }}
          typed={typed}
          timing={timing}
          machineOptions={{ bh: flags.optBH, th: flags.optTH, dth: flags.optDTH }}
          deactivated={deactivated}
          managers={managers}
          blink={blink}
          zeroing={zeroing}
          notice={notice}
        />
        <aside className="side-panel">
          {freeMode ? (
            <ScreenIndex current={screen} onPick={navigate} />
          ) : mode === 'lessons' ? (
            <LessonPanel
              activeLessonId={activeLessonId}
              stepIndex={stepIndex}
              progress={progress}
              completed={completed}
              hint={hint}
              onStart={startLesson}
              onContinue={advanceLesson}
              onExit={exitLesson}
            />
          ) : (
            <InfoPanel slug={screen} labelJa={navmap.screens[screen]?.labelJa} />
          )}
        </aside>
      </main>
    </div>
  );
}
