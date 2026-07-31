// shared/components/parts/partsApi.js
//
// The parts UI is shared by three apps; the way they TALK to the broker is not.
// The CCW apps use firebase/compat, Shearers uses the modular SDK, and each has
// its own idea of which plants it may ask about. Importing one implementation
// into the component would have made the component unshareable — which is
// exactly why Shearers ended up with its own copy of all of this.
//
// So the component asks for an implementation instead of importing one. Each
// app registers its own once, at startup.
//
// A module-level singleton rather than React context: these components are
// opened from several unrelated places in each app, and threading a provider
// through three different App trees is a lot of plumbing for one object that
// never changes after boot.

import { isAssembly } from '../../utils/partLines.js';

let impl = null;

// Called once per app at startup. Must supply:
//   fetchPartsForMachine(customer, folder) -> { parts: [...] }
//   fetchDiagrams(customer, folder)        -> { diagrams: [...] }
//   fetchDiagram(diagramId)                -> { hotspots: [...], name }
//   fetchDiagramImage(diagramId)           -> object URL (caller revokes)
export function configureParts(implementation) {
  impl = implementation;
}

// Fails loudly and specifically. An unconfigured app would otherwise show
// "cannot read property of null" from somewhere deep in a modal.
export function partsApi() {
  if (!impl) {
    throw new Error(
      'Parts UI used before configureParts() — call it once at app startup.'
    );
  }
  return impl;
}

// Pure ranking, so it lives with the component rather than being injected:
// an exact part number should beat an incidental substring in a description,
// because operators type the number far more often than the name.
export function searchParts(parts, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  for (const p of parts) {
    // The drawing's own assembly row is not a replaceable part.
    if (isAssembly(p)) continue;
    const code = (p.partCode || '').toLowerCase();
    const item = String(p.itemNo || '').toLowerCase();
    const name = (p.partName || '').toLowerCase();
    let score = -1;
    if (code === q || item === q) score = 0;
    else if (code.startsWith(q)) score = 1;
    else if (item.startsWith(q)) score = 2;
    else if (code.includes(q)) score = 3;
    else if (name.includes(q)) score = 4;
    if (score >= 0) scored.push({ p, score });
  }
  scored.sort((a, b) =>
    a.score - b.score
    || (a.p.partCode || '').localeCompare(b.p.partCode || '', undefined, { numeric: true })
  );
  return scored.slice(0, limit).map((s) => s.p);
}

export default { configureParts, partsApi, searchParts };
