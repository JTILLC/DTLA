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
  subscribeBoardTypes, saveBoardTypes, subscribePartsBindings, subscribeBoardParts, updateLogEntry,
} from '../services/logs.js';
import { BOARD_TYPES } from '@app/config/constants';
import { useToast } from './Toast.jsx';
import CopyConfigFrom from './CopyConfigFrom.jsx';
import PartLookupField from './parts/PartLookupField.jsx';
import { toStored, fromStored, partLines, qtyLabel } from '../utils/partLines.js';
import PartsManualBinding from './PartsManualBinding.jsx';
import PartDiagramViewer from './parts/PartDiagramViewer.jsx';
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
import ActingAs from './ActingAs.jsx';
import TemplateBar from './TemplateBar.jsx';
import { normalizeTypes } from '../utils/boardTypes.js';
import { sameDayItemsOnDiagram, diagramLabel } from '../utils/dayDiagramItems.js';
import { resolveBoardPart } from '../utils/boardParts.js';

// Shared by the copy-from picker, the template bar and the push dialog, so all
// three describe a list the same way.
const describeTypes = (d) => {
  const n = normalizeTypes(d?.types).length;
  if (!n) return null;
  const mapped = normalizeTypes(d?.types).filter((t) => t.partNumber).length;
  return `${n} board type${n === 1 ? '' : 's'}${mapped ? `, ${mapped} with part numbers` : ''}`;
};

// Not everything replaced is a board.
//
// Springs, gaskets, hangers, cam rollers — most of what comes off a machine has
// no board type, and making somebody name one to record a gasket means they
// pick the nearest wrong answer and the log carries it forever. Stored as a
// real value rather than blank so the entry says plainly that no board was
// involved, and so it can never be confused with "not filled in yet".
export const NOT_A_BOARD = 'Part (not a board)';

// Common reasons, offered as suggestions rather than as a fixed list: the box
// stays free text, so anything not here can still be typed. A dropdown of only
// these would force somebody to pick the nearest wrong one.
export const REPLACEMENT_REASONS = [
  'Failed',
  'Intermittent fault',
  'Water ingress',
  'Corrosion',
  'Physical damage',
  'Weight drift / zero error',
  'No communication',
  'Preventive replacement',
  'Upgrade',
];

const BLANK = {
  lineTitle: '',
  headNumber: '',
  // Deliberately EMPTY, not the first board type.
  //
  // It used to default to whatever headed the list — Load Cell Amplifier — and
  // the entry's headline is the board type, so every replacement logged without
  // touching the dropdown claimed a load cell amp had been changed. A default
  // that is wrong more often than right is not a convenience, it is a log
  // filing the wrong part.
  boardType: '',
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
  // Board type -> part number, per machine. Overrides the board type's general
  // number for boards that differ between machines.
  const [boardParts, setBoardParts] = useState({ byMachine: {} });
  const [editingBindings, setEditingBindings] = useState(false);
  // The manual entry confirmed for the part currently typed, if any.
  const [pickedPart, setPickedPart] = useState(null);
  // Further parts on the same replacement — a board plus its gasket and screws.
  const [extraParts, setExtraParts] = useState([]);
  // Count for a part typed rather than picked from the manual.
  const [typedQty, setTypedQty] = useState(1);
  // The entry being edited, or null when logging a new one. The form is the
  // same either way — an edit that used a different screen would drift from the
  // one people actually know.
  const [editing, setEditing] = useState(null);
  // A past entry whose drawing is being viewed.
  const [diagramEntry, setDiagramEntry] = useState(null);
  // Every balloon to ring when a drawing is opened from the log: the clicked
  // part first, then anything else replaced on that drawing, on that line, that
  // day.
  const dayItems = useMemo(
    () => sameDayItemsOnDiagram(entries, diagramEntry),
    [entries, diagramEntry],
  );

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

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeBoardParts(workspaceId, customerId, setBoardParts);
  }, [workspaceId, customerId]);

  // Configured list wins; BOARD_TYPES is the starting point for a customer
  // nobody has set up yet. Normalised so the rest of this file sees objects
  // whether the stored list is the old bare strings or the current shape that
  // carries a part number.
  const boardTypeList = useMemo(
    () => normalizeTypes((configuredTypes && configuredTypes.length) ? configuredTypes : BOARD_TYPES),
    [configuredTypes],
  );
  const boardTypes = useMemo(() => boardTypeList.map((t) => t.name), [boardTypeList]);

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

  // The part for the chosen board type — this machine's, if one is set for it,
  // otherwise the board type's general number. See shared/utils/boardParts.js.
  const resolveFor = (lineTitle, boardType) => resolveBoardPart({
    boardParts,
    binding: bindings[lineTitle] || null,
    boardTypes: boardTypeList,
    boardType,
  });
  const mappedPart = useMemo(
    () => resolveFor(form.lineTitle, form.boardType),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardParts, bindings, boardTypeList, form.lineTitle, form.boardType],
  );

  // Choosing a board type fills its part in — but only into an empty picker.
  // Overwriting a part someone already chose would silently change what the log
  // says was fitted, and a mapping is guidance, not a better source than the
  // person standing at the machine.
  const chooseBoardType = (name) => {
    set('boardType', name);
    // Nothing to look up for a non-board part: the board-to-part mapping is
    // per board type, and there is no board.
    if (name === NOT_A_BOARD) return;
    if (pickedPart || extraParts.length || form.partNumber.trim()) return;
    const r = resolveFor(form.lineTitle, name);
    if (r) setPickedPart(r.part);
  };

  // Everything replaced in this one job, in the shape the log stores.
  // A part typed rather than picked is still a part: it is recorded with its
  // count so an off-manual replacement isn't silently logged as one.
  const partsForSave = () => {
    const chosen = [pickedPart, ...extraParts].filter(Boolean).map(toStored);
    const typed = form.partNumber.trim();
    // A number still in the box when Save is pressed counts. It used to be
    // ignored the moment anything else was on the list, so typing a second
    // part and pressing Save silently dropped it — and typing invalidates any
    // pick (see PartLookupField), so an untouched pick cannot be duplicated
    // here.
    if (typed && !pickedPart) chosen.push(toStored({ partCode: typed, qty: typedQty }));
    return chosen;
  };

  // Keep the selected board type valid if the list changes underneath.
  useEffect(() => {
    // Only a type that no longer EXISTS gets replaced. An empty box is a
    // deliberate "not chosen yet" and must stay that way, or the default this
    // page just removed comes back through the side door.
    if (form.boardType && boardTypes.length && !boardTypes.includes(form.boardType)) {
      setForm((f) => ({ ...f, boardType: boardTypes[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardTypes.join('|')]);


  // Start a new entry from the last replacement. Board swaps repeat: same line,
  // same head, same board type, often the same part. Serials never carry over —
  // they identify the individual board and are the one thing that MUST be read
  // off the hardware each time.
  // How many replacements have been logged without closing the form.
  //
  // A shift is not one replacement. Four heads get new gaskets, one gets a
  // spring, the amp on head 12 goes — and each is its own entry because each
  // has its own head and its own part. The form used to close on every save, so
  // recording a shift meant reopening it once per part and re-picking the line
  // each time. It now stays open and counts.
  const [loggedThisSession, setLoggedThisSession] = useState(0);

  const openAdd = () => {
    setLoggedThisSession(0);
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
    setTypedQty(1);
    setAdding(true);
  };

  const openTypeEditor = () => {
    setDraftTypes(boardTypeList.map((t) => ({ ...t })));
    setEditingTypes(true);
  };

  const commitTypes = async () => {
    const cleaned = normalizeTypes(draftTypes);
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

  // Reopen a saved entry. The parts list is rebuilt into the same shape the
  // picker produces, so adding and removing parts works exactly as it does on a
  // new entry rather than being a second, weaker editor.
  const openEdit = (entry) => {
    const list = Array.isArray(entry.parts) && entry.parts.length
      ? entry.parts
      : (entry.partNumber ? [{
          partNumber: entry.partNumber, partName: entry.partName,
          itemNo: entry.partItemNo, diagramId: entry.partDiagramId,
          diagramName: entry.partDiagramName,
        }] : []);
    setForm({
      lineTitle: entry.lineTitle || '',
      headNumber: entry.headNumber == null ? '' : String(entry.headNumber),
      boardType: entry.boardType || '',
      partNumber: entry.partNumber || '',
      reason: entry.reason || '',
      notes: entry.notes || '',
    });
    setPickedPart(list.length && entry.partVerified ? fromStored(list[0]) : null);
    setExtraParts(list.slice(1).map(fromStored));
    // An unverified entry's count lives on its single typed part.
    setTypedQty(!entry.partVerified && list.length ? fromStored(list[0]).qty : 1);
    setEditing(entry);
    setAdding(true);
  };

  const cancelEdit = () => {
    setEditing(null);
    setAdding(false);
    setPickedPart(null);
    setExtraParts([]);
    setTypedQty(1);
  };

  const saveEdit = () => withFreshActor((filedBy) => lineGuard.check(editing?.lineTitle, async (override) => {
    if (!editing) return;
    setSaving(true);
    try {
      const parts = partsForSave();
      await updateLogEntry(workspaceId, customerId, LOG_BOARD, editing.id, withEditStamp({
        lineTitle: form.lineTitle,
        headNumber: form.headNumber === '' ? null : Number(form.headNumber),
        boardType: form.boardType,
        partNumber: form.partNumber.trim(),
        partName: pickedPart?.partName || '',
        partItemNo: pickedPart?.itemNo || '',
        partDiagramId: pickedPart?.diagramId || '',
        partDiagramName: pickedPart?.diagramName || '',
        partVerified: !!pickedPart,
        parts,
        reason: form.reason.trim(),
        notes: form.notes.trim(),
      }, editing, filedBy));
      toast.success('Entry updated');
      cancelEdit();
    } catch (err) {
      console.error('Board log edit failed:', err);
      toast.error('Could not update: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }));

  const save = () => withActor((filedBy) => lineGuard.check(form.lineTitle, async (override) => {
    if (!form.lineTitle) return toast.error('Pick a line');
    if (!form.boardType) return toast.error('Choose what was replaced');

    // Read back the parts and the counts before anything is written.
    //
    // The quantities are the part of this form most easily got wrong — a
    // stepper left at 1 when four went on, a part still sitting in the box
    // unadded — and the log is what a customer is later billed and advised
    // from. Cheaper to read one line now than to correct a record later.
    const about = partsForSave();
    const summary = about.length
      // The raw count, not qtyLabel: that prints nothing for a single item —
      // right in a list, wrong in a confirmation, where "1 ×" is the fact being
      // confirmed.
      ? about.map((p) => `  • ${p.qty || 1} × ${p.partNumber}${p.partName ? ` (${p.partName})` : ''}`).join('\n')
      : '  • no part number recorded';
    const where = form.headNumber === '' ? form.lineTitle : `${form.lineTitle} · Head ${form.headNumber}`;
    const ok = await dialog.confirm(
      `Log this replacement on ${where}?\n\n${form.boardType}\n${summary}`,
      { title: 'Confirm what was replaced', confirmText: 'Log it' },
    );
    if (!ok) return;

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
        parts: partsForSave(),
        reason: form.reason.trim(),
        notes: form.notes.trim(),
        performedBy: performedByName || (role === 'customer' ? 'Plant staff' : 'JTI'),
        role,
        ...crewStamp(lineCrew.forLine(form.lineTitle), lineCrew.shiftId),
        // Filed against a line this person is not assigned to, with a
        // supervisor's authorisation. Absent on an ordinary entry.
        ...overrideStamp(override, form.lineTitle),
        // Who filed it, proven — distinct from the crew, which is context.
        actionBy: filedBy,
        actionByVerified: !!filedBy,
      });
      // Carry what repeats across a shift, clear what does not.
      //
      // The line and the board type are the same for four gaskets in a row; the
      // HEAD and the PARTS are the whole point of the next entry and must never
      // carry, or the second one silently repeats the first. The reason usually
      // holds too — a water-damaged machine gives the same answer all morning.
      setForm({
        ...BLANK,
        lineTitle: form.lineTitle,
        boardType: form.boardType,
        reason: form.reason,
      });
      setPickedPart(null);
      setExtraParts([]);
      setTypedQty(1);
      setLoggedThisSession((n) => n + 1);
      // Deliberately NOT closing the form: the next replacement is nearly
      // always seconds away. "Done" below closes it.
      toast.success('Logged — add the next one');
    } catch (err) {
      console.error('Board log save failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }));

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
    return <div className="text-muted p-3">Select a customer to record replacements.</div>;
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
          // The whole day's work on this drawing, not just this one entry.
          //
          // A shift is logged as an entry per head, so the drawing opened from
          // any one of them used to ring a single balloon while four other
          // parts of the same assembly had been changed that morning. Scoped to
          // the same line as well as the same day — see dayDiagramItems.js for
          // why the line matters.
          partItemNos={dayItems.map((p) => p.itemNo)}
          partLabel={diagramLabel(dayItems, diagramEntry.partNumber)}
          onClose={() => setDiagramEntry(null)}
        />
      )}

      {editingBindings && (
        <PartsManualBinding
          workspaceId={workspaceId}
          customerId={customerId}
          lines={lines}
          bindings={bindings}
          boardTypes={boardTypes}
          boardParts={boardParts}
          confirm={(message) => dialog.confirm(message, {
            title: 'Remove part', confirmText: 'Remove', variant: 'danger',
          })}
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
              describe={describeTypes}
              onCopy={(d) => setDraftTypes(normalizeTypes(d?.types))}
            />
            <TemplateBar
              workspaceId={workspaceId}
              customers={customers}
              currentCustomerId={customerId}
              configKey="boardTypes"
              label="board types"
              draft={() => ({ types: normalizeTypes(draftTypes) })}
              describe={describeTypes}
              onLoad={(d) => setDraftTypes(normalizeTypes(d?.types))}
              updatedBy={performedByName}
            />
          </div>
          <div className="card-body d-flex flex-column gap-2">
            <small className="text-muted">
              These are the options the customer app offers when logging a board.
              Renaming or removing one never changes entries already logged — they
              keep the name they were recorded with.
            </small>
            <small className="text-muted">
              Give a board its part number and whoever logs a replacement gets the
              part filled in for them — they can still change it. Leave it blank for
              boards that vary by machine.
            </small>
            {draftTypes.map((t, i) => {
              const upd = (patch) => setDraftTypes((d) => d.map((v, j) => (j === i ? { ...v, ...patch } : v)));
              return (
                <div key={i} className="d-flex gap-2 align-items-start">
                  <div className="flex-grow-1 d-flex flex-column gap-1">
                    <input
                      type="text"
                      className="form-control"
                      value={t.name || ''}
                      onChange={(e) => upd({ name: e.target.value })}
                      placeholder="Board type"
                      aria-label="Board type name"
                    />
                    <div className="d-flex gap-1 flex-wrap">
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        style={{ maxWidth: '11rem' }}
                        value={t.partNumber || ''}
                        onChange={(e) => upd({ partNumber: e.target.value })}
                        placeholder="Part number (optional)"
                        aria-label={`Part number for ${t.name || 'this board'}`}
                      />
                      <input
                        type="text"
                        className="form-control form-control-sm flex-grow-1"
                        value={t.partName || ''}
                        onChange={(e) => upd({ partName: e.target.value })}
                        placeholder="Part description (optional)"
                        aria-label={`Part description for ${t.name || 'this board'}`}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    onClick={() => setDraftTypes((d) => d.filter((_, j) => j !== i))}
                    aria-label={`Remove ${t.name || 'board type'}`}
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary align-self-start"
              onClick={() => setDraftTypes((d) => [...d, { name: '' }])}
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
            <strong>New replacement</strong>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={cancelEdit}>
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
                onChange={(e) => chooseBoardType(e.target.value)}
              >
                <option value="">Choose what was replaced…</option>
                <option value={NOT_A_BOARD}>{NOT_A_BOARD}</option>
                {boardTypeList.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}{b.partNumber ? ` — ${b.partNumber}` : ''}
                  </option>
                ))}
              </select>
              {mappedPart && !pickedPart && (
                <small className="text-muted">
                  {mappedPart.part.partCode}
                  {mappedPart.part.partName ? ` · ${mappedPart.part.partName}` : ''}
                  {/* Which claim this is: off this machine's manual, or the
                      general number kept for the board type. */}
                  <span className="ms-1">
                    ({mappedPart.source === 'machine' ? 'this machine' : 'usual part'})
                  </span>
                  {' — '}
                  <button type="button" className="btn btn-link btn-sm p-0 align-baseline"
                    onClick={() => setPickedPart(mappedPart.part)}>use this part</button>
                </small>
              )}
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
                typedQty={typedQty}
                onTypedQty={setTypedQty}
                // This app has its own dialog; the browser's would look foreign
                // beside every other confirmation in the page.
                confirm={(message) => dialog.confirm(message, {
                  title: 'Remove part', confirmText: 'Remove', variant: 'danger',
                })}
              />
            </div>

            <div>
              <label className="form-label" htmlFor="board-reason">Reason</label>
              {/* A list to pick from AND a box to type in, in one control —
                  the common answers without a dropdown that forces the nearest
                  wrong one when the real reason is not on it. */}
              <input
                id="board-reason"
                type="text"
                list="board-reason-options"
                className="form-control"
                value={form.reason}
                onChange={(e) => set('reason', e.target.value)}
                placeholder="Pick one or type why it was replaced"
              />
              <datalist id="board-reason-options">
                {REPLACEMENT_REASONS.map((r) => <option key={r} value={r} />)}
              </datalist>
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
            <ActingAs customerId={customerId} what="Replacements" />
            <button
              type="button"
              className="btn btn-primary"
              onClick={editing ? saveEdit : save}
              disabled={saving}
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Log replacement'}
            </button>
            {/* The way out of a form that no longer closes itself, and the
                count that says the earlier ones did save — without it, a form
                that looks the same after pressing Log reads as a failure. */}
            {!editing && loggedThisSession > 0 && (
              <>
                <span className="small text-muted">
                  {loggedThisSession} logged{form.lineTitle ? ` on ${form.lineTitle}` : ''} — the line, board type and reason carry over.
                </span>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => { setAdding(false); setLoggedThisSession(0); setForm(BLANK); setPickedPart(null); setExtraParts([]); setTypedQty(1); }}
                >
                  Done
                </button>
              </>
            )}
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
              {entries.length === 0 ? 'No replacements logged yet.' : 'None for this line.'}
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
                          {/* A non-board entry is headed by what was actually
                              replaced. "Part (not a board)" as a title tells
                              the reader only what it was NOT. */}
                          {e.boardType === NOT_A_BOARD
                            ? (partLines(e)[0]?.partNumber || e.partNumber || 'Part replacement')
                            : (e.boardType || 'Board')}
                          {e.headNumber != null
                            ? ` · Head ${e.headNumber}`
                            : (e.boardType === NOT_A_BOARD ? '' : ' · machine board')}
                        </div>
                        <div className="small text-muted">
                          {e.lineTitle} · {new Date(e.performedAt).toLocaleDateString()} ({sinceLabel(e.performedAt)})
                          {' · '}by {e.performedBy || 'Unknown'}{e.role === 'customer' ? ' (plant)' : ' (JTI)'}
                        </div>
                        <CrewLine entry={e} />
                        <EditedNote entry={e} />
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => openEdit(e)}
                      >
                        Edit
                      </button>
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
                          {/* Every part, each on its own line with its count.
                              The number identifies it; the name is what anyone
                              reading the log a month later actually recognises;
                              the count is the difference between replacing two
                              of a set of ten and replacing all ten. */}
                          {partLines(e).map((p, i) => (
                            <span key={`${p.partNumber}-${i}`} className="d-block">
                              {i === 0 ? 'Part ' : '+ '}
                              <strong>{p.partNumber}</strong>
                              {p.itemNo && <span className="text-muted"> · item {p.itemNo}</span>}
                              {p.partName && <> — {p.partName}</>}
                              {qtyLabel(p.qty) && (
                                <span className="badge bg-dark ms-1" title={
                                  p.manualQty ? `${p.qty} of ${p.manualQty} on the drawing` : `${p.qty} replaced`
                                }>{qtyLabel(p.qty)}</span>
                              )}
                            </span>
                          ))}
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
