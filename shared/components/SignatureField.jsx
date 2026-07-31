import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getSavedSignatures, fetchSignatures, saveSignature, deleteSignature } from './signatureStore';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';

const CURSIVE = "'Snell Roundhand','Brush Script MT','Segoe Script',cursive";

// Inject the pad/library CSS once (keeps this component drop-in for the CCW app,
// which is Bootstrap-styled and doesn't share the MDValidation stylesheet).
const STYLE_ID = 'jti-sigfield-css';
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.sigfs { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; height: 100dvh; z-index: 2000;
  background: #fff; display: flex; flex-direction: column; touch-action: none; overscroll-behavior: contain;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
.sigfs-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid #cfd8dc; background: #f7f9fa; }
.sigfs-hint { font-size: 0.8rem; color: #607d8b; flex: 1 1 auto; text-align: center; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sigfs-actions { display: flex; gap: 8px; flex: 0 0 auto; }
.sigfs canvas { flex: 1 1 auto; width: 100%; min-height: 0; touch-action: none; cursor: crosshair; }
.sigfs-line { position: absolute; left: 6%; right: 6%; bottom: 16%; border-top: 2px solid #90a4ae; text-align: center; font-size: 0.8rem; color: #b0bec5; padding-top: 4px; pointer-events: none; }
.sigsaved { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; padding: 8px; border: 1px solid #cfd8dc; border-radius: 8px; background: #f7f9fa; }
.sigsaved-item { position: relative; }
.sigsaved-apply { display: flex; flex-direction: column; align-items: center; gap: 2px; background: #fff; border: 1px solid #b0bec5; border-radius: 7px; padding: 6px 10px 4px; cursor: pointer; }
.sigsaved-apply img { height: 34px; max-width: 150px; object-fit: contain; }
.sigsaved-apply span { font-size: 0.72rem; color: #455a64; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sigsaved-del { position: absolute; top: -7px; right: -7px; width: 20px; height: 20px; border-radius: 50%; border: none; background: #c0392b; color: #fff; font-size: 0.7rem; line-height: 1; cursor: pointer; }
`;
  document.head.appendChild(el);
}

// Crop a canvas down to the bounding box of its ink so the saved signature is tight.
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

// Full-screen drawing overlay — sign using the entire device screen.
function FullscreenPad({ onSave, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
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
    <div className="sigfs">
      <div className="sigfs-bar">
        <button type="button" className="btn btn-sm btn-danger" onClick={onCancel}>✕ Cancel</button>
        <span className="sigfs-hint">Rotate to landscape &amp; sign</span>
        <span className="sigfs-actions">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clear}>Clear</button>
          <button type="button" className="btn btn-sm btn-success" onClick={save}>Save</button>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <div className="sigfs-line">Sign above the line</div>
    </div>,
    document.body
  );
}

// Signature input: type a name (cursive) or draw it, full-screen on mobile, and
// reuse a saved signature across forms. Emits a PNG data URL (or null) via onChange.
export default function SignatureField({ label, onChange }) {
  ensureStyles();
  const toast = useToast();
  const dialog = useDialog();
  const [mode, setMode] = useState('type');
  const [text, setText] = useState('');
  const [full, setFull] = useState(false);
  const [current, setCurrent] = useState(null);
  const [saved, setSaved] = useState(() => getSavedSignatures());
  const [showSaved, setShowSaved] = useState(false);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  const emit = useCallback((img) => { setCurrent(img); onChange(img); }, [onChange]);

  // Pull the cloud-synced signature library on mount (shared across apps/devices).
  useEffect(() => { fetchSignatures().then(setSaved).catch(() => {}); }, []);

  useEffect(() => {
    if (mode !== 'type') return;
    if (!text.trim()) { emit(null); return; }
    const c = document.createElement('canvas');
    c.width = 480; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.font = `italic 64px ${CURSIVE}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 10, 66);
    emit(c.toDataURL('image/png'));
  }, [text, mode, emit]);

  // Hard-lock the page while the full-screen pad is open so rotation can't shift it.
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
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - r.left) * (canvasRef.current.width / r.width), y: (clientY - r.top) * (canvasRef.current.height / r.height) };
  };
  const start = (e) => { drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => { if (!drawing.current) return; const ctx = canvasRef.current.getContext('2d'); const { x, y } = point(e); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000'; ctx.lineTo(x, y); ctx.stroke(); drew.current = true; };
  const end = () => { if (!drawing.current) return; drawing.current = false; if (drew.current) emit(trimToInk(canvasRef.current) || canvasRef.current.toDataURL('image/png')); };
  const clearDraw = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); drew.current = false; emit(null); };
  const pick = (m) => { setMode(m); emit(null); drew.current = false; setText(''); };

  const saveFull = useCallback((img) => { setFull(false); if (img) { setMode('draw'); emit(img); } }, [emit]);
  const applySaved = (img) => { setShowSaved(false); setMode('draw'); setText(''); drew.current = false; emit(img); };
  const saveForReuse = async () => {
    if (!current) { toast.error('Type or draw a signature first, then save it for reuse.'); return; }
    const name = await dialog.prompt('Name this signature (e.g. "Josh – Calibrator")', {
      title: 'Save Signature',
      confirmText: 'Save',
      defaultValue: ''
    });
    if (name === null) return;
    setSaved(saveSignature(name, current));
  };
  const removeSaved = (id) => setSaved(deleteSignature(id));

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontWeight: 600, fontSize: '0.85em' }}>{label}</div>
      <div style={{ display: 'flex', gap: '12px', margin: '4px 0', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.8em' }}><input type="radio" checked={mode === 'type'} onChange={() => pick('type')} /> Type</label>
        <label style={{ fontSize: '0.8em' }}><input type="radio" checked={mode === 'draw'} onChange={() => pick('draw')} /> Draw</label>
        {saved.length > 0 && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowSaved((s) => !s)}>
            ★ Saved ({saved.length}) {showSaved ? '▲' : '▼'}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setFull(true)}>⛶ Full screen</button>
      </div>
      {showSaved && (
        <div className="sigsaved">
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
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type name" className="form-control form-control-sm" />
      ) : (
        <>
          <canvas
            ref={canvasRef} width={480} height={120}
            style={{ width: '100%', height: '90px', border: '1px solid #ccc', borderRadius: '4px', touchAction: 'none', background: '#fff', cursor: 'crosshair' }}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
          <button type="button" className="btn btn-sm btn-outline-secondary" style={{ marginTop: '4px' }} onClick={clearDraw}>Clear</button>
        </>
      )}
      {current && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
          <img src={current} alt="signature" style={{ maxHeight: '46px' }} />
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={saveForReuse}>★ Save for reuse</button>
        </div>
      )}
      {full && <FullscreenPad onSave={saveFull} onCancel={() => setFull(false)} />}
      {dialog.DialogComponent}
    </div>
  );
}
