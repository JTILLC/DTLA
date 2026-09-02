import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import navmap from './data/navmap.json';
import lessons from './data/lessons';
import screenInfo from './data/screenInfo';
import Rcu from './components/Rcu';
import InfoPanel from './components/InfoPanel';
import LessonPanel from './components/LessonPanel';
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
  const [mode, setMode] = useState(saved.mode === 'lessons' ? 'lessons' : 'explore');
  const [showHotspots, setShowHotspots] = useState(saved.showHotspots ?? true);
  const [activeLessonId, setActiveLessonId] = useState(saved.activeLessonId ?? null);
  const [stepIndex, setStepIndex] = useState(saved.stepIndex ?? 0);
  const [progress, setProgress] = useState(saved.progress ?? {});
  const [completed, setCompleted] = useState(saved.completed ?? []);
  const [openDrawer, setOpenDrawer] = useState(null); // null | 'machineSet' | 'selectTotal'
  const [history, setHistory] = useState([]);
  const [hint, setHint] = useState(null);
  const [wrongFlash, setWrongFlash] = useState(0);

  const lesson = lessons.find((l) => l.id === activeLessonId) || null;
  const step = lesson && stepIndex < lesson.steps.length ? lesson.steps[stepIndex] : null;
  const lessonActive = Boolean(step);

  /* Persist everything that matters — a reload or a closed iPad never
     loses the trainee's place. */
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          screen, mode, showHotspots,
          activeLessonId, stepIndex, progress, completed,
        })
      );
    } catch {
      /* storage full/unavailable: keep running */
    }
  }, [screen, mode, showHotspots, activeLessonId, stepIndex, progress, completed]);

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

  const handleTap = useCallback((evt) => {
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
            : 'Not that key — follow the highlighted one.'
        );
      }
      return;
    }
    if (evt.type === 'nav') navigate(evt.to);
  }, [lessonActive, step, navigate, advanceLesson]);

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
    return null;
  }, [step]);

  const title = screenInfo[screen]?.title || screen;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">
          CCW-R RCU Simulator<small>{title}</small>
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
        />
        <aside className="side-panel">
          {mode === 'lessons' ? (
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
