// src/components/logger/Photos.jsx
//
// Photo capture/view/delete for the Shearers logger. Used per issue and next to
// a line's general notes; both allow multiple photos.
//
// This is deliberately SIMPLE compared with the CCW apps' media broker. This is
// a separate Firebase project used by two people, so photos are uploaded to
// Storage and rendered from their download URL. No broker, no custom claims.
//
// Two lessons carried over from CCW, because they were real bugs there:
//   * phone photos are huge — downscale before upload or a stint's worth of
//     images makes the app crawl on cellular;
//   * iOS shoots HEIC, which only Safari can decode. Uploading an undecodable
//     file "successfully" stores bytes nothing can ever render, so a file that
//     won't decode is rejected with an explanation instead.
import React, { useRef, useState } from 'react';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from '../../firebaseConfig';
import { useToast } from '../../context/ToastContext';
import { saveThumb } from '../../services/photoThumbs';

// Matches how the rest of this codebase gets its Firebase services
// (each module calls getDatabase(app) / getAuth(app) locally).
const storage = getStorage(app);

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.8;

// Downscale + normalise to JPEG. Resolves null if the browser can't decode it.
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
      canvas.toBlob((blob) => resolve(blob || null), 'image/jpeg', JPEG_QUALITY);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);   // most often HEIC outside Safari
      resolve(null);
    };
    img.src = url;
  });

// A tiny copy of the photo for the daily PDF, made here because the bytes are
// already in memory. Stored in its own database node rather than on the entry —
// see services/photoThumbs for why. Small on purpose: ~10KB, against the 1600px
// original in Storage that remains the source of truth for viewing.
const THUMB_DIM = 320;
const THUMB_QUALITY = 0.7;

const makeThumb = (blob) =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    img.onload = () => {
      try {
        const scale = Math.min(1, THUMB_DIM / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
      } catch { done(''); }        // never block an upload over a thumbnail
    };
    img.onerror = () => done('');
    img.src = url;
  });

// Full-screen viewer. Tap anywhere to close.
const Lightbox = ({ url, onClose }) => (
  <div
    onClick={onClose}
    className="fixed inset-0 z-[3000] bg-black/90 flex items-center justify-center p-3"
    role="dialog"
    aria-modal="true"
  >
    <img src={url} alt="" className="max-w-full max-h-full object-contain" />
    <button
      type="button"
      onClick={onClose}
      aria-label="Close photo"
      className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/90 text-gray-900 text-xl font-bold"
    >
      ✕
    </button>
  </div>
);

export default function Photos({ photos, onChange, pathPrefix, disabled, label = 'Photo' }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(null);
  const list = photos || [];

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (inputRef.current) inputRef.current.value = '';   // allow re-picking the same file
    if (!files.length) return;

    setBusy(true);
    const added = [];
    try {
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const blob = await compressImage(file);
        if (!blob) {
          toast.error(`Couldn't read "${file.name}". If it's a HEIC photo, save it as JPEG first.`);
          continue;
        }
        const path = `${pathPrefix}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const sRef = storageRef(storage, path);
        // eslint-disable-next-line no-await-in-loop
        await uploadBytes(sRef, blob, { contentType: 'image/jpeg' });
        // eslint-disable-next-line no-await-in-loop
        const url = await getDownloadURL(sRef);
        // Kept in its own node, not on the entry: see services/photoThumbs.
        // eslint-disable-next-line no-await-in-loop
        await saveThumb(path, await makeThumb(blob));
        added.push({ url, path });
      }
      if (added.length) {
        onChange([...list, ...added]);
        toast.success(added.length > 1 ? `${added.length} photos added` : 'Photo added');
      }
    } catch (err) {
      console.error('Photo upload failed:', err);
      toast.error('Upload failed: ' + (err?.message || 'unknown error'));
      if (added.length) onChange([...list, ...added]);   // keep whatever did land
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (idx) => {
    const photo = list[idx];
    onChange(list.filter((_, i) => i !== idx));   // remove from the log immediately
    if (photo?.path) {
      try {
        await deleteObject(storageRef(storage, photo.path));
      } catch (err) {
        // The reference is already gone from the log; a leftover file is
        // harmless and shouldn't surface as an error to the user.
        console.warn('Could not delete stored photo:', err?.message || err);
      }
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {list.map((photo, idx) => (
        <div key={photo.path || idx} className="relative w-14 h-14">
          <button
            type="button"
            onClick={() => setViewer(photo.url)}
            className="w-14 h-14 rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 block"
            title="Tap to view"
            aria-label={`View ${label.toLowerCase()} ${idx + 1}`}
          >
            <img src={photo.url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
          {!disabled && (
            <button
              type="button"
              onClick={() => handleDelete(idx)}
              aria-label={`Remove ${label.toLowerCase()} ${idx + 1}`}
              title="Remove photo"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold leading-none border border-white shadow"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {!disabled && (
        <label
          className={`btn-secondary !px-3 !py-2 text-sm cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}
          title="Add a photo"
        >
          {busy ? 'Uploading…' : '📷 Photo'}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFiles}
            className="hidden"
          />
        </label>
      )}

      {viewer && <Lightbox url={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
