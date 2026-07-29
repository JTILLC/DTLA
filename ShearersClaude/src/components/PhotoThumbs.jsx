// src/components/PhotoThumbs.jsx
//
// Read-only photo thumbnails with a tap-to-enlarge viewer. Used by Summary,
// Head History and the customer's shared views — anywhere photos are displayed
// but not edited. Uploading/deleting lives in logger/Photos.jsx.
//
// Kept as its own component so the four read-only call sites can't drift apart.
import React, { useState } from 'react';

export default function PhotoThumbs({ photos, size = 40 }) {
  const [viewer, setViewer] = useState(null);
  const list = (photos || []).filter((p) => p?.url);
  if (!list.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {list.map((p, i) => (
          <button
            key={p.path || i}
            type="button"
            onClick={() => setViewer(p.url)}
            title="Tap to view"
            aria-label={`View photo ${i + 1}`}
            className="rounded border border-gray-300 dark:border-gray-600 overflow-hidden block shrink-0"
            style={{ width: size, height: size }}
          >
            <img src={p.url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      {viewer && (
        <div
          onClick={() => setViewer(null)}
          className="fixed inset-0 z-[3000] bg-black/90 flex items-center justify-center p-3"
          role="dialog"
          aria-modal="true"
        >
          <img src={viewer} alt="" className="max-w-full max-h-full object-contain" />
          <button
            type="button"
            onClick={() => setViewer(null)}
            aria-label="Close photo"
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/90 text-gray-900 text-xl font-bold"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
