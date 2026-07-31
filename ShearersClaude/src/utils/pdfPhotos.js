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
// the missing ones are counted and NAMED in the PDF instead, with the reason.
//
// There are two independent ways to get the pixels, and this tries both:
// fetch() then draw, and failing that an <img> pointed straight at the URL.
// They fail differently — fetch can be blocked by a proxy, an extension or a
// content blocker that an ordinary image load sails past, and a large photo
// that stalls one may still stream through the other. Trying only the first
// meant a photo that the phone could display was still missing from the report.

// Photos are embedded in full colour. These bound the file size, not the
// palette: every phone photo at full resolution produces a report nobody can
// email. 480px at 0.8 is legible enough to see a cracked hopper or a burnt
// track on a board, which is the whole reason the photo is in the report.
const THUMB_MAX = 480;          // px on the long edge
const JPEG_QUALITY = 0.8;

// How many photos are in flight at once. A day with twenty photos used to open
// twenty simultaneous connections from a phone on plant wifi; enough of them
// were dropped by the network that a photo which existed, and was readable,
// still failed to reach the report. Downloading a few at a time is marginally
// slower and far more likely to finish.
const CONCURRENCY = 4;
const ATTEMPTS = 3;
// Long enough for a big photo on plant wifi, short enough that one bad file
// cannot hold the whole report hostage.
const TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where a photo lives, for the failure line. Enough to tell a Storage link from
// something unexpected without printing a signed URL into the report.
const hostOf = (url) => { try { return new URL(url).host; } catch { return 'bad link'; } };

// Which bucket, and which object in it — without the access token. Enough to
// find the file in Storage and to see a malformed name; not enough to hand
// anyone the photo.
//
// The bucket is included because CORS is configured per bucket, so a photo that
// fails CORS while its neighbours pass is almost certainly not in the same one.
// Reporting only the object path would have hidden the one field that explains
// the difference.
function objectPathOf(url) {
  try {
    const { pathname } = new URL(url);
    const bucket = pathname.split('/b/')[1]?.split('/')[0] || '';
    const object = pathname.split('/o/')[1] || '';
    return [bucket && decodeURIComponent(bucket), object && decodeURIComponent(object)]
      .filter(Boolean).join(' / ');
  } catch { return ''; }
}

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

// A loaded image → a downscaled JPEG data URL.
// Throws only if the canvas is tainted, which means the pixels are readable on
// screen but not extractable — a CORS failure by another name.
function drawThumb(img) {
  const scale = Math.min(1, THUMB_MAX / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), w: canvas.width, h: canvas.height };
}

const decode = (src, { crossOrigin } = {}) => new Promise((resolve) => {
  const img = new Image();
  if (crossOrigin) img.crossOrigin = 'anonymous';
  let timer;
  const finish = (v) => { clearTimeout(timer); img.onload = null; img.onerror = null; resolve(v); };
  timer = setTimeout(() => finish({ failed: true, why: 'timed out decoding' }), TIMEOUT_MS);
  img.onload = () => {
    // `loaded` records that the pixels arrived, which is not the same as being
    // allowed to read them: an image fetched without CORS displays perfectly
    // and taints the canvas. Callers need to tell those apart.
    try { finish({ ...drawThumb(img), loaded: true }); }
    catch { finish({ failed: true, loaded: true, why: 'blocked by the browser (CORS)' }); }
  };
  img.onerror = () => finish({ failed: true, loaded: false, why: 'not a readable image' });
  img.src = src;
});

// A URL the browser cannot possibly have cached under a different set of rules.
//
// This is the fix for the failure that took four rounds to find. The app
// displays photos with a plain <img>, which caches an OPAQUE response — one
// with no CORS headers, because a plain image load never needed them. When the
// export later asks for the same URL with CORS, the browser can answer from
// that cached opaque copy, and the CORS check fails against a response that
// never carried the header. The photo you had just looked at was the one that
// would not embed, while photos you had not opened fetched cleanly.
//
// Extra query parameters are ignored by Firebase Storage, which keys on the
// path and token, so this changes the cache entry and nothing else.
const bust = (url) => `${url}${url.includes('?') ? '&' : '?'}_pdf=${Date.now()}`;

// Route one: download the bytes, then decode them.
async function viaFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    // `reload` refuses the cache outright and goes to the network, which is
    // belt and braces alongside the busted URL: either alone fixes the opaque
    // hit, and neither costs anything on a photo that was never cached.
    res = await fetch(url, { mode: 'cors', cache: 'reload', signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    // An abort is a stall, not a refusal, and a huge old photo on a weak
    // connection is the likeliest cause — worth saying so rather than blaming
    // the network in general.
    const why = err?.name === 'AbortError'
      ? `too slow to download in ${TIMEOUT_MS / 1000}s`
      : `no response from ${hostOf(url)}`;
    return { failed: true, why, retryable: true };
  }
  if (!res.ok) {
    clearTimeout(timer);
    // 404 means the file is gone from Storage while the log still points at it;
    // 403 means it is there but the link no longer authorises. Different
    // problems, so the report says which rather than "could not be loaded".
    return {
      failed: true,
      why: res.status === 404 ? 'file no longer in storage' : `refused (${res.status})`,
      retryable: res.status >= 500,
    };
  }
  let blob;
  try {
    blob = await res.blob();
  } catch {
    clearTimeout(timer);
    // The server answered and then the body failed. That is a different fault
    // from never connecting — it points at a truncated or corrupt object.
    return { failed: true, why: 'download started but did not finish', retryable: true };
  }
  clearTimeout(timer);
  if (!blob.size) return { failed: true, why: 'the stored file is empty' };
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await decode(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Fetch → downscale → data URL, with an image load as a second route.
//
// Retries with a growing pause rather than immediately: an instant retry
// rejoins the same congestion that just failed.
export async function photoToThumb(url, attempt = 0) {
  const bad = linkProblem(url);
  if (bad) return { failed: true, why: bad };      // no point retrying a bad link

  let first = await viaFetch(url);
  if (!first.failed) return first;

  // Same request, under a URL the cache has never seen. `cache: 'reload'`
  // should already have prevented an opaque hit, but a cached entry is not the
  // only thing keyed by URL — this also sidesteps a stale negative result.
  if (first.retryable) {
    const retried = await viaFetch(bust(url));
    if (!retried.failed) return retried;
    first = retried;
  }

  if (first.retryable && attempt < ATTEMPTS - 1) {
    await sleep(400 * (attempt + 1));
    return photoToThumb(url, attempt + 1);
  }

  // Second route. No fetch involved, so it is not subject to whatever stopped
  // the first — and when it works, the photo makes the report instead of an
  // apology. Only worth trying for a fault that could be transport-specific.
  if (first.retryable) {
    // Busted here too: a crossOrigin <img> reads the same cache a plain <img>
    // wrote, so pointing it at the original URL would hit the same opaque entry
    // that just defeated fetch.
    const second = await decode(bust(url), { crossOrigin: true });
    if (!second.failed) return second;

    // Both routes are gone, and both of them need CORS. A plain <img> does not
    // — it can display a photo it is not allowed to hand to a canvas. So this
    // last probe cannot rescue the photo, only say WHY it was lost: a file the
    // browser can still display is a permissions problem, and a file it cannot
    // is a missing or unreachable one. Those have nothing to do with each other
    // and the report should not present them as the same failure.
    const displayable = await decode(url, { crossOrigin: false });
    const where = objectPathOf(url);
    const suffix = where ? ` — ${where}` : '';
    console.warn('[pdf] both routes failed:', url, first.why, '/', second.why);
    return {
      failed: true,
      // The photo is present and readable — only permission to copy its pixels
      // is missing, i.e. the download arrived without the CORS header that
      // grants it. A filtering network was the obvious suspect and was ruled
      // out on cellular, so the message states the fact and names the bucket
      // and object rather than asserting a cause it cannot know.
      why: displayable.loaded
        ? `the photo opens but the download carries no permission to copy it (CORS)${suffix}`
        : `the file could not be reached at all (${first.why})${suffix}`,
    };
  }

  console.warn('[pdf] photo unavailable:', url, first.why);
  return { failed: true, why: first.why };
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
export function drawThumbRow(doc, thumbs, startY, { x = 14, maxWidth = 180, gap = 3, height = 38 } = {}) {
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
