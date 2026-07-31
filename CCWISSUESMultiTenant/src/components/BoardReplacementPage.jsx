// src/components/BoardReplacementPage.jsx
//
// Circuit board replacement log — what was changed, on which head, when, and by
// whom. Customer-level like the span log, so the history survives across visits
// and the share-link viewer can show the customer what's been replaced.
//
// Boards are tracked by SERIAL, removed and installed. That's the field that
// makes the log worth keeping: it answers "has this board been swapped before",
// and catches a board that gets refitted somewhere else after being pulled.
//
// A replacement may be head-level (load cell amp, stepper driver) or
// machine-level (main control, power supply), so the head number is optional
// rather than assumed.
import { useEffect, useMemo, useState } from 'react';
import { Cpu, ChevronLeft, Trash2, Plus, Settings, X, Link2 } from 'lucide-react';
import {
  LOG_BOARD, subscribeLog, addLogEntry, deleteLogEntry, sinceLabel,
  subscribeBoardTypes, saveBoardTypes, subscribePartsBindings,
} from '../services/logs.js';
import { BOARD_TYPES } from '../config/constants';
import { useToast } from './Toast.jsx';
import CopyConfigFrom from './CopyConfigFrom.jsx';
import PartLookupField from './PartLookupField.jsx';
import PartsManualBinding from './PartsManualBinding.jsx';
import PartDiagramViewer from './PartDiagramViewer.jsx';
import CrewLine from './CrewLine.jsx';
import CrewChip from './CrewChip.jsx';
import PinPrompt from './PinPrompt.jsx';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import { subscribeCrew } from '../services/logs.js';
import { useLineCrew, crewStamp } from '../utils/useLineCrew.js';
import { useDialog } from './DialogSystem.jsx';

const BLANK = {
  lineTitle: '',
  headNumber: '',
  boardType: BOARD_TYPES[0],
  partNumber: '',
  reason: '',
  notes: '',
};

export default function BoardReplacementPage({
  customers = [],
  workspaceId,
  customerId,
  customerName,
  visits = [],
  performedByName,
  role = 'jti',
  canEditTypes = false,   // the original app sets the list; the customer app uses it
}) {
  const toast = useToast();
  const lineCrew = useLineCrew(workspaceId, customerId);
  // Crewing says who was ON the line; this says who actually filed the entry.
  // An entry logged at 2am otherwise inherits whoever was crewed at 6am.
  const { person: actor, remember: rememberActor } = useVerifiedPerson(customerId);
  const [crewPeople, setCrewPeople] = useState([]);
  const [pendingSave, setPendingSave] = useState(null);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeCrew(workspaceId, customerId, setCrewPeople);
  }, [workspaceId, customerId]);

  // A plant that has not set PINs keeps logging, unattributed. This records who
  // filed something; it must never become a lock on recording work at all.
  const withActor = (run) => {
    const anyPin = crewPeople.some((p) => p.pinHash);
    if (actor || !anyPin) return run(actor?.name || '');
    setPendingSave(() => run);
  };
  const dialog = useDialog();
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterLine, setFilterLine] = useState('');
  // null until the config doc resolves; then either the configured list or null
  // meaning "never set up", in which case we fall back to the built-in defaults.
  const [configuredTypes, setConfiguredTypes] = useState(null);
  const [editingTypes, setEditingTypes] = useState(false);
  const [draftTypes, setDraftTypes] = useState([]);
  const [savingTypes, setSavingTypes] = useState(false);
  // Which machine's manual each line's parts come from, keyed by line title.
  const [bindings, setBindings] = useState({});
  const [editingBindings, setEditingBindings] = useState(false);
  // The manual entry confirmed for the part currently typed, if any.
  const [pickedPart, setPickedPart] = useState(null);
  // Further parts on the same replacement — a board plus its gasket and screws.
  const [extraParts, setExtraParts] = useState([]);
  // A past entry whose drawing is being viewed.
  const [diagramEntry, setDiagramEntry] = useState(null);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLog(workspaceId, customerId, LOG_BOARD, setEntries);
  }, [workspaceId, customerId]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribePartsBindings(workspaceId, customerId, setBindings);
  }, [workspaceId, customerId]);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeBoardTypes(workspaceId, customerId, setConfiguredTypes);
  }, [workspaceId, customerId]);

  // Configured list wins; BOARD_TYPES is the starting point for a customer
  // nobody has set up yet.
  const boardTypes = (configuredTypes && configuredTypes.length) ? configuredTypes : BOARD_TYPES;

  // Lines come from the customer's visits — the only place a line is defined.
  const lines = useMemo(() => {
    const seen = new Map();
    [...visits]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .forEach((v) => (v.lines || []).forEach((l) => {
        // Model and serial ride along for the parts-manual screen: they are
        // shown so whoever links a line can see WHICH machine they are binding.
        // They are not the matching key — the catalog stores neither.
        if (l?.title && !seen.has(l.title)) {
          seen.set(l.title, {
            heads: (l.heads || []).length,
            model: l.model || '',
            serialNumber: l.serialNumber || '',
          });
        }
      }));
    return [...seen.entries()].map(([title, meta]) => ({ title, ...meta }));
  }, [visits]);

  const headCount = lines.find((l) => l.title === form.lineTitle)?.heads || 0;

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  // Keep the selected board type valid if the list changes underneath.
  useEffect(() => {
    if (boardTypes.length && !boardTypes.includes(form.boardType)) {
      setForm((f) => ({ ...f, boardType: boardTypes[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardTypes.join('|')]);


  // Start a new entry from the last replacement. Board swaps repeat: same line,
  // same head, same board type, often the same part. Serials never carry over —
  // they identify the individual board and are the one thing that MUST be read
  // off the hardware each time.
  const openAdd = () => {
    const last = entries[0];
    setForm(last
      ? {
          ...BLANK,
          lineTitle: last.lineTitle || '',
          headNumber: last.headNumber || '',
          boardType: last.boardType || BLANK.boardType,
          partNumber: last.partNumber || '',
        }
      : BLANK);
    setPickedPart(null);
    setExtraParts([]);
    setAdding(true);
  };

  const openTypeEditor = () => {
    setDraftTypes([...boardTypes]);
    setEditingTypes(true);
  };

  const commitTypes = async () => {
    const cleaned = draftTypes.map((t) => t.trim()).filter(Boolean);
    if (cleaned.length === 0) return toast.error('Keep at least one board type');
    setSavingTypes(true);
    try {
      await saveBoardTypes(workspaceId, customerId, cleaned);
      setEditingTypes(false);
      toast.success('Board types saved — the customer app will use these');
    } catch (err) {
      toast.error('Could not save board types: ' + (err?.message || 'unknown error'));
    } finally {
      setSavingTypes(false);
    }
  };

  const save = () => withActor(async (filedBy) => {
    if (!form.lineTitle) return toast.error('Pick a line');
    if (!form.boardType) return toast.error('Pick a board type');
    setSaving(true);
    try {
      await addLogEntry(workspaceId, customerId, LOG_BOARD, {
        lineTitle: form.lineTitle,
        // Empty means a machine-level board rather than head 0.
        headNumber: form.headNumber === '' ? null : Number(form.headNumber),
        boardType: form.boardType,
        partNumber: form.partNumber.trim(),
        // Provenance, not decoration: the log has to distinguish a number
        // checked against the machine's manual from one someone typed.
        partName: pickedPart?.partName || '',
        partItemNo: pickedPart?.itemNo || '',
        partDiagramId: pickedPart?.diagramId || '',
        partDiagramName: pickedPart?.diagramName || '',
        partVerified: !!pickedPart,
        // Everything replaced in this one job. The single fields above stay the
        // primary part so existing screens and exports keep working unchanged.
        parts: [pickedPart, ...extraParts].filter(Boolean).map((p) => ({
          partNumber: p.partCode || String(p.itemNo || ''),
          partName: p.partName || '',
          itemNo: p.itemNo || '',
          diagramId: p.diagramId || '',
          diagramName: p.diagramName || '',
        })),
        reason: form.reason.trim(),
        notes: form.notes.trim(),
        performedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        role,
        ...crewStamp(lineCrew.forLine(form.lineTitle), lineCrew.shiftId),
        // Who filed it, proven — distinct from the crew, which is context.
        actionBy: filedBy,
        actionByVerified: !!filedBy,
      });
      setForm({ ...BLANK, lineTitle: form.lineTitle });   // keep the line for the next one
      setPickedPart(null);
      setExtraParts([]);
      setAdding(false);
      toast.success('Board replacement logged');
    } catch (err) {
      console.error('Board log save failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  });

  const remove = async (entry) => {
    const ok = await dialog.confirm(
      `Delete the ${entry.boardType || 'board'} replacement logged ${new Date(entry.performedAt).toLocaleDateString()}?`,
      { title: 'Delete log entry', confirmText: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    try {
      await deleteLogEntry(workspaceId, customerId, LOG_BOARD, entry.id);
      toast.success('Entry deleted');
    } catch (err) {
      toast.error('Could not delete: ' + (err?.message || 'unknown error'));
    }
  };

  if (!customerId) {
    return <div className="text-muted p-3">Select a customer to record board replacements.</div>;
  }

  const shown = filterLine ? entries.filter((e) => e.lineTitle === filterLine) : entries;

  // Serials are no longer collected. Entries logged before that still carry
  // them and are still displayed, so the repeat-serial badge stays useful for
  // history rather than being dropped along with the fields.
  const serialCounts = entries.reduce((acc, e) => {
    const s = (e.serialInstalled || '').trim().toLowerCase();
    if (s) acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <h5 className="d-flex align-items-center gap-2 mb-0">
          <Cpu size={18} /> Parts / Board Replacements{customerName ? ` — ${customerName}` : ''}
        </h5>
        <div className="d-flex align-items-center gap-2">
          {canEditTypes && !editingTypes && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setEditingBindings(true)}
            >
              <Link2 size={14} /> Parts manuals
            </button>
          )}
          {canEditTypes && !editingTypes && (
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={openTypeEditor}>
              <Settings size={16} /> Board types
            </button>
          )}
          {!adding && (
            <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
              <Plus size={16} /> Log a replacement
            </button>
          )}
        </div>
      </div>

      {diagramEntry && (
        <PartDiagramViewer
          diagramId={diagramEntry.partDiagramId}
          partItemNo={diagramEntry.partItemNo}
          // A past entry can hold several parts; ring the ones on this drawing.
          partItemNos={(diagramEntry.parts || [])
            .filter((p) => p.diagramId === diagramEntry.partDiagramId)
            .map((p) => p.itemNo)}
          partLabel={
            (diagramEntry.parts || []).length > 1
              ? `${diagramEntry.partNumber} + ${diagramEntry.parts.length - 1} more`
              : diagramEntry.partNumber
          }
          onClose={() => setDiagramEntry(null)}
        />
      )}

      {editingBindings && (
        <PartsManualBinding
          workspaceId={workspaceId}
          customerId={customerId}
          lines={lines}
          bindings={bindings}
          onClose={() => setEditingBindings(false)}
        />
      )}

      {editingTypes && (
        <div className="card mb-3">
          <div className="card-header d-flex justify-content-between align-items-center">
            <strong>Board types for {customerName || 'this customer'}</strong>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditingTypes(false)}>
              Cancel
            </button>
          </div>
          <div className="card-body pb-0">
            <CopyConfigFrom
              workspaceId={workspaceId}
              customers={customers}
              currentCustomerId={customerId}
              configKey="boardTypes"
              label="board types"
              describe={(d) => {
                const t = (d?.types || []).filter(Boolean);
                return t.length ? `${t.length} board type${t.length === 1 ? '' : 's'}` : null;
              }}
              onCopy={(d) => setDraftTypes([...(d?.types || [])])}
            />
          </div>
          <div className="card-body d-flex flex-column gap-2">
            <small className="text-muted">
              These are the options the customer app offers when logging a board.
              Renaming or removing one never changes entries already logged — they
              keep the name they were recorded with.
            </small>
            {draftTypes.map((t, i) => (
              <div key={i} className="input-group">
                <input
                  type="text"
                  className="form-control"
                  value={t}
                  onChange={(e) => setDraftTypes((d) => d.map((v, j) => (j === i ? e.target.value : v)))}
                  placeholder="Board type"
                />
                <button
                  type="button"
                  className="btn btn-outline-danger"
                  onClick={() => setDraftTypes((d) => d.filter((_, j) => j !== i))}
                  aria-label={`Remove ${t}`}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary align-self-start"
              onClick={() => setDraftTypes((d) => [...d, ''])}
            >
              <Plus size={16} /> Add type
            </button>
            <button type="button" className="btn btn-primary" onClick={commitTypes} disabled={savingTypes}>
              {savingTypes ? 'Saving…' : 'Save board types'}
            </button>
          </div>
        </div>
      )}

      {adding && (
        <div className="card mb-3">
          <div className="card-header d-flex justify-content-between align-items-center">
            <strong>New board replacement</strong>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAdding(false)}>
              <ChevronLeft size={16} /> Cancel
            </button>
          </div>
          <div className="card-body d-flex flex-column gap-2">
            <div>
              <label className="form-label" htmlFor="board-line">Line</label>
              <select
                id="board-line"
                className="form-select"
                value={form.lineTitle}
                onChange={(e) => set('lineTitle', e.target.value)}
              >
                <option value="">-- Select line --</option>
                {lines.map((l) => <option key={l.title} value={l.title}>{l.title}</option>)}
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="board-head">Head</label>
              <select
                id="board-head"
                className="form-select"
                value={form.headNumber}
                onChange={(e) => set('headNumber', e.target.value)}
              >
                <option value="">Not head-specific (machine board)</option>
                {Array.from({ length: headCount }, (_, i) => (
                  <option key={i + 1} value={i + 1}>Head {i + 1}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="board-type">Board type</label>
              <select
                id="board-type"
                className="form-select"
                value={form.boardType}
                onChange={(e) => set('boardType', e.target.value)}
              >
                {boardTypes.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="board-part">Part number</label>
              <PartLookupField
                binding={bindings[form.lineTitle] || null}
                value={form.partNumber}
                onChange={(v) => set('partNumber', v)}
                onPick={setPickedPart}
                picked={pickedPart}
                extras={extraParts}
                onExtras={setExtraParts}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="board-reason">Reason</label>
              <input
                id="board-reason"
                type="text"
                className="form-control"
                value={form.reason}
                onChange={(e) => set('reason', e.target.value)}
                placeholder="e.g. intermittent load cell reading"
              />
            </div>

            <div>
              <label className="form-label" htmlFor="board-notes">Notes</label>
              <input
                id="board-notes"
                type="text"
                className="form-control"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="optional"
              />
            </div>

            <CrewChip lineCrew={lineCrew} lineTitle={form.lineTitle} />
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Log board replacement'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <strong>History</strong>
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-secondary">{shown.length}</span>
            <select
              className="form-select form-select-sm"
              style={{ width: 'auto' }}
              value={filterLine}
              onChange={(e) => setFilterLine(e.target.value)}
              aria-label="Filter by line"
            >
              <option value="">All lines</option>
              {lines.map((l) => <option key={l.title} value={l.title}>{l.title}</option>)}
            </select>
          </div>
        </div>
        <div className="card-body">
          {shown.length === 0 ? (
            <div className="text-muted small">
              {entries.length === 0 ? 'No board replacements logged yet.' : 'None for this line.'}
            </div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {shown.map((e) => {
                const sn = (e.serialInstalled || '').trim().toLowerCase();
                const repeat = sn && serialCounts[sn] > 1;
                return (
                  <div key={e.id} className="border rounded p-2">
                    <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                      <div>
                        <div className="fw-semibold">
                          {e.boardType || 'Board'}
                          {e.headNumber != null ? ` · Head ${e.headNumber}` : ' · machine board'}
                        </div>
                        <div className="small text-muted">
                          {e.lineTitle} · {new Date(e.performedAt).toLocaleDateString()} ({sinceLabel(e.performedAt)})
                          {' · '}by {e.performedBy || 'Unknown'}{e.role === 'customer' ? ' (plant)' : ' (JTI)'}
                        </div>
                        <CrewLine entry={e} />
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => remove(e)}
                        aria-label="Delete entry"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="small mt-1">
                      {e.partNumber && (
                        <>
                          Part <strong>{e.partNumber}</strong>
                          {/* The number identifies it; the name is what anyone
                              reading the log a month later actually recognises. */}
                          {e.partName && <> — {e.partName}</>}
                          {Array.isArray(e.parts) && e.parts.length > 1 && (
                            <> + {e.parts.length - 1} more</>
                          )}
                          {e.partVerified
                            ? <span className="badge bg-success ms-1" title={e.partName || 'Confirmed against the parts manual'}>✓ manual</span>
                            : <span className="badge bg-secondary ms-1" title="Typed in, not checked against a parts manual">unverified</span>}
                          {e.partDiagramId && (
                            <button
                              type="button"
                              className="btn btn-link btn-sm p-0 ms-1 align-baseline"
                              onClick={() => setDiagramEntry(e)}
                            >
                              drawing
                            </button>
                          )}
                          {' '}
                        </>
                      )}
                      {e.serialRemoved && <>· out <code>{e.serialRemoved}</code>{' '}</>}
                      {e.serialInstalled && (
                        <>
                          · in <code>{e.serialInstalled}</code>
                          {repeat && (
                            <span className="badge bg-warning text-dark ms-1" title="This serial appears more than once in the log">
                              seen {serialCounts[sn]}×
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {e.reason && <div className="small mt-1"><em>{e.reason}</em></div>}
                    {e.notes && <div className="small text-muted mt-1">{e.notes}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
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

    </div>
  );
}
