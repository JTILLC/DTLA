// src/components/PartDiagramViewer.jsx
//
// The exploded view, with the replaced part ringed on it.
//
// A part number confirms itself against the manual; the drawing confirms it
// against the machine. "000-145-5246-04" means nothing standing at a weigher —
// seeing it circled on the assembly does.
//
// Hotspot coordinates are PERCENTAGES of the image, which is what lets the
// marker sit correctly at any render size without knowing the source
// dimensions. That also means the marker must be positioned against the
// RENDERED image box, not the container — a drawing letterboxed inside a
// portrait phone screen would otherwise put the ring in the wrong place.
import { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { fetchDiagram, fetchDiagramImage } from '../config/parts.js';

export default function PartDiagramViewer({ diagramId, partItemNo, partLabel, onClose }) {
  const [meta, setMeta] = useState(null);
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(false);
  const [box, setBox] = useState(null);      // rendered image rect, for the marker
  const imgRef = useRef(null);

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

  // Track where the image actually renders. `object-fit: contain` letterboxes,
  // so the image box and its container are not the same rectangle.
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

  // Every hotspot for this part. A part can be balloned more than once on one
  // drawing, so ring them all rather than picking arbitrarily.
  const spots = (meta?.hotspots || []).filter(
    (h) => String(h.partNumber) === String(partItemNo)
  );

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

      <div
        style={{
          flex: 1, minHeight: 0, position: 'relative',
          overflow: zoom ? 'auto' : 'hidden',
          display: zoom ? 'block' : 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {error && <div className="text-warning p-3">{error}</div>}
        {!error && !src && <div className="text-white-50 p-3">Loading the drawing…</div>}
        {src && (
          <img
            ref={imgRef}
            src={src}
            alt={meta?.name || 'Parts diagram'}
            onLoad={measure}
            style={zoom
              ? { display: 'block', maxWidth: 'none', width: 'auto' }
              : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
          />
        )}

        {/* Markers ride on the rendered image box, in fixed coordinates, so they
            stay put whether the image is letterboxed or scrolled while zoomed. */}
        {src && box && !zoom && spots.map((h) => (
          <span
            key={h.id}
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: box.left + (h.x / 100) * box.width,
              top: box.top + (h.y / 100) * box.height,
              width: '40px', height: '40px', marginLeft: '-20px', marginTop: '-20px',
              border: '3px solid #ff3b30',
              borderRadius: '50%',
              boxShadow: '0 0 0 3px rgba(255,255,255,0.85)',
              pointerEvents: 'none',
            }}
          />
        ))}
      </div>

      <div className="text-center text-white-50 small py-2 px-3">
        {spots.length === 0 && meta
          ? 'This part isn’t balloned on this drawing — showing the full view.'
          : zoom
          ? 'Scroll to move around. The marker is hidden while zoomed.'
          : `Ringed in red${spots.length > 1 ? ` (${spots.length} places)` : ''}.`}
      </div>
    </div>
  );
}
