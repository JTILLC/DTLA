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
import { asPicked, clampQty, manualQty } from '../../utils/partLines.js';
import './parts-ui.css';
import PartDiagramViewer from './PartDiagramViewer.jsx';
import PartsBrowser from './PartsBrowser.jsx';

// One selected part, with how many of it were replaced.
//
// The quantity is only asked for when it is genuinely a question. A drawing
// showing one of a part admits no other answer, so that row states "Qty 1"
// rather than offering a control whose every other setting would be wrong.
// Where the drawing shows ten, the count is capped at ten and says so — you
// cannot replace more of a part than the machine has.
function PickedPart({ part, primary, disabled, onQty, onRemove }) {
  const max = manualQty(part);
  const qty = clampQty(part.qty, max);
  const fixed = max === 1;

  return (
    <div className="pui-picked-row">
      <div className="pui-picked-main">
        <span className="pui-fw-semibold">{part.partCode || `Item ${part.itemNo}`}</span>
        {part.partName && <span className="pui-small pui-text-muted"> — {part.partName}</span>}
      </div>

      <div className="pui-qty">
        {fixed ? (
          <span className="pui-small pui-text-muted">Qty 1</span>
        ) : (
          <>
            <button
              type="button" className="pui-qty-btn" disabled={disabled || qty <= 1}
              onClick={() => onQty(qty - 1)} aria-label="One fewer"
            >−</button>
            <input
              type="number" className="pui-qty-input" inputMode="numeric"
              min={1} max={max || undefined} value={qty} disabled={disabled}
              onChange={(e) => onQty(clampQty(e.target.value, max))}
              aria-label="Quantity replaced"
            />
            <button
              type="button" className="pui-qty-btn" disabled={disabled || (max ? qty >= max : false)}
              onClick={() => onQty(clampQty(qty + 1, max))} aria-label="One more"
            >+</button>
            {max > 1 && <span className="pui-small pui-text-muted">of {max}</span>}
          </>
        )}
        {onRemove && (
          <button
            type="button" className="pui-qty-btn pui-qty-remove" disabled={disabled}
            onClick={onRemove} title="Remove this part" aria-label="Remove this part"
          >✕</button>
        )}
      </div>
    </div>
  );
}

export default function PartLookupField({
  binding,            // { partsCustomer, folder } | null
  value,              // current partNumber text
  onChange,           // (partNumber) => void
  onPick,             // (part | null) => void — the primary confirmed part
  picked,             // the primary confirmed part, if any
  extras = [],        // further parts on the same replacement
  onExtras,           // (parts[]) => void
  typedQty,           // count for a part typed rather than picked, if supported
  onTypedQty,         // (n) => void — omit and no count is offered for free text
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
    onPick(asPicked(p));      // carries the drawing's count and a replaced count of 1
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
            {/* The name is on the part's own row below, with its count — no
                need to say it twice. This line is provenance: checked against
                the manual, on this drawing, at this item number. */}
            Confirmed
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

      {/* A part typed rather than picked still has a count. There is no drawing
          to cap it against, so it is uncapped — but leaving it out entirely
          would mean an off-manual part could only ever be logged as one. */}
      {!picked && value.trim() && onTypedQty && (
        <div className="pui-picked-list pui-mt-1">
          <div className="pui-picked-row">
            <div className="pui-picked-main pui-small pui-text-muted">How many replaced</div>
            <div className="pui-qty">
              <button
                type="button" className="pui-qty-btn"
                disabled={disabled || clampQty(typedQty, null) <= 1}
                onClick={() => onTypedQty(clampQty(typedQty, null) - 1)} aria-label="One fewer"
              >−</button>
              <input
                type="number" className="pui-qty-input" inputMode="numeric" min={1}
                value={clampQty(typedQty, null)} disabled={disabled}
                onChange={(e) => onTypedQty(clampQty(e.target.value, null))}
                aria-label="Quantity replaced"
              />
              <button
                type="button" className="pui-qty-btn" disabled={disabled}
                onClick={() => onTypedQty(clampQty(typedQty, null) + 1)} aria-label="One more"
              >+</button>
            </div>
          </div>
        </div>
      )}

      {(picked || extras.length > 0) && (
        <div className="pui-picked-list pui-mt-1">
          {[...(picked ? [{ p: picked, primary: true }] : []),
            ...extras.map((p) => ({ p, primary: false }))].map(({ p, primary }) => (
              <PickedPart
                key={`${primary ? 'p' : 'x'}-${p.diagramId}-${p.itemNo}-${p.partCode}`}
                part={p}
                primary={primary}
                disabled={disabled}
                onQty={(qty) => (primary
                  ? onPick({ ...p, qty })
                  : onExtras?.(extras.map((x) => (x === p ? { ...x, qty } : x))))}
                onRemove={primary ? null : () => onExtras?.(extras.filter((x) => x !== p))}
              />
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
            onExtras?.(rest.map(asPicked));
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
