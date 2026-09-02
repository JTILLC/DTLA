import lessons from '../data/lessons';

/**
 * Lesson side panel. With no lesson active it lists the lessons with their
 * saved progress (nothing is ever lost by leaving a lesson — progress is
 * kept and the card offers Resume). With one active it shows the current
 * step, the previous step's explanation, and Continue for read steps.
 */
export default function LessonPanel({
  activeLessonId,
  stepIndex,
  progress,        // {lessonId: furthest step index}
  completed,       // [lessonId]
  hint,
  onStart,         // (lessonId, stepIndex)
  onContinue,
  onExit,
}) {
  const lesson = lessons.find((l) => l.id === activeLessonId);

  if (!lesson) {
    return (
      <div className="side-panel__body">
        <div className="panel-heading">
          <h2>Guided lessons</h2>
        </div>
        <p className="info-summary" style={{ marginBottom: '0.8rem' }}>
          Step-by-step procedures from the Operation Manual. The key to
          press is highlighted on the screen; your place is saved if you
          leave.
        </p>
        {lessons.map((l) => {
          const done = completed.includes(l.id);
          const at = progress[l.id] ?? 0;
          const started = at > 0 && !done;
          return (
            <div className="lesson-card" key={l.id}>
              <h3>
                {l.title}{' '}
                {done && <span className="chip">completed</span>}
                {started && (
                  <span className="chip chip--warn">
                    step {at + 1} of {l.steps.length}
                  </span>
                )}
              </h3>
              <p>{l.blurb}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                Manual: {l.ref}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn--primary"
                  onClick={() => onStart(l.id, started ? at : 0)}
                >
                  {done ? 'Run again' : started ? 'Resume' : 'Start'}
                </button>
                {started && (
                  <button className="btn" onClick={() => onStart(l.id, 0)}>
                    Restart
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (stepIndex >= lesson.steps.length) {
    const last = lesson.steps[lesson.steps.length - 1];
    return (
      <div className="side-panel__body">
        <div className="panel-heading">
          <h2>{lesson.title}</h2>
          <span className="chip">completed</span>
        </div>
        {last?.explain && <p className="step-explain">{last.explain}</p>}
        <p className="step-explain">
          Lesson complete. Read more in the Operation Manual: {lesson.ref}.
        </p>
        <button
          className="btn btn--primary"
          style={{ marginTop: '0.8rem' }}
          onClick={onExit}
        >
          Back to lessons
        </button>
      </div>
    );
  }

  const step = lesson.steps[stepIndex];
  const prev = stepIndex > 0 ? lesson.steps[stepIndex - 1] : null;

  return (
    <div className="side-panel__body">
      <div className="panel-heading">
        <h2>{lesson.title}</h2>
        <span className="chip">
          step {stepIndex + 1} / {lesson.steps.length}
        </span>
      </div>
      <div className="lesson-progress">
        <div style={{ width: `${(stepIndex / lesson.steps.length) * 100}%` }} />
      </div>

      {prev?.explain && <p className="step-explain">{prev.explain}</p>}

      <div className="step-instruction" style={{ marginTop: '0.7rem' }}>
        {step.instruction}
      </div>

      {step.kind === 'read' && (
        <button
          className="btn btn--primary"
          style={{ marginTop: '0.8rem' }}
          onClick={onContinue}
        >
          Continue
        </button>
      )}
      {step.kind === 'tap-nav' && (
        <p className="step-explain">Tap the highlighted key on the screen.</p>
      )}
      {step.kind === 'tap-spot' && (
        <p className="step-explain">
          Tap the highlighted {step.label} key on the screen.
        </p>
      )}

      {hint && <p className="step-hint">{hint}</p>}

      <button
        className="btn btn--ghost"
        style={{ marginTop: '1.2rem' }}
        onClick={onExit}
      >
        Leave lesson (progress saved)
      </button>
    </div>
  );
}
