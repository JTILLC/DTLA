// src/components/PartsPage.jsx
//
// Part and board replacements for the Shearers plant.
//
// Same job as the CCW apps' Parts/Boards section: record what was replaced,
// with the part confirmed against that machine's own manual rather than taken
// on trust as free text. Ported rather than shared — this app has no build
// relationship with those, uses the Realtime Database instead of Firestore, and
// is styled with Tailwind.
//
// Scoping is the point of the manual lookup. Part numbers differ between
// machines, so a global search would happily offer a number that is right for
// SOME machine and wrong for this one. Each line is bound once to a machine in
// the parts catalog, and suggestions come only from that machine's manual.
//
// Typing is never blocked. A part can be missing from a manual, or a line can
// have no manual linked, and someone who has just replaced a board must still
// be able to record it — the entry is simply marked unverified.
import { useEffect, useMemo, useState } from 'react';
import {
  subscribePartsLog, addPartsEntry, updatePartsEntry, deletePartsEntry,
  subscribeBoardTypes, saveBoardTypes,
  subscribeBindings, saveBindings,
} from '../services/partsLog';
import { fetchOurMachines } from '../config/parts';
import { SECTIONS, HEADS_PER_LINE } from '../constants';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { withEditStamp, editSummary } from '@shared/utils/editTrail.js';
import PartLookupField from '@shared/components/parts/PartLookupField.jsx';
import PartDiagramViewer from '@shared/components/parts/PartDiagramViewer.jsx';
import Photos from './logger/Photos';
import { toStored, fromStored, partLines, qtyLabel } from '@shared/utils/partLines.js';
import PhotoThumbs from './PhotoThumbs';

const ALL_LINES = SECTIONS.flatMap((s) => s.lines);

const BLANK = {
  line: '',
  head: '',
  boardType: '',
  partNumber: '',
  reason: '',
  notes: '',
  photos: [],
};

const fmt = (iso) =>
  new Date(iso).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export default function PartsPage() {
  const toast = useToast();
  // Everyone here signs in as themselves, so the login already says who edited.
  // The CCW apps need a PIN because a plant tablet is shared; adding one here
  // would only re-prove an identity the login has already proved.
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [boardTypes, setBoardTypes] = useState([]);
  const [bindings, setBindings] = useState({});
  const [form, setForm] = useState(BLANK);
  const [picked, setPicked] = useState(null);
  const [extras, setExtras] = useState([]);
  // Count for a part typed rather than picked from the manual.
  const [typedQty, setTypedQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterLine, setFilterLine] = useState('');
  const [diagramEntry, setDiagramEntry] = useState(null);
  const [showBindings, setShowBindings] = useState(false);
  const [editing, setEditing] = useState(null);   // the saved entry being corrected

  useEffect(() => subscribePartsLog(setEntries), []);
  useEffect(() => subscribeBoardTypes(setBoardTypes), []);
  useEffect(() => subscribeBindings(setBindings), []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Everything replaced in this one job, in the shape the log stores.
  // A part typed rather than picked is still a part: it is recorded with its
  // count so an off-manual replacement isn't silently logged as one.
  const partsForSave = () => {
    const chosen = [picked, ...extras].filter(Boolean);
    if (chosen.length) return chosen.map(toStored);
    const typed = form.partNumber.trim();
    return typed ? [toStored({ partCode: typed, qty: typedQty })] : [];
  };

  // Start from the last replacement: swaps repeat on the same line and head,
  // often the same part. Nothing identifying an individual board carries over.
  const openAdd = () => {
    const last = entries[0];
    setForm(last
      ? { ...BLANK, line: last.line || '', head: last.head || '', boardType: last.boardType || '' }
      : { ...BLANK, boardType: boardTypes[0] || '' });
    setPicked(null);
    setExtras([]);
    setTypedQty(1);
    setAdding(true);
  };

  // Reopen a saved entry in the same form, so adding or removing a part works
  // exactly as it does on a new one.
  const openEdit = (entry) => {
    const list = Array.isArray(entry.parts) && entry.parts.length
      ? entry.parts
      : (entry.partNumber ? [{
          partNumber: entry.partNumber, partName: entry.partName,
          itemNo: entry.partItemNo, diagramId: entry.partDiagramId,
          diagramName: entry.partDiagramName,
        }] : []);
    setForm({
      line: entry.line || '',
      head: entry.head == null ? '' : String(entry.head),
      boardType: entry.boardType || '',
      partNumber: entry.partNumber || '',
      reason: entry.reason || '',
      notes: entry.notes || '',
      photos: entry.photos || [],
    });
    setPicked(list.length && entry.partVerified ? fromStored(list[0]) : null);
    setExtras(list.slice(1).map(fromStored));
    // An unverified entry's count lives on its single typed part.
    setTypedQty(!entry.partVerified && list.length ? fromStored(list[0]).qty : 1);
    setEditing(entry);
    setAdding(true);
  };

  const cancel = () => {
    setAdding(false);
    setEditing(null);
    setPicked(null);
    setExtras([]);
    setTypedQty(1);
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!window.confirm('Save changes to this entry? The change is recorded against you.')) return;
    setSaving(true);
    try {
      await updatePartsEntry(editing.id, withEditStamp({
        line: form.line,
        head: form.head === '' ? null : Number(form.head),
        boardType: form.boardType,
        partNumber: form.partNumber.trim(),
        partName: picked?.partName || '',
        partItemNo: picked?.itemNo || '',
        partDiagramId: picked?.diagramId || '',
        partDiagramName: picked?.diagramName || '',
        partVerified: !!picked,
        parts: partsForSave(),
        reason: form.reason.trim(),
        notes: form.notes.trim(),
        photos: form.photos || [],
      }, editing, user?.email || ''));
      toast.success('Entry updated');
      cancel();
    } catch (err) {
      console.error('parts edit failed:', err);
      toast.error('Could not update: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!form.line) return toast.error('Pick a line');
    if (!form.boardType) return toast.error('Pick what was replaced');
    setSaving(true);
    try {
      await addPartsEntry({
        line: form.line,
        // Blank means a machine-level part rather than head 0.
        head: form.head === '' ? null : Number(form.head),
        boardType: form.boardType,
        partNumber: form.partNumber.trim(),
        partName: picked?.partName || '',
        partItemNo: picked?.itemNo || '',
        partDiagramId: picked?.diagramId || '',
        partDiagramName: picked?.diagramName || '',
        partVerified: !!picked,
        // Everything replaced in this one job — a board and its gasket are one
        // replacement, not two.
        parts: partsForSave(),
        reason: form.reason.trim(),
        notes: form.notes.trim(),
        photos: form.photos || [],
      });
      setForm({ ...BLANK, line: form.line });
      setPicked(null);
      setExtras([]);
      setTypedQty(1);
      setAdding(false);
      toast.success('Replacement logged');
    } catch (err) {
      console.error('parts log save failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry) => {
    if (!window.confirm(`Delete the ${entry.boardType || 'part'} replacement logged ${fmt(entry.performedAt)}?`)) return;
    try {
      await deletePartsEntry(entry.id);
      toast.success('Entry deleted');
    } catch (err) {
      toast.error('Could not delete: ' + (err?.message || 'unknown error'));
    }
  };

  const shown = filterLine ? entries.filter((e) => e.line === filterLine) : entries;

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold dark:text-gray-100">Parts / Board Replacements</h2>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => setShowBindings((v) => !v)}>
            Parts manuals
          </button>
          {!adding && (
            <button type="button" className="btn-primary" onClick={openAdd}>
              Log a replacement
            </button>
          )}
        </div>
      </div>

      {showBindings && (
        <BindingsEditor
          bindings={bindings}
          onClose={() => setShowBindings(false)}
          toast={toast}
        />
      )}

      {adding && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="flex-1 min-w-[150px]">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Line</span>
              <select className="field w-full" value={form.line} onChange={(e) => set('line', e.target.value)}>
                <option value="">Pick a line…</option>
                {ALL_LINES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="w-32">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Head</span>
              <select className="field w-full" value={form.head} onChange={(e) => set('head', e.target.value)}>
                <option value="">Machine</option>
                {Array.from({ length: HEADS_PER_LINE }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex-1 min-w-[150px]">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">What was replaced</span>
              <select className="field w-full" value={form.boardType} onChange={(e) => set('boardType', e.target.value)}>
                <option value="">Pick…</option>
                {boardTypes.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          </div>

          <div>
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Part number or name</span>
            <PartLookupField
              binding={bindings[form.line] || null}
              value={form.partNumber}
              onChange={(v) => set('partNumber', v)}
              onPick={setPicked}
              picked={picked}
              extras={extras}
              onExtras={setExtras}
              typedQty={typedQty}
              onTypedQty={setTypedQty}
            />
          </div>

          <input
            className="field w-full"
            placeholder="Reason (e.g. intermittent load cell reading)"
            value={form.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
          <input
            className="field w-full"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />

          <div>
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Photos</span>
            <Photos
              photos={form.photos}
              onChange={(photos) => set('photos', photos)}
              pathPrefix="downtime-photos/parts"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={editing ? saveEdit : save}
              disabled={saving}
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Log replacement'}
            </button>
            <button type="button" className="btn-secondary" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-semibold dark:text-gray-100">History</h3>
          <select className="field w-auto" value={filterLine} onChange={(e) => setFilterLine(e.target.value)}>
            <option value="">All lines</option>
            {ALL_LINES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        {shown.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {entries.length === 0 ? 'Nothing logged yet.' : 'None for this line.'}
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map((e) => (
              <div key={e.id} className="border border-gray-200 dark:border-gray-700 rounded p-2">
                <div className="flex justify-between items-start gap-2 flex-wrap">
                  <div>
                    <div className="font-semibold dark:text-gray-100">
                      {e.boardType || 'Part'}
                      {e.head != null ? ` · Head ${e.head}` : ' · machine'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {e.line} · {fmt(e.performedAt)}
                    </div>
                    {editSummary(e) && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">✎ {editSummary(e)}</div>
                    )}
                    {e.partNumber && (
                      <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                        {/* Every part with its count, not the first and a
                            promise that others exist. */}
                        {partLines(e).map((p, i) => (
                          <span key={`${p.partNumber}-${i}`} className="block">
                            {i === 0 ? 'Part ' : '+ '}
                            <strong>{p.partNumber}</strong>
                            {p.itemNo ? ` · item ${p.itemNo}` : ''}
                            {p.partName ? ` — ${p.partName}` : ''}
                            {qtyLabel(p.qty) && (
                              <span
                                className="ml-1 px-1.5 py-0.5 rounded bg-gray-700 text-white"
                                title={p.manualQty ? `${p.qty} of ${p.manualQty} on the drawing` : `${p.qty} replaced`}
                              >{qtyLabel(p.qty)}</span>
                            )}
                          </span>
                        ))}
                        <span
                          className={'ml-1 px-1.5 py-0.5 rounded text-white ' +
                            (e.partVerified ? 'bg-emerald-600' : 'bg-gray-500')}
                        >
                          {e.partVerified ? '✓ manual' : 'unverified'}
                        </span>
                        {e.partDiagramId && (
                          <button
                            type="button"
                            className="ml-2 text-indigo-600 dark:text-indigo-400 underline"
                            onClick={() => setDiagramEntry(e)}
                          >
                            drawing
                          </button>
                        )}
                      </div>
                    )}
                    {e.reason && <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{e.reason}</div>}
                    {e.notes && <div className="text-xs text-gray-500 dark:text-gray-400">{e.notes}</div>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" className="btn-secondary" onClick={() => openEdit(e)}>Edit</button>
                    <button type="button" className="btn-secondary" onClick={() => remove(e)}>Delete</button>
                  </div>
                </div>
                {Array.isArray(e.photos) && e.photos.length > 0 && (
                  <div className="mt-2">
                    <PhotoThumbs photos={e.photos} size={56} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {diagramEntry && (
        <PartDiagramViewer
          diagramId={diagramEntry.partDiagramId}
          partItemNo={diagramEntry.partItemNo}
          partItemNos={(diagramEntry.parts || [])
            .filter((p) => p.diagramId === diagramEntry.partDiagramId)
            .map((p) => p.itemNo)}
          partLabel={diagramEntry.partNumber}
          onClose={() => setDiagramEntry(null)}
        />
      )}
    </div>
  );
}

// Which machine in the parts catalog each line's parts come from.
//
// Only this plant's own machines are offered: the app asks the broker for its
// named customers rather than the whole catalog, so no other plant is ever
// listed. A line with no binding says so instead of falling back to a wider
// search that could offer the wrong machine's parts.
function BindingsEditor({ bindings, onClose, toast }) {
  const [machines, setMachines] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(bindings);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(bindings); }, [bindings]);

  useEffect(() => {
    let cancelled = false;
    fetchOurMachines()
      .then((d) => { if (!cancelled) setMachines(d.customers || []); })
      .catch((err) => {
        if (cancelled) return;
        console.warn('machine list failed:', err);
        setError(err?.message || 'Could not read the parts catalog.');
      });
    return () => { cancelled = true; };
  }, []);

  // Flattened "plant — machine" options; a site can own more than one plant in
  // the catalog, and the line has to say which.
  const options = useMemo(() => (machines || []).flatMap((c) =>
    c.folders.map((f) => ({
      key: `${c.customer}||${f.folder}`,
      label: `${c.customer} — ${f.folder}`,
      partsCustomer: c.customer,
      folder: f.folder,
    }))
  ), [machines]);

  const commit = async () => {
    setSaving(true);
    try {
      await saveBindings(draft);
      toast.success('Parts manuals linked');
      onClose();
    } catch (err) {
      console.error('save bindings failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold dark:text-gray-100">Parts manuals</h3>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Link each line to the machine its parts come from. Part suggestions on a
        replacement then come only from that machine&apos;s manual.
      </p>

      {error && <div className="p-2 rounded bg-amber-100 text-amber-900 text-sm mb-2">{error}</div>}
      {!machines && !error && <p className="text-gray-500 text-sm">Loading the parts catalog…</p>}

      {machines && (
        <>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {ALL_LINES.map((line) => {
              const b = draft[line] || {};
              const value = b.partsCustomer && b.folder ? `${b.partsCustomer}||${b.folder}` : '';
              return (
                <div key={line} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-sm dark:text-gray-100">{line}</span>
                  <select
                    className="field flex-1 min-w-0"
                    value={value}
                    onChange={(e) => {
                      const opt = options.find((o) => o.key === e.target.value);
                      setDraft((d) => {
                        const next = { ...d };
                        if (!opt) delete next[line];
                        else next[line] = { partsCustomer: opt.partsCustomer, folder: opt.folder };
                        return next;
                      });
                    }}
                    aria-label={`Machine for ${line}`}
                  >
                    <option value="">Not linked</option>
                    {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn-primary mt-3" onClick={commit} disabled={saving}>
            {saving ? 'Saving…' : 'Save links'}
          </button>
        </>
      )}
    </div>
  );
}
