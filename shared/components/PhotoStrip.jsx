// shared/components/PhotoStrip.jsx
//
// A few photos attached to one record — take, look at, remove.
//
// Built for pre-start checks, where a photo is the difference between "problem"
// and a maintenance visit that knows what it is walking to. Kept general: it
// takes a list of { path } and hands back a new list.
//
// Served through the media broker, never by public URL, like every other
// photograph of a customer's equipment in these apps.
import { useRef, useState } from 'react';
import { Camera, X, Loader } from 'lucide-react';
import { uploadPhoto, deletePhoto } from '../utils/photoUpload.js';
import { useAuthedMedia } from '../utils/useAuthedMedia.js';
import { useToast } from './Toast.jsx';

export default function PhotoStrip({
  photos = [],
  onChange,
  pathPrefix,
  readOnly = false,
  max = 4,
  label = 'Add photo',
  size = 56,
}) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const urls = useAuthedMedia(photos);

  const pick = async (e) => {
    const files = [...(e.target.files || [])];
    if (inputRef.current) inputRef.current.value = '';
    if (!files.length) return;
    const room = max - photos.length;
    if (room <= 0) return toast.error(`That's the limit of ${max} photos.`);

    setBusy(true);
    const added = [];
    for (const file of files.slice(0, room)) {
      try {
        added.push(await uploadPhoto(pathPrefix, file));
      } catch (err) {
        // One bad photo must not lose the others already uploaded.
        console.error('Photo upload failed:', err);
        toast.error(err?.message || 'Upload failed');
      }
    }
    setBusy(false);
    if (added.length) {
      onChange([...photos, ...added]);
      if (files.length > room) toast.info(`Added ${added.length} — ${max} is the limit.`);
    }
  };

  const remove = async (photo) => {
    onChange(photos.filter((p) => p !== photo));
    await deletePhoto(photo?.path);
  };

  if (readOnly && photos.length === 0) return null;

  return (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      {photos.map((p, i) => {
        const src = urls[p.path] || p.url;
        return (
          <span key={p.path || i} className="position-relative d-inline-block" style={{ width: size, height: size }}>
            {src ? (
              <a href={src} target="_blank" rel="noreferrer">
                <img
                  src={src}
                  alt={`Photo ${i + 1}`}
                  style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6 }}
                />
              </a>
            ) : (
              <span className="d-inline-flex align-items-center justify-content-center border rounded"
                    style={{ width: size, height: size }}>
                <Loader size={14} className="text-muted" />
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                className="btn btn-sm btn-danger position-absolute top-0 end-0 p-0 lh-1"
                style={{ width: 18, height: 18, transform: 'translate(35%,-35%)' }}
                onClick={() => remove(p)}
                aria-label={`Remove photo ${i + 1}`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        );
      })}

      {!readOnly && photos.length < max && (
        <>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Camera size={14} /> {busy ? 'Uploading…' : label}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            // `capture` is deliberately absent: on a phone this still offers the
            // camera, but it also allows a photo taken a minute ago on the way
            // back from the machine. Forcing live capture only loses those.
            multiple
            className="d-none"
            onChange={pick}
          />
        </>
      )}
    </div>
  );
}
