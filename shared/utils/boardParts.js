// shared/utils/boardParts.js
//
// Which part a board IS depends on which machine it is in.
//
// Board types carry a part number (shared/utils/boardTypes.js), which works for
// boards that are the same everywhere. It is wrong for the ones that are not:
// "Main Control Board" is a different part number on a bigger weigher, and a
// single number per type would confidently fill in the wrong one.
//
// A folder in the parts catalog IS one machine, and a line is already bound to a
// folder so its part lookup searches the right manual. That binding is therefore
// the machine identity this mapping needs — no new thing to set up, and no
// matching on model strings the catalog does not carry.
//
//   customers/{cid}/config/boardParts
//     { byMachine: { 'Shearers//CCW-R-214 #2': { 'Main Control Board': {…} } } }
//
// Stored per customer, like every other config, so a plant reads it with the
// rules they already have. Between customers it travels the same way as the
// checklists: copied by a push, not shared by reference.
//
// Resolution order when someone logs a replacement:
//
//   1. this machine's mapping   — picked from that machine's own manual, so it
//                                 is a VERIFIED part
//   2. the board type's number  — JTI's general default, unverified
//   3. nothing
//
// Ordered that way because specific beats general, and because only the first
// one was chosen with a particular machine in front of somebody.

import { partForType, mappedPickedPart } from './boardTypes.js';

// A machine's key. Folders are namespaced per parts-customer in the catalog, so
// the customer has to be part of the key or two plants' "Line 1" folders collide.
// '//' cannot appear in either half — a folder name with a slash still cannot
// produce a double slash unless someone types one deliberately.
export const machineKey = (binding) => {
  const c = String(binding?.partsCustomer ?? '').trim();
  const f = String(binding?.folder ?? '').trim();
  return c && f ? `${c}//${f}` : null;
};

export const machineLabel = (binding) => {
  const k = machineKey(binding);
  return k ? k.replace('//', ' · ') : '';
};

// Everything mapped for one machine: { [boardTypeName]: part }
export function partsForMachine(boardParts, binding) {
  const key = machineKey(binding);
  if (!key) return {};
  return (boardParts?.byMachine || {})[key] || {};
}

// Case-insensitive, so a board type renamed "main control board" keeps its
// mapping. First exact match wins to keep it predictable.
function lookup(map, boardType) {
  const want = String(boardType ?? '').trim().toLowerCase();
  if (!want) return null;
  if (map[boardType]) return map[boardType];
  const hit = Object.entries(map).find(([k]) => k.toLowerCase() === want);
  return hit ? hit[1] : null;
}

/**
 * The part to pre-fill, and where it came from.
 *
 * Returns { part, source } with source 'machine' | 'type', or null. The caller
 * shows the source, because "this came off that machine's manual" and "this is
 * the number JTI keeps for this board" are different claims and the person
 * logging the job should be able to tell them apart.
 */
export function resolveBoardPart({ boardParts, binding, boardTypes, boardType }) {
  const mapped = lookup(partsForMachine(boardParts, binding), boardType);
  if (mapped?.partNumber) {
    return {
      source: 'machine',
      part: {
        partCode: mapped.partNumber,
        partName: mapped.partName || '',
        itemNo: mapped.itemNo || '',
        diagramId: mapped.diagramId || '',
        diagramName: mapped.diagramName || '',
        qty: 1,
        manualQty: mapped.manualQty ?? null,
        // Picked from this machine's own manual when it was set up, so it is as
        // good as picking it by hand now.
        fromMachine: true,
      },
    };
  }
  const generic = mappedPickedPart(partForType(boardTypes, boardType));
  return generic ? { source: 'type', part: generic } : null;
}

// What the editor writes: strip to the fields worth keeping, drop blanks so
// Firestore does not fill up with empty strings, and drop a row with no number.
export function cleanMapping(map) {
  const out = {};
  Object.entries(map || {}).forEach(([type, p]) => {
    const partNumber = String(p?.partNumber ?? '').trim();
    if (!partNumber) return;
    const entry = { partNumber };
    ['partName', 'itemNo', 'diagramId', 'diagramName'].forEach((k) => {
      const v = String(p?.[k] ?? '').trim();
      if (v) entry[k] = v;
    });
    if (p?.manualQty != null && p.manualQty !== '') entry.manualQty = p.manualQty;
    out[type] = entry;
  });
  return out;
}

// Merge one machine's mapping into the whole document, removing the machine
// entirely when it has nothing left rather than leaving an empty object behind.
export function withMachine(boardParts, binding, mapping) {
  const key = machineKey(binding);
  if (!key) return boardParts || { byMachine: {} };
  const byMachine = { ...(boardParts?.byMachine || {}) };
  const cleaned = cleanMapping(mapping);
  if (Object.keys(cleaned).length === 0) delete byMachine[key];
  else byMachine[key] = cleaned;
  return { ...(boardParts || {}), byMachine };
}

export const countMappings = (boardParts) =>
  Object.values(boardParts?.byMachine || {}).reduce((n, m) => n + Object.keys(m || {}).length, 0);

export default {
  machineKey, machineLabel, partsForMachine, resolveBoardPart,
  cleanMapping, withMachine, countMappings,
};
