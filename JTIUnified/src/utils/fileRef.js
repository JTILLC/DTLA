// src/utils/fileRef.js
//
// Telling a link apart from a storage path.
//
// Files in this system are recorded two ways. Anything uploaded through the
// dashboard stores a full download URL; older CCW visits stored a bare object
// path like `user_files/<uid>/visits/<id>/report.pdf`. Both shapes are in the
// data and both are live.
//
// Putting the second shape in an href or an iframe src is the bug this exists
// to prevent: a relative path resolves against the dashboard's own origin, and
// the single-page app's catch-all redirect answers with index.html — so
// "Open PDF" opened a second copy of the dashboard instead of the document,
// with no error anywhere to say why.

/** True only for something a browser can fetch on its own. */
export const isAbsoluteUrl = (ref) => /^https?:\/\//i.test(String(ref || '').trim());

/**
 * True when the reference has to be resolved before it can be shown —
 * i.e. it is a storage path and needs reading through the media broker.
 */
export const needsResolving = (ref) => !!String(ref || '').trim() && !isAbsoluteUrl(ref);

export default { isAbsoluteUrl, needsResolving };
