// shared/utils/partLines.js
//
// How many of a part were actually replaced.
//
// A drawing can list ten of the same screw; replacing two of them is not the
// same job as replacing all ten, and a log that records only "screw" cannot
// tell the difference. So each part on a replacement carries its own count.
//
// Two different numbers are involved and conflating them causes real errors:
//
//   manualQty — how many of that part the drawing shows. A fact about the
//               machine, read from the parts manual. Guidance and a starting
//               point, NOT a limit: manuals are wrong sometimes, and one can
//               describe a single assembly where several were worked on.
//   qty       — how many were replaced. A fact about the job, entered by
//               whoever did it, and never overruled by the manual.
//
// The catalog calls its number `qty`, and a stored part calls the replaced
// count `qty` too. That collision is why conversion happens here, at the
// boundary, instead of being repeated at each call site with the odds of one
// of them getting it backwards.

// The manual's count as a usable number, or null when it can't be trusted.
//
// Manuals are transcribed text, not a database: a quantity can arrive as "2",
// as "2 pcs", as "AR" for as-required, or blank. A number we can't read means
// no ceiling rather than a wrong one — better to allow an unusual count than to
// block a genuine repair because the manual was untidy.
export function manualQty(catalogPart) {
  if (!catalogPart) return null;
  // Which field to read is decided by whether `manualQty` EXISTS, not by
  // whether it has a value. A catalog part has no such key and its `qty` IS the
  // drawing count; a picked or stored part has the key, and its `qty` is the
  // replaced count. Falling through from an empty manualQty to qty read "1
  // replaced" as "the drawing shows 1" and silently locked the quantity control
  // at 1 for every part whose manual quantity could not be read.
  const raw = 'manualQty' in catalogPart ? catalogPart.manualQty : catalogPart.qty;
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).match(/\d+/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Force a count to be a whole number of at least one. `max` is optional and
// used only where a ceiling genuinely applies; the drawing count is not one.
export function clampQty(n, max) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return max ? Math.min(v, max) : v;
}

// A catalog part, as the picker holds it while the form is open.
//
// The replaced count starts at 1 — the overwhelmingly common case, and the only
// possible answer when the drawing shows one. Nobody should have to type "1"
// for every part they fit.
export function asPicked(catalogPart) {
  const max = manualQty(catalogPart);
  return { ...catalogPart, manualQty: max, qty: 1 };
}

// Picker shape → the shape written to the log.
export function toStored(p) {
  const max = manualQty(p);
  return {
    partNumber: p.partCode || String(p.itemNo || ''),
    partName: p.partName || '',
    itemNo: p.itemNo || '',
    diagramId: p.diagramId || '',
    diagramName: p.diagramName || '',
    // NOT clamped to the drawing count. What someone says they replaced is the
    // record; the manual is a reference, and quietly rewriting the number they
    // entered would make the log lie about the job.
    qty: clampQty(p.qty, null),
    // Kept so a reader can see "2 of the 10 on the drawing" long after the
    // fact, without having to open the manual again.
    manualQty: max || '',
  };
}

// Log shape → picker shape, for reopening a saved entry.
export function fromStored(p) {
  const max = manualQty(p);
  return {
    partCode: p.partNumber,
    partName: p.partName,
    itemNo: p.itemNo,
    diagramId: p.diagramId,
    diagramName: p.diagramName,
    manualQty: max,
    qty: clampQty(p.qty, null),
  };
}

// Every part on an entry, in one shape, whatever era the entry is from.
//
// Entries predating multi-part support carry a single partNumber/partName, and
// entries predating quantities carry no count at all. Both still have to render
// — an old log is not a broken log, and a missing count means one.
export function partLines(entry) {
  const list = Array.isArray(entry?.parts) && entry.parts.length
    ? entry.parts
    : (entry?.partNumber
        ? [{ partNumber: entry.partNumber, partName: entry.partName }]
        : []);
  return list.map((p) => ({
    partNumber: p.partNumber || '',
    partName: p.partName || '',
    qty: clampQty(p.qty, null),
    manualQty: manualQty(p),
  }));
}

// Identity of a part on a replacement: the same item, on the same drawing.
// Two different bolts can share a code across drawings, so the drawing is part
// of the identity rather than the code alone.
export const partKey = (p) =>
  `${p?.diagramId || ''}|${p?.itemNo || ''}|${p?.partCode || p?.partNumber || ''}`;

// Add parts to the ones already chosen, keeping what is there.
//
// Picking a second time used to REPLACE the list, so adding a gasket to a board
// silently discarded the board. Anything already present — including the
// primary part, passed separately — is left alone rather than duplicated.
export function mergeParts(existing = [], incoming = [], primary = null) {
  const seen = new Set([
    ...(primary ? [partKey(primary)] : []),
    ...existing.map(partKey),
  ]);
  const added = [];
  for (const p of incoming) {
    const k = partKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    added.push(p);
  }
  return [...existing, ...added];
}

// "×2" for a part fitted more than once, nothing for a single one. A log full
// of "×1" is noise that hides the one line that says "×4".
export function qtyLabel(qty) {
  const n = clampQty(qty, null);
  return n > 1 ? `×${n}` : '';
}

export default {
  manualQty, clampQty, asPicked, toStored, fromStored,
  partLines, qtyLabel, partKey, mergeParts,
};
