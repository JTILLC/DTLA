// shared/components/IssueHistory.jsx
//
// Every fault ever recorded against a head, across shift logs and service
// visits alike. The screen that answers "has this one done this before?".
//
// Extracted from the two App.jsx files, where it existed twice and had already
// drifted: the wording of a comment, the label on the source badge, whether the
// customer picker appears. Two copies of a component this size is two places to
// fix the next thing.
//
// The presentation is a grid rather than a table per head, because a table
// sizes its own columns and no two heads lined up; and because Bootstrap's
// table background is white and these apps theme with [data-theme], so every
// row stayed white on a dark page. See issue-history.css.
//
// The `history` shape is unchanged: the PDF export consumes it.
import { useEffect, useMemo, useState } from 'react';
import './issue-history.css';

const STATE_LABEL = {
  fixed: 'Fixed',
  active_with_issues: 'Active w/ issues',
  not_fixed: 'Not fixed',
};
const stateKey = (fixed) => (fixed === 'fixed' || fixed === 'active_with_issues' ? fixed : 'not_fixed');

export default function IssueHistory({
  customers = [],
  visits = [],
  onExportPDF,
  // The customer this screen opens on. `locked` hides the picker entirely —
  // a plant login has exactly one customer and being asked to choose made the
  // app look like it had lost track of who was signed in.
  customerId = '',
  locked = false,
  // Which `source` value earns a badge, and what to call it. The two apps badge
  // opposite sides: JTI's own app marks the plant's logs, the plant app marks
  // JTI's visits. Each is marking "the other side".
  badgeSource = null,
  badgeLabel = '',
}) {
  const [selectedCustomer, setSelectedCustomer] = useState(customerId || '');
  const [selectedLine, setSelectedLine] = useState('');

  useEffect(() => {
    if (customerId) setSelectedCustomer(customerId);
  }, [customerId]);

  const history = useMemo(() => {
    if (!selectedCustomer || !selectedLine) return [];
    if (!customers.find((c) => c.id === selectedCustomer)) return [];

    const byHead = {};
    visits.filter((v) => v.customerId === selectedCustomer).forEach((visit) => {
      // A record with no lines is legitimate — a log started and not yet filled
      // in — and used to throw here the moment one appeared.
      const lines = visit.lines || [];
      const chosen = selectedLine === '__ALL__' ? lines : lines.filter((l) => l?.title === selectedLine);

      chosen.forEach((line) => {
        (line.heads || []).forEach((head) => {
          const issues = head.issues || [];
          const oldFormat = head.error && head.error !== 'None';
          const hasNotes = head.notes && head.notes.trim() !== '';
          const isOffline = head.status !== 'active';
          if (!(isOffline || oldFormat || issues.length || hasNotes)) return;

          const key = selectedLine === '__ALL__' ? `${line.title}__${head.id}` : String(head.id);
          if (!byHead[key]) byHead[key] = { lineTitle: line.title, headId: head.id, visitEntries: [] };

          const list = issues.length
            ? issues.map((i) => ({ type: i.type, fixed: i.fixed, notes: i.notes || '' }))
            : oldFormat ? [{ type: head.error, fixed: head.fixed, notes: '' }] : [];

          byHead[key].visitEntries.push({
            visitName: visit.name || `Visit ${new Date(visit.date).toLocaleDateString()}`,
            visitDate: visit.date,
            source: badgeSource && visit.source === badgeSource ? badgeLabel : '',
            status: head.status,
            issues: list,
            headNotes: head.notes || '',
          });
        });
      });
    });

    return Object.values(byHead)
      .map((e) => ({
        ...e,
        visitEntries: e.visitEntries.sort((a, b) => new Date(b.visitDate || 0) - new Date(a.visitDate || 0)),
      }))
      .sort((a, b) => (a.lineTitle !== b.lineTitle
        ? String(a.lineTitle).localeCompare(String(b.lineTitle))
        : a.headId - b.headId));
  }, [selectedCustomer, selectedLine, customers, visits, badgeSource, badgeLabel]);

  const lineOptions = useMemo(() => {
    const set = new Set();
    visits.filter((v) => v.customerId === selectedCustomer)
      .forEach((v) => (v.lines || []).forEach((l) => { if (l?.title) set.add(l.title); }));
    return [...set].sort();
  }, [visits, selectedCustomer]);

  const scopeLabel = selectedLine === '__ALL__' ? 'All Lines' : selectedLine;

  return (
    <div className="p-3 rounded" style={{ background: 'var(--bg-secondary)' }}>
      <h5 className="mb-3">Issue History</h5>

      <div className="d-flex gap-2 mb-3 flex-wrap">
        {!locked && (
          <select
            value={selectedCustomer}
            onChange={(e) => { setSelectedCustomer(e.target.value); setSelectedLine(''); }}
            className="form-select form-select-sm"
            style={{ minWidth: '180px', width: 'auto' }}
          >
            <option value="">-- Select Customer --</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        {selectedCustomer && (
          <select
            value={selectedLine}
            onChange={(e) => setSelectedLine(e.target.value)}
            className="form-select form-select-sm"
            style={{ minWidth: '180px', width: 'auto' }}
          >
            <option value="">-- Select Line --</option>
            <option value="__ALL__">All Lines</option>
            {lineOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}

        {selectedLine && history.length > 0 && onExportPDF && (
          <button
            type="button"
            className="btn btn-outline-success btn-sm"
            onClick={() => onExportPDF(
              history,
              customers.find((c) => c.id === selectedCustomer)?.name || 'Unknown',
              selectedLine === '__ALL__' ? 'All-Lines' : selectedLine,
            )}
          >
            Export History PDF
          </button>
        )}
      </div>

      {history.length > 0 ? (
        <>
          <div className="small text-secondary mb-2">
            {history.length} head{history.length === 1 ? '' : 's'} with a record on {scopeLabel}
          </div>
          {history.map((head, idx) => (
            <section className="ih-head" key={`${head.lineTitle}-${head.headId}-${idx}`}>
              <div className="ih-head-bar">
                <span className="ih-head-title">
                  {selectedLine === '__ALL__' && <span className="ih-head-line">{head.lineTitle} · </span>}
                  Head {head.headId}
                </span>
                <span className="ih-head-count">
                  {head.visitEntries.length} record{head.visitEntries.length === 1 ? '' : 's'}
                </span>
              </div>

              {head.visitEntries.map((entry, i) => (
                <div className="ih-row" key={i}>
                  <div className="ih-when">
                    <span className="ih-date">{entry.visitName}</span>
                    {entry.source && <span className="ih-src">{entry.source}</span>}
                  </div>

                  <div className="ih-status">
                    <span className={`ih-pill ih-pill--${entry.status === 'offline' ? 'offline' : 'active'}`}>
                      {entry.status === 'offline' ? 'offline' : 'running'}
                    </span>
                  </div>

                  <div className="ih-issues">
                    {entry.issues.length ? entry.issues.map((iss, j) => (
                      <span className={`ih-issue ih-issue--${stateKey(iss.fixed)}`} key={j}>
                        <span className="ih-issue-type">{iss.type}</span>
                        <span className="ih-issue-state">{STATE_LABEL[stateKey(iss.fixed)]}</span>
                        {iss.notes && <span className="ih-issue-note">{iss.notes}</span>}
                      </span>
                    )) : <span className="ih-note ih-note--empty">—</span>}
                  </div>

                  <div className={`ih-note${entry.headNotes ? '' : ' ih-note--empty'}`}>
                    {entry.headNotes || '—'}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      ) : selectedLine ? (
        <p className="text-secondary mb-0">Nothing recorded against any head on {scopeLabel}.</p>
      ) : null}
    </div>
  );
}
