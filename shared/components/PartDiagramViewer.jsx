// src/components/PartDiagramViewer.jsx
//
// The exploded view, with the replaced part ringed on it.
//
// A part number confirms itself against the manual; the drawing confirms it
// against the machine. "000-145-5246-04" means nothing standing at a weigher —
// seeing it circled on the assembly does.
//
// Hotspot coordinates are PERCENTAGES of the image, so markers live INSIDE an
// inline-block wrapper that shrinks to the rendered image and are offset by
// percent. The wrapper is the image's box by construction, so letterboxing,
// resizing, zooming and scrolling all move the markers with it for free.
//
// An earlier version measured the rendered rect and positioned markers with
// position:fixed. That measured once against the viewport, so the moment the
// container scrolled the rings stayed put while the drawing moved out from
// under them.
import { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { fetchDiagram, fetchDiagramImage } from '../config/parts.js';

export default function PartDiagramViewer({
  diagramId,
  partItemNo,          // the primary part's balloon number
  partItemNos,         // every part from this replacement, when there is more than one
  partLabel,
  onClose,
}) {
  const [meta, setMeta] = useState(null);
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  // Zoom is a real magnification, not "show at natural size". A scanned drawing
  // is often smaller than a desktop viewport, so natural size overflowed
  // nothing and there was nothing to scroll — zoom appeared to do nothing at
  // all. Steps are multiples of the FITTED width, so each press always enlarges.
  const [zoomStep, setZoomStep] = useState(0);   // 0 = fit
  const ZOOM_STEPS = [1, 2, 4];
  const zoom = zoomStep > 0;

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setError('');
    setMeta(null);
    setSrc('');

    Promise.all([fetchDiagram(diagramId), fetchDiagramImage(diagramId)])
      .then(([m, url]) => {
        if (cancelled) { URL.revokeObjectURL(url); return; }
        objectUrl = url;
        setMeta(m);
        setSrc(url);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Diagram load failed:', err);
        setError(err?.message || 'Could not load the drawing.');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [diagramId]);

  // Every hotspot for every part on this replacement. A repair is often several
  // parts, and ringing only the first left the rest invisible on the drawing
  // they were picked from.
  //
  // A part can also be balloned more than once on one drawing, so all of its
  // hotspots are ringed rather than an arbitrary first.
  const wanted = new Set(
    (partItemNos && partItemNos.length ? partItemNos : [partItemNo])
      .filter((n) => n !== undefined && n !== null && n !== '')
      .map(String)
  );
  const spots = (meta?.hotspots || []).filter((h) => wanted.has(String(h.partNumber)));

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3200, background: 'rgba(0,0,0,0.95)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div className="d-flex align-items-center justify-content-between px-3 py-2 text-white">
        <div className="small text-truncate">
          <strong>{partLabel || 'Part'}</strong>
          {meta?.name ? ` · ${meta.name}` : ''}
        </div>
        <div className="d-flex align-items-center gap-2">
          {src && (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
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
                className="btn btn-sm btn-outline-light"
                onClick={() => setZoomStep((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
                disabled={zoomStep === ZOOM_STEPS.length - 1}
                aria-label="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm btn-light" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1, minHeight: 0, position: 'relative',
          // Always scrollable. Hiding the overflow at Fit meant a drawing taller
          // than the window was clipped with no way to reach the rest of it.
          overflow: 'auto',
          display: zoom ? 'block' : 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {error && <div className="text-warning p-3">{error}</div>}
        {!error && !src && <div className="text-white-50 p-3">Loading the drawing…</div>}
        {src && (
          <span
            style={{
              position: 'relative', display: 'inline-block', lineHeight: 0,
              // Percentage of the viewport rather than of the image's natural
              // size: the drawing is always at least as wide as the window at
              // 2x, so there is always something to pan.
              width: zoom ? `${ZOOM_STEPS[zoomStep] * 100}%` : 'auto',
            }}
          >
            <img
              src={src}
              alt={meta?.name || 'Parts diagram'}
              style={zoom
                ? { display: 'block', width: '100%', height: 'auto', maxWidth: 'none' }
                : {
                    maxWidth: '100%',
                    // Viewport units, not a percentage: the wrapper that keeps
                    // the markers aligned is inline-block with auto height, and
                    // a percentage height against an auto-height parent
                    // resolves to nothing — which is what let the drawing
                    // overflow and get cut off. 96px is the header plus footer.
                    maxHeight: 'calc(100vh - 96px)',
                    objectFit: 'contain',
                    display: 'block',
                  }}
            />
            {spots.map((h) => (
              <span
                key={h.id}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${h.x}%`,
                  top: `${h.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: '40px', height: '40px',
                  border: '3px solid #ff3b30',
                  borderRadius: '50%',
                  boxShadow: '0 0 0 3px rgba(255,255,255,0.85)',
                  pointerEvents: 'none',
                }}
              />
            ))}
          </span>
        )}
      </div>

      <div className="text-center text-white-50 small py-2 px-3">
        {spots.length === 0 && meta
          ? 'This part isn’t balloned on this drawing — showing the full view.'
          : `Ringed in red${spots.length > 1 ? ` — ${spots.length} marked` : ''}.${zoom ? ' Drag or scroll to move around.' : ''}`}
      </div>
    </div>
  );
}
