// src/components/SpanAdjustPage.jsx
//
// Span adjustment as its own screen, scoped to CUSTOMER → LINE rather than to a
// visit.
//
// Why it isn't inside a visit: a span adjustment is a recurring maintenance task
// on its own ~30-day clock, done by whoever is on shift. Nesting it under a visit
// meant an operator had to care which visit was open to record something that has
// nothing to do with a visit — and weights entered in one visit were invisible in
// the next, which is exactly when you want to see what the readings were last
// time.
//
// This screen keeps weights in local state seeded from the most recent LOG entry
// for the line, and writes only to the log. The log is therefore the single
// source of truth for span readings; there is no second copy to disagree with it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, ChevronLeft, Check, Trash2 } from 'lucide-react';
import {
  LOG_SPAN, subscribeLog, addLogEntry, updateLogEntry, deleteLogEntry,
  sinceLabel, dueStatus, addDays,
} from '../services/logs.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';
import WeightScanner from './WeightScanner.jsx';
import CrewLine from './CrewLine.jsx';
import CrewChip from './CrewChip.jsx';
import EditedNote from './EditedNote.jsx';
import { withEditStamp } from '../utils/editTrail.js';
import { round1, spanDiff, headRecord, hasAfterReadings, testWeightOf } from '../utils/spanWeights.js';
import PinPrompt from './PinPrompt.jsx';
import LineLockPrompt from './LineLockPrompt.jsx';
import { useLineGuard } from '../utils/useLineGuard.jsx';
import { overrideStamp } from '../utils/lineAccess.js';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import { subscribeCrew } from '../services/logs.js';
import { useLineCrew, crewStamp } from '../utils/useLineCrew.js';
import ActingAs from './ActingAs.jsx';
import './data-table.css';

const LAST_LINE_KEY = 'ccw-span-last-line';

export default function SpanAdjustPage({
  workspaceId,
  customerId,
  customerName,
  visits = [],
  performedByName,
  role = 'jti',
}) {
  const toast = useToast();
  const dialog = useDialog();
  const lineCrew = useLineCrew(workspaceId, customerId);
  // Crewing says who was ON the line; this says who actually filed the entry.
  // An entry logged at 2am otherwise inherits whoever was crewed at 6am.
  const { person: actor, remember: rememberActor, touch: touchActor } = useVerifiedPerson(customerId);
  const [crewPeople, setCrewPeople] = useState([]);
  const [pendingSave, setPendingSave] = useState(null);
  // Identity says who is filing; this says whether they may file it here.
  const lineGuard = useLineGuard({ people: crewPeople, actor });

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeCrew(workspaceId, customerId, setCrewPeople);
  }, [workspaceId, customerId]);

  // A plant that has not set PINs keeps logging, unattributed. This records who
  // filed something; it must never become a lock on recording work at all.
  const withActor = (run) => {
    const anyPin = crewPeople.some((p) => p.pinHash);
    // Using the remembered name pushes the idle clock out, so a shift's
    // continuous work never re-prompts while a tablet put down still lapses.
    if (actor) touchActor();
    if (actor || !anyPin) return run(actor?.name || '');
    setPendingSave(() => run);
  };
  // An edit REWRITES a record that already exists, so it always asks. Having
  // proved who you are earlier in the shift is not the same as confirming this
  // particular change — that confirmation is what makes the trail mean
  // anything. A plant with no PINs still edits, unattributed, as everywhere.
  const withFreshActor = (run) => {
    const anyPin = crewPeople.some((p) => p.pinHash);
    if (!anyPin) return run('');
    // A JTI account has no PIN to re-key, so asking again would only be a
    // dialog that answers itself. The edit is still stamped with who made it.
    if (actor?.isSuper) return run(actor.name);
    setPendingSave(() => run);
  };

  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState(null);   // line title
  const [rows, setRows] = useState([]);             // [{head, currentWeight, afterWeight}]
  // One number for the whole line: the test weight every head is spanned to.
  // It is still stored per head, because that is the shape the log has always
  // had, but it was never actually per head — a column of identical 200s was
  // four taps of nothing.
  const [testWeight, setTestWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [intervalDays, setIntervalDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // A saved entry opened for correction: { id, heads:[...], notes }.
  const [editing, setEditing] = useState(null);
  // Heads whose current weight came from a photo rather than a keypress. Marked
  // in the table so an operator knows which numbers to sanity-check, and cleared
  // the moment one is typed over.
  const [scanned, setScanned] = useState(() => new Set());
  // The same, for the after-span photo. Two sets rather than one: a head can be
  // scanned before and typed after, and the marks have to say which is which.
  const [scannedAfter, setScannedAfter] = useState(() => new Set());
  // Bumped after each successful log. Together with the line title it keys the
  // scanner, so the retained photo is dropped once it has served its purpose
  // rather than following you to the next line.
  const [logSeq, setLogSeq] = useState(0);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_SPAN, setEntries);
  }, [workspaceId, customerId]);

  // Lines come from the customer's visits — the only place a line definition
  // exists. Union across visits (newest first) so a line still appears even if
  // it wasn't touched on the most recent visit.
  const lines = useMemo(() => {
    const seen = new Map();
    [...visits]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .forEach((v) => {
        (v.lines || []).forEach((l) => {
          if (l?.title && !seen.has(l.title)) {
            seen.set(l.title, { title: l.title, heads: (l.heads || []).length, model: l.model || '' });
          }
        });
      });
    return [...seen.values()];
  }, [visits]);

  const latestFor = (title) => entries.find((e) => e.lineTitle === title) || null;

  // Restore the last line worked on — fewer taps on a plant floor. The header
  // always names the selected line so it can't be logged against by accident.
  // Runs at most ONCE. `selected` has to stay in the deps for the initial
  // restore to fire after lines load, but without the ref guard, pressing
  // "All lines" (which sets selected to null) re-runs this and immediately
  // re-selects the saved line — making the overview unreachable.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || selected || lines.length === 0) return;
    restoredRef.current = true;
    try {
      const saved = localStorage.getItem(LAST_LINE_KEY);
      if (saved && lines.some((l) => l.title === saved)) setSelected(saved);
    } catch { /* storage unavailable */ }
  }, [lines, selected]);

  // Seed the weight rows whenever the line changes: last logged readings if we
  // have them, otherwise a blank row per head.
  useEffect(() => {
    if (!selected) { setRows([]); return; }
    const line = lines.find((l) => l.title === selected);
    const last = latestFor(selected);
    const headCount = line?.heads || last?.heads?.length || 0;
    const next = Array.from({ length: headCount }, (_, i) => {
      const prev = last?.heads?.find((h) => Number(h.head) === i + 1);
      return {
        head: i + 1,
        // Both readings are what you measure TODAY — always start blank so a
        // stale one can't be logged unchanged by accident.
        currentWeight: '',
        afterWeight: '',
      };
    });
    setRows(next);
    // The test weight carries forward; it rarely changes between cycles, and it
    // is the one thing on this screen that is the same every time.
    setTestWeight(testWeightOf(last?.heads || []) ?? '');
    setNotes('');
    setScanned(new Set());
    setScannedAfter(new Set());
    try { localStorage.setItem(LAST_LINE_KEY, selected); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, lines.length, entries.length]);

  const setRow = (idx, field, value) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const clearWeights = () => {
    setRows((prev) => prev.map((r) => ({ ...r, currentWeight: '', afterWeight: '' })));
    setScanned(new Set());
    setScannedAfter(new Set());
  };

  // A scan fills the fields; it does not log anything. Heads the reader couldn't
  // make out keep whatever is already in them, so a partial scan tops up a
  // partly-typed column instead of wiping it.
  const applyScanTo = (field, mark) => (byHead) => {
    setRows((prev) => prev.map((r) => (
      byHead.has(r.head) ? { ...r, [field]: String(byHead.get(r.head)) } : r
    )));
    mark(new Set(byHead.keys()));
  };
  const applyScan = applyScanTo('currentWeight', setScanned);
  const applyScanAfter = applyScanTo('afterWeight', setScannedAfter);

  // Typed over: it's the operator's number now, not the camera's.
  const unmark = (mark) => (head) => mark((prev) => {
    if (!prev.has(head)) return prev;
    const next = new Set(prev);
    next.delete(head);
    return next;
  });

  const save = () => withActor((filedBy) => lineGuard.check(selected, async (override) => {
    if (!selected) return toast.error('Pick a line first');
    const measured = rows.filter((r) => String(r.currentWeight).trim() !== '');
    if (measured.length === 0) {
      return toast.error('Enter at least one current weight before logging');
    }
    setSaving(true);
    try {
      const heads = rows.map((r) => headRecord({ ...r, spanWeight: testWeight }));
      const line = lines.find((l) => l.title === selected);
      await addLogEntry(workspaceId, customerId, LOG_SPAN, {
        lineTitle: selected,
        model: line?.model || '',
        performedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        role,
        ...crewStamp(lineCrew.forLine(selected), lineCrew.shiftId),
        // Filed against a line this person is not assigned to, with a
        // supervisor's authorisation. Absent on an ordinary entry.
        ...overrideStamp(override, selected),
        // Who filed it, proven — distinct from the crew, which is context.
        actionBy: filedBy,
        actionByVerified: !!filedBy,
        notes: notes.trim(),
        heads,
        confirmed: false,
        intervalDays: intervalDays === '' ? null : Number(intervalDays),
        nextDueAt: intervalDays === '' ? null : addDays(null, Number(intervalDays)),
      });
      setNotes('');
      clearWeights();
      setLogSeq((n) => n + 1);
      toast.success(`Span adjustment logged for ${selected}`);
    } catch (err) {
      console.error('Span log save failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }));

  // Weights get mistyped, and re-logging to fix one would lose when the work
  // was actually done and who did it. Editing keeps both and records the change.
  const openEdit = (entry) => setEditing({
    id: entry.id,
    entry,
    notes: entry.notes || '',
    testWeight: testWeightOf(entry.heads || []) ?? '',
    heads: (entry.heads || []).map((h) => ({
      head: h.head,
      currentWeight: h.currentWeight ?? '',
      afterWeight: h.afterWeight ?? '',
    })),
  });

  const saveEdit = () => withFreshActor((filedBy) => lineGuard.check(editing?.entry?.lineTitle, async (override) => {
    if (!editing) return;
    try {
      const heads = editing.heads.map((r) => headRecord({ ...r, spanWeight: editing.testWeight }));
      await updateLogEntry(workspaceId, customerId, LOG_SPAN, editing.id,
        withEditStamp({
          heads, notes: editing.notes.trim(), ...overrideStamp(override, editing.entry?.lineTitle),
        }, editing.entry, filedBy));
      toast.success('Entry updated');
      setEditing(null);
    } catch (err) {
      console.error('Span log edit failed:', err);
      toast.error('Could not update: ' + (err?.message || 'unknown error'));
    }
  }));

  const confirmEntry = async (entry) => {
    try {
      await updateLogEntry(workspaceId, customerId, LOG_SPAN, entry.id, {
        confirmed: true,
        confirmedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        confirmedAt: new Date().toISOString(),
      });
      toast.success('Confirmed');
    } catch (err) {
      toast.error('Could not confirm: ' + (err?.message || 'unknown error'));
    }
  };

  const removeEntry = async (entry) => {
    const ok = await dialog.confirm(
      `Delete the span adjustment logged ${new Date(entry.performedAt).toLocaleString()}?`,
      { title: 'Delete log entry', confirmText: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    try {
      await deleteLogEntry(workspaceId, customerId, LOG_SPAN, entry.id);
      toast.success('Entry deleted');
    } catch (err) {
      toast.error('Could not delete: ' + (err?.message || 'unknown error'));
    }
  };

  if (!customerId) {
    return <div className="text-muted p-3">Select a customer to record span adjustments.</div>;
  }

  // ---- Overview: every line's due state at a glance -----------------------
  // The point of a schedule is noticing what's overdue without hunting line by
  // line, so overdue sorts to the top.
  if (!selected) {
    const overview = lines
      .map((l) => {
        const last = latestFor(l.title);
        return { ...l, last, due: dueStatus(last?.nextDueAt) };
      })
      .sort((a, b) => {
        const rank = { overdue: 0, due: 1, soon: 2, ok: 3, none: 4 };
        const d = rank[a.due.state] - rank[b.due.state];
        return d !== 0 ? d : a.title.localeCompare(b.title, undefined, { numeric: true });
      });

    return (
      <div>
        <h5 className="d-flex align-items-center gap-2 mb-3">
          <ClipboardCheck size={18} /> Span Adjustments{customerName ? ` — ${customerName}` : ''}
        </h5>
        {overview.length === 0 ? (
          <div className="text-muted">No lines found for this customer yet.</div>
        ) : (
          <div className="list-group">
            {overview.map((l) => (
              <button
                key={l.title}
                type="button"
                className="list-group-item list-group-item-action d-flex justify-content-between align-items-center flex-wrap gap-2"
                onClick={() => setSelected(l.title)}
              >
                <div className="text-start">
                  <div className="fw-semibold">{l.title}</div>
                  <div className="small text-muted">
                    {l.heads} heads · last {l.last ? sinceLabel(l.last.performedAt) : 'never'}
                  </div>
                </div>
                <span
                  className={
                    'badge ' +
                    (l.due.state === 'overdue' ? 'bg-danger'
                      : l.due.state === 'due' || l.due.state === 'soon' ? 'bg-warning text-dark'
                      : l.due.state === 'ok' ? 'bg-success'
                      : 'bg-secondary')
                  }
                >
                  {l.due.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- One line: enter weights and log ------------------------------------
  const last = latestFor(selected);
  const due = dueStatus(last?.nextDueAt);
  const lineEntries = entries.filter((e) => e.lineTitle === selected);

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSelected(null)}>
          <ChevronLeft size={16} /> All lines
        </button>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="small text-muted">Last: {last ? sinceLabel(last.performedAt) : 'never'}</span>
          {due.state !== 'none' && (
            <span
              className={
                'badge ' +
                (due.state === 'overdue' ? 'bg-danger'
                  : due.state === 'due' || due.state === 'soon' ? 'bg-warning text-dark'
                  : 'bg-success')
              }
            >
              {due.label}
            </span>
          )}
        </div>
      </div>

      <h5 className="mb-3">{selected}</h5>

      <div className="card mb-3">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
            <div className="input-group input-group-sm" style={{ width: 'auto' }}>
              <span className="input-group-text">Test weight</span>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                className="form-control"
                style={{ maxWidth: '90px' }}
                placeholder="200"
                value={testWeight}
                onChange={(e) => setTestWeight(e.target.value)}
              />
              <span className="input-group-text">g</span>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline-warning"
              onClick={clearWeights}
            >
              Clear weights
            </button>
          </div>

          {/* Two photos, in the order the job is done: what the heads read
              before the adjustment, then what they read after it. The second
              one is why the difference is measured rather than assumed. */}
          <div className="row g-2 mb-2">
            <div className="col-12 col-md-6">
              <WeightScanner
                key={`before-${selected}-${logSeq}`}
                expectedHeads={rows.length}
                onApply={applyScan}
                label="Scan before"
                fills="before weights"
                hint="Photograph the screen BEFORE the adjustment. You still check and log the numbers."
              />
            </div>
            <div className="col-12 col-md-6">
              <WeightScanner
                key={`after-${selected}-${logSeq}`}
                expectedHeads={rows.length}
                onApply={applyScanAfter}
                label="Scan after"
                fills="after weights"
                hint="Photograph the screen once the span is done, to record where it landed."
              />
            </div>
          </div>

          <div className="table-responsive">
            {/* data-table: see data-table.css — without it Bootstrap keeps its
                light --bs-table-bg under [data-theme] and the weight grid
                glares white on a dark page. */}
            <table className="table table-sm mobile-cards data-table mb-0">
              <thead>
                <tr>
                  <th>Head</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const diff = spanDiff(r.currentWeight, r.afterWeight);
                  return (
                    <tr key={r.head}>
                      <td data-label="Head"><strong>{r.head}</strong></td>
                      <td data-label="Before">
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          className={'form-control form-control-sm' + (scanned.has(r.head) ? ' border-primary' : '')}
                          value={r.currentWeight}
                          placeholder="—"
                          title={scanned.has(r.head) ? 'Read from the before photo — check it' : undefined}
                          onChange={(e) => {
                            setRow(i, 'currentWeight', e.target.value);
                            unmark(setScanned)(r.head);
                          }}
                        />
                      </td>
                      <td data-label="After">
                        <input
                          type="number"
                          step="any"
                          inputMode="decimal"
                          className={'form-control form-control-sm' + (scannedAfter.has(r.head) ? ' border-primary' : '')}
                          value={r.afterWeight}
                          placeholder="—"
                          title={scannedAfter.has(r.head) ? 'Read from the after photo — check it' : undefined}
                          onChange={(e) => {
                            setRow(i, 'afterWeight', e.target.value);
                            unmark(setScannedAfter)(r.head);
                          }}
                        />
                      </td>
                      {/* Null, not 0.0, until both readings exist: a head that
                          has not been read twice has no difference yet. */}
                      <td data-label="Diff">{diff === null ? '—' : diff.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body d-flex flex-column gap-2">
          <input
            type="text"
            className="form-control"
            placeholder="Notes for this adjustment (optional)…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <label className="small text-muted mb-0" htmlFor="span-page-interval">Next one due in</label>
            <div className="input-group input-group-sm" style={{ width: 'auto' }}>
              <input
                id="span-page-interval"
                type="number"
                min="0"
                inputMode="numeric"
                className="form-control"
                style={{ maxWidth: '80px' }}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                placeholder="30"
              />
              <span className="input-group-text">days</span>
            </div>
            {intervalDays !== '' && (
              <span className="small text-muted">
                → {new Date(addDays(null, Number(intervalDays))).toLocaleDateString()}
              </span>
            )}
          </div>
          <CrewChip lineCrew={lineCrew} lineTitle={selected} />
            <ActingAs customerId={customerId} what="Span adjustments" />
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : `Log span adjustment for ${selected}`}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <strong>History</strong>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Hide' : `Show (${lineEntries.length})`}
          </button>
        </div>
        {showHistory && (
          <div className="card-body">
            {lineEntries.length === 0 ? (
              <div className="text-muted small">Nothing logged for this line yet.</div>
            ) : (
              <div className="d-flex flex-column gap-2">
                {lineEntries.map((e) => (
                  <div key={e.id} className="data-box p-2">
                    <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                      <div>
                        <div className="fw-semibold">
                          {new Date(e.performedAt).toLocaleString([], {
                            year: 'numeric', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </div>
                        <div className="small text-muted">
                          by {e.performedBy || 'Unknown'}{e.role === 'customer' ? ' (plant)' : ' (JTI)'}
                        </div>
                        <CrewLine entry={e} />
                        <EditedNote entry={e} />
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        {e.confirmed ? (
                          <span className="badge bg-success">✓ Confirmed</span>
                        ) : (
                          <button type="button" className="btn btn-sm btn-outline-success" onClick={() => confirmEntry(e)}>
                            <Check size={14} /> Confirm
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => openEdit(e)}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeEntry(e)} aria-label="Delete entry">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {editing?.id === e.id && (
                      <div className="data-box p-2 mt-2">
                        <div className="small text-muted mb-2">
                          Correcting this entry. The time it was logged and who
                          logged it are kept; the change is recorded separately.
                        </div>
                        <div className="input-group input-group-sm mb-2" style={{ width: 'auto' }}>
                          <span className="input-group-text">Test weight</span>
                          <input
                            type="number" step="any" inputMode="decimal"
                            className="form-control"
                            style={{ maxWidth: '90px' }}
                            value={editing.testWeight}
                            onChange={(ev) => setEditing((d) => ({ ...d, testWeight: ev.target.value }))}
                          />
                          <span className="input-group-text">g</span>
                        </div>
                        <div className="table-responsive">
                          <table className="table table-sm data-table mb-2">
                            <thead>
                              <tr><th>Head</th><th>Before</th><th>After</th><th>Diff</th></tr>
                            </thead>
                            <tbody>
                              {editing.heads.map((r, i) => {
                                const d0 = spanDiff(r.currentWeight, r.afterWeight);
                                return (
                                  <tr key={r.head}>
                                    <td><strong>{r.head}</strong></td>
                                    <td>
                                      <input
                                        type="number" step="any" inputMode="decimal"
                                        className="form-control form-control-sm"
                                        value={r.currentWeight}
                                        onChange={(ev) => setEditing((d) => ({
                                          ...d,
                                          heads: d.heads.map((x, j) => (j === i ? { ...x, currentWeight: ev.target.value } : x)),
                                        }))}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number" step="any" inputMode="decimal"
                                        className="form-control form-control-sm"
                                        value={r.afterWeight}
                                        placeholder="—"
                                        onChange={(ev) => setEditing((d) => ({
                                          ...d,
                                          heads: d.heads.map((x, j) => (j === i ? { ...x, afterWeight: ev.target.value } : x)),
                                        }))}
                                      />
                                    </td>
                                    <td>{d0 === null ? '—' : d0.toFixed(1)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <input
                          type="text"
                          className="form-control form-control-sm mb-2"
                          placeholder="Notes"
                          value={editing.notes}
                          onChange={(ev) => setEditing((d) => ({ ...d, notes: ev.target.value }))}
                        />
                        <div className="d-flex gap-2">
                          <button type="button" className="btn btn-sm btn-primary" onClick={saveEdit}>
                            Save changes
                          </button>
                          <button type="button" className="btn btn-sm btn-link" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {e.notes && <div className="small mt-1">{e.notes}</div>}
                    {e.nextDueAt && (
                      <div className="small text-muted mt-1">
                        Next due {new Date(e.nextDueAt).toLocaleDateString()}
                        {e.intervalDays ? ` (${e.intervalDays}-day cycle)` : ''}
                      </div>
                    )}
                    {Array.isArray(e.heads) && e.heads.length > 0 && (
                      <details className="mt-2">
                        <summary className="small text-muted" style={{ cursor: 'pointer' }}>
                          Weights ({e.heads.length} heads)
                        </summary>
                        {/* Entries logged before the after-photo existed have
                            only a reading and a target, and are shown the way
                            they were recorded. Reprinting their target under an
                            "After" heading would present an assumed number as a
                            measured one. */}
                        {hasAfterReadings(e.heads) ? (
                          <div className="table-responsive mt-1">
                            {testWeightOf(e.heads) !== null && (
                              <div className="small text-muted mb-1">
                                Test weight {testWeightOf(e.heads)}g
                              </div>
                            )}
                            <table className="table table-sm data-table mb-0">
                              <thead>
                                <tr><th>Head</th><th>Before</th><th>After</th><th>Diff</th></tr>
                              </thead>
                              <tbody>
                                {e.heads.map((h) => {
                                  const d0 = spanDiff(h.currentWeight, h.afterWeight);
                                  return (
                                    <tr key={h.head}>
                                      <td>{h.head}</td>
                                      <td>{h.currentWeight}</td>
                                      <td>{h.afterWeight ?? '—'}</td>
                                      <td>{d0 === null ? '—' : d0.toFixed(1)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="table-responsive mt-1">
                            <table className="table table-sm data-table mb-0">
                              <thead>
                                <tr><th>Head</th><th>Current</th><th>Span</th><th>Diff</th></tr>
                              </thead>
                              <tbody>
                                {e.heads.map((h) => (
                                  <tr key={h.head}>
                                    <td>{h.head}</td>
                                    <td>{h.currentWeight}</td>
                                    <td>{h.spanWeight}</td>
                                    <td>{round1(h.difference).toFixed(1)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {lineGuard.challenge && (
        <LineLockPrompt
          customerId={customerId}
          people={crewPeople}
          challenge={lineGuard.challenge}
          onAuthorise={lineGuard.authorise}
          onCancel={lineGuard.dismiss}
        />
      )}
      {pendingSave && (
        <PinPrompt
          customerId={customerId}
          people={crewPeople}
          title="Who is logging this?"
          message="The entry is recorded against you."
          onVerified={(p) => {
            rememberActor(p);
            const run = pendingSave;
            setPendingSave(null);
            run(p.name);
          }}
          onCancel={() => setPendingSave(null)}
        />
      )}

      {dialog.DialogComponent}
    </div>
  );
}
