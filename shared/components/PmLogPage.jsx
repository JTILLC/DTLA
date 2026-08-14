// src/components/PmLogPage.jsx
//
// Preventative maintenance log. JTI defines the checklist; the plant's
// maintenance staff and operators fill it in; the share-link viewer shows the
// result read-only.
//
// Two things worth knowing about the data model:
//
// 1. A submission COPIES each item's label into itself instead of pointing at
//    the template. Templates get edited — items renamed, reordered, removed —
//    and a signed-off check has to keep meaning what it meant on the day. A
//    reference would let an edit silently rewrite history.
//
// 2. Submissions are immutable once made. To correct one you submit again; the
//    log is a record of checks performed, not a document to revise.
//
// 3. A submission covers ONE frequency, not the whole checklist. Each section
//    says how often it runs, and daily / weekly / monthly / quarterly / annual
//    each keep their own last-done and next-due. Before this, one submission
//    marked everything done at once and the interval was typed in by whoever
//    was holding the tablet — so a plant's daily walk-round silently signed off
//    its annual load-cell certification. See utils/pmFrequency.js.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Settings, Plus, X, Trash2, ChevronLeft, BookOpen } from 'lucide-react';
import {
  LOG_PM, subscribeLog, addLogEntry, deleteLogEntry, updateLogEntry,
  subscribePmTemplate, savePmTemplate, DEFAULT_PM_SECTIONS,
  sinceLabel, dueStatus,
} from '../services/logs.js';
import ReferenceImage from './ReferenceImage.jsx';
import ManualFigure from './ManualFigure.jsx';
import { PM_PRESETS, presetSections } from '../config/pmPresets.js';
import {
  FREQUENCIES, boardFor, frequencyOf, bucketOf, labelOf, needsSignOff,
  nextDueFor, sectionsFor, FREQ_BY_KEY, WHOLE_PLANT,
} from '../utils/pmFrequency.js';
import { useToast } from './Toast.jsx';
import CopyConfigFrom from './CopyConfigFrom.jsx';
import CrewLine from './CrewLine.jsx';
import CrewChip from './CrewChip.jsx';
import EditedNote from './EditedNote.jsx';
import { withEditStamp } from '../utils/editTrail.js';
import PinPrompt from './PinPrompt.jsx';
import LineLockPrompt from './LineLockPrompt.jsx';
import { useLineGuard } from '../utils/useLineGuard.jsx';
import { overrideStamp } from '../utils/lineAccess.js';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import { subscribeCrew } from '../services/logs.js';
import { useLineCrew, crewStamp } from '../utils/useLineCrew.js';
import { useDialog } from './DialogSystem.jsx';
import { isSiteLead } from '../utils/roles.js';
import './pm-item.css';
import ActingAs from './ActingAs.jsx';
import TemplateBar from './TemplateBar.jsx';

// One wording for "what is in this checklist", shared by the copy-from picker,
// the JTI template bar and the push dialog.
const describeChecklist = (d) => {
  const secs = d?.sections || [];
  const items = secs.reduce((n, s) => n + (s.items || []).length, 0);
  if (!secs.length || !items) return null;
  return `${secs.length} section${secs.length === 1 ? '' : 's'} and ${items} item${items === 1 ? '' : 's'}`;
};

const RESULTS = [
  { key: 'ok', label: 'OK', cls: 'btn-success' },
  { key: 'issue', label: 'Issue', cls: 'btn-danger' },
  { key: 'na', label: 'N/A', cls: 'btn-secondary' },
];

const newId = () => Math.random().toString(36).slice(2, 9);


// A copied checklist takes the WORDING, not the identity or the photos.
//
// New ids because item ids key answers while filling in — sharing them across
// customers would let one plant's in-progress check bleed into another's.
//
// Uploaded reference photos are dropped: they live at
// pm-images/{ws}/{sourceCustomer}/ and both storage.rules and the media broker
// authorise per customer, so a copied path would simply 403 for the new
// customer's operators. Better an obviously missing photo than a broken one.
//
// Manual FIGURES are kept. They ship with the app at a fixed URL and are the
// same drawing for every CCW-R, so there is nothing customer-scoped to break.
const copiedSections = (sections) =>
  (sections || []).map((sec, si) => ({
    id: `sec_${Date.now()}_${si}`,
    title: sec.title || '',
    // Resolved rather than copied raw: a checklist written before the field
    // existed arrives with none, and inferring from the title here means the
    // copy lands on a real schedule instead of silently becoming as-needed.
    frequency: frequencyOf(sec),
    items: (sec.items || []).map((it, ii) => ({
      id: `item_${Date.now()}_${si}_${ii}`,
      label: it.label || '',
      type: it.type || 'check',
      ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
    })),
  }));

// A textarea that is exactly as tall as its content.
//
// Checklist items are sentences, not words, and a one-line input hides all but
// the first few. This grows as you type and, importantly, arrives at the right
// height for text that is ALREADY there — which is the case that matters when
// you open a saved checklist to read it.
function GrowingTextarea({ value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';                 // shrink first, or it only ever grows
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} {...props} />;
}

export default function PmLogPage({
  customers = [],
  workspaceId,
  customerId,
  customerName,
  visits = [],
  performedByName,
  role = 'customer',
  canEditTemplate = false,
  canSubmit = true,
}) {
  const toast = useToast();
  const lineCrew = useLineCrew(workspaceId, customerId);
  // Crewing says who was ON the line; this says who actually filed the entry.
  // An entry logged at 2am otherwise inherits whoever was crewed at 6am.
  const { person: actor, remember: rememberActor } = useVerifiedPerson(customerId);
  const [crewPeople, setCrewPeople] = useState([]);
  const [pendingSave, setPendingSave] = useState(null);
  // Identity says who is filing; this says whether they may file it here.
  const lineGuard = useLineGuard({ people: crewPeople, actor });
  // A PM check is the record most likely to be questioned later, so signing one
  // off is the one action here that must be an attestation rather than a name
  // picked from a list. A supervisor proves it with their own PIN.
  const [signingEntry, setSigningEntry] = useState(null);
  // A submitted check reopened for correction. Items keep the wording they were
  // signed off with; only the answers and notes are editable.
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeCrew(workspaceId, customerId, setCrewPeople);
  }, [workspaceId, customerId]);

  // Both submitting and editing a PM check confirm who is doing it, every
  // time. Having proved who you are earlier in the shift is not the same as
  // confirming THIS check, and that confirmation is the whole value of the
  // record — a signed daily nobody actually signed is worse than no signature.
  //
  // A plant that has not set PINs up keeps logging, unattributed. This records
  // who filed something; it must never become a lock on recording work at all.
  const withFreshActor = (run) => {
    const anyPin = crewPeople.some((p) => p.pinHash);
    if (!anyPin) return run('');
    setPendingSave(() => run);
  };

  const dialog = useDialog();
  const [entries, setEntries] = useState([]);
  const [template, setTemplate] = useState(null);
  const [mode, setMode] = useState('home');       // home | fill | template
  const [answers, setAnswers] = useState({});     // itemId -> { result, value, note }
  const [lineTitle, setLineTitle] = useState('');
  const [notes, setNotes] = useState('');
  // Which frequency the fill screen is running. Set when a board row is
  // opened, so the screen only ever shows the checks that row covers.
  const [fillFreq, setFillFreq] = useState('daily');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState([]);         // template editor working copy
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_PM, setEntries);
  }, [workspaceId, customerId]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribePmTemplate(workspaceId, customerId, setTemplate);
  }, [workspaceId, customerId]);

  const sections = (template?.sections?.length ? template.sections : DEFAULT_PM_SECTIONS);

  const lines = useMemo(() => {
    const seen = new Set();
    [...visits]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .forEach((v) => (v.lines || []).forEach((l) => l?.title && seen.add(l.title)));
    return [...seen];
  }, [visits]);

  // One row per frequency the checklist uses, each broken down per line.
  //
  // A frequency nobody has run yet has no nextDueAt, which dueStatus reads as
  // "no schedule" rather than overdue — on the day this ships every bucket is
  // empty, and a board opening in red about work nobody is late on would be
  // worse than the problem it fixes.
  const board = useMemo(
    () => boardFor(sections, entries, { lineTitles: lines }).map((row) => ({
      ...row,
      due: dueStatus(row.nextDueAt),
      byLine: row.byLine.map((b) => ({ ...b, due: dueStatus(b.nextDueAt) })),
    })),
    [sections, entries, lines],
  );

  // Opening a check always says which frequency AND which line it is for, so
  // the fill screen never has to guess and the operator never has to set a
  // dropdown they have already answered by tapping.
  const runCheck = (freqKey, forLine) => {
    setFillFreq(freqKey);
    setLineTitle(forLine || '');
    setAnswers({});
    setMode('fill');
  };

  // The sections the fill screen is running, and what it will schedule next.
  const fillSections = useMemo(() => sectionsFor(sections, fillFreq), [sections, fillFreq]);

  const setAnswer = (itemId, patch) =>
    setAnswers((a) => ({ ...a, [itemId]: { ...(a[itemId] || {}), ...patch } }));

  // ---- Submit -------------------------------------------------------------
  // withFreshActor, not withActor: a PM check is a signed statement that work
  // was carried out, so it asks every time. Having keyed a PIN earlier in the
  // shift proves who you are; it does not confirm THIS check. A plant with no
  // PINs set still submits, unattributed, exactly as everywhere else.
  const submit = () => withFreshActor((filedBy) => lineGuard.check(lineTitle, async (override) => {
    // Whoever cannot submit cannot file a check by any route, not merely by
    // having the button hidden.
    if (!canSubmit) return;
    const items = [];
    fillSections.forEach((sec) =>
      (sec.items || []).forEach((it) => {
        const a = answers[it.id] || {};
        items.push({
          section: sec.title,
          label: it.label,          // copied, not referenced — see header note
          ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
          type: it.type || 'check',
          result: it.type === 'value' ? '' : (a.result || ''),
          value: it.type === 'value' ? (a.value || '') : '',
          note: a.note || '',
        });
      })
    );

    // Refused up front, and only when the app actually knows the lines — a
    // plant whose lines are not on record yet must still be able to record
    // work, or the check simply does not get written down anywhere.
    if (lines.length > 0 && !lineTitle) {
      return toast.error('Pick which line this check was carried out on');
    }

    const answered = items.filter((i) => i.result || i.value);
    if (answered.length === 0) {
      return toast.error('Fill in at least one item before submitting');
    }

    setSaving(true);
    try {
      await addLogEntry(workspaceId, customerId, LOG_PM, {
        lineTitle: lineTitle || null,
        performedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        ...crewStamp(lineCrew.forLine(lineTitle), lineCrew.shiftId),
        // Who filed it, proven — distinct from the crew, which is context.
        actionBy: filedBy,
        actionByVerified: !!filedBy,
        role,
        notes: notes.trim(),
        items,
        issueCount: items.filter((i) => i.result === 'issue').length,
        okCount: items.filter((i) => i.result === 'ok').length,
        frequency: fillFreq,
        // Kept alongside the frequency so anything reading the old field still
        // works, and so a bucket survives even if the vocabulary is edited.
        intervalDays: FREQ_BY_KEY[fillFreq]?.days ?? null,
        nextDueAt: nextDueFor(fillFreq),
      });
      setAnswers({});
      setNotes('');
      setMode('home');
      toast.success(`${labelOf(fillFreq)} PM check submitted`);
    } catch (err) {
      console.error('PM submit failed:', err);
      toast.error('Could not submit: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }));

  const openEdit = (entry) => setEditing({
    id: entry.id,
    entry,
    notes: entry.notes || '',
    items: (entry.items || []).map((it) => ({ ...it })),
  });

  const saveEdit = () => withFreshActor((filedBy) => lineGuard.check(editing?.lineTitle, async (override) => {
    if (!editing) return;
    try {
      const issueCount = editing.items.filter((it) => it.result === 'issue').length;
      await updateLogEntry(workspaceId, customerId, LOG_PM, editing.id, withEditStamp({
        items: editing.items,
        notes: editing.notes.trim(),
        issueCount,
      }, editing.entry, filedBy));
      toast.success('Check updated');
      setEditing(null);
    } catch (err) {
      console.error('PM edit failed:', err);
      toast.error('Could not update: ' + (err?.message || 'unknown error'));
    }
  }));

  const signOff = async (entry, supervisor) => {
    try {
      await updateLogEntry(workspaceId, customerId, LOG_PM, entry.id, {
        supervisorSignedBy: supervisor.name,
        supervisorSignedAt: new Date().toISOString(),
      });
      toast.success(`Signed off by ${supervisor.name}`);
    } catch (err) {
      console.error('PM sign-off failed:', err);
      toast.error('Could not sign off: ' + (err?.message || 'unknown error'));
    }
  };

  const removeEntry = async (entry) => {
    const ok = await dialog.confirm(
      `Delete the PM check submitted ${new Date(entry.performedAt).toLocaleString()}?`,
      { title: 'Delete PM check', confirmText: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    try {
      await deleteLogEntry(workspaceId, customerId, LOG_PM, entry.id);
      toast.success('Deleted');
    } catch (err) {
      toast.error('Could not delete: ' + (err?.message || 'unknown error'));
    }
  };

  // ---- Template editing ---------------------------------------------------
  // ADDS the manual's sections rather than replacing the checklist. A plant's
  // own items exist because something bit them once; a preset must never be
  // able to wipe that. Sections already present by title are skipped, so
  // pressing it twice does not duplicate the manual.
  const addPreset = async (preset) => {
    const have = new Set(draft.map((s) => (s.title || '').trim().toLowerCase()));
    const incoming = presetSections(preset).filter(
      (s) => !have.has((s.title || '').trim().toLowerCase())
    );
    if (incoming.length === 0) {
      return toast.error('Those sections are already on this checklist.');
    }
    const skipped = preset.sections.length - incoming.length;
    const ok = await dialog.confirm(
      `Add ${incoming.length} section${incoming.length === 1 ? '' : 's'} from ${preset.name}?` +
      (skipped ? ` (${skipped} already present, and will be left alone.)` : '') +
      ' Nothing is saved until you press save.',
      { title: 'Add manual checklist', confirmText: 'Add' }
    );
    if (!ok) return;
    setDraft((d) => [...d, ...incoming]);
    toast.success('Added — review it, then save.');
  };

  const openTemplate = () => {
    setDraft(JSON.parse(JSON.stringify(sections)));
    setMode('template');
  };

  const commitTemplate = async () => {
    const cleaned = draft
      .map((sec) => ({
        ...sec,
        title: (sec.title || '').trim(),
        items: (sec.items || [])
          .map((it) => ({
            ...it,
            label: (it.label || '').trim(),
            // Firestore rejects undefined; a missing image must be null.
            image: it.image || null,
          }))
          .filter((it) => it.label),
      }))
      .filter((sec) => sec.title && sec.items.length);
    if (cleaned.length === 0) return toast.error('Add at least one section with one item');
    setSavingTemplate(true);
    try {
      await savePmTemplate(workspaceId, customerId, cleaned);
      setMode('home');
      toast.success('Checklist saved — the customer app will use it');
    } catch (err) {
      toast.error('Could not save checklist: ' + (err?.message || 'unknown error'));
    } finally {
      setSavingTemplate(false);
    }
  };

  if (!customerId) {
    return <div className="text-muted p-3">Select a customer to use the PM log.</div>;
  }

  // ---- Template editor ----------------------------------------------------
  if (mode === 'template') {
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h5 className="d-flex align-items-center gap-2 mb-0">
            <Settings size={18} /> PM checklist{customerName ? ` — ${customerName}` : ''}
          </h5>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode('home')}>
            <ChevronLeft size={16} /> Cancel
          </button>
        </div>

        <small className="text-muted d-block mb-3">
          These are the items operators will fill in. Editing this never changes
          checks already submitted — each submission keeps the wording it was
          signed off with.
        </small>

        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <span className="small text-muted">Add from the equipment manual</span>
          {PM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => addPreset(preset)}
            >
              <BookOpen size={14} /> {preset.name}
            </button>
          ))}
        </div>

        <CopyConfigFrom
          workspaceId={workspaceId}
          customers={customers}
          currentCustomerId={customerId}
          configKey="pmTemplate"
          label="checklist"
          describe={describeChecklist}
          onCopy={(d) => setDraft(copiedSections(d?.sections))}
        />

        {canEditTemplate && (
          <TemplateBar
            workspaceId={workspaceId}
            customers={customers}
            currentCustomerId={customerId}
            configKey="pmTemplate"
            label="checklist"
            // Sent as copiedSections would leave it: fresh ids, and without the
            // per-customer uploaded photos, whose Storage paths and broker auth
            // are scoped to the plant they were taken at. A pushed reference to
            // one would resolve to a broken image at every other site.
            draft={() => ({ sections: copiedSections(draft) })}
            describe={describeChecklist}
            onLoad={(d) => setDraft(copiedSections(d?.sections))}
            updatedBy={performedByName}
          />
        )}

        {draft.map((sec, si) => (
          <div className="card mb-3" key={sec.id || si}>
            <div className="card-header d-flex gap-2 align-items-center flex-wrap">
              <input
                type="text"
                className="form-control form-control-sm"
                style={{ minWidth: '12rem' }}
                value={sec.title}
                placeholder="Section title"
                onChange={(e) => setDraft((d) => d.map((s, i) => (i === si ? { ...s, title: e.target.value } : s)))}
              />
              {/* How often this section runs. It is what splits the log into
                  separate daily / weekly / monthly records, so it sits beside
                  the title rather than buried in the items. An existing
                  checklist that never had the field falls back to reading its
                  own title, so this shows the right thing before anyone edits
                  anything. */}
              <label className="small text-muted mb-0" htmlFor={`pm-freq-${si}`}>Runs</label>
              <select
                id={`pm-freq-${si}`}
                className="form-select form-select-sm"
                style={{ maxWidth: '11rem' }}
                value={frequencyOf(sec)}
                onChange={(e) => setDraft((d) => d.map((x, i) => (i === si ? { ...x, frequency: e.target.value } : x)))}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              {needsSignOff(frequencyOf(sec)) && (
                <span className="badge bg-secondary" title="A supervisor signs this one off after it is submitted">
                  supervisor sign-off
                </span>
              )}
              <button
                type="button"
                className="btn btn-sm btn-outline-danger ms-auto"
                onClick={() => setDraft((d) => d.filter((_, i) => i !== si))}
                aria-label="Remove section"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="card-body d-flex flex-column gap-2">
              {(sec.items || []).map((it, ii) => (
                /* The label gets a row of its own, and grows to fit.
                   These are instructions — "Dispersion table surface and radial
                   troughs free of product build-up" — and in a Bootstrap
                   input-group they shared one line with a dropdown, a delete
                   button and two image buttons. What was left showed about
                   twenty characters, so the only way to read an item was to
                   click into the field and scrub sideways. */
                <div className="pm-item" key={it.id || ii}>
                  <GrowingTextarea
                    className="form-control pm-item-label"
                    value={it.label}
                    placeholder="Item to check"
                    onChange={(e) => setDraft((d) => d.map((s, i) => i !== si ? s : {
                      ...s, items: s.items.map((x, j) => (j === ii ? { ...x, label: e.target.value } : x)),
                    }))}
                  />
                  <div className="pm-item-controls">
                  <select
                    className="form-select"
                    style={{ maxWidth: '150px' }}
                    value={it.type || 'check'}
                    onChange={(e) => setDraft((d) => d.map((s, i) => i !== si ? s : {
                      ...s, items: s.items.map((x, j) => (j === ii ? { ...x, type: e.target.value } : x)),
                    }))}
                  >
                    <option value="check">OK / Issue</option>
                    <option value="value">Reading</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    onClick={() => setDraft((d) => d.map((s, i) => i !== si ? s : {
                      ...s, items: s.items.filter((_, j) => j !== ii),
                    }))}
                    aria-label="Remove item"
                  >
                    <X size={16} />
                  </button>
                  {it.imageUrl && (
                    <span className="pm-item-fig">
                      <ManualFigure src={it.imageUrl} label={it.label} size={40} />
                    </span>
                  )}
                  <span className="pm-item-fig">
                    <ReferenceImage
                      image={it.image}
                      pathPrefix={`pm-images/${workspaceId}/${customerId}`}
                      onChange={(img) => setDraft((d) => d.map((s, i) => i !== si ? s : {
                        ...s, items: s.items.map((x, j) => (j === ii ? { ...x, image: img } : x)),
                      }))}
                      size={40}
                    />
                  </span>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary align-self-start"
                onClick={() => setDraft((d) => d.map((s, i) => i !== si ? s : {
                  ...s, items: [...(s.items || []), { id: newId(), label: '', type: 'check' }],
                }))}
              >
                <Plus size={16} /> Add item
              </button>
            </div>
          </div>
        ))}

        <div className="d-flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setDraft((d) => [...d, {
              id: newId(),
              title: '',
              // Monthly by default because that is what the old free-typed
              // interval defaulted to (30 days) — a section somebody adds
              // without touching the dropdown keeps the meaning it used to have.
              frequency: 'monthly',
              items: [{ id: newId(), label: '', type: 'check' }],
            }])}
          >
            <Plus size={16} /> Add section
          </button>
          <button type="button" className="btn btn-primary" onClick={commitTemplate} disabled={savingTemplate}>
            {savingTemplate ? 'Saving…' : 'Save checklist'}
          </button>
        </div>
        {dialog.DialogComponent}
      </div>
    );
  }

  // ---- Fill in a check ----------------------------------------------------
  if (mode === 'fill') {
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h5 className="mb-0 d-flex align-items-center gap-2 flex-wrap">
            {labelOf(fillFreq)} PM check
            {/* The line is in the heading, not only in the dropdown below it.
                A daily is filed per line, so which line this one counts for is
                part of what you are confirming — not a setting further down
                the page that is easy to submit without ever looking at. */}
            <span className="badge bg-primary">{lineTitle || 'Whole plant'}</span>
            {needsSignOff(fillFreq) && (
              <span className="badge bg-secondary">needs supervisor sign-off</span>
            )}
          </h5>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode('home')}>
            <ChevronLeft size={16} /> Back
          </button>
        </div>

        {/* Says plainly that this covers one interval only. The old screen
            showed every section at once, which is exactly the confusion this
            change exists to remove. */}
        <p className="small text-muted">
          These are the {labelOf(fillFreq).toLowerCase()} checks only. Submitting them records a
          {' '}{labelOf(fillFreq).toLowerCase()} check and does not affect any other interval.
        </p>

        {lines.length > 0 && (
          <div className="mb-3">
            <label className="form-label" htmlFor="pm-line">Line</label>
            {/* Required, not optional. Every PM check at these plants is run
                per line, and the old "whole plant" default meant a check filed
                without a thought recorded nothing about which machine it was
                actually carried out on. Checks already filed that way are still
                readable in the history; there is just no way to make another. */}
            <select id="pm-line" className="form-select" value={lineTitle} onChange={(e) => setLineTitle(e.target.value)}>
              <option value="">— Pick a line —</option>
              {lines.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}

        {fillSections.map((sec) => (
          <div className="card mb-3" key={sec.id || sec.title}>
            <div className="card-header"><strong>{sec.title}</strong></div>
            <div className="card-body d-flex flex-column gap-3">
              {(sec.items || []).map((it) => {
                const a = answers[it.id] || {};
                return (
                  <div key={it.id}>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <div className="fw-semibold flex-grow-1">{it.label}</div>
                      {/* The manual's own drawing of the part, where the item
                          came from the manual preset. */}
                      <ManualFigure src={it.imageUrl} label={it.label} size={44} />
                      {/* Reference photo, if the checklist has one — shows the
                          operator what they're looking at. */}
                      <ReferenceImage
                        image={it.image}
                        pathPrefix={`pm-images/${workspaceId}/${customerId}`}
                        onChange={() => {}}
                        readOnly
                        size={44}
                      />
                    </div>
                    {it.type === 'value' ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        className="form-control"
                        placeholder="Reading"
                        value={a.value || ''}
                        onChange={(e) => setAnswer(it.id, { value: e.target.value })}
                      />
                    ) : (
                      // Big tap targets: this is filled in on a phone or tablet
                      // on the floor, often with gloves on.
                      <div className="btn-group w-100" role="group" aria-label={it.label}>
                        {RESULTS.map((r) => (
                          <button
                            key={r.key}
                            type="button"
                            className={`btn ${a.result === r.key ? r.cls : 'btn-outline-secondary'}`}
                            onClick={() => setAnswer(it.id, { result: a.result === r.key ? '' : r.key })}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      type="text"
                      className="form-control form-control-sm mt-1"
                      placeholder="Note (optional)"
                      value={a.note || ''}
                      onChange={(e) => setAnswer(it.id, { note: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="card mb-3">
          <div className="card-body d-flex flex-column gap-2">
            <input
              type="text"
              className="form-control"
              placeholder="Overall notes (optional)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {/* The schedule comes from the section's own frequency now. It was
                a number typed in at submit time, which meant the person least
                likely to know the plant's PM policy set it, and any typo
                rescheduled everything. */}
            <div className="small text-muted">
              {FREQ_BY_KEY[fillFreq]?.days
                ? <>Next {labelOf(fillFreq).toLowerCase()} check due in <strong>{FREQ_BY_KEY[fillFreq].days} days</strong>.</>
                : <>These checks are not on a schedule — nothing will be marked due.</>}
            </div>
            <CrewChip lineCrew={lineCrew} lineTitle={lineTitle} />
            <ActingAs customerId={customerId} what="PM checks" />
            <button type="button" className="btn btn-primary btn-lg" onClick={submit} disabled={saving}>
              {saving ? 'Submitting…' : 'Submit PM check'}
            </button>
          </div>
        </div>
        {dialog.DialogComponent}
      </div>
    );
  }

  // ---- Home: status + history --------------------------------------------
  return (
    <div>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <h5 className="d-flex align-items-center gap-2 mb-0">
          <ClipboardList size={18} /> Preventative Maintenance{customerName ? ` — ${customerName}` : ''}
        </h5>
        <div className="d-flex align-items-center gap-2">
          {canEditTemplate && (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={openTemplate}>
              <Settings size={16} /> Checklist
            </button>
          )}
          {/* No single "new check" button any more: which check you are running
              is the question this screen exists to answer, so it is asked on the
              board rather than after you have already committed to filling one
              in. */}
        </div>
      </div>

      {/* One row per interval this plant's checklist actually uses. Each keeps
          its own last-done and next-due, so a finished daily says nothing about
          the monthly sitting under it. */}
      {board.length === 0 ? (
        <div className="card mb-3">
          <div className="card-body small text-muted">
            No checklist set up yet.{canEditTemplate
              ? ' Use Checklist above to build one — each section says how often it runs.'
              : ' JTI sets this up for your plant.'}
          </div>
        </div>
      ) : (
        <div className="card mb-3">
          <div className="card-header"><strong>Checks</strong></div>
          <div className="list-group list-group-flush">
            {board.map((row) => {
              const items = row.sections.reduce((t, sec) => t + (sec.items || []).length, 0);
              return (
                <div className="list-group-item d-flex align-items-center justify-content-between flex-wrap gap-2" key={row.key}>
                  <div>
                    <div className="fw-semibold d-flex align-items-center gap-2 flex-wrap">
                      {row.label}
                      <span className="badge bg-light text-dark border">{items} item{items === 1 ? '' : 's'}</span>
                      {row.awaitingSignOff && (
                        <span className="badge bg-warning text-dark">awaiting sign-off</span>
                      )}
                    </div>
                    {/* The line is named because this board is plant-wide: the
                        newest check of that frequency wins whichever line it
                        was on, so "Last done 2 hours ago" alone would read as
                        the whole plant being done when one line was. The
                        Overview breaks it down per line. */}
                    <div className="small text-muted">
                      {row.last
                        ? `Last done ${sinceLabel(row.last.performedAt)}${row.last.lineTitle ? ` on ${row.last.lineTitle}` : ''} — ${row.last.performedBy || 'Unknown'}`
                        : 'Never run'}
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {/* 'none' covers both as-needed and never-run. Neither is
                        overdue, and a red badge on either would be a lie. */}
                    {row.due.state !== 'none' && (
                      <span
                        className={
                          'badge ' +
                          (row.due.state === 'overdue' ? 'bg-danger'
                            : row.due.state === 'due' || row.due.state === 'soon' ? 'bg-warning text-dark'
                            : 'bg-success')
                        }
                      >
                        {row.due.label}
                      </span>
                    )}
                    {/* Only where the app does not yet know this plant's
                        lines. Everywhere else the line chips below ARE the
                        run buttons, and a second one that quietly filed
                        against no line is exactly what we just removed. */}
                    {canSubmit && lines.length === 0 && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => runCheck(row.key, WHOLE_PLANT)}
                      >
                        <Plus size={16} /> Run
                      </button>
                    )}
                  </div>

                  {/* Per line, because a daily is per line: one line's
                      walk-round says nothing about the next one's. Each chip
                      runs that line's check directly, so an operator taps the
                      line that still needs doing instead of opening the form
                      and setting a dropdown to say what they already knew. */}
                  {row.byLine.length > 0 && (
                    <div className="d-flex flex-wrap gap-1 w-100">
                      {row.byLine.map((b) => {
                        const tone = b.due.state === 'overdue' ? 'btn-outline-danger'
                          : b.due.state === 'due' || b.due.state === 'soon' ? 'btn-outline-warning'
                          : b.last ? 'btn-outline-success'
                          : 'btn-outline-secondary';
                        // Checks filed before the line became required. They
                        // stay visible because they are real work that was
                        // really done, but they are a record now, not a button:
                        // there is no line to run "not line-specific" against.
                        const isLegacy = b.lineTitle === WHOLE_PLANT && lines.length > 0;
                        const name = b.lineTitle || (isLegacy ? 'Not line-specific' : 'Whole plant');
                        const when = !b.last ? 'never run'
                          : b.due.state === 'none' ? `done ${sinceLabel(b.last.performedAt)}`
                          : b.due.label.toLowerCase();
                        const detail = b.last
                          ? `Last done ${sinceLabel(b.last.performedAt)} by ${b.last.performedBy || 'Unknown'}`
                          : 'No check of this kind recorded for this line';

                        if (isLegacy) {
                          return (
                            <span
                              key={name}
                              className="btn btn-sm btn-outline-secondary disabled opacity-75"
                              title={`${detail}. Filed before checks were recorded per line.`}
                            >
                              {name} <span className="opacity-75">&middot; {when}</span>
                            </span>
                          );
                        }

                        return (
                          <button
                            key={name}
                            type="button"
                            className={`btn btn-sm ${tone}`}
                            disabled={!canSubmit}
                            onClick={() => runCheck(row.key, b.lineTitle)}
                            title={detail}
                          >
                            {name} <span className="opacity-75">&middot; {when}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <strong>History</strong>
          <span className="badge bg-secondary">{entries.length}</span>
        </div>
        <div className="card-body">
          {entries.length === 0 ? (
            <div className="text-muted small">No PM checks submitted yet.</div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {entries.map((e) => (
                <div key={e.id} className="border rounded p-2">
                  <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                    <div>
                      <div className="fw-semibold d-flex align-items-center gap-2 flex-wrap">
                        {new Date(e.performedAt).toLocaleString([], {
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                        {/* Which interval this was. Entries filed before the
                            field existed are placed by the interval that was
                            typed in, and anything that matched nothing reads
                            "Unscheduled" rather than being filed under a guess. */}
                        <span className="badge bg-secondary">{labelOf(bucketOf(e))}</span>
                      </div>
                      <div className="small text-muted">
                        {e.lineTitle ? `${e.lineTitle} · ` : ''}
                        by {e.performedBy || 'Unknown'}{e.role === 'customer' ? ' (plant)' : ' (JTI)'}
                      </div>
                      <CrewLine entry={e} />
                      <EditedNote entry={e} />
                      {e.supervisorSignedBy ? (
                        <div className="small text-success-emphasis">
                          ✓ Signed off by {e.supervisorSignedBy}
                          {e.supervisorSignedAt
                            ? ` · ${new Date(e.supervisorSignedAt).toLocaleDateString()}`
                            : ''}
                        </div>
                      ) : needsSignOff(bucketOf(e)) ? (
                        /* Only the long-interval checks. A daily is confirmed
                           by the PIN of whoever ran it; making a supervisor
                           counter-sign every shift's walk-round is how a
                           signature stops meaning anything. */
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success mt-1"
                          onClick={() => setSigningEntry(e)}
                        >
                          Supervisor sign-off
                        </button>
                      ) : null}
                      {editing?.id !== e.id && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary mt-1 ms-1"
                          onClick={() => openEdit(e)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      {e.issueCount > 0 ? (
                        <span className="badge bg-danger">{e.issueCount} issue{e.issueCount === 1 ? '' : 's'}</span>
                      ) : (
                        <span className="badge bg-success">All OK</span>
                      )}
                      {canEditTemplate && (
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeEntry(e)} aria-label="Delete">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {editing?.id === e.id && (
                    <div className="border rounded p-2 mt-2">
                      <div className="small text-muted mb-2">
                        Correcting this check. Item wording is fixed — it is what
                        was signed off with — so only the answers change.
                      </div>
                      {editing.items.map((it, i) => (
                        <div key={i} className="mb-2">
                          <div className="small fw-semibold">{it.label}</div>
                          {it.type === 'value' ? (
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              value={it.value || ''}
                              onChange={(ev) => setEditing((d) => ({
                                ...d,
                                items: d.items.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)),
                              }))}
                            />
                          ) : (
                            <div className="btn-group btn-group-sm" role="group">
                              {['ok', 'issue', 'na'].map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  className={'btn btn-sm ' + (it.result === r
                                    ? (r === 'issue' ? 'btn-danger' : r === 'ok' ? 'btn-success' : 'btn-secondary')
                                    : 'btn-outline-secondary')}
                                  onClick={() => setEditing((d) => ({
                                    ...d,
                                    items: d.items.map((x, j) => (j === i ? { ...x, result: r } : x)),
                                  }))}
                                >
                                  {r === 'ok' ? 'OK' : r === 'issue' ? 'Issue' : 'N/A'}
                                </button>
                              ))}
                            </div>
                          )}
                          <input
                            type="text"
                            className="form-control form-control-sm mt-1"
                            placeholder="Note"
                            value={it.note || ''}
                            onChange={(ev) => setEditing((d) => ({
                              ...d,
                              items: d.items.map((x, j) => (j === i ? { ...x, note: ev.target.value } : x)),
                            }))}
                          />
                        </div>
                      ))}
                      <input
                        type="text"
                        className="form-control form-control-sm mb-2"
                        placeholder="Notes for the check"
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
                  <details className="mt-2">
                    <summary className="small text-muted" style={{ cursor: 'pointer' }}>
                      {(e.items || []).length} items
                    </summary>
                    <ul className="small mt-1 mb-0 ps-3">
                      {(e.items || []).map((it, i) => (
                        <li key={i} className={it.result === 'issue' ? 'text-danger' : ''}>
                          {it.label}: <strong>{it.value || it.result || '—'}</strong>
                          {it.note ? ` — ${it.note}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {signingEntry && (
        <PinPrompt
          customerId={customerId}
          people={crewPeople.filter((p) => (p.roles || []).includes('supervisor') || isSiteLead(p))}
          title="Supervisor sign-off"
          message="Signing confirms these checks were carried out. It is recorded against you and cannot be undone here."
          onVerified={(p) => {
            const entry = signingEntry;
            setSigningEntry(null);
            signOff(entry, p);
          }}
          onCancel={() => setSigningEntry(null)}
        />
      )}

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
