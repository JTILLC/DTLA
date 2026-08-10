// shared/components/UpdateBanner.jsx
//
// "There is a newer version of this app — reload."
//
// Checked when the tab is brought back to the front, and on a slow timer while
// it is in use. Picking the tablet up is the moment that matters: it is when a
// shift starts, and it is the only moment a person is about to trust what the
// screen says.
//
// It asks rather than reloading itself. A reload throws away whatever is
// half-typed, and doing that to somebody mid-sentence to deliver a fix they
// did not ask for is its own kind of data loss.
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { bundleFromHtml, isStale, runningBundle } from '../utils/buildVersion.js';

const CHECK_EVERY_MS = 10 * 60 * 1000;

export default function UpdateBanner({ checkEveryMs = CHECK_EVERY_MS }) {
  const [stale, setStale] = useState(false);
  // Captured once: the moment the banner shows, the page must keep comparing
  // against what it is RUNNING, not against whatever it last saw served.
  const mineRef = useRef(null);
  if (mineRef.current === null) mineRef.current = runningBundle() || false;

  const check = useCallback(async () => {
    const mine = mineRef.current;
    if (!mine) return;                       // dev server, or nothing to compare
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      // no-store, not no-cache: this request must not be answered from the very
      // cache whose staleness it exists to detect.
      const res = await fetch(`${import.meta.env.BASE_URL || '/'}?v=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      setStale(isStale(mine, bundleFromHtml(await res.text())));
    } catch {
      // Offline in a plant is normal and is not news. Say nothing.
    }
  }, []);

  useEffect(() => {
    check();
    const onShow = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    const t = setInterval(check, checkEveryMs);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
      clearInterval(t);
    };
  }, [check, checkEveryMs]);

  if (!stale) return null;

  return (
    <div
      className="alert alert-warning d-flex flex-wrap align-items-center gap-2 py-2 mb-0 rounded-0 border-0"
      role="status"
      style={{ position: 'sticky', top: 0, zIndex: 3500 }}
    >
      <RefreshCw size={16} aria-hidden="true" />
      <span>
        <strong>A newer version of this app is available.</strong>{' '}
        Reload to get it — anything already saved stays saved.
      </span>
      <button
        type="button"
        className="btn btn-sm btn-warning ms-auto fw-semibold"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
