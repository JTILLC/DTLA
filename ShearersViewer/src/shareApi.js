// src/shareApi.js
//
// Downtime data for this share link, fetched through the broker.
//
// This viewer used to read the Realtime Database directly, which is why the
// downtime data had to be world-readable — every stop, every fault note,
// available to anyone who knew the database URL. The share link was decoration:
// nothing checked it, because nothing had to.
//
// The broker checks it. It holds the credential, validates the token against
// the shares node, and returns only what a valid link entitles this viewer to.
// The database is closed to the public as a result, which was the point.
//
// The cost is that this polls rather than subscribing. A live subscription
// needs a database connection, and a connection needs a credential this page
// cannot be trusted with. Downtime is reviewed rather than watched, so a minute
// behind is not a meaningful difference — and the broker caches for twenty
// seconds, so a page open all day is not a request per viewer per second.

const BROKER = 'https://ccw-media.josh-c80.workers.dev';

/** How often the open page asks for fresh data. */
export const POLL_MS = 60_000;

const tokenFromUrl = () => {
  const m = /\/shared\/([^/?#]+)/.exec(window.location.pathname);
  if (m) return decodeURIComponent(m[1]);
  return new URLSearchParams(window.location.search).get('token') || '';
};

export class ShareError extends Error {}

/**
 * @param {'data'|'history'} which
 * @param {string} [token] - defaults to the one in the address bar
 */
export async function fetchShared(which, token = tokenFromUrl()) {
  if (!token) throw new ShareError('This link is missing its share code.');

  const res = await fetch(`${BROKER}/shearers/${which}?token=${encodeURIComponent(token)}`);

  if (res.status === 403) {
    // The broker answers the same way for a link that never existed and one
    // that was revoked, so this cannot say which.
    throw new ShareError('This share link is no longer valid. Ask JTI for a new one.');
  }
  if (res.status === 503) throw new ShareError('Shared views are not switched on yet.');
  if (!res.ok) throw new ShareError('Could not load the downtime data. Please try again shortly.');

  return res.json();
}

/**
 * Fetch now, then keep it fresh until the returned function is called.
 *
 * Errors after the first success are swallowed on purpose: a page left open
 * through a wobbly connection should keep showing what it has rather than
 * replacing a working report with an error.
 */
export function pollShared(which, onValue, onError) {
  let stopped = false;
  let timer = null;
  let everWorked = false;

  const tick = async () => {
    try {
      const value = await fetchShared(which);
      everWorked = true;
      if (!stopped) onValue(value);
    } catch (err) {
      if (!stopped && !everWorked) onError?.(err);
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };

  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

export default { fetchShared, pollShared, POLL_MS, ShareError };
