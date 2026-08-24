// src/utils/ccwLink.js
//
// A link from a record here to the visit it came from in CCW Issues.
//
// Everything on a customer's page — a head that went offline, a service visit —
// exists in the weigher app, and the way back was to open that app, pick the
// customer, find the visit in the list and then find the line and head. Four
// steps from a row that already knows all four answers.
//
// CCW takes `?id=<visitId>&customer=<customerId>&line=<title>&head=<number>`,
// loads that visit and scrolls the head into view. The customer id is optional
// there — without it the app looks through every customer for the visit — so it
// is passed whenever we have it and left out when we do not, rather than
// guessing.
const CCW_URL = 'https://jti-issues.pages.dev';

export const ccwVisitLink = ({ visitId, customerId, line, head } = {}) => {
  const id = String(visitId || '').trim();
  if (!id) return null;          // nothing to open — the caller hides the link

  const params = new URLSearchParams({ id });
  if (customerId) params.set('customer', String(customerId));
  if (line) params.set('line', String(line));
  // A head of 0 is not a head; anything else that was recorded is worth passing.
  if (head || head === 0) {
    const h = String(head).trim();
    if (h) params.set('head', h);
  }
  return `${CCW_URL}/?${params.toString()}`;
};

export default ccwVisitLink;
