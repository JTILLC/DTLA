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
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, Search, ZoomIn, ZoomOut, Eye, EyeOff } from 'lucide-react';
import { fetchDiagrams, fetchDiagram, fetchDiagramImage, searchParts } from '../config/parts.js';

export default function PartsBrowser({ binding, parts = [], onPick, onClose }) {
  const [diagrams, setDiagrams] = useState(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(null);      // { id, name }
  const [meta, setMeta] = useState(null);            // hotspots
  const [src, setSrc] = useState('');
  const [zoom, setZoom] = useState(false);
  const [box, setBox] = useState(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(null);  // itemNo arrived at via search
  // Balloons cover the very detail you are trying to read. Hiding them is the
  // difference between a usable drawing and a field of blue dots.
  const [showSpots, setShowSpots] = useState(true);
  const imgRef = useRef(null);

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

  // `object-fit: contain` letterboxes, so the marker layer has to follow the
  // rendered image rect rather than its container.
  const measure = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const r = img.getBoundingClientRect();
    const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    setBox({ left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h });
  };

  useEffect(() => {
    if (!src) return undefined;
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [src, zoom]);

  // Parts on THIS drawing, keyed by the balloon number the hotspot carries.
  const partsHere = useMemo(() => {
    const m = new Map();
    for (const p of parts) {
      if (p.diagramId === current?.id) m.set(String(p.itemNo), p);
    }
    return m;
  }, [parts, current?.id]);

  const results = useMemo(() => searchParts(parts, query, 40), [parts, query]);

  const jumpTo = (p) => {
    setQuery('');
    setHighlight(String(p.itemNo));
    const d = (diagrams || []).find((x) => x.id === p.diagramId);
    setCurrent(d || { id: p.diagramId, name: p.diagramName || 'Drawing' });
  };

  const take = (p) => {
    onPick(p);
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
                <button type="button" className="btn btn-sm btn-primary" onClick={() => take(p)}>
                  Use
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
              <img
                ref={imgRef}
                src={src}
                alt={current?.name || 'Parts diagram'}
                onLoad={measure}
                style={zoom
                  ? { display: 'block', maxWidth: 'none', width: 'auto' }
                  : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
              />
            )}

            {/* Tappable balloons. 44px targets — this is used on a phone at a
                machine, not with a mouse. */}
            {src && box && !zoom && (meta?.hotspots || []).map((h) => {
              const p = partsHere.get(String(h.partNumber));
              const isHit = highlight && String(h.partNumber) === highlight;
              // Hiding keeps the one part you searched for ringed — that is the
              // thing you opened the drawing to find.
              if (!showSpots && !isHit) return null;
              return (
                <button
                  key={h.id}
                  type="button"
                  title={p ? `${p.partCode || ''} ${p.partName || ''}`.trim() : `Item ${h.partNumber}`}
                  onClick={() => (p ? take(p) : null)}
                  disabled={!p}
                  style={{
                    position: 'fixed',
                    left: box.left + (h.x / 100) * box.width,
                    top: box.top + (h.y / 100) * box.height,
                    width: '44px', height: '44px', marginLeft: '-22px', marginTop: '-22px',
                    borderRadius: '50%',
                    border: isHit ? '3px solid #ff3b30' : '2px solid rgba(13,110,253,0.9)',
                    background: isHit ? 'rgba(255,59,48,0.25)' : 'rgba(13,110,253,0.18)',
                    boxShadow: isHit ? '0 0 0 3px rgba(255,255,255,0.85)' : 'none',
                    cursor: p ? 'pointer' : 'default',
                    padding: 0,
                  }}
                >
                  <span className="visually-hidden">
                    {p ? `Use ${p.partCode || p.partName}` : `Item ${h.partNumber}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-center text-white-50 small py-2 px-3">
        {query.trim().length >= 2
          ? 'Use adds the part to the entry. Show opens it on its drawing.'
          : listOfDrawings
          ? 'Pick a drawing, then tap the part you replaced.'
          : zoom
          ? 'Scroll to move around. Tap the zoom button to fit and tap parts.'
          : showSpots
          ? 'Tap a marked part to use it. Use the eye button to clear the markers.'
          : 'Markers hidden — tap the eye button to bring them back.'}
      </div>
    </div>
  );
}
