import React, { useEffect, useRef, useState } from 'react';
import { straighten, guessCorners, SCREEN_W, SCREEN_H } from '../utils/perspective';
import { scanRcuScreen, canvasToJpeg } from '../utils/scan';

/**
 * A screen photographed on site.
 *
 * This is the path for every RCU generation whose artwork we do not hold —
 * which is most of the newer units. The photo is straightened into something
 * that reads like a screen capture, and its values are listed beside it.
 *
 * The corner handles are always shown and always draggable. Auto-detection is
 * a suggestion: a reflection on the bezel or a lit machine behind the unit
 * pulls a corner, and a corner out by a few percent skews every value on the
 * page. Nothing here decides on the engineer's behalf.
 */
export default function PhotoScreen({ section, onChange, onRemove, getIdToken, readerReady, readerHint }) {
  const [photo, setPhoto] = useState(null);         // the original, as an Image
  const [corners, setCorners] = useState(null);
  const [dragging, setDragging] = useState(-1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const boxRef = useRef(null);

  // HEIC is what an iPhone shoots by default and no browser decodes it in a
  // canvas, so say why rather than showing an empty frame.
  const openFile = (file) => {
    setError('');
    if (!file) return;
    if (/\.hei[cf]$/i.test(file.name) && !file.type.startsWith('image/')) {
      setError('This looks like a HEIC photo. Share it as JPEG, or use the phone camera here.');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPhoto(img);
      setCorners(guessCorners(img) || [
        [img.width * 0.1, img.height * 0.1], [img.width * 0.9, img.height * 0.1],
        [img.width * 0.9, img.height * 0.9], [img.width * 0.1, img.height * 0.9],
      ]);
    };
    img.onerror = () => setError('Could not open that image.');
    img.src = url;
  };

  const apply = () => {
    if (!photo || !corners) return;
    const canvas = straighten(photo, corners, SCREEN_W, SCREEN_H);
    onChange({ ...section, image: canvas.toDataURL('image/jpeg', 0.9) });
    setPhoto(null);
    setCorners(null);
  };

  const read = async () => {
    if (!section.image) return;
    setBusy('Reading the screen…');
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SCREEN_W;
      canvas.height = SCREEN_H;
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0); resolve(); };
        img.onerror = reject;
        img.src = section.image;
      });
      const blob = await canvasToJpeg(canvas);
      const result = await scanRcuScreen(blob, getIdToken);
      onChange({
        ...section,
        title: section.title || result.screenTitle || 'Photographed screen',
        activeTab: result.activeTab || '',
        fields: result.fields || [],
        notes: result.notes || '',
        source: 'photo',
      });
    } catch (err) {
      setError(err.message || 'Could not read the screen.');
    } finally {
      setBusy('');
    }
  };

  // Corner dragging, in the photo's own coordinates.
  const toPhoto = (event) => {
    const rect = boxRef.current.getBoundingClientRect();
    const point = event.touches?.[0] || event;
    return [
      ((point.clientX - rect.left) / rect.width) * photo.width,
      ((point.clientY - rect.top) / rect.height) * photo.height,
    ];
  };
  const onMove = (event) => {
    if (dragging < 0 || !photo) return;
    event.preventDefault();
    const next = corners.map((c, i) => (i === dragging ? toPhoto(event) : c));
    setCorners(next);
  };

  useEffect(() => {
    const stop = () => setDragging(-1);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
    return () => {
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchend', stop);
    };
  }, []);

  const setField = (i, patch) => {
    const fields = (section.fields || []).map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange({ ...section, fields });
  };

  return (
    <section className="card p-4 mb-4" id={section.id}>
      <header className="flex items-start justify-between gap-3 mb-3">
        <input
          className="field font-semibold"
          style={{ maxWidth: '22rem' }}
          value={section.title || ''}
          placeholder="Screen name, e.g. Various Parameter Setting"
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
        <button type="button" className="btn" onClick={onRemove}>Remove</button>
      </header>

      {!section.image && !photo && (
        <label className="btn">
          Choose a photo
          <input
            type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => openFile(e.target.files?.[0])}
          />
        </label>
      )}

      {photo && (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
            Drag the four handles onto the corners of the screen itself, then straighten.
          </p>
          <div
            ref={boxRef}
            className="relative inline-block max-w-full select-none touch-none"
            onMouseMove={onMove}
            onTouchMove={onMove}
          >
            <img src={photo.src} alt="" className="max-w-full h-auto block" />
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox={`0 0 ${photo.width} ${photo.height}`}
              preserveAspectRatio="none"
            >
              <polygon
                points={corners.map((c) => c.join(',')).join(' ')}
                fill="rgba(29,78,216,0.15)" stroke="#1d4ed8"
                strokeWidth={Math.max(2, photo.width / 300)}
              />
              {corners.map((c, i) => (
                <circle
                  key={i} cx={c[0]} cy={c[1]} r={Math.max(10, photo.width / 60)}
                  fill="#1d4ed8" stroke="#fff" strokeWidth={Math.max(2, photo.width / 400)}
                  style={{ cursor: 'grab' }}
                  onMouseDown={() => setDragging(i)}
                  onTouchStart={() => setDragging(i)}
                />
              ))}
            </svg>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary" onClick={apply}>Straighten</button>
            <button type="button" className="btn" onClick={() => { setPhoto(null); setCorners(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(section.image || section.fields?.length > 0) && (
        <div className={section.image ? 'grid gap-4 lg:grid-cols-2' : ''}>
          {section.image && <div>
            <img
              src={section.image} alt={section.title || 'RCU screen'}
              className="w-full h-auto rounded border" style={{ borderColor: 'var(--border)' }}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button" className="btn btn-primary"
                onClick={read} disabled={!!busy || !readerReady}
              >
                {busy || 'Read the settings'}
              </button>
              <label className="btn">
                Replace photo
                <input
                  type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => openFile(e.target.files?.[0])}
                />
              </label>
              <button
                type="button" className="btn"
                onClick={() => onChange({
                  ...section,
                  fields: [...(section.fields || []), { label: '', value: '', confident: true }],
                  source: section.source === 'photo' ? 'photo' : 'typed',
                })}
              >
                Add a setting
              </button>
            </div>
            {!readerReady && readerHint && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {readerHint} You can still type the settings in below.
              </p>
            )}
            {error && <p className="text-sm mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
            {section.notes && (
              <p className="text-xs mt-2" style={{ color: 'var(--warn)' }}>{section.notes}</p>
            )}
          </div>}

          <div>
            <p className="field-label">
              {section.image ? 'Settings on this screen' : 'Settings'}
              {!section.image && section.source === 'imported' && (
                <span className="chip ml-2">read from the machine's export</span>
              )}
            </p>
            {!section.fields?.length && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Nothing recorded yet.
              </p>
            )}
            {(section.fields || []).map((field, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input
                  className="field" style={{ flex: 2 }} value={field.label}
                  placeholder="Setting name, exactly as printed"
                  onChange={(e) => setField(i, { label: e.target.value })}
                />
                <input
                  className="field" style={{ flex: 1 }} value={field.value}
                  placeholder="Value"
                  onChange={(e) => setField(i, { value: e.target.value, confident: true })}
                />
                {field.confident === false && (
                  <span className="chip" style={{ color: 'var(--warn)' }} title="The reader was unsure — check this one">
                    check
                  </span>
                )}
                <button
                  type="button" className="btn"
                  onClick={() => onChange({
                    ...section, fields: section.fields.filter((_, idx) => idx !== i),
                  })}
                >
                  ×
                </button>
              </div>
            ))}
            {!section.image && (
              <button
                type="button" className="btn mt-1"
                onClick={() => onChange({
                  ...section,
                  fields: [...(section.fields || []), { label: '', value: '', confident: true }],
                })}
              >
                Add a setting
              </button>
            )}
            {section.fields?.some((f) => f.confident === false) && (
              <p className="text-xs" style={{ color: 'var(--warn)' }}>
                Values marked “check” were read but not with confidence. Confirm them
                against the machine before this goes to the customer.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
