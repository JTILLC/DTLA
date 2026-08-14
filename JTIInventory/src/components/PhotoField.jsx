import { useRef, useState, useEffect } from 'react';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Camera, Trash2 } from 'lucide-react';
import { storage } from '../config/firebase';
import { resizeImage, UnsupportedImageError } from '../utils/resizeImage';

/**
 * Photo picker + uploader. Resizes client-side, uploads to Storage, and
 * returns {photoUrl, photoPath} so the caller can persist it on the record.
 *
 * Props:
 * - value: { photoUrl, photoPath }
 * - onChange: ({photoUrl, photoPath}) => void
 * - uploadPath: string (Storage folder prefix, e.g. `user_files/<uid>/inventory-photos`)
 * - onOpen: (url) => void  (open lightbox)
 * - onError: (message) => void
 * - onUploadingChange: (bool) => void  (so the parent form can block Save during upload)
 */
export default function PhotoField({ value, onChange, uploadPath, onOpen, onError, onUploadingChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  // Keep parent informed while we're in-flight
  useEffect(() => { onUploadingChange?.(busy); }, [busy, onUploadingChange]);

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      let resized;
      try {
        resized = await resizeImage(file);
      } catch (err) {
        if (err instanceof UnsupportedImageError) {
          // Surface the friendly message, skip upload entirely
          onError?.(err.message);
          return;
        }
        throw err;
      }

      const safeName = (resized.name || 'photo.jpg').replace(/[^a-z0-9._-]/gi, '_');
      const path = `${uploadPath}/${Date.now()}-${safeName}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, resized, { contentType: resized.type || 'image/jpeg' });
      const url = await getDownloadURL(ref);
      console.log('[PhotoField] uploaded', { path, url });

      // If replacing, fire-and-forget delete of previous photo
      if (value?.photoPath) {
        deleteObject(storageRef(storage, value.photoPath)).catch(() => {});
      }

      onChange({ photoUrl: url, photoPath: path });
    } catch (err) {
      console.error(err);
      onError?.(err?.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = () => {
    if (value?.photoPath) {
      deleteObject(storageRef(storage, value.photoPath)).catch(() => {});
    }
    onChange({ photoUrl: null, photoPath: null });
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {value?.photoUrl ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src={value.photoUrl}
            alt="Part photo"
            onClick={() => onOpen?.(value.photoUrl)}
            style={{
              width: 96,
              height: 96,
              objectFit: 'cover',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              cursor: 'zoom-in',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              onClick={handlePick}
              className="btn btn-outline-secondary btn-sm"
              disabled={busy}
            >
              <Camera size={14} /> {busy ? 'Uploading…' : 'Replace'}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className="btn btn-outline-danger btn-sm"
              disabled={busy}
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handlePick}
          className="btn btn-outline-secondary btn-sm"
          disabled={busy}
        >
          <Camera size={14} /> {busy ? 'Uploading…' : 'Add photo'}
        </button>
      )}
    </div>
  );
}
