// src/components/parts/PartLookupField.jsx
//
// Shearers copy of the CCW field — same behaviour, Tailwind styling.
//
// The part-number field on a board/parts replacement, backed by the machine's
// own parts manual instead of taking free text on trust.
//
// Scoping is the point. Part numbers differ between machines, so a global
// search would happily offer a number that is correct for SOME machine and
// wrong for this one. Suggestions come only from the folder this line is bound
// to — one folder is one machine — and a line with no binding says so rather
// than silently falling back to a wider search.
//
// Typing is never blocked. A part can be missing from a manual, or a manual can
// be missing entirely, and an operator who has just replaced something must
// still be able to record it. Confirmed picks are marked; free text is kept as
// typed and flagged as unverified, so the log distinguishes "checked against
// the manual" from "someone typed it".
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, AlertTriangle, Image as ImageIcon, BookOpen } from 'lucide-react';
import { fetchPartsForMachine, searchParts } from '../../config/parts.js';
import PartDiagramViewer from './PartDiagramViewer.jsx';
import PartsBrowser from './PartsBrowser.jsx';

export default function PartLookupField({
  binding,            // { partsCustomer, folder } | null
  value,              // current partNumber text
  onChange,           // (partNumber) => void
  onPick,             // (part | null) => void — the primary confirmed part
  picked,             // the primary confirmed part, if any
  extras = [],        // further parts on the same replacement
  onExtras,           // (parts[]) => void
  disabled = false,
}) {
  const [parts, setParts] = useState(null);     // null = not loaded yet
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const [showDiagram, setShowDiagram] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  const key = binding ? `${binding.partsCustomer}||${binding.folder}` : '';

  // One fetch per machine, then filter locally — a manual is small and static
  // enough that a request per keystroke would be pure waste.
  useEffect(() => {
    let cancelled = false;
    setParts(null);
    setError('');
    if (!binding?.partsCustomer || !binding?.folder) return undefined;
    setLoading(true);
    fetchPartsForMachine(binding.partsCustomer, binding.folder)
      .then((data) => { if (!cancelled) setParts(data.parts || []); })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Parts manual load failed:', err);
        setError(err?.message || 'Could not load the parts manual.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key]);

  // Close the suggestion list on an outside tap.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const matches = useMemo(
    () => (parts ? searchParts(parts, value) : []),
    [parts, value]
  );

  const choose = (p) => {
    onChange(p.partCode || String(p.itemNo));
    onPick(p);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2">
        <span className="text-gray-500"><Search size={14} /></span>
        <input
          type="text"
          className="field flex-1 min-w-0"
          placeholder={binding ? 'Part number or name' : 'Part number (no manual linked)'}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            onPick(null);           // editing invalidates a previous confirmation
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {binding && (
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => setBrowsing(true)}
            disabled={disabled || !parts}
            title="Browse this machine's drawings and tap the part"
          >
            <BookOpen size={14} /> Browse
          </button>
        )}
      </div>

      {picked ? (
        <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-start gap-1">
          <Check size={14} className="shrink-0 mt-0.5" />
          <span>
            {picked.partName || 'Confirmed'}
            {picked.itemNo ? ` · item ${picked.itemNo}` : ''}
            {picked.diagramName ? ` · ${picked.diagramName}` : ''}
            {picked.diagramId && (
              <button
                type="button"
                className="ml-2 text-indigo-600 dark:text-indigo-400 underline text-xs"
                onClick={() => setShowDiagram(true)}
              >
                <ImageIcon size={12} /> View on drawing
              </button>
            )}
          </span>
        </div>
      ) : value.trim() && parts && matches.length === 0 ? (
        <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Not in this machine&apos;s manual — it will be logged as typed.</span>
        </div>
      ) : null}

      {extras.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {extras.map((p) => (
            <button
              key={`${p.diagramId}-${p.itemNo}-${p.partCode}`}
              type="button"
              className="text-xs px-2 py-0.5 rounded bg-gray-500 text-white"
              title={`${p.partName || ''} — remove`}
              onClick={() => onExtras?.(extras.filter((x) => x !== p))}
            >
              + {p.partCode || `Item ${p.itemNo}`} ✕
            </button>
          ))}
        </div>
      )}

      {!binding && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          No parts manual linked to this line, so numbers can&apos;t be checked.
        </div>
      )}
      {loading && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Loading the parts manual…</div>}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}

      {browsing && (
        <PartsBrowser
          binding={binding}
          parts={parts || []}
          onPick={(list) => {
            // First pick fills the field; the rest ride along on the same entry.
            // A board and its gasket are one replacement, not two.
            const [first, ...rest] = list;
            if (first) choose(first);
            onExtras?.(rest);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}

      {showDiagram && picked?.diagramId && (
        <PartDiagramViewer
          diagramId={picked.diagramId}
          partItemNo={picked.itemNo}
          // Everything picked that lives on THIS drawing — extras on another
          // drawing cannot be ringed here and are not pretended to be.
          partItemNos={[picked, ...extras]
            .filter((p) => p.diagramId === picked.diagramId)
            .map((p) => p.itemNo)}
          partLabel={
            extras.length
              ? `${picked.partCode || `Item ${picked.itemNo}`} + ${extras.length} more`
              : (picked.partCode || `Item ${picked.itemNo}`)
          }
          onClose={() => setShowDiagram(false)}
        />
      )}

      {open && matches.length > 0 && (
        <div
          className="absolute w-full shadow-lg rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700"
          style={{ zIndex: 1050, maxHeight: '240px', overflowY: 'auto' }}
        >
          {matches.map((p) => (
            <button
              key={`${p.diagramId}-${p.itemNo}-${p.partCode}`}
              type="button"
              className="block w-full text-left p-2 hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => choose(p)}
            >
              <div className="font-semibold">{p.partCode || `Item ${p.itemNo}`}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {p.partName || 'Unnamed part'}
                {p.itemNo ? ` · item ${p.itemNo}` : ''}
                {p.diagramName ? ` · ${p.diagramName}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
