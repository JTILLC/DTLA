// src/components/Lightbox.jsx
// Full-screen in-app photo viewer. Ported from the field app (CCWISSUESGitHub)
// — opening photos in a new tab is unreliable on mobile, especially when the
// share link was opened from Messages, where the customer loses the app tab.
import { useEffect } from 'react';

const Lightbox = ({ url, onClose }) => {
  // Escape to close, and stop the page behind from scrolling under the finger.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 3000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px',
      }}
    >
      <img
        src={url}
        alt="Photo"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        style={{
          position: 'absolute', top: 'calc(14px + env(safe-area-inset-top))', right: '14px',
          width: '44px', height: '44px', borderRadius: '50%', border: 'none',
          background: 'rgba(255,255,255,0.9)', color: '#111', fontSize: '20px',
          fontWeight: 'bold', cursor: 'pointer', lineHeight: 1,
        }}
      >✕</button>
    </div>
  );
};

export default Lightbox;
