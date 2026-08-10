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
import { linesFromHistory } from '../utils/linesFromHistory.js';
import { boardFor, outstandingLines, lastHandoverAt } from '../utils/prestart.js';
import {
  LOG_SPAN, LOG_PM, LOG_PRESTART, subscribeLog, dueStatus, sinceLabel,
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

// "head 4" / "heads 4, 7 and 11". Long lists are cut short rather than running
// off the row — past about half a dozen the individual numbers stop being the
// point and the count takes over.
function headList(nums, max = 6) {
  if (!nums.length) return '';
  const word = nums.length === 1 ? 'head' : 'heads';
  if (nums.length > max) return `${word} ${nums.slice(0, max).join(', ')} +${nums.length - max} more`;
  if (nums.length === 1) return `head ${nums[0]}`;
  return `${word} ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;
}

export default function OverviewPage({
  customerName, workspaceId, customerId, lines = [], visits = [], onGo,
  // 'log' for a plant's shift record, 'visit' for JTI's service call.
  noun = 'log',
  // Given the lines rebuilt from this plant's own history, put them on the
  // open record. Absent → only the manual route is offered.
  onAdoptLines,
}) {
  // Every line title this plant has ever had, across all records. Span Adjust
  // and Pre-Start already work this way; Overview looked only at the open log,
  // which is why a plant with four lines on record saw them on two screens and
  // not on this one.
  const historyLines = useMemo(() => linesFromHistory(visits), [visits]);
  const knownLineTitles = historyLines.map((l) => l.title);

  const [spanLog, setSpanLog] = useState([]);
  const [pmLog, setPmLog] = useState([]);
  const [prestartLog, setPrestartLog] = useState([]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_SPAN, setSpanLog);
  }, [workspaceId, customerId]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_PRESTART, setPrestartLog);
  }, [workspaceId, customerId]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_PM, setPmLog);
  }, [workspaceId, customerId]);

  // Per line: every head's state, and WHICH heads are in each state.
  //
  // Numbers, not just counts. "2 offline" tells you there is a problem; "heads
  // 1, 2" tells you where to stand. They are numbered from one, matching the
  // Quick Head Toggle tiles rather than the array index.
  const lineStates = useMemo(() => lines.map((line) => {
    const heads = (line.heads || []).map(headState);
    const numbersIn = (state) => heads
      .map((s, i) => (s === state ? i + 1 : 0))
      .filter(Boolean);
    return {
      title: line.title || 'Untitled line',
      heads,
      offlineHeads: numbersIn('offline'),
      fixedHeads: numbersIn('fixed'),
      issueHeads: numbersIn('issues'),
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
        .map((l) => `${l.title} · ${headList(l.offlineHeads)}`).join('  ·  '),
      go: 'current', goLabel: 'Current Visit',
    });
  }
  if (totalIssues) {
    items.push({
      sev: 'due',
      title: `${totalIssues} head${totalIssues === 1 ? '' : 's'} running with known issues`,
      detail: lineStates.filter((l) => l.issues)
        .map((l) => `${l.title} · ${headList(l.issueHeads)}`).join('  ·  '),
      go: 'current', goLabel: 'Current Visit',
    });
  }
  // Lines not yet walked today. The pre-start screen has always known this;
  // the Overview did not, so the one check a plant is meant to do every shift
  // was the one thing "Needs attention" never mentioned.
  const handoverAt = useMemo(() => lastHandoverAt(visits), [visits]);
  const prestartOutstanding = useMemo(
    () => outstandingLines(boardFor(lines, prestartLog, new Date(), handoverAt)),
    [lines, prestartLog, handoverAt],
  );
  if (prestartOutstanding.length) {
    items.push({
      sev: handoverAt ? 'critical' : 'due',
      title: `Pre-start not done on ${prestartOutstanding.length} line${prestartOutstanding.length === 1 ? '' : 's'}`,
      detail: handoverAt
        ? `Sanitation had the machines — every line needs walking again. ${prestartOutstanding.join(' · ')}`
        : prestartOutstanding.join(' · '),
      go: 'prestart', goLabel: 'Pre-Start',
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

      {/* "Nothing outstanding" over ZERO lines is not reassurance, it is a false
          all-clear: every one of those checks passes vacuously when there is
          nothing to check. A log with no lines has to say so, and say where the
          plant's lines went, because they are still visible on Span Adjust and
          Pre-Start — which read every record rather than just the open one. */}
      {lines.length === 0 ? (
        <div className="ccw-ov-clear ccw-ov-nolines">
          <strong>No lines on this {noun} yet.</strong>{' '}
          {knownLineTitles.length > 0
            ? `${knownLineTitles.length} line${knownLineTitles.length === 1 ? '' : 's'} on record for this plant — ${knownLineTitles.slice(0, 4).join(', ')}${knownLineTitles.length > 4 ? '…' : ''}. Nothing is being tracked until they are on this ${noun}.`
            : 'Add them once and every log from here on starts with them.'}
          {/* The names are already on screen; offering them as a button is the
              difference between telling somebody what they have and giving it
              to them. Head counts come from the same records, so a 16-head line
              comes back as 16 — and because history is matched on the title,
              a line rebuilt this way inherits its own past. */}
          {onAdoptLines && historyLines.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-primary ms-2"
              onClick={() => onAdoptLines(historyLines)}
            >
              Add {historyLines.length === 1 ? 'this line' : `these ${historyLines.length} lines`}
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${onAdoptLines && historyLines.length > 0 ? 'btn-outline-secondary' : 'btn-primary'} ms-2`}
            onClick={() => onGo?.('current')}
          >
            {onAdoptLines && historyLines.length > 0 ? 'Set up manually' : 'Set them up →'}
          </button>
        </div>
      ) : items.length === 0 ? (
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
                {/* The same chip the line switcher uses, dot and all — one
                    visual language for "a line and how it is doing", rather
                    than a plain label here and a chip three taps away. The dot
                    reports the worst state on the line, since that is what
                    decides whether you need to look. */}
                <span className="line-chip ccw-ov-chip">
                  <span
                    className={'line-chip-dot line-chip-dot--' + (
                      l.offline ? 'offline' : l.issues ? 'attn' : l.fixed ? 'fixed' : 'ok'
                    )}
                    aria-hidden="true"
                  />
                  {l.title}
                </span>
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
                  {[
                    l.offlineHeads.length ? `${headList(l.offlineHeads)} offline` : '',
                    l.fixedHeads.length ? `${headList(l.fixedHeads)} fixed` : '',
                    l.issueHeads.length ? `${headList(l.issueHeads)} with issues` : '',
                  ].filter(Boolean).join(' · ') || 'all running'}
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
