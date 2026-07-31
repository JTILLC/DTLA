// src/components/parts/PartsBrowser.jsx
//
// Shearers copy of the CCW browser — same behaviour, Tailwind instead of
// Bootstrap. Kept as a copy rather than shared because the two apps have no
// build relationship; changing one means changing the other by hand.
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
import { fetchDiagrams, fetchDiagram, fetchDiagramImage, searchParts } from '../../config/parts.js';

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
  // Same reasoning as the diagram viewer: zoom is a real magnification, so a
  // drawing smaller than the window still has something to pan.
  const [zoomStep, setZoomStep] = useState(0);
  const ZOOM_STEPS = [1, 2, 4];
  const zoom = zoomStep > 0;

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
    setZoomStep(0);
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
      <div className="flex items-center gap-2 px-3 py-2 text-white">
        {current ? (
          <button
            type="button"
            className="px-2 py-1 text-sm rounded border border-white/60 text-white"
            onClick={() => { setCurrent(null); setHighlight(null); }}
          >
            <ChevronLeft size={16} /> Drawings
          </button>
        ) : (
          <strong className="truncate">{binding?.folder || 'Parts manual'}</strong>
        )}
        <div className="ml-auto flex items-center gap-2">
          {src && (
            <button
              type="button"
              className={'px-2 py-1 text-sm rounded ' + (showList ? 'bg-white text-gray-900' : 'border border-white/60 text-white')}
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
              className={'px-2 py-1 text-sm rounded ' + (showSpots ? 'border border-white/60 text-white' : 'bg-white text-gray-900')}
              onClick={() => setShowSpots((v) => !v)}
              aria-label={showSpots ? 'Hide part markers' : 'Show part markers'}
              title={showSpots ? 'Hide the markers to read the drawing' : 'Show part markers'}
            >
              {showSpots ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          )}
          {src && (
            <>
              <button
                type="button"
                className="px-2 py-1 text-sm rounded border border-white/60 text-white"
                onClick={() => setZoomStep((z) => Math.max(0, z - 1))}
                disabled={zoomStep === 0}
                aria-label="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <span className="small text-white-50" style={{ minWidth: '3.2rem', textAlign: 'center' }}>
                {zoomStep === 0 ? 'Fit' : `${ZOOM_STEPS[zoomStep]}×`}
              </span>
              <button
                type="button"
                className="px-2 py-1 text-sm rounded border border-white/60 text-white"
                onClick={() => setZoomStep((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
                disabled={zoomStep === ZOOM_STEPS.length - 1}
                aria-label="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </>
          )}
          <button type="button" className="px-2 py-1 text-sm rounded bg-white text-gray-900" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Search runs across the whole machine, so a part can be reached without
          knowing which drawing it lives on. */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-white/70"><Search size={14} /></span>
          <input
            type="text"
            className="field flex-1 min-w-0"
            placeholder="Search this machine by part number or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        {error && <div className="m-3 p-2 rounded bg-amber-100 text-amber-900 text-sm">{error}</div>}

        {query.trim().length >= 2 ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {results.length === 0 && (
              <div className="text-white/70 p-3">Nothing matching “{query}” on this machine.</div>
            )}
            {results.map((p) => (
              <div key={`${p.diagramId}-${p.itemNo}-${p.partCode}`} className="flex gap-2 items-center p-2 bg-white dark:bg-gray-800">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{p.partCode || `Item ${p.itemNo}`}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {p.partName || 'Unnamed part'}
                    {p.itemNo ? ` · item ${p.itemNo}` : ''}
                    {p.diagramName ? ` · ${p.diagramName}` : ''}
                  </div>
                </div>
                <button type="button" className="btn-secondary" onClick={() => jumpTo(p)}>
                  Show
                </button>
                <button
                  type="button"
                  className={'px-2 py-1 text-sm rounded text-white ' + (isPicked(p) ? 'bg-emerald-600' : 'bg-indigo-600')}
                  onClick={() => toggle(p)}
                >
                  {isPicked(p) ? 'Added' : 'Add'}
                </button>
              </div>
            ))}
          </div>
        ) : listOfDrawings ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {!diagrams && !error && <div className="text-white/70 p-3">Loading the manual…</div>}
            {diagrams?.length === 0 && (
              <div className="text-white/70 p-3">This machine has no drawings in the catalog.</div>
            )}
            {(diagrams || []).map((d) => (
              <button
                key={d.id}
                type="button"
                className="block w-full text-left p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => { setHighlight(null); setCurrent(d); }}
              >
                <div className="font-semibold">{d.name}</div>
                {(d.number || d.itemNo) && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
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
            {!src && !error && <div className="text-white/70 p-3">Loading the drawing…</div>}
            {src && (
              <span
                style={{
                  position: 'relative', display: 'inline-block', lineHeight: 0,
                  width: zoom ? `${ZOOM_STEPS[zoomStep] * 100}%` : 'auto',
                }}
              >
                <img
                  src={src}
                  alt={current?.name || 'Parts diagram'}
                  style={zoom
                    ? { display: 'block', width: '100%', height: 'auto', maxWidth: 'none' }
                    : {
                        maxWidth: '100%',
                        // See PartDiagramViewer: a percentage height against the
                        // auto-height marker wrapper resolves to nothing, so the
                        // cap has to be in viewport units. Allows for the header,
                        // search box and footer.
                        maxHeight: 'calc(100vh - 200px)',
                        objectFit: 'contain',
                        display: 'block',
                      }}
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

      {/* Parts on this drawing. A sibling of the tray in the same column rather
          than an overlay: as an overlay pinned to the bottom the two fought for
          the same space and the tray won, so the list button did nothing once
          anything was picked. */}
      {showList && current && query.trim().length < 2 && (
        <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
          <div className="flex justify-between items-center px-3 py-2 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
            <strong>Parts on {current?.name || 'this drawing'}</strong>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowList(false)}
              aria-label="Hide the parts list"
            >
              <X size={14} />
            </button>
          </div>
          {listHere.length === 0 ? (
            <div className="text-gray-500 p-3">No parts listed for this drawing.</div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {listHere.map((p) => (
                <button
                  key={`${p.itemNo}-${p.partCode}`}
                  type="button"
                  className="block w-full text-left p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                  onClick={() => toggle(p)}
                >
                  <div className="flex gap-2">
                    <span
                      className={'text-xs px-2 py-0.5 rounded text-white shrink-0 ' + (isPicked(p) ? 'bg-emerald-600' : 'bg-gray-500')}
                      style={{ minWidth: '2.2rem' }}
                    >
                      {isPicked(p) ? '✓' : p.itemNo}
                    </span>
                    <span>
                      <span className="font-semibold">{p.partCode || `Item ${p.itemNo}`}</span>
                      {p.partName && <span className="block text-xs text-gray-500 dark:text-gray-400">{p.partName}</span>}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The tray. Always visible once something is picked, so the button that
          finishes the job is in one place regardless of how you got here. */}
      {picked.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-3 py-2">
          <div className="flex flex-wrap gap-1 mb-2" style={{ maxHeight: '90px', overflowY: 'auto' }}>
            {picked.map((p) => (
              <button
                key={keyOf(p)}
                type="button"
                className="text-xs px-2 py-0.5 rounded bg-emerald-600 text-white"
                onClick={() => toggle(p)}
                title="Remove"
              >
                {p.partCode || `Item ${p.itemNo}`} ✕
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={commit}>
              Use {picked.length} part{picked.length === 1 ? '' : 's'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPicked([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="text-center text-white/70 text-xs py-2 px-3">
        {query.trim().length >= 2
          ? 'Add collects parts. Show opens one on its drawing.'
          : listOfDrawings
          ? 'Pick a drawing, then tap the parts you replaced.'
          : showList
          ? 'Tap parts to collect them, then Use.'
          : zoom
          ? 'Drag or scroll to move around. Markers stay on their parts.'
          : showSpots
          ? 'Tap marked parts to collect them — more than one is fine.'
          : 'Markers hidden — tap the eye button to bring them back.'}
      </div>
    </div>
  );
}
