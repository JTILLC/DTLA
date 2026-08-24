// src/components/WeightScanner.jsx
//
// "Photograph the screen instead of typing it."
//
// Entering current weights means copying 14–20 numbers off the weigher's panel
// into a phone, one at a time, usually standing at the machine. This takes one
// photo of the Ishida CCW screen and pre-fills the fields from it.
//
// It PRE-FILLS. It never saves. Every value lands in an editable field with the
// scanned ones marked, and the operator still presses the log button — a
// misread digit has to be caught by a human, not discovered a month later in
// the history.
//
// The head numbers on that screen are circled glyphs arranged in a ring, and
// the ring rotates: head 1 can sit at 12 o'clock on one line and 3 o'clock on
// the next. So the reader is anchored on the circled numeral, never on position
// (see media-worker/src/weights.js). This component's job is to get a legible
// JPEG, hand it over, and present what came back honestly — including what
// didn't line up with the line's configured head count.
//
// Why there is a live camera rather than just a file input
// --------------------------------------------------------
// `<input capture="environment">` hands back whatever the phone's camera format
// is, and on an iPhone that is usually HEIC — which only Safari can decode, so
// the canvas step failed and the operator was told to "save it as JPEG first"
// while standing at the machine. Useless advice on a plant floor. Capturing a
// frame from getUserMedia sidesteps the codec entirely: the frame is drawn to a
// canvas and WE choose JPEG, on every device.
//
// The file picker stays as a fallback (desktop, or a photo already taken), and
// that path decodes HEIC via a lazily-imported decoder — 2.6MB that must not
// land in the main bundle, hence the dynamic import.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, X, Camera, Image as ImageIcon, Maximize2 } from 'lucide-react';
import { scanWeigherScreen } from '../config/media.js';
import { useToast } from './Toast.jsx';

// Bigger than the issue-photo limit on purpose: this image is read for small
// digits, and detail lost here is a wrong weight rather than a blurrier photo.
const MAX_DIM = 2000;
const JPEG_QUALITY = 0.85;

const looksHeic = (file) =>
  /heic|heif/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');

// Draw through a canvas so the output is JPEG whatever went in, and bounded.
const canvasToJpeg = (source) =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(source);
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

// Try the browser first, decoder second.
//
// Safari decodes HEIC natively, so attempting the canvas pass up front means it
// never downloads the decoder at all. Everywhere else that attempt fails
// harmlessly and we fall through.
//
// The decoder is `heic-to` rather than the more obvious `heic2any`: heic2any
// bundles libheif 1.x, which cannot assemble the TILED GRID layout modern
// iPhones write, and fails with "ERR_LIBHEIF format not supported" on a photo
// straight off the phone. heic-to carries a current libheif (wasm inlined, so
// no separate asset to serve) and reads those.
const fileToJpeg = async (file) => {
  const direct = await canvasToJpeg(file);
  if (direct) return direct;

  if (!looksHeic(file)) {
    throw new Error(`"${file.name}" isn't an image this browser can read.`);
  }

  const { heicTo } = await import('heic-to');
  const out = await heicTo({ blob: file, type: 'image/jpeg', quality: JPEG_QUALITY });
  const jpeg = await canvasToJpeg(out);
  if (!jpeg) throw new Error('HEIC decoded but the image could not be re-encoded.');
  return jpeg;
};

export default function WeightScanner({
  expectedHeads = 0,
  onApply,
  // Which column this scanner fills. There are two of them on the span screen —
  // one for the readings before the adjustment and one for after — and an
  // operator holding a phone over a weigher needs to know which button is which
  // without reading a paragraph.
  label = 'Scan screen',
  fills = 'current weights',
  hint = 'Photograph the weigher screen to fill the current weights. You still check and log them.',
}) {
  const toast = useToast();
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [result, setResult] = useState(null);     // { heads, unit, notes }
  const [preview, setPreview] = useState('');
  // The photo outlives the fill. Checking a filled value against the screen is
  // the whole point of not auto-saving, and that is impossible if applying the
  // reading discards the evidence.
  const [applied, setApplied] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [zoom, setZoom] = useState(false);        // fit-to-screen vs 1:1

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCamera(false);
  };

  // Release the camera and the preview object URL on unmount — a live track
  // left running keeps the phone's camera light on after you leave the page.
  useEffect(() => () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Attach the stream once the <video> is actually mounted.
  useEffect(() => {
    if (!camera || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(() => { /* autoplay refusal; the poster still shows */ });
  }, [camera]);

  const reset = () => {
    setResult(null);
    setApplied(false);
    setViewer(false);
    setZoom(false);
    setPreview((p) => { if (p) URL.revokeObjectURL(p); return ''; });
  };

  // Shared tail of both capture routes.
  const send = async (blob) => {
    setBusy(true);
    reset();
    try {
      setPreview(URL.createObjectURL(blob));
      const data = await scanWeigherScreen(blob);
      setResult(data);
      if (!data.heads?.length) {
        toast.error(data.notes || 'No head weights could be read from that photo.');
      }
    } catch (err) {
      console.error('Weigher screen scan failed:', err);
      toast.error(err?.message || 'Could not read the screen.');
    } finally {
      setBusy(false);
    }
  };

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return toast.error('This browser can\'t open the camera — use "Choose photo" instead.');
    }
    try {
      // Rear camera, and ask for detail: the digits on the panel are small.
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      setCamera(true);
    } catch (err) {
      console.warn('Camera unavailable:', err);
      toast.error(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied — allow it in your browser settings, or use "Choose photo".'
          : 'Could not open the camera — use "Choose photo" instead.'
      );
    }
  };

  const shoot = async () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return toast.error('Camera is still warming up — try again in a second.');
    const scale = Math.min(1, MAX_DIM / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    stopCamera();
    if (!blob) return toast.error('Could not capture that frame — try again.');
    await send(blob);
  };

  const pick = async (e) => {
    const file = (e.target.files || [])[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setBusy(true);
    let blob;
    try {
      blob = await fileToJpeg(file);
    } catch (err) {
      console.error('Image conversion failed:', err);
      // Say what actually went wrong. The previous generic "try the camera
      // instead" hid the real fault and made this undiagnosable from the field.
      toast.error(`Couldn't read "${file.name}": ${err?.message || err}`);
      return;
    } finally {
      setBusy(false);
    }
    if (blob) await send(blob);
  };

  // What came back may not match the line. Say so plainly instead of quietly
  // dropping or renumbering readings.
  const heads = result?.heads || [];
  const counts = heads.reduce((m, h) => m.set(h.head, (m.get(h.head) || 0) + 1), new Map());
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([h]) => h);
  const outOfRange = expectedHeads
    ? heads.filter((h) => h.head < 1 || h.head > expectedHeads).map((h) => h.head)
    : [];
  const missing = expectedHeads
    ? Array.from({ length: expectedHeads }, (_, i) => i + 1).filter((n) => !counts.has(n))
    : [];
  const unsure = heads.filter((h) => h.confident === false).map((h) => h.head);
  const wrongUnit = result && result.unit && result.unit !== 'g' && result.unit !== 'unknown';

  const apply = () => {
    // Apply only what is unambiguous. A duplicated head number means we don't
    // know which reading belongs to it, so leave those for manual entry rather
    // than picking one at random.
    const usable = heads.filter(
      (h) => !duplicates.includes(h.head) && !outOfRange.includes(h.head)
    );
    if (!usable.length) return toast.error('Nothing here can be applied — enter the weights manually.');
    onApply(new Map(usable.map((h) => [h.head, h.weight])));
    toast.success(`Filled ${usable.length} of the ${fills} — check them before logging.`);
    // Deliberately NOT reset(): the photo stays available so the filled values
    // can be checked against the screen they came from.
    setApplied(true);
  };

  return (
    <div className="mb-2">
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={openCamera} disabled={busy}>
          <Camera size={16} /> {busy ? 'Reading screen…' : label}
        </button>
        <label className="btn btn-sm btn-outline-secondary mb-0">
          <ImageIcon size={16} /> Choose photo
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={pick}
            style={{ display: 'none' }}
            disabled={busy}
          />
        </label>
      </div>
      {!result && !busy && (
        <div className="form-text mt-1">{hint}</div>
      )}

      {/* Reading takes several seconds. Without this the operator is staring at
          a page that looks like it ignored them, and taps again. */}
      {busy && (
        <div className="card mt-2">
          <div className="card-body d-flex align-items-center gap-3">
            <div className="spinner-border spinner-border-sm text-primary" role="status">
              <span className="visually-hidden">Reading…</span>
            </div>
            <div>
              <div className="fw-semibold">Reading the screen…</div>
              <div className="small text-muted">
                Matching each head number to the weight in its own hopper. Usually 5–15 seconds.
              </div>
            </div>
          </div>
          {preview && (
            <img
              src={preview}
              alt="Photo being read"
              className="rounded-bottom"
              style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', display: 'block', opacity: 0.6 }}
            />
          )}
        </div>
      )}

      {/* Live viewfinder. Frames come from the video stream, so the phone's
          HEIC setting never enters into it. */}
      {camera && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 3000, background: '#000',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{ flex: 1, width: '100%', objectFit: 'contain', minHeight: 0 }}
          />
          <div className="text-center text-white small py-1 px-2">
            Fill the frame with the weigher screen — get close enough to read the numbers.
          </div>
          <div
            className="d-flex align-items-center justify-content-between px-3 pb-4 pt-2"
            style={{ gap: '12px' }}
          >
            <button type="button" className="btn btn-outline-light" onClick={stopCamera}>
              Cancel
            </button>
            <button
              type="button"
              onClick={shoot}
              aria-label="Take photo"
              style={{
                width: '72px', height: '72px', borderRadius: '50%',
                border: '4px solid rgba(255,255,255,0.85)', background: '#fff', cursor: 'pointer',
              }}
            />
            <span style={{ width: '76px' }} />
          </div>
        </div>
      )}

      {result && (
        <div className="card mt-2">
          <div className="card-header d-flex justify-content-between align-items-center">
            <strong>{applied ? 'Filled from this photo' : 'Read from photo'}</strong>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={reset} aria-label="Discard scan">
              <X size={14} /> {applied ? 'Done' : 'Discard'}
            </button>
          </div>
          <div className="card-body">
            {preview && (
              <button
                type="button"
                onClick={() => { setZoom(false); setViewer(true); }}
                className="btn p-0 border-0 bg-transparent w-100 mb-2 text-start"
                title="Tap to view full screen"
              >
                <img
                  src={preview}
                  alt="Scanned weigher screen — tap to enlarge"
                  className="rounded border"
                  style={{ maxWidth: '100%', maxHeight: '220px', objectFit: 'contain', display: 'block' }}
                />
                <span className="small text-muted d-inline-flex align-items-center gap-1 mt-1">
                  <Maximize2 size={12} /> Tap the photo to check the numbers
                </span>
              </button>
            )}

            {heads.length > 0 && (
              <div className="d-flex flex-wrap gap-1 mb-2">
                {[...heads]
                  .sort((a, b) => a.head - b.head)
                  .map((h, i) => (
                    <span
                      key={`${h.head}-${i}`}
                      className={
                        'badge ' +
                        (duplicates.includes(h.head) || outOfRange.includes(h.head)
                          ? 'bg-danger'
                          : h.confident === false
                          ? 'bg-warning text-dark'
                          : 'bg-secondary')
                      }
                    >
                      {h.head}: {h.weight}
                    </span>
                  ))}
              </div>
            )}

            {(missing.length > 0 || duplicates.length > 0 || outOfRange.length > 0
              || unsure.length > 0 || wrongUnit || result.notes) && (
              <ul className="small mb-2 ps-3">
                {expectedHeads > 0 && heads.length !== expectedHeads && (
                  <li className="text-warning-emphasis">
                    <AlertTriangle size={12} /> Read {heads.length} of {expectedHeads} heads.
                  </li>
                )}
                {missing.length > 0 && <li>Not read: head{missing.length > 1 ? 's' : ''} {missing.join(', ')} — enter manually.</li>}
                {duplicates.length > 0 && <li className="text-danger">Head {duplicates.join(', ')} appeared twice — skipped.</li>}
                {outOfRange.length > 0 && <li className="text-danger">Head {outOfRange.join(', ')} isn&apos;t on this line — skipped.</li>}
                {unsure.length > 0 && <li>Unsure about head{unsure.length > 1 ? 's' : ''} {unsure.join(', ')} — double-check.</li>}
                {wrongUnit && <li className="text-danger">Screen appears to be in {result.unit}, not grams.</li>}
                {result.notes && <li className="text-muted">{result.notes}</li>}
              </ul>
            )}

            {applied ? (
              <div className="small text-success-emphasis d-flex align-items-center gap-1">
                <Check size={14} /> Weights filled in — the photo stays here until you press Done.
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={apply}
                disabled={heads.length === 0}
              >
                <Check size={14} /> Fill current weights
              </button>
            )}
          </div>
        </div>
      )}

      {/* Full-screen check. Tapping the image toggles fit-to-screen and 1:1, so
          a small digit can actually be read on a phone. Closing returns to the
          form with everything intact — this never touches the scan state. */}
      {viewer && preview && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.94)',
            overflow: zoom ? 'auto' : 'hidden',
            display: zoom ? 'block' : 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img
            src={preview}
            alt="Scanned weigher screen"
            onClick={() => setZoom((z) => !z)}
            style={zoom
              ? { display: 'block', maxWidth: 'none', width: 'auto', cursor: 'zoom-out' }
              : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'zoom-in' }}
          />
          <button
            type="button"
            onClick={() => { setViewer(false); setZoom(false); }}
            aria-label="Close photo"
            style={{
              position: 'fixed', top: '14px', right: '14px', width: '44px', height: '44px',
              borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)',
              color: '#111', fontSize: '20px', fontWeight: 'bold', cursor: 'pointer', zIndex: 3001,
            }}
          >✕</button>
          <div
            style={{
              position: 'fixed', bottom: '14px', left: 0, right: 0, textAlign: 'center',
              color: 'rgba(255,255,255,0.85)', fontSize: '0.8rem', pointerEvents: 'none',
            }}
          >
            {zoom ? 'Tap the photo to fit to screen' : 'Tap the photo to zoom in'}
          </div>
        </div>
      )}
    </div>
  );
}
