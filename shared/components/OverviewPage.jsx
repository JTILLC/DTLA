// shared/components/OverviewPage.jsx
//
// What needs attention at this customer, before you go looking for it.
//
// The app opened on an empty "Visit name" box, which is the one screen that
// knows nothing. Everything here was already being recorded — heads offline,
// PM due dates, span schedules, visit history — it just lived across three
// tabs, so answering "how is this plant doing?" meant visiting all of them.
//
// Nothing new is stored. Every figure is derived from logs the app already
// writes, so this screen cannot drift out of step with them.
import { useEffect, useMemo, useState } from 'react';
import {
  LOG_SPAN, LOG_PM, subscribeLog, dueStatus, sinceLabel,
} from '../services/logs.js';
import './overview.css';

const headState = (head) => {
  const issues = head?.issues || [];
  const has = issues.length > 0;
  if (head?.status === 'offline') {
    if (has && issues.every((i) => i.fixed === 'fixed')) return 'fixed';
    if (has && issues.some((i) => i.fixed === 'active_with_issues')) return 'issues';
    return 'offline';
  }
  return has ? 'issues' : 'active';
};

const STATE_WORD = {
  offline: 'offline',
  fixed: 'offline, all fixed',
  issues: 'active with issues',
  active: 'active',
};

export default function OverviewPage({
  customerName, workspaceId, customerId, lines = [], visits = [], onGo,
}) {
  const [spanLog, setSpanLog] = useState([]);
  const [pmLog, setPmLog] = useState([]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_SPAN, setSpanLog);
  }, [workspaceId, customerId]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_PM, setPmLog);
  }, [workspaceId, customerId]);

  // Per line: every head's state, and the counts worth saying out loud.
  const lineStates = useMemo(() => lines.map((line) => {
    const heads = (line.heads || []).map(headState);
    return {
      title: line.title || 'Untitled line',
      heads,
      offline: heads.filter((s) => s === 'offline').length,
      fixed: heads.filter((s) => s === 'fixed').length,
      issues: heads.filter((s) => s === 'issues').length,
    };
  }), [lines]);

  const totalOffline = lineStates.reduce((n, l) => n + l.offline, 0);
  const totalIssues = lineStates.reduce((n, l) => n + l.issues, 0);

  // Most recent PM per line, and whether it is overdue.
  const pmDue = useMemo(() => {
    const latest = new Map();
    pmLog.forEach((e) => {
      const key = e.lineTitle || '—';
      if (!latest.has(key)) latest.set(key, e);      // log arrives newest first
    });
    return [...latest.entries()]
      .map(([lineTitle, entry]) => ({ lineTitle, entry, due: dueStatus(entry.nextDueAt) }))
      .filter((r) => r.due && /Overdue|today/i.test(r.due.label));
  }, [pmLog]);

  const linesNeverSpanned = useMemo(() => {
    const seen = new Set(spanLog.map((e) => e.lineTitle));
    return lineStates.filter((l) => !seen.has(l.title)).map((l) => l.title);
  }, [spanLog, lineStates]);

  const items = [];
  if (pmDue.length) {
    items.push({
      sev: 'critical',
      title: `PM due or overdue on ${pmDue.length} line${pmDue.length === 1 ? '' : 's'}`,
      detail: pmDue.map((r) => `${r.lineTitle} · ${r.due.label.toLowerCase()}`).join(' · '),
      go: 'pm', goLabel: 'PM Log',
    });
  }
  if (totalOffline) {
    items.push({
      sev: 'critical',
      title: `${totalOffline} head${totalOffline === 1 ? '' : 's'} offline`,
      detail: lineStates.filter((l) => l.offline)
        .map((l) => `${l.title} · ${l.offline}`).join(' · '),
      go: 'current', goLabel: 'Current Visit',
    });
  }
  if (totalIssues) {
    items.push({
      sev: 'due',
      title: `${totalIssues} head${totalIssues === 1 ? '' : 's'} running with known issues`,
      detail: lineStates.filter((l) => l.issues)
        .map((l) => `${l.title} · ${l.issues}`).join(' · '),
      go: 'current', goLabel: 'Current Visit',
    });
  }
  if (linesNeverSpanned.length) {
    items.push({
      sev: 'due',
      title: `No span adjustment recorded on ${linesNeverSpanned.length} line${linesNeverSpanned.length === 1 ? '' : 's'}`,
      detail: linesNeverSpanned.join(' · '),
      go: 'span', goLabel: 'Span Adjust',
    });
  }

  const lastVisit = visits.find((v) => !v.deleted);

  return (
    <div className="ccw-overview">
      <div className="ccw-ov-head">
        <h5 className="mb-0">Needs attention</h5>
        <span className="text-secondary small">
          {customerName || 'This customer'}
          {items.length ? ` · ${items.length} open item${items.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="ccw-ov-clear">
          Nothing outstanding — no heads down, no PM overdue, every line has a span record.
        </div>
      ) : (
        <div className="ccw-ov-items">
          {items.map((it) => (
            <button
              key={it.title}
              type="button"
              className="ccw-ov-item"
              data-sev={it.sev}
              onClick={() => onGo?.(it.go)}
            >
              <span className="ccw-ov-stripe" aria-hidden="true" />
              <span className="ccw-ov-body">
                <span className="ccw-ov-title">{it.title}</span>
                <span className="ccw-ov-detail">{it.detail}</span>
              </span>
              <span className="ccw-ov-go">{it.goLabel} →</span>
            </button>
          ))}
        </div>
      )}

      {lineStates.length > 0 && (
        <>
          <div className="ccw-ov-head mt-3">
            <h6 className="mb-0">Heads at a glance</h6>
            <span className="text-secondary small">every line on this visit</span>
          </div>
          <div className="ccw-ov-lines">
            {lineStates.map((l) => (
              <button
                key={l.title}
                type="button"
                className="ccw-ov-line"
                onClick={() => onGo?.('current')}
              >
                <span className="ccw-ov-linename">{l.title}</span>
                <span
                  className="ccw-ov-heads"
                  aria-label={`${l.title}: ${l.heads.length} heads, ${l.offline} offline, ${l.issues} with issues`}
                >
                  {l.heads.map((s, i) => (
                    <i
                      key={i}
                      className="ccw-ov-head-cell"
                      data-state={s}
                      title={`Head ${i + 1} — ${STATE_WORD[s]}`}
                    />
                  ))}
                </span>
                <span className="ccw-ov-linenote">
                  {l.offline ? `${l.offline} offline` : ''}
                  {l.offline && l.fixed ? ' · ' : ''}
                  {l.fixed ? `${l.fixed} fixed` : ''}
                  {!l.offline && !l.fixed && !l.issues ? 'all running' : ''}
                  {l.issues && !l.offline ? `${l.issues} with issues` : ''}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="ccw-ov-strip">
        <span>Visits on record <b>{visits.filter((v) => !v.deleted).length}</b></span>
        <span>Last visit <b>{lastVisit ? sinceLabel(lastVisit.date) : 'never'}</b></span>
        <span>Last span adjust <b>{spanLog[0] ? sinceLabel(spanLog[0].performedAt) : 'never'}</b></span>
        <span>Last PM <b>{pmLog[0] ? sinceLabel(pmLog[0].performedAt) : 'never'}</b></span>
      </div>
    </div>
  );
}
