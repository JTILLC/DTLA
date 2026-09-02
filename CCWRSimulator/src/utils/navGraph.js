/**
 * Pure helpers over the navigation map. Used by the app and by the tests.
 */

/**
 * Every navigation edge as {from, to}, hotspots plus the Machine Set drawer.
 *
 * Two things this has to get right, both of which were once wrong here:
 * `screens` and `drawTabOn` overlap, so the screens they name are de-duplicated
 * rather than counted twice; and a drawer item with `to: null` (real on the
 * unit, no artwork captured) opens nothing and is not an edge.
 */
export function allEdges(navmap) {
  const edges = [];
  for (const [from, s] of Object.entries(navmap.screens)) {
    for (const h of s.hotspots) edges.push({ from, to: h.to });
  }
  const ms = navmap.machineSet;
  if (ms) {
    const openable = ms.items.filter((i) => i.to);
    for (const from of drawerScreens(navmap)) {
      for (const item of openable) edges.push({ from, to: item.to });
    }
  }
  return edges;
}

/** The screens that carry the Machine Set tab, each once. */
export function drawerScreens(navmap) {
  const ms = navmap.machineSet;
  if (!ms) return [];
  return [...new Set([...(ms.screens || []), ...(ms.drawTabOn || [])])];
}

/** Screens reachable from `start` by tapping. */
export function reachable(navmap, start = 'main-menu') {
  const adj = {};
  for (const { from, to } of allEdges(navmap)) {
    (adj[from] ||= new Set()).add(to);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const s = queue.shift();
    for (const t of adj[s] || []) {
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return seen;
}

/** Screens that can get back to `target` (no dead ends when it's main-menu). */
export function canReach(navmap, target = 'main-menu') {
  const back = {};
  for (const { from, to } of allEdges(navmap)) {
    (back[to] ||= new Set()).add(from);
  }
  const seen = new Set([target]);
  const queue = [target];
  while (queue.length) {
    const s = queue.shift();
    for (const t of back[s] || []) {
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return seen;
}

/** True when the point (px in the 800x600 canvas) is inside the rect. */
export function pointInRect(pt, rect) {
  return (
    pt.x >= rect.x && pt.x <= rect.x + rect.w &&
    pt.y >= rect.y && pt.y <= rect.y + rect.h
  );
}
