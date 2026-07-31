// src/components/ReferenceImage.jsx
//
// One reference photo attached to a PM checklist item — "this is what to look
// at". Uploaded by whoever maintains the checklist; operators see it read-only
// while filling the check in.
//
// Served through the media broker like the rest of CCW media rather than by a
// public URL: these are photographs of a customer's equipment, and carving out
// a public exception for them would undo the point of the broker. The upload
// therefore strips the auto-created download token, exactly as issue photos do.
import { useEffect, useRef, useState } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/storage';
import { Camera, X } from 'lucide-react';
import { fetchAuthedMedia, usingBroker } from '../config/media.js';
import { useToast } from './Toast.jsx';

const MAX_DIM = 1400;
const JPEG_QUALITY = 0.8;

// Same normalise-and-shrink as issue photos: iOS shoots HEIC, which only Safari
// decodes, so anything that won't decode is rejected rather than stored as bytes
// nothing can render.
const compressImage = (file) =>
  new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b || null), 'image/jpeg', JPEG_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });

export default function ReferenceImage({ image, onChange, pathPrefix, readOnly = false, size = 56 }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(false);

  // Resolve the stored path to something displayable.
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    if (!image?.path) { setSrc(''); return undefined; }
    if (!usingBroker()) { setSrc(image.url || ''); return undefined; }
    fetchAuthedMedia(image.path)
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        objectUrl = u;
        setSrc(u);
      })
      .catch((err) => {
        console.warn('Reference image fetch failed:', err?.message || err);
        if (!cancelled && image.url) setSrc(image.url);   // legacy fallback
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image?.path, image?.url]);

  const pick = async (e) => {
    const file = (e.target.files || [])[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImage(file);
      if (!blob) {
        toast.error(`Couldn't read "${file.name}". If it's a HEIC photo, save it as JPEG first.`);
        return;
      }
      const path = `${pathPrefix}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
      const ref = firebase.storage().ref().child(path);
      await ref.put(blob, { contentType: 'image/jpeg' });
      // Strip the public download token so the object is broker-only.
      try {
        await ref.updateMetadata({ customMetadata: { firebaseStorageDownloadTokens: '' } });
      } catch (metaErr) {
        console.warn('Could not revoke public token:', metaErr?.message || metaErr);
      }
      onChange({ path });
      toast.success('Reference image added');
    } catch (err) {
      console.error('Reference image upload failed:', err);
      toast.error('Upload failed: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const path = image?.path;
    onChange(null);
    if (path) {
      try {
        await firebase.storage().ref().child(path).delete();
      } catch (err) {
        console.warn('Could not delete reference image:', err?.message || err);
      }
    }
  };

  if (!image?.path && readOnly) return null;

  return (
    <span className="d-inline-flex align-items-center gap-1">
      {image?.path ? (
        <span className="position-relative d-inline-block" style={{ width: size, height: size }}>
          <button
            type="button"
            className="photo-thumb-btn"
            style={{ width: size, height: size }}
            onClick={() => src && setViewer(true)}
            title="Reference photo — tap to enlarge"
            aria-label="View reference photo"
          >
            {src
              ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <span style={{ fontSize: '10px', color: '#888' }}>…</span>}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={clear}
              aria-label="Remove reference photo"
              title="Remove"
              style={{
                position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px',
                minWidth: '18px', minHeight: '18px', padding: 0, lineHeight: '16px', fontSize: '10px',
                fontWeight: 'bold', color: '#fff', background: '#dc3545', border: '1px solid #fff',
                borderRadius: '50%', cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box',
                appearance: 'none', WebkitAppearance: 'none',
              }}
            >×</button>
          )}
        </span>
      ) : (
        !readOnly && (
          <label className="btn btn-sm btn-outline-secondary mb-0" title="Add a reference photo">
            <Camera size={14} /> {busy ? 'Uploading…' : 'Photo'}
            <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
          </label>
        )
      )}

      {viewer && src && (
        <span
          onClick={() => setViewer(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 3000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px',
          }}
        >
          <img src={src} alt="Reference" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          <button
            type="button"
            onClick={() => setViewer(false)}
            aria-label="Close"
            style={{
              position: 'absolute', top: '14px', right: '14px', width: '44px', height: '44px',
              borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)',
              color: '#111', fontSize: '20px', fontWeight: 'bold', cursor: 'pointer',
            }}
          >✕</button>
        </span>
      )}
    </span>
  );
}
