// src/ui/views.js
//
// Which view is open, decided by the URL instead of by seven booleans.
//
// There were seven mutually-exclusive flags — showCalendar, showMap,
// showTroubleshoot, showServiceReports, showRecords, showPacket, plus a
// selected customer — and the dashboard body was guarded by the negation of all
// of them:
//
//   {!searchResults && !selectedCustomer && !showCalendar && !showMap
//    && !showTroubleshoot && !showServiceReports && !showRecords && !showPacket
//
// That line grew every time a view was added, and adding one meant editing
// three places and remembering to close the others by hand. Seven booleans
// describe 128 states, of which 8 are legal; the URL describes exactly the 8.
//
// It also buys the thing that made this worth doing: a link. "Open the packet
// for 2026028" or "look at Flagstone Foods" become addresses somebody can send,
// and the browser's back button starts working.
//
// Deliberately not react-router. The whole app is one large component and
// every view is already rendered inline; adopting a router would mean pulling
// each one out into a route component in the same change. This is the routing
// part of that without the restructuring part, and it does not stop a router
// being adopted later.

/** Path segment ↔ view key. The empty path is the dashboard. */
export const VIEWS = {
  board: 'board',
  calendar: 'calendar',
  map: 'map',
  troubleshoot: 'troubleshoot',
  reports: 'reports',
  records: 'records',
  packet: 'packet',
};

export const HOME = 'home';
export const CUSTOMER = 'customer';

/** A customer name as a URL segment, and back again. */
export const toSlug = (name) => String(name || '')
  .trim().toLowerCase()
  .replace(/&/g, ' and ')
  // Apostrophes are removed, not turned into a separator: a possessive is part
  // of the word, so "Reser's" is resers rather than reser-s. Same rule as
  // normalizeCustomerName, and for the same reason — the two must agree or a
  // link built here will not find the customer it names.
  .replace(/['’‘`]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/**
 * Read a location into { view, customerSlug, sr }.
 *
 * Anything unrecognised is the dashboard rather than an error page: a stale
 * bookmark should land somewhere useful, not on a dead end.
 */
export const parsePath = (pathname = '/') => {
  const parts = String(pathname || '/').split('/').filter(Boolean);
  if (parts.length === 0) return { view: HOME };

  const [head, rest] = parts;
  if (head === 'customer' && rest) return { view: CUSTOMER, customerSlug: rest };
  // A packet deep link may name its service report: /packet/2026028
  if (head === 'packet') return { view: VIEWS.packet, sr: rest || '' };
  if (VIEWS[head]) return { view: VIEWS[head] };
  return { view: HOME };
};

/** ...and back to a path, so the two can never disagree. */
export const toPath = ({ view, customerSlug, sr } = {}) => {
  if (view === CUSTOMER && customerSlug) return `/customer/${customerSlug}`;
  if (view === VIEWS.packet && sr) return `/packet/${sr}`;
  if (view && view !== HOME && VIEWS[view]) return `/${view}`;
  return '/';
};

/**
 * Find the customer whose name matches a slug.
 *
 * Matched on the slug rather than the raw name because a name that survives a
 * round trip through a URL is not the name that went in — "Reser's Fine Foods"
 * comes back without its apostrophe.
 */
export const customerFromSlug = (slug, customers = []) =>
  customers.find((c) => toSlug(c?.name ?? c) === String(slug || '')) || null;

export default { VIEWS, HOME, CUSTOMER, parsePath, toPath, toSlug, customerFromSlug };
