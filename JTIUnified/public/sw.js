// A service worker whose only job is to remove itself.
//
// An older build of this dashboard registered a caching service worker. That
// registration lives in the BROWSER, not in this repo, so deleting the code
// did not remove it — every browser that ever loaded the old build still runs
// it, and it still answers navigations from its own precache.
//
// That precache holds an index.html from whenever it was stored, and that
// document names content-hashed asset files that no longer exist. The result
// is a white screen: the HTML loads, the script it asks for 404s, nothing
// executes, and there is not even a console error to find, because no code
// ever ran.
//
// Normally a stale worker heals itself — the browser re-fetches this script,
// sees it changed, and installs the new one. Here it could not: `_redirects`
// sends every unmatched path to /index.html, so the update check received
// text/html, which is not a valid worker script, so the browser rejected the
// update and kept the broken worker. The SPA fallback was hiding the escape
// hatch. `public/sw.js` is a real file now, so it is served as itself and the
// fallback never applies to it.
//
// Registering nothing is deliberate. The dashboard has no offline story worth
// the risk of serving a build nobody can see, and the fix for staleness is
// already in _headers: index.html is no-store, assets are immutable.

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for every tab to close — the
  // tab that needs rescuing is the one open right now.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop every cache this origin holds. They are all from the old worker;
    // nothing here creates any.
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));

    await self.registration.unregister();

    // Reload the open tabs. Without this the page a person is staring at
    // stays blank until they happen to refresh, which is the whole problem:
    // a blank page gives nobody a reason to try again.
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.navigate(client.url));
  })());
});

// No fetch handler ON PURPOSE. A worker without one is bypassed entirely for
// network requests, so from the moment this installs the browser talks to the
// server directly — even before the unregister above completes.
