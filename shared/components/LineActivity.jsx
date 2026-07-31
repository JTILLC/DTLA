// src/components/LineActivity.jsx
//
// "Walk me through this line's week."
//
// Everything needed to answer that already existed — span adjustments, board
// replacements, PM checks, heads taken offline, issues marked fixed — but each
// lived on its own screen with its own filter. Reconstructing a week meant four
// tabs and a good memory, which is why nobody did it.
//
// This merges them into one time-ordered feed per line. It reads existing data
// and writes nothing: every event here is recorded elsewhere by the screen that
// owns it, so nothing can drift out of step with its source.
//
// Head events come from the VISITS rather than a log, because that is where
// head state lives. A head carries only its LATEST status change, so this shows
// the last time each head was stopped, not every time it ever was — the honest
// limit of what the data holds, and better than inventing a history from a
// single timestamp.
import { useMemo, useState } from 'react';
import {
  Activity, ClipboardCheck, Cpu, ClipboardList, PowerOff, Power, Wrench, Users,
} from 'lucide-react';

const KIND = {
  span: { icon: ClipboardCheck, label: 'Span adjustment', cls: 'text-primary' },
  board: { icon: Cpu, label: 'Part / board', cls: 'text-info' },
  pm: { icon: ClipboardList, label: 'PM check', cls: 'text-success' },
  offline: { icon: PowerOff, label: 'Head offline', cls: 'text-danger' },
  online: { icon: Power, label: 'Head back on', cls: 'text-success' },
  fixed: { icon: Wrench, label: 'Issue fixed', cls: 'text-warning' },
  crew: { icon: Users, label: 'Crewing changed', cls: 'text-secondary' },
};

const when = (iso) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const fmt = (iso) =>
  new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const named = (e) =>
  [e.operator && `Op ${e.operator}`, e.tech && `Maint ${e.tech}`]
    .filter(Boolean).join(' · ');

export default function LineActivity({
  lineTitle,
  spanLog = [],
  boardLog = [],
  pmLog = [],
  crewLog = [],
  headLog = [],
  visits = [],
  limit = 60,
}) {
  const [kinds, setKinds] = useState(null);   // null = everything

  const events = useMemo(() => {
    if (!lineTitle) return [];
    const out = [];

    spanLog.filter((e) => e.lineTitle === lineTitle).forEach((e) => out.push({
      id: `span-${e.id}`, kind: 'span', at: e.performedAt,
      title: 'Span adjustment logged',
      detail: `${(e.heads || []).length} heads${e.notes ? ` · ${e.notes}` : ''}`,
      who: named(e) || e.performedBy,
    }));

    boardLog.filter((e) => e.lineTitle === lineTitle).forEach((e) => out.push({
      id: `board-${e.id}`, kind: 'board', at: e.performedAt,
      title: `${e.boardType || 'Part'} replaced${e.headNumber != null ? ` · head ${e.headNumber}` : ''}`,
      detail: [e.partNumber && `part ${e.partNumber}`, e.partName, e.reason].filter(Boolean).join(' · '),
      who: named(e) || e.performedBy,
    }));

    pmLog.filter((e) => !e.lineTitle || e.lineTitle === lineTitle).forEach((e) => out.push({
      id: `pm-${e.id}`, kind: 'pm', at: e.performedAt,
      title: 'PM check submitted',
      detail: typeof e.issueCount === 'number'
        ? `${e.issueCount} issue${e.issueCount === 1 ? '' : 's'} raised`
        : '',
      who: named(e) || e.performedBy,
    }));

    // Crewing changes that touched this line.
    crewLog.forEach((c) => {
      const forLine = (c.lines || {})[lineTitle];
      if (!forLine) return;
      out.push({
        id: `crew-${c.id}`, kind: 'crew', at: c.performedAt,
        title: 'Crewing changed',
        detail: [
          forLine.operator && `Operator ${forLine.operator}`,
          forLine.tech && `Maintenance ${forLine.tech}`,
          forLine.supervisor && `Supervisor ${forLine.supervisor}`,
        ].filter(Boolean).join(' · '),
        who: c.changedBy || '',
      });
    });

    // Head events proper, once they started being logged.
    const loggedKeys = new Set();
    headLog.filter((e) => e.lineTitle === lineTitle).forEach((e) => {
      loggedKeys.add(`${e.headNumber}-${e.performedAt}`);
      out.push({
        id: `hl-${e.id}`,
        kind: e.action === 'fixed' ? 'fixed' : e.action === 'active' ? 'online' : 'offline',
        at: e.performedAt,
        title: e.action === 'fixed'
          ? `Head ${e.headNumber} · ${e.issueType || 'issue'} marked ${e.fixedState === 'fixed' ? 'fixed' : e.fixedState === 'active_with_issues' ? 'active with issues' : 'not fixed'}`
          : `Head ${e.headNumber} ${e.action === 'active' ? 'back online' : 'taken offline'}`,
        detail: '',
        who: e.by || '',
      });
    });

    // Head state from the visits, for anything stopped BEFORE the head log
    // existed. Deduped on head + timestamp so a logged event is not shown
    // twice — the head document and the log carry the same instant.
    visits.forEach((v) => {
      (v.lines || []).filter((l) => l?.title === lineTitle).forEach((l) => {
        (l.heads || []).forEach((h, i) => {
          const num = h.id || i + 1;
          if (h.statusAt && !loggedKeys.has(`${num}-${h.statusAt}`)) {
            out.push({
              id: `head-${v.id}-${num}-${h.statusAt}`,
              kind: h.statusAction === 'active' ? 'online' : 'offline',
              at: h.statusAt,
              title: `Head ${num} ${h.statusAction === 'active' ? 'back online' : 'taken offline'}`,
              detail: v.name ? `visit ${v.name}` : '',
              who: h.statusBy || '',
            });
          }
          (h.issues || []).forEach((iss, j) => {
            if (!iss.fixedAt || loggedKeys.has(`${num}-${iss.fixedAt}`)) return;
            out.push({
              id: `fix-${v.id}-${num}-${j}-${iss.fixedAt}`,
              kind: 'fixed', at: iss.fixedAt,
              title: `Head ${num} · ${iss.type || 'issue'} marked ${iss.fixed === 'fixed' ? 'fixed' : iss.fixed === 'active_with_issues' ? 'active with issues' : 'not fixed'}`,
              detail: iss.notes || '',
              who: iss.fixedBy || '',
            });
          });
        });
      });
    });

    return out
      .filter((e) => e.at)
      .sort((a, b) => when(b.at) - when(a.at))
      .slice(0, limit);
  }, [lineTitle, spanLog, boardLog, pmLog, crewLog, headLog, visits, limit]);

  const shown = kinds ? events.filter((e) => kinds.has(e.kind)) : events;

  const toggleKind = (k) => setKinds((prev) => {
    const next = new Set(prev || Object.keys(KIND));
    if (next.has(k)) next.delete(k); else next.add(k);
    return next.size === Object.keys(KIND).length ? null : next;
  });

  if (!lineTitle) {
    return <div className="text-muted">Pick a line to see what has happened on it.</div>;
  }

  return (
    <div>
      <div className="d-flex flex-wrap gap-1 mb-3">
        {Object.entries(KIND).map(([k, meta]) => {
          const on = !kinds || kinds.has(k);
          const Icon = meta.icon;
          return (
            <button
              key={k}
              type="button"
              className={'btn btn-sm ' + (on ? 'btn-secondary' : 'btn-outline-secondary')}
              onClick={() => toggleKind(k)}
            >
              <Icon size={12} /> {meta.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="text-muted">
          {events.length === 0
            ? 'Nothing recorded for this line yet.'
            : 'Nothing of the kinds selected above.'}
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {shown.map((e) => {
            const meta = KIND[e.kind];
            const Icon = meta.icon;
            return (
              <div key={e.id} className="d-flex gap-2 border rounded p-2">
                <Icon size={16} className={`${meta.cls} flex-shrink-0 mt-1`} />
                <div className="flex-grow-1">
                  <div className="fw-semibold">{e.title}</div>
                  {e.detail && <div className="small text-muted">{e.detail}</div>}
                  <div className="small text-muted">
                    {fmt(e.at)}{e.who ? ` · ${e.who}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { Activity };
