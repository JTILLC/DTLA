// src/components/WeightScanner.jsx
//
// "Photograph the screen instead of typing it."
//
// Entering current weights means copying a weight per head off the weigher's
// panel into a phone, one at a time, standing at the machine. This takes one
// photo of the Ishida CCW screen and pre-fills the fields from it.
//
// It PRE-FILLS. It never saves. Every value lands in an editable field with the
// scanned ones marked, and the operator still presses the log button — a
// misread digit has to be caught by a human, not discovered a month later in
// the history.
//
// The head numbers on that screen are circled glyphs arranged in a ring, and
// the ring rotates: head 1 can sit at 12 o'clock on one line and 3 o'clock on
// the next. So the reader is anchored on the circled numeral, never on position.
// This component's job is to get a legible JPEG, hand it to the CCW media
// Worker, and present what came back honestly.
//
// Why there is a live camera rather than just a file input
// --------------------------------------------------------
// `<input capture>` hands back whatever the phone's camera format is, and on an
// iPhone that is usually HEIC — which only Safari decodes. Capturing a frame
// from getUserMedia sidesteps the codec entirely: the frame is drawn to a
// canvas and WE choose JPEG, on every device. The file picker stays as a
// fallback and lazily imports a HEIC decoder for it.
//
// This is the Shearers copy of the CCW component — same behaviour, Tailwind
// instead of Bootstrap.
import { useEffect, useRef, useState } from 'react';
import { scanWeigherScreen } from '../config/scan';
import { useToast } from '../context/ToastContext';

// Bigger than the photo-upload limit on purpose: this image is read for small
// digits, and detail lost here is a wrong weight rather than a blurrier photo.
const MAX_DIM = 2000;
const JPEG_QUALITY = 0.85;

const looksHeic = (file) =>
  /heic|heif/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');

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

// Browser first, decoder second — Safari decodes HEIC natively and so never
// downloads the decoder. `heic-to` rather than `heic2any`: the latter bundles
// libheif 1.x, which cannot assemble the tiled-grid layout modern iPhones write.
const fileToJpeg = async (file) => {
  const direct = await canvasToJpeg(file);
  if (direct) return direct;
  if (!looksHeic(file)) throw new Error(`"${file.name}" isn't an image this browser can read.`);

  const { heicTo } = await import('heic-to');
  const out = await heicTo({ blob: file, type: 'image/jpeg', quality: JPEG_QUALITY });
  const jpeg = await canvasToJpeg(out);
  if (!jpeg) throw new Error('HEIC decoded but the image could not be re-encoded.');
  return jpeg;
};

export default function WeightScanner({ expectedHeads = 0, onApply }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState('');

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCamera(false);
  };

  // A live track left running keeps the phone's camera light on after you leave.
  useEffect(() => () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!camera || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(() => { /* autoplay refusal */ });
  }, [camera]);

  const reset = () => {
    setResult(null);
    setPreview((p) => { if (p) URL.revokeObjectURL(p); return ''; });
  };

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
    // A duplicated head number means we don't know which reading belongs to it,
    // so leave those for manual entry rather than picking one at random.
    const usable = heads.filter(
      (h) => !duplicates.includes(h.head) && !outOfRange.includes(h.head)
    );
    if (!usable.length) return toast.error('Nothing here can be applied — enter the weights manually.');
    onApply(new Map(usable.map((h) => [h.head, h.weight])));
    toast.success(`Filled ${usable.length} current weight${usable.length === 1 ? '' : 's'} — check them before logging.`);
    reset();
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={openCamera} disabled={busy}>
          {busy ? 'Reading screen…' : 'Scan screen'}
        </button>
        <label className="btn-secondary cursor-pointer mb-0">
          Choose photo
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={pick}
            className="hidden"
            disabled={busy}
          />
        </label>
      </div>
      {!result && !busy && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Photograph the weigher screen to fill the current weights. You still check and log them.
        </p>
      )}

      {/* Live viewfinder. Frames come from the video stream, so the phone's
          HEIC setting never enters into it. */}
      {camera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="flex-1 w-full min-h-0 object-contain"
          />
          <p className="text-center text-white text-xs py-1 px-2">
            Fill the frame with the weigher screen — get close enough to read the numbers.
          </p>
          <div className="flex items-center justify-between px-4 pb-6 pt-2">
            <button
              type="button"
              className="text-white border border-white/70 rounded px-3 py-2"
              onClick={stopCamera}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={shoot}
              aria-label="Take photo"
              className="w-[72px] h-[72px] rounded-full bg-white border-4 border-white/80"
            />
            <span className="w-[76px]" />
          </div>
        </div>
      )}

      {result && (
        <div className="card p-3 mt-2">
          <div className="flex justify-between items-center mb-2">
            <strong className="dark:text-gray-100">Read from photo</strong>
            <button type="button" className="btn-secondary" onClick={reset}>Discard</button>
          </div>

          {preview && (
            <img
              src={preview}
              alt="Scanned weigher screen"
              className="mb-2 rounded border border-gray-200 dark:border-gray-700 max-h-56 object-contain"
            />
          )}

          {heads.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {[...heads].sort((a, b) => a.head - b.head).map((h, i) => (
                <span
                  key={`${h.head}-${i}`}
                  className={
                    'text-xs px-2 py-0.5 rounded ' +
                    (duplicates.includes(h.head) || outOfRange.includes(h.head)
                      ? 'bg-red-600 text-white'
                      : h.confident === false
                      ? 'bg-amber-400 text-gray-900'
                      : 'bg-gray-200 dark:bg-gray-700 dark:text-gray-100')
                  }
                >
                  {h.head}: {h.weight}
                </span>
              ))}
            </div>
          )}

          {(missing.length > 0 || duplicates.length > 0 || outOfRange.length > 0
            || unsure.length > 0 || wrongUnit || result.notes) && (
            <ul className="text-xs list-disc pl-4 mb-2 space-y-0.5 text-gray-600 dark:text-gray-300">
              {expectedHeads > 0 && heads.length !== expectedHeads && (
                <li className="text-amber-600 dark:text-amber-400">
                  Read {heads.length} of {expectedHeads} heads.
                </li>
              )}
              {missing.length > 0 && <li>Not read: head{missing.length > 1 ? 's' : ''} {missing.join(', ')} — enter manually.</li>}
              {duplicates.length > 0 && <li className="text-red-600 dark:text-red-400">Head {duplicates.join(', ')} appeared twice — skipped.</li>}
              {outOfRange.length > 0 && <li className="text-red-600 dark:text-red-400">Head {outOfRange.join(', ')} isn&apos;t on this line — skipped.</li>}
              {unsure.length > 0 && <li>Unsure about head{unsure.length > 1 ? 's' : ''} {unsure.join(', ')} — double-check.</li>}
              {wrongUnit && <li className="text-red-600 dark:text-red-400">Screen appears to be in {result.unit}, not grams.</li>}
              {result.notes && <li>{result.notes}</li>}
            </ul>
          )}

          <button type="button" className="btn-primary" onClick={apply} disabled={heads.length === 0}>
            Fill current weights
          </button>
        </div>
      )}
    </div>
  );
}
