// src/components/IssuePhotos.jsx
// Photo capture/view/delete. Photos live in Firebase Storage; the returned
// {url, path} objects are stored (on an issue or a head) and persisted with the
// visit via the app's normal autosave. Tapping a thumbnail opens an in-app
// full-screen viewer (more reliable on mobile than opening a new tab).
import { useEffect, useRef, useState } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/storage';
import { Camera, Loader } from 'lucide-react';
import { useToast } from './Toast.jsx';
import photoQueue from '../utils/photoQueue.js';
import { useAuthedMedia } from '../utils/useAuthedMedia.js';

const MAX_DIM = 1600;      // longest edge after downscale
// No bytes moved for this long => treat as no signal and queue it instead.
const STALL_MS = 12000;
const JPEG_QUALITY = 0.8;

// Downscale large phone photos before upload to keep uploads fast and storage
// small — and, importantly, to normalise HEIC to JPEG.
//
// iOS shoots HEIC by default. Safari can decode it, so the canvas re-encode
// below turns it into a JPEG everything can display. Other browsers CANNOT
// decode HEIC: the old code resolved with the original file on decode failure,
// which uploaded HEIC bytes labelled `image/jpeg` — an image no browser could
// ever render. Resolving null instead lets the caller reject the file with an
// explanation rather than silently storing something unviewable.
const compressImage = (file) =>
  new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      if (scale === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob || file),
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      // Could not decode — most often HEIC in a non-Safari browser.
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });

// Full-screen photo viewer. position:fixed + pointerEvents:auto so it works
// even inside a read-only (pointer-events:none) area.
const Lightbox = ({ url, onClose }) => (
  <div
    onClick={onClose}
    style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px',
      pointerEvents: 'auto',
    }}
  >
    <img src={url} alt="Photo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      style={{
        position: 'absolute', top: '14px', right: '14px', width: '40px', height: '40px',
        borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)',
        color: '#111', fontSize: '20px', fontWeight: 'bold', cursor: 'pointer',
      }}
    >✕</button>
  </div>
);

const IssuePhotos = ({ photos = [], onChange, pathBase, docPath, disabled, disabledReason, isDark }) => {
  const toast = useToast();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewer, setViewer] = useState(null);
  // Local object URLs for photos still sitting in the offline queue, keyed by
  // pendingId, so a queued photo still shows a thumbnail — including after a
  // reload, since the blob itself is persisted in IndexedDB.
  const [pendingUrls, setPendingUrls] = useState({});
  // Resolves stored photos to displayable URLs, fetching through the media
  // broker with the signed-in user's ID token once objects lose their public
  // download token.
  const { srcFor } = useAuthedMedia(photos);

  const pendingIds = (photos || []).filter((p) => p?.pendingId).map((p) => p.pendingId).join(',');
  useEffect(() => {
    let cancelled = false;
    const urls = [];
    if (!pendingIds) { setPendingUrls({}); return undefined; }
    photoQueue.all().then((entries) => {
      if (cancelled) return;
      const map = {};
      entries.forEach((entry) => {
        if (pendingIds.split(',').includes(entry.id)) {
          const url = URL.createObjectURL(entry.blob);
          urls.push(url);
          map[entry.id] = url;
        }
      });
      setPendingUrls(map);
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [pendingIds]);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (inputRef.current) inputRef.current.value = '';
    if (!files.length) return;

    if (disabled) {
      toast.error(disabledReason || 'Save the visit first before adding photos');
      return;
    }

    setUploading(true);
    const added = [];
    let queued = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(0);
        // eslint-disable-next-line no-await-in-loop
        const blob = await compressImage(files[i]);
        if (!blob) {
          toast.error(
            `Couldn't read "${files[i].name}". If it's a HEIC photo, open it on ` +
            `your phone or save it as JPEG first.`
          );
          continue;
        }
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // No signal? Park it rather than failing — this is the plant-floor case.
        if (!navigator.onLine) {
          // eslint-disable-next-line no-await-in-loop
          await photoQueue.add({ id, blob, pathBase, docPath, createdAt: Date.now() });
          added.push({ pendingId: id });
          queued += 1;
          continue;
        }

        const path = `${pathBase}/${id}.jpg`;
        const ref = firebase.storage().ref().child(path);
        const task = ref.put(blob, { contentType: 'image/jpeg' });
        try {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve, reject) => {
            // navigator.onLine lies in the case that matters most: connected to
            // plant wifi with no route out, or signal so weak nothing moves. Give
            // up if no BYTES move for STALL_MS (the timer resets on real
            // progress, so a slow upload still completes) and let the photo fall
            // through to the offline queue instead of spinning at 0%.
            let settled = false;
            let lastBytes = -1;
            let timer;
            const finish = (fn, arg) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              fn(arg);
            };
            const arm = () => {
              clearTimeout(timer);
              timer = setTimeout(() => {
                try { task.cancel(); } catch { /* already finished */ }
                finish(reject, new Error('Upload stalled — no signal'));
              }, STALL_MS);
            };
            arm();
            task.on(
              'state_changed',
              (snap) => {
                if (snap.bytesTransferred !== lastBytes) {
                  lastBytes = snap.bytesTransferred;
                  arm();   // real progress — reset the stall clock
                }
                setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
              },
              (err) => finish(reject, err),
              () => finish(resolve)
            );
          });
          // Firebase mints a PUBLIC download token for every upload, and those
          // tokenized URLs bypass Storage security rules entirely. Strip it so
          // the object is only reachable through the media broker, which
          // re-checks the share (or the user's claims) on every request.
          // Best-effort: if it fails the photo is still saved, just public — far
          // better than losing a tech's photo over a metadata call.
          try {
            // eslint-disable-next-line no-await-in-loop
            await task.snapshot.ref.updateMetadata({
              customMetadata: { firebaseStorageDownloadTokens: '' },
            });
          } catch (metaErr) {
            console.warn('Could not revoke public token for', path, metaErr?.message || metaErr);
          }
          added.push({ path });
        } catch (uploadErr) {
          // Signal dropped mid-upload, or Storage rejected it. Queue and retry
          // on reconnect instead of losing the photo.
          console.warn('Upload failed, queueing for retry:', uploadErr?.message || uploadErr);
          // eslint-disable-next-line no-await-in-loop
          await photoQueue.add({ id, blob, pathBase, docPath, createdAt: Date.now() });
          added.push({ pendingId: id });
          queued += 1;
        }
      }

      onChange([...(photos || []), ...added]);
      if (queued > 0) {
        toast.info(
          queued === added.length
            ? `${queued} photo${queued > 1 ? 's' : ''} saved on this device — ${queued > 1 ? 'they' : 'it'} will upload when you're back online.`
            : `${added.length - queued} uploaded, ${queued} saved for when you're back online.`
        );
      } else {
        toast.success(added.length > 1 ? `${added.length} photos added` : 'Photo added');
      }
    } catch (err) {
      console.error('Photo capture error:', err);
      toast.error('Failed to add photo: ' + (err?.message || 'unknown error'));
      if (added.length) onChange([...(photos || []), ...added]);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDelete = async (idx) => {
    const photo = photos[idx];
    // Remove immediately; best-effort delete from Storage.
    onChange(photos.filter((_, j) => j !== idx));
    // Still queued locally — drop it from the queue so it never uploads.
    if (photo?.pendingId) {
      try { await photoQueue.remove(photo.pendingId); } catch { /* best effort */ }
      return;
    }
    if (photo?.path) {
      try {
        await firebase.storage().ref().child(photo.path).delete();
      } catch (e) {
        console.log('Photo may not exist in storage:', e);
      }
    }
  };

  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        {(photos || []).map((photo, idx) => {
          // A queued photo has no URL yet — preview it from the IndexedDB blob
          // and mark it so the tech knows it hasn't reached the cloud.
          const isPending = !!photo?.pendingId;
          const src = srcFor(photo, pendingUrls);
          return (
          <div key={photo.path || photo.pendingId || idx} style={{ position: 'relative', width: '56px', height: '56px' }}>
            <button
              type="button"
              className="photo-thumb-btn"
              onClick={() => src && setViewer(src)}
              title={isPending ? 'Waiting to upload' : 'Tap to view'}
              aria-label={isPending ? `Photo ${idx + 1}, waiting to upload` : `View photo ${idx + 1} full size`}
              style={{
                width: '56px', height: '56px',
                pointerEvents: 'auto', // viewable even inside a read-only area
                opacity: isPending ? 0.65 : 1,
              }}
            >
              {src ? (
                <img
                  src={src}
                  alt={`Photo ${idx + 1}`}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <span style={{ fontSize: '10px', color: '#666' }}>…</span>
              )}
            </button>
            {isPending && (
              <span
                title="Waiting for signal — will upload automatically"
                style={{
                  position: 'absolute', bottom: '-3px', left: '-3px',
                  fontSize: '9px', lineHeight: 1, padding: '2px 4px', borderRadius: '999px',
                  background: '#f59e0b', color: '#1f2937', fontWeight: 700,
                  border: '1px solid #fff',
                }}
              >queued</span>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={() => handleDelete(idx)}
                title="Remove photo"
                style={{
                  position: 'absolute', top: '-5px', right: '-5px', width: '16px', height: '16px',
                  minWidth: '16px', minHeight: '16px', padding: 0, margin: 0, lineHeight: '14px',
                  fontSize: '9px', fontWeight: 'bold', color: '#fff', background: '#dc3545',
                  border: '1px solid #fff', borderRadius: '50%', boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
                  cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box',
                  appearance: 'none', WebkitAppearance: 'none',
                }}
              >✕</button>
            )}
          </div>
          );
        })}

        {uploading ? (
          <span className="d-inline-flex align-items-center gap-1 text-muted" style={{ fontSize: '0.8rem' }}>
            <Loader size={14} className="spinner-border spinner-border-sm" />
            Uploading… {progress}%
          </span>
        ) : (
          <label
            className="btn btn-sm btn-outline-secondary mb-0"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: disabled ? 0.6 : 1 }}
            title={disabled ? (disabledReason || 'Save the visit first') : 'Add a photo'}
          >
            <Camera size={14} />
            Photo
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFiles}
              style={{ display: 'none' }}
            />
          </label>
        )}
      </div>

      {viewer && <Lightbox url={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
};

export default IssuePhotos;
