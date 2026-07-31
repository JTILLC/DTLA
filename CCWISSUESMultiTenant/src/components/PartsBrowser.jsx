// src/components/PartsBrowser.jsx
//
// Browse the machine's manual and tap the part you replaced.
//
// The lookup field answers "is this number right?". This answers the question
// an operator actually has at the machine: "what IS this thing I just pulled
// out?" You recognise a part on an exploded view long before you can recall its
// number — so the drawing is the index, not the number.
//
// Everything is scoped to the line's bound machine, exactly as the typed
// lookup is. Browsing cannot wander into another machine's manual.
//
// Two ways to land on a part, because operators arrive from both directions:
// pick a drawing and tap a balloon, or search the parts list and jump to where
// that part sits on its drawing.
import { useEffect, useMemo, useState } from 'react';
import { X, ChevronLeft, Search, ZoomIn, ZoomOut, Eye, EyeOff, List } from 'lucide-react';
import { fetchDiagrams, fetchDiagram, fetchDiagramImage, searchParts } from '../config/parts.js';

export default function PartsBrowser({ binding, parts = [], onPick, onClose }) {
  // A repair is rarely one part — a board comes with its gasket and its screws.
  // Picks accumulate in a tray so the whole job is captured in one trip through
  // the manual instead of reopening it per part.
  const [picked, setPicked] = useState([]);
  const [diagrams, setDiagrams] = useState(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(null);      // { id, name }
  const [meta, setMeta] = useState(null);            // hotspots
  const [src, setSrc] = useState('');
  const [zoom, setZoom] = useState(false);

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(null);  // itemNo arrived at via search
  // Balloons cover the very detail you are trying to read. Hiding them is the
  // difference between a usable drawing and a field of blue dots.
  const [showSpots, setShowSpots] = useState(true);
  // Some parts are easier to find by reading the list than by hunting a balloon
  // on a dense assembly — especially the ones drawn small or overlapping.
  const [showList, setShowList] = useState(false);


  // Drawings for this machine.
  useEffect(() => {
    let cancelled = false;
    if (!binding?.partsCustomer || !binding?.folder) return undefined;
    fetchDiagrams(binding.partsCustomer, binding.folder)
      .then((d) => { if (!cancelled) setDiagrams(d.diagrams || []); })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Diagram list failed:', err);
        setError(err?.message || 'Could not load this machine’s manual.');
      });
    return () => { cancelled = true; };
  }, [binding?.partsCustomer, binding?.folder]);

  // The selected drawing: hotspots and image.
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setMeta(null);
    setSrc('');
    setZoom(false);
    if (!current?.id) return undefined;
    Promise.all([fetchDiagram(current.id), fetchDiagramImage(current.id)])
      .then(([m, url]) => {
        if (cancelled) { URL.revokeObjectURL(url); return; }
        objectUrl = url;
        setMeta(m);
        setSrc(url);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Diagram load failed:', err);
        setError(err?.message || 'Could not load that drawing.');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [current?.id]);

  // Parts on THIS drawing, keyed by the balloon number the hotspot carries.
  const partsHere = useMemo(() => {
    const m = new Map();
    for (const p of parts) {
      if (p.diagramId === current?.id) m.set(String(p.itemNo), p);
    }
    return m;
  }, [parts, current?.id]);

  const results = useMemo(() => searchParts(parts, query, 40), [parts, query]);

  // Ordered by balloon number, which is how the drawing itself is numbered —
  // reading down the list matches walking round the assembly.
  const listHere = useMemo(
    () => [...partsHere.values()].sort(
      (a, b) => String(a.itemNo).localeCompare(String(b.itemNo), undefined, { numeric: true })
    ),
    [partsHere]
  );

  const jumpTo = (p) => {
    setQuery('');
    setHighlight(String(p.itemNo));
    const d = (diagrams || []).find((x) => x.id === p.diagramId);
    setCurrent(d || { id: p.diagramId, name: p.diagramName || 'Drawing' });
  };

  const keyOf = (p) => `${p.diagramId}|${p.itemNo}|${p.partCode}`;
  const isPicked = (p) => picked.some((x) => keyOf(x) === keyOf(p));

  const toggle = (p) => setPicked((prev) => (
    prev.some((x) => keyOf(x) === keyOf(p))
      ? prev.filter((x) => keyOf(x) !== keyOf(p))
      : [...prev, p]
  ));

  // One part is still one tap plus Use. Keeping the tray for the single case as
  // well means the button is always in the same place, rather than the first
  // tap doing something different depending on how many you end up needing.
  const commit = () => {
    if (picked.length === 0) return;
    onPick(picked);
    onClose();
  };

  const listOfDrawings = !current;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3200, background: '#111',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div className="d-flex align-items-center gap-2 px-3 py-2 text-white">
        {current ? (
          <button
            type="button"
            className="btn btn-sm btn-outline-light"
            onClick={() => { setCurrent(null); setHighlight(null); }}
          >
            <ChevronLeft size={16} /> Drawings
          </button>
        ) : (
          <strong className="text-truncate">{binding?.folder || 'Parts manual'}</strong>
        )}
        <div className="ms-auto d-flex align-items-center gap-2">
          {src && (
            <button
              type="button"
              className={'btn btn-sm ' + (showList ? 'btn-light' : 'btn-outline-light')}
              onClick={() => setShowList((v) => !v)}
              aria-label={showList ? 'Hide the parts list' : 'Show the parts list for this drawing'}
              title={showList ? 'Hide the parts list' : 'Parts on this drawing'}
            >
              <List size={16} />
            </button>
          )}
          {src && (
            <button
              type="button"
              className={'btn btn-sm ' + (showSpots ? 'btn-outline-light' : 'btn-light')}
              onClick={() => setShowSpots((v) => !v)}
              aria-label={showSpots ? 'Hide part markers' : 'Show part markers'}
              title={showSpots ? 'Hide the markers to read the drawing' : 'Show part markers'}
            >
              {showSpots ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          )}
          {src && (
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              onClick={() => setZoom((z) => !z)}
              aria-label={zoom ? 'Fit to screen' : 'Zoom in'}
            >
              {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-light" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Search runs across the whole machine, so a part can be reached without
          knowing which drawing it lives on. */}
      <div className="px-3 pb-2">
        <div className="input-group input-group-sm">
          <span className="input-group-text"><Search size={14} /></span>
          <input
            type="text"
            className="form-control"
            placeholder="Search this machine by part number or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        {error && <div className="alert alert-warning m-3">{error}</div>}

        {query.trim().length >= 2 ? (
          <div className="list-group list-group-flush">
            {results.length === 0 && (
              <div className="text-white-50 p-3">Nothing matching “{query}” on this machine.</div>
            )}
            {results.map((p) => (
              <div key={`${p.diagramId}-${p.itemNo}-${p.partCode}`} className="list-group-item d-flex gap-2 align-items-center">
                <div className="flex-grow-1">
                  <div className="fw-semibold">{p.partCode || `Item ${p.itemNo}`}</div>
                  <div className="small text-muted">
                    {p.partName || 'Unnamed part'}
                    {p.itemNo ? ` · item ${p.itemNo}` : ''}
                    {p.diagramName ? ` · ${p.diagramName}` : ''}
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => jumpTo(p)}>
                  Show
                </button>
                <button
                  type="button"
                  className={'btn btn-sm ' + (isPicked(p) ? 'btn-success' : 'btn-primary')}
                  onClick={() => toggle(p)}
                >
                  {isPicked(p) ? 'Added' : 'Add'}
                </button>
              </div>
            ))}
          </div>
        ) : listOfDrawings ? (
          <div className="list-group list-group-flush">
            {!diagrams && !error && <div className="text-white-50 p-3">Loading the manual…</div>}
            {diagrams?.length === 0 && (
              <div className="text-white-50 p-3">This machine has no drawings in the catalog.</div>
            )}
            {(diagrams || []).map((d) => (
              <button
                key={d.id}
                type="button"
                className="list-group-item list-group-item-action"
                onClick={() => { setHighlight(null); setCurrent(d); }}
              >
                <div className="fw-semibold">{d.name}</div>
                {(d.number || d.itemNo) && (
                  <div className="small text-muted">
                    {d.number ? `Drawing ${d.number}` : ''}{d.number && d.itemNo ? ' · ' : ''}{d.itemNo || ''}
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div
            style={{
              minHeight: '100%',
              display: zoom ? 'block' : 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            {!src && !error && <div className="text-white-50 p-3">Loading the drawing…</div>}
            {src && (
              <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
                <img
                  src={src}
                  alt={current?.name || 'Parts diagram'}
                  style={zoom
                    ? { display: 'block', maxWidth: 'none', width: 'auto' }
                    : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
                />

                {/* Balloons sit inside the image's own box, offset by percent, so
                    they track it through letterboxing, resize, zoom and scroll.
                    They were previously positioned against the viewport, which
                    left them behind the moment the drawing scrolled. */}
                {showSpots && (meta?.hotspots || []).map((h) => {
                  const p = partsHere.get(String(h.partNumber));
                  const isHit = highlight && String(h.partNumber) === highlight;
                  const chosen = p && isPicked(p);
                  return (
                    <button
                      key={h.id}
                      type="button"
                      title={p ? `${p.partCode || ''} ${p.partName || ''}`.trim() : `Item ${h.partNumber}`}
                      onClick={() => (p ? toggle(p) : null)}
                      disabled={!p}
                      style={{
                        position: 'absolute',
                        left: `${h.x}%`,
                        top: `${h.y}%`,
                        transform: 'translate(-50%, -50%)',
                        width: '44px', height: '44px',
                        borderRadius: '50%',
                        border: chosen
                          ? '3px solid #198754'
                          : isHit ? '3px solid #ff3b30' : '2px solid rgba(13,110,253,0.9)',
                        background: chosen
                          ? 'rgba(25,135,84,0.35)'
                          : isHit ? 'rgba(255,59,48,0.25)' : 'rgba(13,110,253,0.18)',
                        boxShadow: isHit ? '0 0 0 3px rgba(255,255,255,0.85)' : 'none',
                        cursor: p ? 'pointer' : 'default',
                        padding: 0,
                      }}
                    >
                      <span className="visually-hidden">
                        {p ? `${chosen ? 'Remove' : 'Add'} ${p.partCode || p.partName}` : `Item ${h.partNumber}`}
                      </span>
                    </button>
                  );
                })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* The tray. Always visible once something is picked, so the button that
          finishes the job is in one place regardless of how you got here. */}
      {picked.length > 0 && (
        <div className="bg-body border-top px-3 py-2">
          <div className="d-flex flex-wrap gap-1 mb-2" style={{ maxHeight: '90px', overflowY: 'auto' }}>
            {picked.map((p) => (
              <button
                key={keyOf(p)}
                type="button"
                className="badge bg-success border-0"
                onClick={() => toggle(p)}
                title="Remove"
              >
                {p.partCode || `Item ${p.itemNo}`} ✕
              </button>
            ))}
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={commit}>
              Use {picked.length} part{picked.length === 1 ? '' : 's'}
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setPicked([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="text-center text-white-50 small py-2 px-3">
        {query.trim().length >= 2
          ? 'Add collects parts. Show opens one on its drawing.'
          : listOfDrawings
          ? 'Pick a drawing, then tap the parts you replaced.'
          : showList
          ? 'Tap parts to collect them, then Use.'
          : showSpots
          ? 'Tap marked parts to collect them — more than one is fine.'
          : 'Markers hidden — tap the eye button to bring them back.'}
      </div>
    </div>
  );
}
