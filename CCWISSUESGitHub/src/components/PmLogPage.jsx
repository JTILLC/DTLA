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
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Settings, Plus, X, Trash2, ChevronLeft } from 'lucide-react';
import {
  LOG_PM, subscribeLog, addLogEntry, deleteLogEntry,
  subscribePmTemplate, savePmTemplate, DEFAULT_PM_SECTIONS,
  sinceLabel, dueStatus, addDays,
} from '../services/logs.js';
import ReferenceImage from './ReferenceImage.jsx';
import { useToast } from './Toast.jsx';
import CopyConfigFrom from './CopyConfigFrom.jsx';
import CrewBar from './CrewBar.jsx';
import CrewLine from './CrewLine.jsx';
import { useShiftCrew, crewStamp } from '../utils/useShiftCrew.js';
import { useDialog } from './DialogSystem.jsx';

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
// Reference images are dropped: they live at pm-images/{ws}/{sourceCustomer}/
// and both storage.rules and the media broker authorise per customer, so a
// copied path would simply 403 for the new customer's operators. Better an
// obviously missing photo than a broken one.
const copiedSections = (sections) =>
  (sections || []).map((sec, si) => ({
    id: `sec_${Date.now()}_${si}`,
    title: sec.title || '',
    items: (sec.items || []).map((it, ii) => ({
      id: `item_${Date.now()}_${si}_${ii}`,
      label: it.label || '',
      type: it.type || 'check',
    })),
  }));

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
  const { crew } = useShiftCrew(customerId);
  const dialog = useDialog();
  const [entries, setEntries] = useState([]);
  const [template, setTemplate] = useState(null);
  const [mode, setMode] = useState('home');       // home | fill | template
  const [answers, setAnswers] = useState({});     // itemId -> { result, value, note }
  const [lineTitle, setLineTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [intervalDays, setIntervalDays] = useState('30');
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

  const last = entries[0] || null;
  const due = dueStatus(last?.nextDueAt);

  const setAnswer = (itemId, patch) =>
    setAnswers((a) => ({ ...a, [itemId]: { ...(a[itemId] || {}), ...patch } }));

  // ---- Submit -------------------------------------------------------------
  const submit = async () => {
    const items = [];
    sections.forEach((sec) =>
      (sec.items || []).forEach((it) => {
        const a = answers[it.id] || {};
        items.push({
          section: sec.title,
          label: it.label,          // copied, not referenced — see header note
          type: it.type || 'check',
          result: it.type === 'value' ? '' : (a.result || ''),
          value: it.type === 'value' ? (a.value || '') : '',
          note: a.note || '',
        });
      })
    );

    const answered = items.filter((i) => i.result || i.value);
    if (answered.length === 0) {
      return toast.error('Fill in at least one item before submitting');
    }

    setSaving(true);
    try {
      await addLogEntry(workspaceId, customerId, LOG_PM, {
        lineTitle: lineTitle || null,
        performedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        ...crewStamp(crew),
        role,
        notes: notes.trim(),
        items,
        issueCount: items.filter((i) => i.result === 'issue').length,
        okCount: items.filter((i) => i.result === 'ok').length,
        intervalDays: intervalDays === '' ? null : Number(intervalDays),
        nextDueAt: intervalDays === '' ? null : addDays(null, Number(intervalDays)),
      });
      setAnswers({});
      setNotes('');
      setMode('home');
      toast.success('PM check submitted');
    } catch (err) {
      console.error('PM submit failed:', err);
      toast.error('Could not submit: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
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

        <CopyConfigFrom
          workspaceId={workspaceId}
          customers={customers}
          currentCustomerId={customerId}
          configKey="pmTemplate"
          label="checklist"
          describe={(d) => {
            const secs = d?.sections || [];
            const items = secs.reduce((n, s) => n + (s.items || []).length, 0);
            if (!secs.length || !items) return null;
            return `${secs.length} section${secs.length === 1 ? '' : 's'} and ${items} item${items === 1 ? '' : 's'}`;
          }}
          onCopy={(d) => setDraft(copiedSections(d?.sections))}
        />

        {draft.map((sec, si) => (
          <div className="card mb-3" key={sec.id || si}>
            <div className="card-header d-flex gap-2 align-items-center">
              <input
                type="text"
                className="form-control form-control-sm"
                value={sec.title}
                placeholder="Section title"
                onChange={(e) => setDraft((d) => d.map((s, i) => (i === si ? { ...s, title: e.target.value } : s)))}
              />
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => setDraft((d) => d.filter((_, i) => i !== si))}
                aria-label="Remove section"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="card-body d-flex flex-column gap-2">
              {(sec.items || []).map((it, ii) => (
                <div className="input-group" key={it.id || ii}>
                  <input
                    type="text"
                    className="form-control"
                    value={it.label}
                    placeholder="Item to check"
                    onChange={(e) => setDraft((d) => d.map((s, i) => i !== si ? s : {
                      ...s, items: s.items.map((x, j) => (j === ii ? { ...x, label: e.target.value } : x)),
                    }))}
                  />
                  <select
                    className="form-select"
                    style={{ maxWidth: '130px' }}
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
                  <span className="input-group-text p-1">
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
            onClick={() => setDraft((d) => [...d, { id: newId(), title: '', items: [{ id: newId(), label: '', type: 'check' }] }])}
          >
            <Plus size={16} /> Add section
          </button>
          <button type="button" className="btn btn-primary" onClick={commitTemplate} disabled={savingTemplate}>
            {savingTemplate ? 'Saving…' : 'Save checklist'}
          </button>
        </div>
      </div>
    );
  }

  // ---- Fill in a check ----------------------------------------------------
  if (mode === 'fill') {
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h5 className="mb-0">PM check</h5>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode('home')}>
            <ChevronLeft size={16} /> Back
          </button>
        </div>

        {lines.length > 0 && (
          <div className="mb-3">
            <label className="form-label" htmlFor="pm-line">Line (optional)</label>
            <select id="pm-line" className="form-select" value={lineTitle} onChange={(e) => setLineTitle(e.target.value)}>
              <option value="">Whole plant / not line-specific</option>
              {lines.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}

        {sections.map((sec) => (
          <div className="card mb-3" key={sec.id || sec.title}>
            <div className="card-header"><strong>{sec.title}</strong></div>
            <div className="card-body d-flex flex-column gap-3">
              {(sec.items || []).map((it) => {
                const a = answers[it.id] || {};
                return (
                  <div key={it.id}>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <div className="fw-semibold flex-grow-1">{it.label}</div>
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
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <label className="small text-muted mb-0" htmlFor="pm-interval">Next PM due in</label>
              <div className="input-group input-group-sm" style={{ width: 'auto' }}>
                <input
                  id="pm-interval"
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
            </div>
            <button type="button" className="btn btn-primary btn-lg" onClick={submit} disabled={saving}>
              {saving ? 'Submitting…' : 'Submit PM check'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Home: status + history --------------------------------------------
  return (
    <div>
      <CrewBar workspaceId={workspaceId} customerId={customerId} canEditRoster={canEditTemplate} />

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
          {canSubmit && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setMode('fill')}>
              <Plus size={16} /> New PM check
            </button>
          )}
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <div className="small text-muted">Last check</div>
            <div className="fw-semibold">
              {last ? `${sinceLabel(last.performedAt)} — ${last.performedBy || 'Unknown'}` : 'Never'}
            </div>
          </div>
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
                      <div className="fw-semibold">
                        {new Date(e.performedAt).toLocaleString([], {
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                      <div className="small text-muted">
                        {e.lineTitle ? `${e.lineTitle} · ` : ''}
                        by {e.performedBy || 'Unknown'}{e.role === 'customer' ? ' (plant)' : ' (JTI)'}
                      </div>
                      <CrewLine entry={e} />
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
    </div>
  );
}
