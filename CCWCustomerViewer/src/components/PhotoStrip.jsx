// src/components/PhotoStrip.jsx
// Read-only thumbnail row that opens photos in the in-app Lightbox.
// Replaces four near-identical <a target="_blank"> blocks (HeadCard, IssueList,
// and both render paths in OfflineHeadsDashboard) — two of which were calling
// safeUrl() without importing it, which crashed the view.
import { useState } from 'react';
import Lightbox from './Lightbox';
import { safeUrl } from '../utils/safeUrl';

const PhotoStrip = ({ photos, label = 'Photo', size = 64 }) => {
  const [viewer, setViewer] = useState(null);
  const shots = (photos || []).filter((p) => p?.url);
  if (shots.length === 0) return null;

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mt-2">
        {shots.map((photo, idx) => (
          <button
            key={photo.path || idx}
            type="button"
            onClick={() => setViewer(safeUrl(photo.url))}
            title="Tap to view full size"
            aria-label={`View ${label.toLowerCase()} ${idx + 1} full size`}
            className="photo-thumb-btn"
            style={{ width: `${size}px`, height: `${size}px` }}
          >
            <img
              src={photo.url}
              alt={`${label} ${idx + 1}`}
              loading="lazy"
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                borderRadius: '6px', display: 'block',
              }}
            />
          </button>
        ))}
      </div>
      {viewer && <Lightbox url={viewer} onClose={() => setViewer(null)} />}
    </>
  );
};

export default PhotoStrip;
