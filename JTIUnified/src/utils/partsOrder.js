// src/utils/partsOrder.js
//
// A parts order, whichever app wrote it.
//
// Orders are built in the Parts Viewer and have until now existed only as a
// JSON file in somebody's Downloads folder, filed by hand into an iCloud
// folder named after the plant. That means "what did we order for Flagstone in
// April?" is a question only one laptop can answer, and only if the file was
// filed correctly.
//
// So they are stored, and this is the shape they are stored in. Two apps write
// orders and they do not agree on a format:
//
//   Customer viewer  { customer, exportDate, orderCount, totalQuantity,
//                      orderItems: [ {...} ] }
//   Internal viewer  { exportDate, orderList: { key: {...} },
//                      metadata: { totalItems, totalQuantity, diagrams } }
//
// Both are accepted, because the historical files are both and rejecting one
// would mean retyping it. What comes out is a single record whose fields mean
// the same thing whatever wrote it.
//
// The CUSTOMER is deliberately not taken from the file. `customer` in an export
// is whatever the viewer happened to be showing — every real file says
// "Multiple Customers (6)", which is not a plant and never joins to one. The
// customer comes from the page the order is filed against, where a person is
// looking at the plant's name while they do it.

const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

/** One line of an order, from either app's spelling of it. */
const normalizeItem = (raw, key = '') => ({
  orderKey: str(raw?.orderKey || key),
  partCode: str(raw?.partCode || raw?.part_code || raw?.code),
  partName: str(raw?.partName || raw?.part_name || raw?.name),
  // The number ON THE DIAGRAM (a hotspot, "32"), not the part code. Both are
  // called "number" by somebody, and confusing them makes an order unorderable.
  partNumber: str(raw?.partNumber || raw?.part_number),
  // How many the machine uses, as printed in the manual.
  qty: str(raw?.qty || raw?.quantity),
  // How many were actually ordered. This is the number that matters.
  orderQty: num(raw?.orderQty ?? raw?.order_qty),
  diagramId: str(raw?.diagramId),
  diagramName: str(raw?.diagramName),
  diagramNumber: str(raw?.diagramNumber),
});

/** Is this an export of DIAGRAMS rather than an order? */
export const isDiagramExport = (data) =>
  !!data && Array.isArray(data.diagrams) && !data.orderItems && !data.orderList;

/**
 * Read an exported file into the stored record, or explain why not.
 *
 * Returns { order } or { error }. Never throws on a bad file: the person
 * uploading picked it from a folder of forty JSONs, and the useful answer is
 * which one they picked by mistake.
 */
export const readOrderExport = (data, { customer, customerId = '', fileName = '', now = new Date() } = {}) => {
  if (!data || typeof data !== 'object') return { error: 'That file is not a parts order.' };
  if (isDiagramExport(data)) {
    return { error: `That is a diagram export (${data.diagrams.length} diagrams), not a parts order. Diagrams are imported in the Parts Viewer.` };
  }

  let items = [];
  if (Array.isArray(data.orderItems)) {
    items = data.orderItems.map((it) => normalizeItem(it));
  } else if (data.orderList && typeof data.orderList === 'object') {
    items = Object.entries(data.orderList).map(([key, it]) => normalizeItem(it, key));
  } else {
    return { error: 'That file has no order lines in it (no orderItems or orderList).' };
  }

  // A line nobody ordered any of is noise from the viewer's working list.
  items = items.filter((it) => it.orderQty > 0 || it.partCode || it.partName);
  if (!items.length) return { error: 'That order is empty.' };

  const name = str(customer);
  if (!name) return { error: 'An order has to be filed against a customer.' };

  return {
    order: {
      customer: name,
      customerId: str(customerId),
      // The date the order was BUILT, not the day somebody got round to
      // uploading it — these files are being filed years after the fact.
      orderedAt: str(data.exportDate) || now.toISOString(),
      uploadedAt: now.toISOString(),
      fileName: str(fileName),
      itemCount: items.length,
      totalQuantity: items.reduce((sum, it) => sum + it.orderQty, 0),
      // Which manuals it was picked from, for a one-line summary that says
      // something ("Drive Weigh Unit, RCU") rather than just a count.
      diagrams: [...new Set(items.map((it) => it.diagramName).filter(Boolean))],
      items,
    },
  };
};

/** Newest first — an order list is read from the top. */
export const byNewest = (a, b) => str(b?.orderedAt).localeCompare(str(a?.orderedAt));

/** Does any line of this order match the search? */
export const orderMatches = (order, matches) => {
  if (!order) return false;
  if (matches(order.customer) || matches(order.fileName)) return true;
  return (order.items || []).some((it) => (
    matches(it.partCode) || matches(it.partName) || matches(it.partNumber)
    || matches(it.diagramName) || matches(it.diagramNumber)
  ));
};

/** The lines of this order that match, for showing under the result. */
export const matchingLines = (order, matches) => (order?.items || []).filter((it) => (
  matches(it.partCode) || matches(it.partName) || matches(it.partNumber)
  || matches(it.diagramName) || matches(it.diagramNumber)
));

export default { readOrderExport, isDiagramExport, byNewest, orderMatches, matchingLines };
