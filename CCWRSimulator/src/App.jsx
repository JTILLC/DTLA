import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import navmap from './data/navmap.json';
import lessons from './data/lessons';
import screenInfo from './data/screenInfo';
import Rcu from './components/Rcu';
import InfoPanel from './components/InfoPanel';
import LessonPanel from './components/LessonPanel';
import ScreenIndex from './components/ScreenIndex';
import { drawers, drawerScreens } from './utils/navGraph';

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
  const [selection, setSelection] = useState(
    saved.selection ?? { wh: true, df: false });
  const [powerBusy, setPowerBusy] = useState(false); // the "Please wait" pop-up
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);
  const powerTimer = useRef(null);

  const showNotice = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => () => {
    clearTimeout(noticeTimer.current);
    clearTimeout(powerTimer.current);
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
          selection,
        })
      );
    } catch {
      /* storage full/unavailable: keep running */
    }
  }, [screen, mode, showHotspots, activeLessonId, stepIndex, progress, completed,
      powerOn, loadedPreset, selection]);

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
      (navmap.screens[screen]?.hotspots || []).map((h) => h.to)
    );
    for (const drawer of drawers(navmap)) {
      if (drawerScreens(drawer).includes(screen)) {
        for (const item of drawer.items) {
          if (item.to) targets.add(item.to);
        }
      }
    }
    for (const t of targets) {
      const img = new Image();
      img.src = `/${navmap.screens[t].image}`;
    }
  }, [screen]);

  const navigate = useCallback((to) => {
    setHistory((h) => [...h.slice(-49), screen]);
    setScreen(to);
    setOpenDrawer(null);
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

    if (evt.type === 'select') {
      // Toggle from the PREVIOUS value rather than from what this render closed
      // over: a stale closure here flips the wrong way and the artwork lags a
      // press behind, which is exactly how it first behaved.
      const next = { ...selection, [evt.which]: !selection[evt.which] };
      setSelection((prev) => ({ ...prev, [evt.which]: !prev[evt.which] }));
      const label = navmap.zeroAdjust.keys[evt.which].label;
      showNotice(
        next[evt.which]
          ? `${label} — selected. Blue means selected; Start zeroes what is selected.`
          : `${label} — cleared. With nothing selected, Start has nothing to zero.`,
      );
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
      advanceLesson, selection, loadedPreset, freeMode]);

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

  const title = screenInfo[screen]?.title || screen;

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
