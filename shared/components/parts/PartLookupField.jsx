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
import { partsApi, searchParts } from './partsApi.js';
import './parts-ui.css';
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
    partsApi().fetchPartsForMachine(binding.partsCustomer, binding.folder)
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
    <div ref={boxRef} className="pui-scope pui-position-relative">
      <div className="pui-input-group">
        <span className="pui-input-group-text"><Search size={14} /></span>
        <input
          type="text"
          className="pui-form-control"
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
            className="pui-btn pui-btn-outline-secondary"
            onClick={() => setBrowsing(true)}
            disabled={disabled || !parts}
            title="Browse this machine's drawings and tap the part"
          >
            <BookOpen size={14} /> Browse
          </button>
        )}
      </div>

      {picked ? (
        <div className="pui-small pui-text-success-emphasis pui-mt-1 pui-d-flex pui-align-start pui-gap-1">
          <Check size={14} className="pui-flex-shrink-0 pui-mt-1" />
          <span>
            {picked.partName || 'Confirmed'}
            {picked.itemNo ? ` · item ${picked.itemNo}` : ''}
            {picked.diagramName ? ` · ${picked.diagramName}` : ''}
            {picked.diagramId && (
              <button
                type="button"
                className="pui-btn pui-btn-link pui-p-0 pui-ms-2 pui-align-baseline"
                onClick={() => setShowDiagram(true)}
              >
                <ImageIcon size={12} /> View on drawing
              </button>
            )}
          </span>
        </div>
      ) : value.trim() && parts && matches.length === 0 ? (
        <div className="pui-small pui-text-warning-emphasis pui-mt-1 pui-d-flex pui-align-start pui-gap-1">
          <AlertTriangle size={14} className="pui-flex-shrink-0 pui-mt-1" />
          <span>Not in this machine&apos;s manual — it will be logged as typed.</span>
        </div>
      ) : null}

      {extras.length > 0 && (
        <div className="pui-d-flex pui-flex-wrap pui-gap-1 pui-mt-1">
          {extras.map((p) => (
            <button
              key={`${p.diagramId}-${p.itemNo}-${p.partCode}`}
              type="button"
              className="pui-badge pui-bg-secondary"
              title={`${p.partName || ''} — remove`}
              onClick={() => onExtras?.(extras.filter((x) => x !== p))}
            >
              + {p.partCode || `Item ${p.itemNo}`} ✕
            </button>
          ))}
        </div>
      )}

      {!binding && (
        <div className="pui-form-text">
          No parts manual linked to this line, so numbers can&apos;t be checked.
        </div>
      )}
      {loading && <div className="pui-form-text">Loading the parts manual…</div>}
      {error && <div className="pui-form-text pui-text-danger">{error}</div>}

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
          className="pui-list-group pui-position-absolute pui-w-100 pui-shadow"
          style={{ zIndex: 1050, maxHeight: '240px', overflowY: 'auto' }}
        >
          {matches.map((p) => (
            <button
              key={`${p.diagramId}-${p.itemNo}-${p.partCode}`}
              type="button"
              className="pui-list-group-item pui-py-2"
              onClick={() => choose(p)}
            >
              <div className="pui-fw-semibold">{p.partCode || `Item ${p.itemNo}`}</div>
              <div className="pui-small pui-text-muted">
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
