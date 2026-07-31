// src/components/ManualFigure.jsx
//
// A figure out of the equipment manual, shipped with the app.
//
// Distinct from ReferenceImage, which shows a photo of THIS plant's machine
// uploaded to that customer's storage and served through the media broker. A
// manual figure is the same drawing for every CCW-R, so it is a static asset:
// no per-customer copies, no per-customer authorisation, and it works on a
// brand-new customer with nothing set up yet.
//
// Both can sit on the same checklist item — the manual drawing showing what the
// part is, a site photo showing where it is on this particular machine.
import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';

export default function ManualFigure({ src, label, size = 44 }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;

  return (
    <>
      <button
        type="button"
        className="photo-thumb-btn"
        style={{ width: size, height: size, position: 'relative' }}
        onClick={() => setOpen(true)}
        title="Figure from the equipment manual — tap to enlarge"
        aria-label="View manual figure"
      >
        <img
          src={src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#fff' }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', bottom: 0, right: 0, background: 'rgba(13,110,253,0.9)',
            color: '#fff', borderRadius: '3px', lineHeight: 1, padding: '1px 2px',
          }}
        >
          <BookOpen size={10} />
        </span>
      </button>

      {open && (
        <span
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 3000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', padding: '12px', gap: '8px',
          }}
        >
          {/* White plate behind it: the figures are black line art on
              transparency, which is invisible on a dark overlay. */}
          <img
            src={src}
            alt={label || 'Manual figure'}
            style={{
              maxWidth: '100%', maxHeight: '85%', objectFit: 'contain',
              background: '#fff', padding: '8px', borderRadius: '4px',
            }}
          />
          {label && (
            <span className="small" style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>
              {label}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            style={{
              position: 'absolute', top: '14px', right: '14px', width: '44px', height: '44px',
              borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)',
              color: '#111', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </span>
      )}
    </>
  );
}
