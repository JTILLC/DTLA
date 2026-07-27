// src/utils/useAuthedMedia.js
//
// Resolves a list of stored photo objects to displayable URLs.
//
// Each photo is one of:
//   { url, path }  legacy — public URL still works
//   { path }       broker-only — must be fetched with the user's ID token
//   { pendingId }  still in the offline queue, previewed from its IndexedDB blob
//
// Returns a map keyed by path/pendingId. Object URLs are revoked on unmount or
// when the photo set changes, so a long session browsing photos doesn't leak
// blobs.
import { useEffect, useState } from 'react';
import { usingBroker, fetchAuthedMedia } from '../config/media.js';

export function useAuthedMedia(photos) {
  const [urls, setUrls] = useState({});

  // Key the effect on identity, not the array reference — parents rebuild the
  // photos array on every render.
  const key = (photos || [])
    .map((p) => p?.path || p?.pendingId || p?.url || '')
    .join('|');

  useEffect(() => {
    let cancelled = false;
    const created = [];

    const list = (photos || []).filter((p) => p?.path && !p.pendingId);
    // Nothing to resolve: legacy public URLs render directly.
    if (!usingBroker() || list.length === 0) {
      setUrls({});
      return undefined;
    }

    (async () => {
      const next = {};
      await Promise.all(
        list.map(async (p) => {
          try {
            const objUrl = await fetchAuthedMedia(p.path);
            if (cancelled) {
              URL.revokeObjectURL(objUrl);
              return;
            }
            created.push(objUrl);
            next[p.path] = objUrl;
          } catch (err) {
            // Fall back to the stored public URL if there is one — during the
            // migration many objects still have a live download token, and a
            // broker hiccup shouldn't blank a tech's photos mid-visit.
            console.warn('Media fetch failed, falling back:', p.path, err?.message || err);
            if (p.url) next[p.path] = p.url;
          }
        })
      );
      if (!cancelled) setUrls(next);
    })();

    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Resolve one photo to whatever is displayable right now.
  const srcFor = (photo, pendingUrls = {}) => {
    if (!photo) return '';
    if (photo.pendingId) return pendingUrls[photo.pendingId] || '';
    if (photo.path && urls[photo.path]) return urls[photo.path];
    return usingBroker() && photo.path ? '' : photo.url || '';
  };

  return { srcFor };
}

export default useAuthedMedia;
