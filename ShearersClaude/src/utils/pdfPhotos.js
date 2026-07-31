// src/utils/pdfPhotos.js
//
// Embedding photos in a PDF.
//
// jsPDF cannot reference an image by URL — the bytes have to be in the file.
// That makes photos the dominant cost of the report, so this downscales each
// one hard before adding it: a thumbnail is enough to show a cracked hopper or
// a burnt board, and a page of full-resolution phone photos produces a file
// nobody can email.
//
// Failures are non-fatal by design. A photo that has been deleted from Storage,
// or a phone that drops signal mid-export, must not cost you the whole report —
// the missing ones are counted and stated in the PDF instead.

const THUMB_MAX = 320;          // px on the long edge
const JPEG_QUALITY = 0.7;

// How many photos are in flight at once. A day with twenty photos used to open
// twenty simultaneous connections from a phone on plant wifi; enough of them
// were dropped by the network that a photo which existed, and was readable,
// still failed to reach the report. Downloading a few at a time is marginally
// slower and far more likely to finish.
const CONCURRENCY = 4;
const ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where a photo lives, for the failure line. Enough to tell a Storage link from
// something unexpected without printing a signed URL into the report.
const hostOf = (url) => { try { return new URL(url).host; } catch { return 'bad link'; } };

// Catch a broken link before blaming the network for it. fetch() throws the
// same TypeError for "the phone dropped the request" and "this string was never
// a web address", and those need opposite responses from whoever reads the PDF.
function linkProblem(url) {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return 'no photo link was saved';
  if (s.startsWith('blob:')) return 'the photo never finished uploading';
  if (!/^https:\/\//i.test(s)) return 'the saved link is not a web address';
  try { new URL(s); } catch { return 'the saved link is malformed'; }
  return null;
}

// Fetch → downscale → data URL. Returns { failed, why } if the photo can't be had.
//
// Retries with a growing pause rather than immediately: the failure this guards
// against is a congested network, and an instant retry rejoins the same burst
// that just failed. The reason is reported so "1 photo could not be loaded" can
// be chased down instead of remaining a mystery in the footer.
export async function photoToThumb(url, attempt = 0) {
  const bad = linkProblem(url);
  if (bad) return { failed: true, why: bad };      // no point retrying a bad link
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) {
      if (res.status >= 500 && attempt < ATTEMPTS - 1) {
        await sleep(400 * (attempt + 1));
        return photoToThumb(url, attempt + 1);
      }
      console.warn(`[pdf] photo unavailable (${res.status}):`, url);
      // 404 means the file is gone from Storage while the log still points at
      // it; 403 means it is there but the link no longer authorises. Different
      // problems, so the report says which rather than "could not be loaded".
      return { failed: true, why: res.status === 404 ? 'file no longer in storage' : `refused (${res.status})` };
    }
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const scale = Math.min(1, THUMB_MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          resolve({
            dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
            w: canvas.width,
            h: canvas.height,
          });
        } catch {
          resolve({ failed: true, why: 'blocked by the browser (CORS)' });
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        console.warn('[pdf] photo downloaded but could not be decoded:', url);
        resolve({ failed: true, why: 'downloaded but not a readable image' });
      };
      img.src = objectUrl;
    });
  } catch (err) {
    if (attempt < ATTEMPTS - 1) {
      await sleep(400 * (attempt + 1));             // let the network settle
      return photoToThumb(url, attempt + 1);
    }
    console.warn('[pdf] photo could not be fetched:', url, err?.message || err);
    // Naming the host distinguishes "the network dropped it" from "this link
    // points somewhere unexpected", which the reason alone cannot.
    return { failed: true, why: `network dropped it after ${ATTEMPTS} tries (${hostOf(url)})` };
  }
}

// Fetch a batch concurrently, preserving order. `cap` bounds how many photos a
// single report will embed at all — without it one busy day could produce a
// hundred-megabyte file.
//
// Takes { url, label } so a failure can be NAMED in the report. "1 photo could
// not be loaded" is true and useless; "Line 4 · head 7 · drive unit" is
// something you can go and look at.
export async function loadThumbs(refs, cap = 40) {
  const wanted = refs.slice(0, cap);

  // A few at a time, in order, rather than all at once. Results are written
  // back by index so the report's photo order still matches the log's.
  const results = new Array(wanted.length);
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const i = next++;
      results[i] = await photoToThumb(wanted[i].url);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));

  const ok = (r) => r && !r.failed;
  return {
    thumbs: results.filter(ok),
    // Name AND reason: "Line 1 · head 2 · WDU (file no longer in storage)"
    // tells you what to do; a bare count does not.
    failedLabels: wanted
      .map((r, i) => (ok(results[i]) ? null : `${r.label || 'photo'} (${results[i]?.why || 'unknown'})`))
      .filter(Boolean),
    failed: results.filter((r) => !ok(r)).length,
    skipped: Math.max(0, refs.length - wanted.length),
  };
}

// Lay thumbnails out in a row, wrapping and paginating as needed.
// Returns the y position after the last row.
export function drawThumbRow(doc, thumbs, startY, { x = 14, maxWidth = 180, gap = 3, height = 26 } = {}) {
  let cx = x;
  let cy = startY;
  const pageH = doc.internal.pageSize.getHeight();

  thumbs.filter((t) => t && t.dataUrl).forEach((t) => {
    const w = Math.max(10, Math.round(height * (t.w / t.h)));
    if (cx + w > x + maxWidth) { cx = x; cy += height + gap; }
    if (cy + height > pageH - 15) { doc.addPage(); cy = 20; cx = x; }
    try {
      doc.addImage(t.dataUrl, 'JPEG', cx, cy, w, height);
    } catch {
      /* a single bad image must not abort the export */
    }
    cx += w + gap;
  });

  return cy + height + gap;
}

export default { photoToThumb, loadThumbs, drawThumbRow };
