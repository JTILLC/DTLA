// shared/utils/boardTypes.js
//
// A board type, and the part number it maps to.
//
// Board types started as bare strings — "Power Supply", "I/O Board" — and log
// entries still store the type that way on purpose, so renaming a type never
// rewrites history. That stays true. What changes here is the LIST: an entry may
// now carry the part number that board is, so someone logging a replacement gets
// the part filled in instead of hunting for it in a manual while standing at a
// machine that is down.
//
//   'Power Supply'                                    ← what was stored
//   { name: 'Power Supply', partNumber: 'SB-104778' } ← what is stored now
//
// Both shapes are read. `normalize` is the only thing that decides which is
// which, so every screen sees objects and no screen has to care.
//
// The mapping is guidance, not a rule. It pre-fills a part that the person
// logging the job can change or remove — the same part they would have picked
// by hand. What it must never do is quietly ADD a part to a job that did not use
// one, so pre-fill only ever happens into an empty picker.

export const typeName = (t) => (typeof t === 'string' ? t : String(t?.name ?? '')).trim();

// One board type, in object form. Unknown keys are dropped rather than carried,
// so a template pushed from an older app version can't smuggle stale fields in.
export function normalizeType(t) {
  const name = typeName(t);
  if (!name) return null;
  if (typeof t === 'string') return { name };
  const part = {
    partNumber: String(t.partNumber ?? '').trim(),
    partName: String(t.partName ?? '').trim(),
    itemNo: String(t.itemNo ?? '').trim(),
    diagramId: String(t.diagramId ?? '').trim(),
    diagramName: String(t.diagramName ?? '').trim(),
  };
  // A part name with no number is not a mapping — it's a note someone half-typed.
  if (!part.partNumber) return { name };
  return {
    name,
    ...Object.fromEntries(Object.entries(part).filter(([, v]) => v !== '')),
  };
}

export const normalizeTypes = (raw) =>
  (Array.isArray(raw) ? raw : []).map(normalizeType).filter(Boolean);

// Names only — for the <select> in the replacement form, whose value stays a
// string because that is what a log entry records.
export const typeNames = (raw) => normalizeTypes(raw).map((t) => t.name);

export const hasPart = (t) => !!normalizeType(t)?.partNumber;

// The mapping for a chosen type name, or null. Matched case-insensitively so a
// type renamed "power supply" still finds its part.
export function partForType(raw, name) {
  const want = typeName(name).toLowerCase();
  if (!want) return null;
  const found = normalizeTypes(raw).find((t) => t.name.toLowerCase() === want);
  return found?.partNumber ? found : null;
}

/**
 * The mapped part as the picker wants it.
 *
 * `qty: 1` because a board is replaced one at a time; `manualQty: null` because
 * the mapping does not know how many the drawing shows. `verified` is false —
 * this part came from a list JTI typed, not from the machine's own manual, and
 * the log should not claim otherwise. If the part is also found in the line's
 * bound folder the picker upgrades it on its own.
 */
export function mappedPickedPart(mapping) {
  const m = normalizeType(mapping);
  if (!m?.partNumber) return null;
  return {
    partCode: m.partNumber,
    partName: m.partName || '',
    itemNo: m.itemNo || '',
    diagramId: m.diagramId || '',
    diagramName: m.diagramName || '',
    qty: 1,
    manualQty: null,
    fromBoardType: true,
  };
}

export default { typeName, normalizeType, normalizeTypes, typeNames, hasPart, partForType, mappedPickedPart };
