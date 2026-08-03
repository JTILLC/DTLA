// shared/components/OpenLogCard.jsx
//
// What Current Log shows when no log is open.
//
// It used to show an empty Log Name box — the one screen in the app that knows
// nothing, on the tab an operator opens first. This says what exists, how old
// it is, and offers the two things worth doing, so nobody has to go hunting
// through the log list to find out whether today has been started yet.
//
// The older-log case deliberately makes you press a button. Opening it for you
// would put today's readings into an earlier day's record, and the editor gives
// no hint that has happened. See shared/utils/todaysLog.js.
import { CalendarPlus, FileClock, FilePlus2 } from 'lucide-react';
import { logLabel, daysOld } from '../utils/todaysLog.js';

const agePhrase = (n) => {
  if (n == null) return '';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 7) return `${n} days ago`;
  if (n < 14) return 'last week';
  return `${Math.floor(n / 7)} weeks ago`;
};

export default function OpenLogCard({ decision, onOpen, onStart, canStart = true }) {
  if (!decision) return null;
  const { action, log } = decision;

  const start = canStart && (
    <button type="button" className="btn btn-primary d-inline-flex align-items-center gap-2" onClick={onStart}>
      <CalendarPlus size={16} /> Start today&apos;s log
    </button>
  );

  if (action === 'start') {
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body text-center py-5">
          <FilePlus2 size={32} className="text-secondary mb-3" />
          <h5 className="mb-2">No daily logs yet</h5>
          <p className="text-secondary mb-4">
            A log holds one shift: which heads are running, what went wrong, and what was replaced.
          </p>
          {!canStart && <p className="text-secondary small mb-0">Ask a supervisor to start one.</p>}
          {start}
        </div>
      </div>
    );
  }

  if (action === 'open') {
    // Reachable when today's log exists but was closed by hand.
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body text-center py-5">
          <FileClock size={32} className="text-secondary mb-3" />
          <h5 className="mb-2">Today&apos;s log is ready</h5>
          <p className="text-secondary mb-4">{logLabel(log)}</p>
          <button type="button" className="btn btn-primary" onClick={() => onOpen(log)}>Open it</button>
        </div>
      </div>
    );
  }

  const age = agePhrase(daysOld(log));
  return (
    <div className="card border-0 shadow-sm">
      <div className="card-body text-center py-5">
        <FileClock size={32} className="text-secondary mb-3" />
        <h5 className="mb-2">Nothing started for today</h5>
        <p className="text-secondary mb-1">
          The most recent log is <strong>{logLabel(log)}</strong>{age ? ` — ${age}` : ''}.
        </p>
        <p className="text-secondary small mb-4">
          Starting today&apos;s log carries its open issues forward. Continue the old one only if
          that shift is still running.
        </p>
        <div className="d-flex gap-2 justify-content-center flex-wrap">
          {start}
          <button type="button" className="btn btn-outline-secondary" onClick={() => onOpen(log)}>
            Continue {logLabel(log)}
          </button>
        </div>
      </div>
    </div>
  );
}
