// src/config/media.js
//
// Media delivery mode for customer-facing photos and service reports.
//
// Firebase `getDownloadURL()` links bypass Storage security rules by design, so
// they stay readable forever and are NOT covered by share-link expiry. The media
// broker (see CCWISSUESGitHub/media-worker) re-checks the share on every request
// and streams the bytes itself, which is what actually ties media access to the
// share's lifetime.
//
// MEDIA_BROKER_BASE is empty until the Worker is deployed. Empty = today's
// behaviour: render the stored public `url`. Set it and every photo is fetched
// through the broker instead, with no other code change.
//
//   e.g. 'https://ccw-media.<subdomain>.workers.dev'
// Set '' to fall back to the legacy public URLs stored on each photo.
export const MEDIA_BROKER_BASE = 'https://ccw-media.josh-c80.workers.dev';

// Build the URL to render for a stored photo/report object.
//
// `photo` is { url, path } — `url` is the legacy public link, `path` the Storage
// object path. The broker needs the path plus the share token that authorises it.
// Falls back to the stored url whenever the broker isn't configured or the object
// predates path tracking, so nothing 404s mid-migration.
export function mediaUrl(photo, shareToken) {
  if (!photo) return '';
  if (!MEDIA_BROKER_BASE || !photo.path || !shareToken) return photo.url || '';
  const encodedPath = photo.path.split('/').map(encodeURIComponent).join('/');
  return `${MEDIA_BROKER_BASE}/m/${encodeURIComponent(shareToken)}/${encodedPath}`;
}

export default { MEDIA_BROKER_BASE, mediaUrl };
