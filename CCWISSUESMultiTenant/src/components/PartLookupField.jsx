// src/components/PartLookupField.jsx
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
import { fetchPartsForMachine, searchParts } from '../config/parts.js';
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
    <div ref={boxRef} className="position-relative">
      <div className="input-group input-group-sm">
        <span className="input-group-text"><Search size={14} /></span>
        <input
          type="text"
          className="form-control"
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
            className="btn btn-outline-secondary"
            onClick={() => setBrowsing(true)}
            disabled={disabled || !parts}
            title="Browse this machine's drawings and tap the part"
          >
            <BookOpen size={14} /> Browse
          </button>
        )}
      </div>

      {picked ? (
        <div className="small text-success-emphasis mt-1 d-flex align-items-start gap-1">
          <Check size={14} className="flex-shrink-0 mt-1" />
          <span>
            {picked.partName || 'Confirmed'}
            {picked.itemNo ? ` · item ${picked.itemNo}` : ''}
            {picked.diagramName ? ` · ${picked.diagramName}` : ''}
            {picked.diagramId && (
              <button
                type="button"
                className="btn btn-link btn-sm p-0 ms-2 align-baseline"
                onClick={() => setShowDiagram(true)}
              >
                <ImageIcon size={12} /> View on drawing
              </button>
            )}
          </span>
        </div>
      ) : value.trim() && parts && matches.length === 0 ? (
        <div className="small text-warning-emphasis mt-1 d-flex align-items-start gap-1">
          <AlertTriangle size={14} className="flex-shrink-0 mt-1" />
          <span>Not in this machine&apos;s manual — it will be logged as typed.</span>
        </div>
      ) : null}

      {extras.length > 0 && (
        <div className="d-flex flex-wrap gap-1 mt-1">
          {extras.map((p) => (
            <button
              key={`${p.diagramId}-${p.itemNo}-${p.partCode}`}
              type="button"
              className="badge bg-secondary border-0"
              title={`${p.partName || ''} — remove`}
              onClick={() => onExtras?.(extras.filter((x) => x !== p))}
            >
              + {p.partCode || `Item ${p.itemNo}`} ✕
            </button>
          ))}
        </div>
      )}

      {!binding && (
        <div className="form-text">
          No parts manual linked to this line, so numbers can&apos;t be checked.
        </div>
      )}
      {loading && <div className="form-text">Loading the parts manual…</div>}
      {error && <div className="form-text text-danger">{error}</div>}

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
          partLabel={picked.partCode || `Item ${picked.itemNo}`}
          onClose={() => setShowDiagram(false)}
        />
      )}

      {open && matches.length > 0 && (
        <div
          className="list-group position-absolute w-100 shadow"
          style={{ zIndex: 1050, maxHeight: '240px', overflowY: 'auto' }}
        >
          {matches.map((p) => (
            <button
              key={`${p.diagramId}-${p.itemNo}-${p.partCode}`}
              type="button"
              className="list-group-item list-group-item-action py-2"
              onClick={() => choose(p)}
            >
              <div className="fw-semibold">{p.partCode || `Item ${p.itemNo}`}</div>
              <div className="small text-muted">
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
