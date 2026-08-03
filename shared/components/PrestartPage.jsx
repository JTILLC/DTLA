// shared/components/PrestartPage.jsx
//
// The daily pre-start walk, on a page of its own.
//
// These checks used to be one section inside the PM checklist. On paper that is
// where they belong; in an app it is the wrong place. PM opens on span checks,
// crack inspections, fuse ratings and battery intervals — maintenance work — and
// an operator who only has to walk the machine before a shift had to go into
// that screen and find the right section in it. Slower, and an invitation to
// tick something that was not theirs to tick.
//
// So: same items, a screen with nothing else on it, its own template and its own
// log. Nothing here writes to the PM log, and nothing here shows PM's intervals
// or overdue state — a pre-start check is not a PM and should never make one
// look done.
//
// The page opens on a BOARD, not a form: one row per line saying whether it has
// been walked today. That is the question an operator arriving for a shift is
// actually asking.
import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck, Check, AlertTriangle, MinusCircle, ChevronLeft, Settings,
  Plus, X, CircleCheck, CircleAlert, Camera,
} from 'lucide-react';
import {
  subscribeLog, addLogEntry, subscribeCrew,
  subscribePrestartTemplate, savePrestartTemplate, LOG_PRESTART,
} from '../services/logs.js';
import { PRESTART_PRESET, presetItems } from '../config/prestartPreset.js';
import { boardFor, outstandingLines, issueCount, buildSubmission, unanswered, photoCount, allPhotos } from '../utils/prestart.js';
import PhotoStrip from './PhotoStrip.jsx';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import { useLineGuard } from '../utils/useLineGuard.jsx';
import { useLineCrew, crewStamp } from '../utils/useLineCrew.js';
import { overrideStamp } from '../utils/lineAccess.js';
import PinPrompt from './PinPrompt.jsx';
import LineLockPrompt from './LineLockPrompt.jsx';
import ActingAs from './ActingAs.jsx';
import CrewChip from './CrewChip.jsx';
import ManualFigure from './ManualFigure.jsx';
import TemplateBar from './TemplateBar.jsx';
import CopyConfigFrom from './CopyConfigFrom.jsx';
import './pm-item.css';

const describeList = (d) => {
  const n = (d?.items || []).length;
  return n ? `${n} item${n === 1 ? '' : 's'}` : null;
};

const timeOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function PrestartPage({
  workspaceId,
  customerId,
  customerName,
  lines = [],            // [{ title }] or ['Line 1', …] — the open record
  visits = [],           // every record, so lines exist with nothing open
  performedByName,
  role = 'customer',
  canEditTemplate = false,
  canSubmit = true,
}) {
  const toast = useToast();
  const dialog = useDialog();
  const lineCrew = useLineCrew(workspaceId, customerId);
  const { person: actor, remember: rememberActor, touch: touchActor } = useVerifiedPerson(customerId);
  const [crewPeople, setCrewPeople] = useState([]);
  const [pendingSave, setPendingSave] = useState(null);
  const lineGuard = useLineGuard({ people: crewPeople, actor });

  const [entries, setEntries] = useState([]);
  const [template, setTemplate] = useState(null);
  const [mode, setMode] = useState('home');       // home | fill | template
  const [lineTitle, setLineTitle] = useState('');
  const [answers, setAnswers] = useState({});     // itemId -> 'ok'|'issue'|'na'|text
  const [notes, setNotes] = useState({});         // itemId -> string
  const [photos, setPhotos] = useState({});       // itemId -> [{ path }]
  const [shiftNotes, setShiftNotes] = useState(''); // one note for the whole check
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState([]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeCrew(workspaceId, customerId, setCrewPeople);
  }, [workspaceId, customerId]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_PRESTART, setEntries, 200);
  }, [workspaceId, customerId]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribePrestartTemplate(workspaceId, customerId, setTemplate);
  }, [workspaceId, customerId]);

  // Nothing saved yet falls back to the manual's own list, so a plant is never
  // looking at an empty screen waiting for JTI to set something up.
  const items = useMemo(
    () => (template?.items?.length ? template.items : presetItems()),
    [template],
  );

  // A line is defined INSIDE a log or visit, not as a thing the plant owns, so
  // "which lines are there" cannot come from whatever record happens to be open
  // — with none open there would be nothing to walk. The open record's lines
  // come first (they are the most current), then every line named by any record,
  // newest first.
  const lineTitles = useMemo(() => {
    const seen = new Set();
    lines.forEach((l) => {
      const t = typeof l === 'string' ? l : l?.title;
      if (t) seen.add(t);
    });
    [...visits]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .forEach((v) => (v.lines || []).forEach((l) => { if (l?.title) seen.add(l.title); }));
    return [...seen];
  }, [lines, visits]);
  const board = useMemo(() => boardFor(lineTitles, entries), [lineTitles, entries]);
  const outstanding = outstandingLines(board);

  // Same identity plumbing as every other log: who is filing, and may they file
  // it against this line.
  const withActor = (run) => {
    const anyPin = crewPeople.some((p) => p.pinHash);
    if (actor) touchActor();
    if (actor || !anyPin) return run(actor?.name || '');
    setPendingSave(() => run);
  };

  const startFill = (title) => {
    setLineTitle(title);
    setAnswers({});
    setNotes({});
    setPhotos({});
    setShiftNotes('');
    setMode('fill');
  };

  // One tap marks every unanswered item OK. The honest argument against it is
  // that it makes rubber-stamping easy; the honest argument for it is that
  // seven taps to say "all fine" on a machine that is fine gets the check
  // skipped altogether. It only fills BLANKS — it never overwrites a judgement
  // somebody already made.
  const markRestOk = () => {
    setAnswers((a) => {
      const next = { ...a };
      items.forEach((it) => {
        if ((it.type || 'check') === 'check' && !next[it.id]) next[it.id] = 'ok';
      });
      return next;
    });
  };

  const submit = () => withActor((filedBy) => lineGuard.check(lineTitle, async (override) => {
    if (!canSubmit) return;
    const missing = unanswered(items, answers);
    if (missing.length) {
      return toast.error(
        `${missing.length} item${missing.length === 1 ? '' : 's'} still to answer.`,
      );
    }
    const built = buildSubmission({ items, answers, notes, photos });
    setSaving(true);
    try {
      await addLogEntry(workspaceId, customerId, LOG_PRESTART, {
        lineTitle: lineTitle || null,
        performedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        ...crewStamp(lineCrew.forLine(lineTitle), lineCrew.shiftId),
        actionBy: filedBy,
        actionByVerified: !!filedBy,
        ...overrideStamp(override, lineTitle),
        role,
        notes: shiftNotes.trim(),
        items: built,
        issueCount: built.filter((i) => i.result === 'issue').length,
        okCount: built.filter((i) => i.result === 'ok').length,
      });
      setMode('home');
      setAnswers({});
      setNotes({});
      setPhotos({});
      setShiftNotes('');
      const bad = built.filter((i) => i.result === 'issue').length;
      toast.success(bad
        ? `Recorded — ${bad} problem${bad === 1 ? '' : 's'} flagged for maintenance.`
        : `${lineTitle} checked and clear.`);
    } catch (err) {
      console.error('Pre-start submit failed:', err);
      toast.error('Could not submit: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }));

  // ---- Template editing (JTI / Site Lead) ---------------------------------
  const openTemplate = () => { setDraft(items.map((i) => ({ ...i }))); setMode('template'); };

  const commitTemplate = async () => {
    const cleaned = draft
      .map((it, i) => ({
        id: it.id || `pre_${Date.now()}_${i}`,
        label: String(it.label || '').trim(),
        type: it.type || 'check',
        ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
      }))
      .filter((it) => it.label);
    if (!cleaned.length) return toast.error('Keep at least one item');
    try {
      await savePrestartTemplate(workspaceId, customerId, cleaned);
      setMode('home');
      toast.success('Pre-start checklist saved — operators will see this.');
    } catch (err) {
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    }
  };

  const prompts = (
    <>
      {pendingSave && (
        <PinPrompt
          people={crewPeople}
          customerId={customerId}
          title="Who is filing this check?"
          onCancel={() => setPendingSave(null)}
          onVerified={(person) => {
            rememberActor(person);
            const run = pendingSave;
            setPendingSave(null);
            run(person.name);
          }}
        />
      )}
      {lineGuard.challenge && (
        <LineLockPrompt
          people={crewPeople}
          customerId={customerId}
          message={lineGuard.challenge.message}
          onCancel={lineGuard.dismiss}
          onAuthorised={lineGuard.authorise}
        />
      )}
      {dialog.DialogComponent}
    </>
  );

  // ---- Fill ---------------------------------------------------------------
  if (mode === 'fill') {
    const answered = items.filter((it) => (it.type || 'check') !== 'check' || answers[it.id]).length;
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <h5 className="d-flex align-items-center gap-2 mb-0">
            <ClipboardCheck size={18} /> Pre-start — {lineTitle}
          </h5>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode('home')}>
            <ChevronLeft size={16} /> Back
          </button>
        </div>

        <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <div className="progress flex-grow-1" style={{ height: 6, minWidth: 120 }}>
            <div className="progress-bar" style={{ width: `${(answered / items.length) * 100}%` }} />
          </div>
          <small className="text-muted">{answered} of {items.length}</small>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={markRestOk}>
            Mark the rest OK
          </button>
        </div>

        <CrewChip lineCrew={lineCrew} lineTitle={lineTitle} />
        <ActingAs customerId={customerId} what="Checks" />

        <div className="d-flex flex-column gap-2 mt-2">
          {items.map((it) => {
            const a = answers[it.id];
            return (
              <div className="pm-item" key={it.id}>
                <div className="d-flex gap-2 align-items-start">
                  <div className="flex-grow-1">{it.label}</div>
                  {it.imageUrl && <ManualFigure src={it.imageUrl} alt={it.label} />}
                </div>

                {(it.type || 'check') === 'check' ? (
                  <div className="btn-group" role="group" aria-label={it.label}>
                    <button type="button"
                      className={`btn btn-sm ${a === 'ok' ? 'btn-success' : 'btn-outline-success'}`}
                      onClick={() => setAnswers((x) => ({ ...x, [it.id]: 'ok' }))}>
                      <Check size={14} /> OK
                    </button>
                    <button type="button"
                      className={`btn btn-sm ${a === 'issue' ? 'btn-danger' : 'btn-outline-danger'}`}
                      onClick={() => setAnswers((x) => ({ ...x, [it.id]: 'issue' }))}>
                      <AlertTriangle size={14} /> Problem
                    </button>
                    <button type="button"
                      className={`btn btn-sm ${a === 'na' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                      onClick={() => setAnswers((x) => ({ ...x, [it.id]: 'na' }))}>
                      <MinusCircle size={14} /> N/A
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={answers[it.id] || ''}
                    onChange={(e) => setAnswers((x) => ({ ...x, [it.id]: e.target.value }))}
                    placeholder="Reading"
                  />
                )}

                {/* A flagged problem is the one thing maintenance will read, so
                    it asks what is wrong rather than leaving them a bare tick. */}
                {a === 'issue' && (
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={notes[it.id] || ''}
                    onChange={(e) => setNotes((x) => ({ ...x, [it.id]: e.target.value }))}
                    placeholder="What is wrong? (maintenance will read this)"
                  />
                )}

                {/* A photo on any item, but only offered up front on a problem —
                    a description of a rocking table is worth far less than a
                    picture of it, and asking for one on all seven items every
                    morning is how the whole check stops being done. */}
                {(a === 'issue' || (photos[it.id] || []).length > 0) && (
                  <PhotoStrip
                    photos={photos[it.id] || []}
                    onChange={(next) => setPhotos((x) => ({ ...x, [it.id]: next }))}
                    pathPrefix={`prestart-photos/${workspaceId}/${customerId}`}
                    label="Photo"
                    max={3}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3">
          <label className="form-label" htmlFor="prestart-notes">
            Anything else? <span className="text-secondary fw-normal">(optional)</span>
          </label>
          <textarea
            id="prestart-notes"
            className="form-control"
            rows={2}
            value={shiftNotes}
            onChange={(e) => setShiftNotes(e.target.value)}
            placeholder="Anything worth passing on that isn't one of the items above"
          />
        </div>

        <button type="button" className="btn btn-primary w-100 mt-3" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : `Submit ${lineTitle} pre-start`}
        </button>
        {prompts}
      </div>
    );
  }

  // ---- Template -----------------------------------------------------------
  if (mode === 'template') {
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h5 className="d-flex align-items-center gap-2 mb-0">
            <Settings size={18} /> Pre-start checklist{customerName ? ` — ${customerName}` : ''}
          </h5>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode('home')}>
            <ChevronLeft size={16} /> Cancel
          </button>
        </div>

        <small className="text-muted d-block mb-3">
          What operators walk through before a shift. Keep it short — a list nobody can
          finish in a couple of minutes is a list that gets ticked without looking.
          Editing this never changes checks already submitted.
        </small>

        <div className="d-flex flex-wrap gap-2 mb-3">
          <button type="button" className="btn btn-sm btn-outline-secondary"
            onClick={() => setDraft(presetItems())}>
            Load {PRESTART_PRESET.name}
          </button>
        </div>

        <CopyConfigFrom
          workspaceId={workspaceId}
          customers={[]}
          currentCustomerId={customerId}
          configKey="prestartTemplate"
          label="pre-start checklist"
          describe={describeList}
          onCopy={(d) => setDraft((d?.items || []).map((i) => ({ ...i })))}
        />

        {canEditTemplate && (
          <TemplateBar
            workspaceId={workspaceId}
            customers={[]}
            currentCustomerId={customerId}
            configKey="prestartTemplate"
            label="pre-start checklist"
            draft={() => ({ items: draft })}
            describe={describeList}
            onLoad={(d) => setDraft((d?.items || []).map((i) => ({ ...i })))}
            updatedBy={performedByName}
          />
        )}

        <div className="d-flex flex-column gap-2">
          {draft.map((it, i) => (
            <div className="pm-item" key={it.id || i}>
              <textarea
                className="form-control pm-item-label"
                rows={2}
                value={it.label || ''}
                onChange={(e) => setDraft((d) => d.map((v, j) => (j === i ? { ...v, label: e.target.value } : v)))}
                placeholder="What to check"
              />
              <div className="pm-item-controls">
                <select
                  className="form-select form-select-sm"
                  style={{ width: 'auto' }}
                  value={it.type || 'check'}
                  onChange={(e) => setDraft((d) => d.map((v, j) => (j === i ? { ...v, type: e.target.value } : v)))}
                >
                  <option value="check">OK / Problem / N/A</option>
                  <option value="value">A reading</option>
                </select>
                <button type="button" className="btn btn-sm btn-outline-danger"
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="d-flex gap-2 mt-3">
          <button type="button" className="btn btn-sm btn-outline-secondary"
            onClick={() => setDraft((d) => [...d, { id: `pre_${Date.now()}_${d.length}`, label: '', type: 'check' }])}>
            <Plus size={14} /> Add item
          </button>
          <button type="button" className="btn btn-primary" onClick={commitTemplate}>Save checklist</button>
        </div>
        {prompts}
      </div>
    );
  }

  // ---- Home: the board ----------------------------------------------------
  return (
    <div>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-1">
        <h5 className="d-flex align-items-center gap-2 mb-0">
          <ClipboardCheck size={18} /> Pre-start checks{customerName ? ` — ${customerName}` : ''}
        </h5>
        {canEditTemplate && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={openTemplate}>
            <Settings size={16} /> Edit checklist
          </button>
        )}
      </div>
      <small className="text-muted d-block mb-3">
        Walk each line before it runs. Anything you flag goes to maintenance.
      </small>

      {lineTitles.length === 0 ? (
        <p className="text-secondary">No lines set up yet — add them on the current log first.</p>
      ) : (
        <>
          <div className={`alert ${outstanding.length ? 'alert-warning' : 'alert-success'} py-2`}>
            {outstanding.length
              ? <><strong>{outstanding.length} line{outstanding.length === 1 ? '' : 's'} still to check today:</strong> {outstanding.join(', ')}</>
              : <><CircleCheck size={16} className="me-1" /><strong>Every line checked today.</strong></>}
          </div>

          <div className="d-flex flex-column gap-2">
            {board.map(({ lineTitle: title, entry, doneToday }) => {
              const bad = doneToday ? issueCount(entry) : 0;
              return (
                <div key={title} className="card">
                  <div className="card-body d-flex align-items-center gap-2 flex-wrap py-2">
                    <div className="flex-grow-1">
                      <div className="fw-semibold d-flex align-items-center gap-2">
                        {title}
                        {doneToday && (bad
                          ? <span className="badge bg-danger"><CircleAlert size={11} /> {bad} problem{bad === 1 ? '' : 's'}</span>
                          : <span className="badge bg-success"><CircleCheck size={11} /> clear</span>)}
                      </div>
                      <small className="text-secondary">
                        {doneToday
                          ? `Checked ${timeOf(entry.performedAt)}${entry.actionBy ? ` by ${entry.actionBy}` : ''}`
                          : entry
                            ? `Last checked ${new Date(entry.performedAt).toLocaleDateString()}`
                            : 'Never checked'}
                      </small>
                    </div>
                    {canSubmit && (
                      <button
                        type="button"
                        className={`btn btn-sm ${doneToday ? 'btn-outline-secondary' : 'btn-primary'}`}
                        onClick={() => startFill(title)}
                      >
                        {doneToday ? 'Check again' : 'Start check'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Recent checks, short on purpose — this page is for doing the walk, not
          for auditing it. The full record is in the log. */}
      {entries.length > 0 && (
        <div className="mt-4">
          <h6 className="text-secondary">Recent checks</h6>
          <ul className="list-group list-group-flush">
            {entries.slice(0, 8).map((e) => (
              <li key={e.id} className="list-group-item px-0 d-flex gap-2 align-items-center flex-wrap">
                <span className="fw-semibold">{e.lineTitle || '—'}</span>
                <span className="small text-secondary">
                  {new Date(e.performedAt).toLocaleDateString()} {timeOf(e.performedAt)}
                  {e.actionBy ? ` · ${e.actionBy}` : ''}
                </span>
                {photoCount(e) > 0 && (
                  <span className="badge bg-secondary"><Camera size={11} /> {photoCount(e)}</span>
                )}
                {issueCount(e) > 0
                  ? <span className="badge bg-danger ms-auto">{issueCount(e)} problem{issueCount(e) === 1 ? '' : 's'}</span>
                  : <span className="badge bg-success ms-auto">clear</span>}
                {/* What was actually wrong, and the note left with it — the
                    reason anyone opens this list at all. */}
                {(issueCount(e) > 0 || e.notes) && (
                  <div className="w-100 small text-secondary ps-1">
                    {(e.items || []).filter((i) => i.result === 'issue').map((i, n) => (
                      <div key={n}>• {i.label}{i.note ? ` — ${i.note}` : ''}</div>
                    ))}
                    {e.notes && <div className="fst-italic">“{e.notes}”</div>}
                    <PhotoStrip photos={allPhotos(e)} onChange={() => {}} readOnly size={44} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {prompts}
    </div>
  );
}
