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
import { partsApi, searchParts } from './partsApi.js';
import { manualQty, isAssembly } from '../../utils/partLines.js';
import './parts-ui.css';

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
  // The number strip is on by default: it is the fastest route to a part and
  // costs nothing when unused.
  const [showStrip, setShowStrip] = useState(true);


  // Drawings for this machine.
  useEffect(() => {
    let cancelled = false;
    if (!binding?.partsCustomer || !binding?.folder) return undefined;
    partsApi().fetchDiagrams(binding.partsCustomer, binding.folder)
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
    Promise.all([partsApi().fetchDiagram(current.id), partsApi().fetchDiagramImage(current.id)])
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
  //
  // The assembly row is held back: it names the whole unit rather than anything
  // fitted to it, and "*" sorts above 1, so it sat at the top of the list as
  // the easiest row to tap by mistake. It is shown as a heading instead.
  const listHere = useMemo(
    () => [...partsHere.values()]
      .filter((p) => !isAssembly(p))
      .sort((a, b) => String(a.itemNo).localeCompare(String(b.itemNo), undefined, { numeric: true })),
    [partsHere]
  );

  const assemblyHere = useMemo(
    () => [...partsHere.values()].find(isAssembly) || null,
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

  // Guarded here rather than in each list, because a part can be reached from
  // four directions — the list, the number strip, a balloon on the drawing, and
  // search — and the assembly must be unpickable from all of them.
  const toggle = (p) => {
    if (isAssembly(p)) return;
    setPicked((prev) => (
      prev.some((x) => keyOf(x) === keyOf(p))
        ? prev.filter((x) => keyOf(x) !== keyOf(p))
        : [...prev, p]
    ));
  };

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
      className="pui-scope"
      style={{
        position: 'fixed', inset: 0, zIndex: 3200, background: '#111',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div className="pui-d-flex pui-align-center pui-gap-2 pui-px-3 pui-py-2 pui-text-white">
        {current ? (
          <button
            type="button"
            className="pui-btn pui-btn-outline-light"
            onClick={() => { setCurrent(null); setHighlight(null); }}
          >
            <ChevronLeft size={16} /> Drawings
          </button>
        ) : (
          <strong className="pui-text-truncate">{binding?.folder || 'Parts manual'}</strong>
        )}
        <div className="pui-ms-auto pui-d-flex pui-align-center pui-gap-2">
          {src && (
            <button
              type="button"
              className={'pui-btn ' + (showStrip ? 'pui-btn-light' : 'pui-btn-outline-light')}
              onClick={() => setShowStrip((v) => !v)}
              aria-label={showStrip ? 'Hide the number strip' : 'Show the number strip'}
              title={showStrip ? 'Hide the number strip' : 'Part numbers down the side'}
            >
              123
            </button>
          )}
          {src && (
            <button
              type="button"
              className={'pui-btn ' + (showList ? 'pui-btn-light' : 'pui-btn-outline-light')}
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
              className={'pui-btn ' + (showSpots ? 'pui-btn-outline-light' : 'pui-btn-light')}
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
                className="pui-btn pui-btn-outline-light"
                onClick={() => setZoomStep((z) => Math.max(0, z - 1))}
                disabled={zoomStep === 0}
                aria-label="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <span className="pui-small pui-text-white-50" style={{ minWidth: '3.2rem', textAlign: 'center' }}>
                {zoomStep === 0 ? 'Fit' : `${ZOOM_STEPS[zoomStep]}×`}
              </span>
              <button
                type="button"
                className="pui-btn pui-btn-outline-light"
                onClick={() => setZoomStep((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
                disabled={zoomStep === ZOOM_STEPS.length - 1}
                aria-label="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </>
          )}
          <button type="button" className="pui-btn pui-btn-light" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Search runs across the whole machine, so a part can be reached without
          knowing which drawing it lives on. */}
      <div className="pui-px-3 pui-pb-2">
        <div className="pui-input-group">
          <span className="pui-input-group-text"><Search size={14} /></span>
          <input
            type="text"
            className="pui-form-control"
            placeholder="Search this machine by part number or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        {error && <div className="pui-alert-warning pui-m-3">{error}</div>}

        {query.trim().length >= 2 ? (
          <div className="pui-list-group">
            {results.length === 0 && (
              <div className="pui-text-white-50 pui-p-3">Nothing matching “{query}” on this machine.</div>
            )}
            {results.map((p) => (
              <div key={`${p.diagramId}-${p.itemNo}-${p.partCode}`} className="pui-list-group-item pui-d-flex pui-gap-2 pui-align-center">
                <div className="pui-flex-grow">
                  <div className="pui-fw-semibold">{p.partCode || `Item ${p.itemNo}`}</div>
                  <div className="pui-small pui-text-muted">
                    {p.partName || 'Unnamed part'}
                    {p.itemNo ? ` · item ${p.itemNo}` : ''}
                    {/* How many the drawing carries. Worth knowing BEFORE
                        adding a part: it is the difference between one screw
                        and the ten that hold the same cover on. */}
                    {manualQty(p) ? ` · qty ${manualQty(p)}` : ''}
                    {p.diagramName ? ` · ${p.diagramName}` : ''}
                  </div>
                </div>
                <button type="button" className="pui-btn pui-btn-outline-secondary" onClick={() => jumpTo(p)}>
                  Show
                </button>
                <button
                  type="button"
                  className={'pui-btn ' + (isPicked(p) ? 'pui-btn-success' : 'pui-btn-primary')}
                  onClick={() => toggle(p)}
                >
                  {isPicked(p) ? 'Added' : 'Add'}
                </button>
              </div>
            ))}
          </div>
        ) : listOfDrawings ? (
          <div className="pui-list-group">
            {!diagrams && !error && <div className="pui-text-white-50 pui-p-3">Loading the manual…</div>}
            {diagrams?.length === 0 && (
              <div className="pui-text-white-50 pui-p-3">This machine has no drawings in the catalog.</div>
            )}
            {(diagrams || []).map((d) => (
              <button
                key={d.id}
                type="button"
                className="pui-list-group-item"
                onClick={() => { setHighlight(null); setCurrent(d); }}
              >
                <div className="pui-fw-semibold">{d.name}</div>
                {(d.number || d.itemNo) && (
                  <div className="pui-small pui-text-muted">
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
            {!src && !error && <div className="pui-text-white-50 pui-p-3">Loading the drawing…</div>}
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
                        // Selected is RED and filled. On a dense assembly the
                        // question is "where is the one I just picked", and a
                        // solid red spot answers it at a glance. The search
                        // jump moved to amber so the two never mean the same.
                        border: chosen
                          ? '3px solid #ff3b30'
                          : isHit ? '3px solid #f59e0b' : '2px solid rgba(13,110,253,0.9)',
                        background: chosen
                          ? 'rgba(255,59,48,0.55)'
                          : isHit ? 'rgba(245,158,11,0.25)' : 'rgba(13,110,253,0.18)',
                        boxShadow: chosen || isHit ? '0 0 0 3px rgba(255,255,255,0.9)' : 'none',
                        cursor: p ? 'pointer' : 'default',
                        padding: 0,
                      }}
                    >
                      <span className="pui-visually-hidden">
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

      {/* Every balloon on this drawing, down the side, as in the Interactive
          Parts Manual. It is how you reach a part you cannot spot on a busy
          assembly: tap the number and its red marker says where it lives.

          Absolutely positioned against the modal rather than placed in the
          scrolling area, so it stays put while the drawing is panned — the
          strip is a fixed index, not part of the picture. */}
      {showStrip && current && !zoom && query.trim().length < 2 && listHere.length > 0 && (
        <div
          style={{
            position: 'absolute', top: 96, right: 8, bottom: 72, width: 58,
            background: 'rgba(255,255,255,0.94)', borderRadius: 8,
            border: '1px solid rgba(0,0,0,0.15)', padding: 6,
            overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6,
            zIndex: 5,
          }}
        >
          {listHere.map((p) => {
            const chosen = isPicked(p);
            const onDrawing = (meta?.hotspots || []).some(
              (h) => String(h.partNumber) === String(p.itemNo)
            );
            return (
              <button
                key={`strip-${p.itemNo}-${p.partCode}`}
                type="button"
                onClick={() => toggle(p)}
                title={`${p.partCode || ''} ${p.partName || ''}`.trim() || `Item ${p.itemNo}`}
                style={{
                  minHeight: 34, padding: '4px 2px', width: '100%',
                  fontSize: 13, fontWeight: 700, lineHeight: 1,
                  color: '#fff', cursor: 'pointer', borderRadius: 5,
                  background: chosen ? '#198754' : '#0d6efd',
                  // A ballooned part can be found on the drawing; one without a
                  // hotspot can only be picked from here, and saying so beats
                  // letting someone hunt for a marker that does not exist.
                  border: onDrawing ? '2px solid #ffd60a' : '2px solid transparent',
                }}
              >
                {p.itemNo}
              </button>
            );
          })}
        </div>
      )}

      {/* Parts on this drawing. A sibling of the tray in the same column rather
          than an overlay: as an overlay pinned to the bottom the two fought for
          the same space and the tray won, so the list button did nothing once
          anything was picked. */}
      {showList && current && query.trim().length < 2 && (
        <div className="pui-bg-body pui-border-top" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
          <div className="pui-d-flex pui-justify-between pui-align-center pui-px-3 pui-py-2 pui-border-bottom pui-sticky-top pui-bg-body">
            <strong>Parts on {current?.name || 'this drawing'}</strong>
            <button
              type="button"
              className="pui-btn pui-btn-outline-secondary"
              onClick={() => setShowList(false)}
              aria-label="Hide the parts list"
            >
              <X size={14} />
            </button>
          </div>
          {/* The unit this drawing depicts. Shown for context, deliberately not
              selectable — replacing "the drive weigh unit" is not what anyone
              means when they pick a part off its own drawing. */}
          {assemblyHere && (
            <div className="pui-px-3 pui-py-2 pui-small pui-text-muted pui-border-bottom">
              Assembly: <span className="pui-fw-semibold">{assemblyHere.partCode}</span>
              {assemblyHere.partName ? ` — ${assemblyHere.partName}` : ''}
            </div>
          )}
          {listHere.length === 0 ? (
            <div className="pui-text-muted pui-p-3">No parts listed for this drawing.</div>
          ) : (
            <div className="pui-list-group">
              {listHere.map((p) => (
                <button
                  key={`${p.itemNo}-${p.partCode}`}
                  type="button"
                  className="pui-list-group-item pui-py-2"
                  onClick={() => toggle(p)}
                >
                  <div className="pui-d-flex pui-gap-2">
                    <span
                      className={'pui-badge pui-flex-shrink-0 ' + (isPicked(p) ? 'pui-bg-success' : 'pui-bg-secondary')}
                      style={{ minWidth: '2.2rem' }}
                    >
                      {isPicked(p) ? '✓' : p.itemNo}
                    </span>
                    <span>
                      <span className="pui-fw-semibold">{p.partCode || `Item ${p.itemNo}`}</span>
                      {/* The drawing's count, on the same line as the name:
                          this is the list people pick from, so it is where
                          "there are ten of these" needs to be said. */}
                      {(p.partName || manualQty(p)) && (
                        <span className="pui-d-block pui-small pui-text-muted">
                          {p.partName || ''}
                          {p.partName && manualQty(p) ? ' · ' : ''}
                          {manualQty(p) ? `qty ${manualQty(p)}` : ''}
                        </span>
                      )}
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
        <div className="pui-bg-body pui-border-top pui-px-3 pui-py-2">
          <div className="pui-d-flex pui-flex-wrap pui-gap-1 pui-mb-2" style={{ maxHeight: '90px', overflowY: 'auto' }}>
            {picked.map((p) => (
              <button
                key={keyOf(p)}
                type="button"
                className="pui-badge pui-bg-success"
                onClick={() => toggle(p)}
                title="Remove"
              >
                {p.partCode || `Item ${p.itemNo}`} ✕
              </button>
            ))}
          </div>
          <div className="pui-d-flex pui-gap-2">
            <button type="button" className="pui-btn pui-btn-primary" onClick={commit}>
              Use {picked.length} part{picked.length === 1 ? '' : 's'}
            </button>
            <button type="button" className="pui-btn pui-btn-outline-secondary" onClick={() => setPicked([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="pui-text-center pui-text-white-50 pui-small pui-py-2 pui-px-3">
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
