// Tests for the photo-embedding paths.
//
// These exist because the failure they cover was diagnosed wrong twice: a
// reason like "could not be reached" covered a missing file, a blocked
// request, a stalled download and a truncated body all at once, and each of
// those needs a different fix. The point of the tests is that the report says
// which one happened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fitInCell, layoutGrid, loadThumbs, photoToThumb } from './pdfPhotos.js';

const URL_OK = 'https://firebasestorage.googleapis.com/v0/b/b/o/p.jpg?alt=media&token=t';

// A stand-in for the browser bits pdfPhotos leans on. `imageBehaviour` decides
// what an <img> does when a src is set, which is how the second route is
// steered independently of fetch.
let imageBehaviour = 'load';

class FakeImage {
  set src(v) {
    this._src = v;
    queueMicrotask(() => {
      if (imageBehaviour === 'load') { this.width = 800; this.height = 600; this.onload?.(); }
      else if (imageBehaviour === 'error') this.onerror?.();
      // 'hang' does nothing, leaving the timeout to fire
    });
  }
}

beforeEach(() => {
  imageBehaviour = 'load';
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('URL', Object.assign(globalThis.URL, {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => {},
  }));
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toDataURL: () => 'data:image/jpeg;base64,AAAA',
    }),
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const okResponse = (size = 1234) => ({ ok: true, status: 200, blob: async () => ({ size }) });

describe('a link that was never usable', () => {
  it('is named as such and never retried', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect((await photoToThumb('blob:whatever')).why).toMatch(/never finished uploading/);
    expect((await photoToThumb('')).why).toMatch(/no photo link/);
    expect((await photoToThumb('/relative/path.jpg')).why).toMatch(/not a web address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('server answered', () => {
  it('reports a deleted file distinctly from a refused one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect((await photoToThumb(URL_OK)).why).toBe('file no longer in storage');

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    expect((await photoToThumb(URL_OK)).why).toBe('refused (403)');
  });

  it('does not retry a 404 — the file will not come back', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    await photoToThumb(URL_OK);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('flags a zero-byte object rather than calling it a network fault', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(0)));
    expect((await photoToThumb(URL_OK)).why).toBe('the stored file is empty');
  });

  it('separates a body that died mid-download from never connecting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, blob: async () => { throw new TypeError('network error'); },
    })));
    imageBehaviour = 'error';                       // second route fails too
    const r = await photoToThumb(URL_OK);
    expect(r.why).toMatch(/download started but did not finish/);
  });
});

describe('the second route', () => {
  it('rescues a photo fetch could not get, so it reaches the report', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    imageBehaviour = 'load';                        // an <img> can still load it
    const r = await photoToThumb(URL_OK);
    expect(r.failed).toBeUndefined();
    expect(r.dataUrl).toMatch(/^data:image\/jpeg/);
  });

  it('says the file is unreachable when nothing can load it, and names the object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    imageBehaviour = 'error';
    const r = await photoToThumb(URL_OK);
    expect(r.why).toMatch(/could not be reached at all/);
    expect(r.why).toMatch(/no response from firebasestorage\.googleapis\.com/);
    expect(r.why).toMatch(/p\.jpg/);            // the object path, not the token
    expect(r.why).toMatch(/\bb\b/);              // and the bucket it lives in
    expect(r.why).not.toMatch(/token/);
  });

  it('distinguishes a photo that displays but may not be embedded', async () => {
    // Every CORS-bearing route fails, yet a plain <img> shows the picture: the
    // file is present and readable, and only the permission to copy its pixels
    // is missing. Reported as a permissions problem, not a missing file.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    let call = 0;
    class PickyImage extends FakeImage {
      set crossOrigin(_v) { this._cors = true; }
      set src(v) {
        call += 1;
        const cors = this._cors;
        queueMicrotask(() => {
          if (cors) this.onerror?.();                       // CORS routes fail
          else { this.width = 800; this.height = 600; this.onload?.(); }  // plain load works
        });
        this._src = v;
      }
    }
    vi.stubGlobal('Image', PickyImage);
    // A tainted canvas is what a real browser does here.
    vi.stubGlobal('document', { createElement: () => ({
      width: 0, height: 0, getContext: () => ({ drawImage: () => {} }),
      toDataURL: () => { throw new Error('tainted'); },
    }) });

    const r = await photoToThumb(URL_OK);
    expect(call).toBeGreaterThan(1);
    expect(r.why).toMatch(/no permission to copy it \(CORS\)/);
    expect(r.why).toMatch(/\bb\b/);              // names the bucket
    expect(r.why).toMatch(/p\.jpg/);              // and the object
  });

  it('is not attempted for a file that is genuinely gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    imageBehaviour = 'load';                        // would succeed if tried
    const r = await photoToThumb(URL_OK);
    expect(r.failed).toBe(true);                    // ...so it must not be tried
    expect(r.why).toBe('file no longer in storage');
  });
});

describe('a cached opaque response poisoning the CORS request', () => {
  // The real bug: the app displays a photo with a plain <img>, the browser
  // caches an opaque response with no CORS headers, and the export's CORS
  // request is then answered from that cached copy and fails. Only the photo
  // that had just been viewed failed; the rest fetched cleanly.
  it('gets the photo anyway by asking under a URL the cache has not seen', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (u, opts) => {
      seen.push({ u: String(u), cache: opts?.cache });
      if (!String(u).includes('_pdf=')) throw new TypeError('Failed to fetch');  // opaque hit
      return okResponse();
    }));
    const r = await photoToThumb(URL_OK);
    expect(r.failed).toBeUndefined();
    expect(r.dataUrl).toMatch(/^data:image\/jpeg/);
    expect(seen[0].cache).toBe('reload');          // refuses the cache outright
    expect(seen[1].u).toMatch(/_pdf=\d+/);         // and then sidesteps the URL
  });

  it('keeps the original query string intact when busting', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (u) => {
      seen.push(String(u));
      if (seen.length === 1) throw new TypeError('Failed to fetch');
      return okResponse();
    }));
    await photoToThumb(URL_OK);
    expect(seen[1]).toContain('alt=media');
    expect(seen[1]).toContain('token=t');
    expect(seen[1]).toMatch(/&_pdf=/);              // appended, not replacing
  });
});

describe('a stalled request', () => {
  it('is named as slow rather than blamed on the network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    }));
    imageBehaviour = 'error';
    expect((await photoToThumb(URL_OK)).why).toMatch(/too slow to download/);
  });
});

describe('loadThumbs', () => {
  it('keeps order, names each failure with its reason, and never rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u) => (String(u).includes('bad')
      ? { ok: false, status: 404 }
      : okResponse())));
    const refs = [
      { url: URL_OK, label: 'good one' },
      { url: 'https://firebasestorage.googleapis.com/bad.jpg', label: 'Line 1 · head 2 · WDU' },
      { url: URL_OK, label: 'another good one' },
    ];
    const { thumbs, failed, failedLabels } = await loadThumbs(refs);
    expect(thumbs).toHaveLength(2);
    // The label must survive to the page, or a photo says nothing about where
    // it came from.
    expect(thumbs.map((t) => t.label)).toEqual(['good one', 'another good one']);
    expect(failed).toBe(1);
    expect(failedLabels).toEqual(['Line 1 · head 2 · WDU (file no longer in storage)']);
  });

  it('uses a thumbnail stored with the entry and never touches the network', async () => {
    // The point of storing it: no fetch means no CORS, no cache, no reliance on
    // the original object still existing.
    const fetchSpy = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchSpy);
    const { thumbs, failed } = await loadThumbs([
      { url: URL_OK, label: 'has a thumb', thumb: 'data:image/jpeg;base64,AAAA' },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(failed).toBe(0);
    expect(thumbs).toHaveLength(1);
  });

  it('still downloads for photos saved before thumbnails existed', async () => {
    const fetchSpy = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const { thumbs } = await loadThumbs([{ url: URL_OK, label: 'old photo' }]);
    expect(fetchSpy).toHaveBeenCalled();
    expect(thumbs).toHaveLength(1);
  });

  it('reports what it refused to embed instead of silently shortening the report', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
    const refs = Array.from({ length: 45 }, (_, i) => ({ url: URL_OK, label: `p${i}` }));
    const { thumbs, skipped } = await loadThumbs(refs, 40);
    expect(thumbs).toHaveLength(40);
    expect(skipped).toBe(5);
  });
});
