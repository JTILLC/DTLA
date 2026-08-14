// Client-side image normalizer: converts HEIC/HEIF to JPEG (Chrome/Firefox
// can't decode HEIC natively), then resizes to ≤ maxDim on the longest edge.
// Returns a JPEG File. Falls back to the original file only on total failure.

// Lazy-load heic-to only when we actually need it — it ships libheif WASM
// and adds ~2.7 MB to the bundle. Users who only upload JPEGs never pay for it.
const loadHeicTo = () => import('heic-to');

async function looksLikeHeic(file) {
  if (!file) return false;
  if (/heic|heif/i.test(file.type || '')) return true;
  if (/\.(heic|heif)$/i.test(file.name || '')) return true;
  try {
    const buf = await file.slice(0, 32).arrayBuffer();
    const text = new TextDecoder('latin1').decode(new Uint8Array(buf));
    return /ftyp(heic|heix|hevc|mif1|msf1|heim|heis|hevm|hevs)/.test(text);
  } catch {
    return false;
  }
}

async function convertHeicToJpeg(file) {
  const { heicTo } = await loadHeicTo();
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
  const newName = (file.name || 'photo').replace(/\.(heic|heif|jpe?g|png)$/i, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg' });
}

export class UnsupportedImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

export async function resizeImage(file, { maxDim = 1600, quality = 0.85 } = {}) {
  if (!file) return file;

  let working = file;
  // Sniff magic bytes — catches files renamed from .heic to .jpg.
  const heic = await looksLikeHeic(file);

  // Step 1: if it's HEIC (even with a .jpg extension), convert to JPEG.
  if (heic) {
    try {
      working = await convertHeicToJpeg(file);
    } catch (err) {
      console.error('HEIC → JPEG conversion failed:', err);
      throw new UnsupportedImageError(
        'This HEIC photo uses a codec we can\'t decode in the browser. ' +
        'On your iPhone, turn on Settings → Camera → Formats → "Most Compatible" so new photos save as JPEG, ' +
        'or convert this photo to JPEG before uploading.'
      );
    }
  }

  // Only bother resizing non-tiny images
  if (working.size < 800 * 1024) return working;

  let objectUrl;
  try {
    objectUrl = URL.createObjectURL(working);
    const img = await loadImage(objectUrl);

    const longest = Math.max(img.width, img.height);
    const scale = Math.min(1, maxDim / longest);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    if (scale === 1) return working;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return working;

    const newName = (working.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch (err) {
    // The <img> failed to decode the file — browser can't render these bytes.
    throw new UnsupportedImageError(
      'This image format isn\'t supported by the browser. ' +
      'Try a JPEG or PNG — on iPhone, Settings → Camera → Formats → "Most Compatible" ' +
      'makes new photos save as JPEG automatically.'
    );
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
