import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getSavedSignatures, fetchSignatures, saveSignature, deleteSignature } from './signatureStore';

const CURSIVE = "'Snell Roundhand','Brush Script MT','Segoe Script',cursive";

// Crop a canvas down to the bounding box of its non-transparent pixels so the
// saved signature is tight (looks right when stretched into the PDF box).
function trimToInk(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  const pad = 12;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w, maxX + pad); maxY = Math.min(h, maxY + pad);
  const cropW = maxX - minX, cropH = maxY - minY;
  // Downscale so the stored signature stays small (it's only shown ~48mm wide in
  // the PDF). The full-screen pad captures at full device resolution otherwise,
  // which bloats the PDF and the cloud-synced payload to several MB.
  const MAXW = 600;
  const scale = Math.min(1, MAXW / cropW);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cropW * scale));
  out.height = Math.max(1, Math.round(cropH * scale));
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

// Full-screen drawing overlay — uses the entire device screen to sign.
function FullscreenPad({ onSave, onCancel }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    // Size the backing store to the displayed size; preserve any existing ink
    // across rotation by snapshotting and redrawing. Coordinates are mapped by
    // ratio per-touch (below), so the bitmap size never has to match CSS exactly.
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const snap = (c.width && drew.current) ? c.toDataURL('image/png') : null;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext('2d');
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000';
      if (snap) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height); img.src = snap; }
    };
    fit();
    const onResize = () => fit();
    // iOS fires events before layout settles — re-measure a couple times after.
    const onOrient = () => { setTimeout(fit, 150); setTimeout(fit, 400); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrient);
    const vv = window.visualViewport;
    if (vv) vv.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrient);
      if (vv) vv.removeEventListener('resize', onResize);
    };
  }, []);

  // Map the touch/mouse point into backing-store pixels using the CURRENT rect,
  // so the stroke always lands exactly under the finger even right after a rotate.
  const point = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: cx * (c.width / r.width), y: cy * (c.height / r.height) };
  };
  const lineW = () => 2.5 * (window.devicePixelRatio || 1);
  const start = (e) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e); ctx.lineWidth = lineW(); ctx.lineTo(x, y); ctx.stroke(); drew.current = true; };
  const end = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); drew.current = false; };
  const save = () => onSave(drew.current ? trimToInk(canvasRef.current) : null);

  return createPortal(
    <div className="sigfs" ref={wrapRef}>
      <div className="sigfs-bar">
        <button type="button" className="btn sigfs-cancel" onClick={onCancel}>✕ Cancel</button>
        <span className="sigfs-hint">Rotate to landscape &amp; sign</span>
        <span className="sigfs-actions">
          <button type="button" className="btn ghost" onClick={clear}>Clear</button>
          <button type="button" className="btn primary" onClick={save}>Save</button>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="sigfs-canvas"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <div className="sigfs-line">Sign above the line</div>
    </div>,
    document.body
  );
}

// Signature input: type a name (rendered in a signature font) or draw it.
// Emits a transparent PNG data URL (or null) via onChange. `value` is the current image.
export default function SignatureField({ label, value, onChange }) {
  const [mode, setMode] = useState('type');
  const [text, setText] = useState('');
  const [full, setFull] = useState(false);
  const [saved, setSaved] = useState(() => getSavedSignatures());
  const [showSaved, setShowSaved] = useState(false);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  // typed -> render to cursive canvas
  useEffect(() => {
    if (mode !== 'type') return;
    if (!text.trim()) { onChange(null); return; }
    const c = document.createElement('canvas');
    c.width = 480; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.font = `italic 64px ${CURSIVE}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 8, 66);
    onChange(c.toDataURL('image/png'));
  }, [text, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull the cloud-synced signature library on mount (shared across apps/devices).
  useEffect(() => { fetchSignatures().then(setSaved).catch(() => {}); }, []);

  // Hard-lock the page while the full-screen pad is open so it can't scroll or
  // shift when the device rotates (which was pushing the buttons out of view).
  useEffect(() => {
    if (!full) return;
    const scrollY = window.scrollY;
    const b = document.body.style;
    const prev = { position: b.position, top: b.top, left: b.left, right: b.right, width: b.width, overflow: b.overflow };
    b.position = 'fixed'; b.top = `-${scrollY}px`; b.left = '0'; b.right = '0'; b.width = '100%'; b.overflow = 'hidden';
    return () => {
      b.position = prev.position; b.top = prev.top; b.left = prev.left; b.right = prev.right; b.width = prev.width; b.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [full]);

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: cx * (canvasRef.current.width / r.width), y: cy * (canvasRef.current.height / r.height) };
  };
  const start = (e) => { drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => { if (!drawing.current) return; const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000'; ctx.lineTo(x, y); ctx.stroke(); drew.current = true; };
  const end = () => { if (!drawing.current) return; drawing.current = false; if (drew.current) onChange(trimToInk(canvasRef.current) || canvasRef.current.toDataURL('image/png')); };
  const clearDraw = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); drew.current = false; onChange(null); };
  const pick = (m) => { setMode(m); onChange(null); drew.current = false; setText(''); };

  const saveFull = useCallback((img) => { setFull(false); if (img) { setMode('draw'); onChange(img); } }, [onChange]);

  // Reusable signature library (shared across all forms on this device).
  const applySaved = (img) => { setShowSaved(false); setMode('draw'); setText(''); drew.current = false; onChange(img); };
  const saveForReuse = () => {
    if (!value) { alert('Type or draw a signature first, then save it for reuse.'); return; }
    const name = window.prompt('Name this signature (e.g. "Josh – Validator")', '');
    if (name === null) return;
    setSaved(saveSignature(name, value));
  };
  const removeSaved = (id) => setSaved(deleteSignature(id));

  return (
    <div className="sig">
      <div className="siglabel">{label}</div>
      <div className="sigmodes">
        <label><input type="radio" checked={mode === 'type'} onChange={() => pick('type')} /> Type</label>
        <label><input type="radio" checked={mode === 'draw'} onChange={() => pick('draw')} /> Draw</label>
        {saved.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={() => setShowSaved((s) => !s)}>
            ★ Saved ({saved.length}) {showSaved ? '▲' : '▼'}
          </button>
        )}
        <button type="button" className="btn ghost sm sigfs-open" onClick={() => setFull(true)}>⛶ Full screen</button>
      </div>
      {showSaved && (
        <div className="sigsaved">
          {saved.length === 0 && <div className="sigsaved-empty">No saved signatures yet.</div>}
          {saved.map((s) => (
            <div key={s.id} className="sigsaved-item">
              <button type="button" className="sigsaved-apply" onClick={() => applySaved(s.img)} title="Use this signature">
                <img src={s.img} alt={s.name} />
                <span>{s.name}</span>
              </button>
              <button type="button" className="sigsaved-del" onClick={() => removeSaved(s.id)} title="Delete">✕</button>
            </div>
          ))}
        </div>
      )}
      {mode === 'type' ? (
        <input type="text" value={text} placeholder="Type name" onChange={(e) => setText(e.target.value)} />
      ) : (
        <>
          <canvas
            ref={canvasRef} width={480} height={120}
            className="sigcanvas"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
          <button type="button" className="btn ghost sm" onClick={clearDraw}>Clear</button>
        </>
      )}
      {value && (
        <div className="sigpreview-row">
          <img className="sigpreview" src={value} alt="signature" />
          <button type="button" className="btn ghost sm" onClick={saveForReuse}>★ Save for reuse</button>
        </div>
      )}
      {full && <FullscreenPad onSave={saveFull} onCancel={() => setFull(false)} />}
    </div>
  );
}
