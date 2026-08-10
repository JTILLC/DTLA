// shared/utils/buildVersion.js
//
// Is this tab still running the build that is actually deployed?
//
// A single-page app fetches index.html once and then never asks again. A tablet
// that lives on a charger in a plant, or a browser tab nobody closes, keeps
// running the JavaScript it loaded on whatever day it loaded it — for weeks.
// The server can be serving a fix and the screen in front of somebody is still
// the bug, with nothing on either side to say so.
//
// That is not a hypothetical: a fix for lines not saving was deployed, verified
// live, and reported as still broken, because the tab under test was three
// builds behind. Hours went into re-reading code that was already correct.
//
// Vite fingerprints the entry bundle (assets/index-<hash>.js) and rewrites
// index.html to point at it, so the filename IS the version. Comparing the one
// this tab is running against the one the server is handing out needs no build
// step, no version file to remember to bump, and no server support.

/** The entry bundle this tab is running, e.g. "index-bn7vjCDy.js". */
export const runningBundle = (doc = typeof document !== 'undefined' ? document : null) => {
  if (!doc) return null;
  const el = [...doc.querySelectorAll('script[src]')]
    .find((s) => /\/assets\/index-[^/]+\.js(\?|$)/.test(s.getAttribute('src') || ''));
  return el ? bundleFromHtml(el.getAttribute('src')) : null;
};

/** The entry bundle named by a served index.html (or any string containing it). */
export const bundleFromHtml = (html) => {
  const m = String(html || '').match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  return m ? m[1] : null;
};

/**
 * True when the server is serving a DIFFERENT build to the one running here.
 *
 * Unknowns are never a mismatch. Offline, a captive portal, an HTML error page,
 * a dev server with no hashed bundle — each of those yields no name to compare,
 * and prompting somebody to reload on the strength of a failed fetch would put
 * an unexplained bar on screen exactly when the network is already unreliable.
 */
export const isStale = (running, served) => !!running && !!served && running !== served;

export default { runningBundle, bundleFromHtml, isStale };
