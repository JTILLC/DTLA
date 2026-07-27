// src/components/PhotoStrip.jsx
// Read-only thumbnail row that opens photos in the in-app Lightbox.
// Replaces four near-identical <a target="_blank"> blocks (HeadCard, IssueList,
// and both render paths in OfflineHeadsDashboard) — two of which were calling
// safeUrl() without importing it, which crashed the view.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import Lightbox from './Lightbox';
import { safeUrl } from '../utils/safeUrl';
import { mediaUrl } from '../config/media';

const PhotoStrip = ({ photos, label = 'Photo', size = 64 }) => {
  // The share token doubles as the media authorisation, so read it from the
  // route rather than threading it through every caller.
  const { token } = useParams();
  const [viewer, setViewer] = useState(null);
  // Accept path-only photos: uploads now strip the public download token, so
  // new photos have no `url` at all and are served through the broker.
  const shots = (photos || []).filter((p) => p?.url || p?.path);
  if (shots.length === 0) return null;

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mt-2">
        {shots.map((photo, idx) => (
          <button
            key={photo.path || idx}
            type="button"
            onClick={() => setViewer(safeUrl(mediaUrl(photo, token)))}
            title="Tap to view full size"
            aria-label={`View ${label.toLowerCase()} ${idx + 1} full size`}
            className="photo-thumb-btn"
            style={{ width: `${size}px`, height: `${size}px` }}
          >
            <img
              src={safeUrl(mediaUrl(photo, token))}
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
