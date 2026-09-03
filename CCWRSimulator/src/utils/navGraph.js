/**
 * Pure helpers over the navigation map. Used by the app and by the tests.
 */

/** The pop-up drawers on the map: Machine Set (bottom) and Select Total (left). */
export function drawers(navmap) {
  return [navmap.machineSet, navmap.selectTotal].filter(Boolean);
}

/**
 * Every navigation edge as {from, to}, hotspots plus the pop-up drawers
 * (Machine Set and Select Total).
 *
 * Two things this has to get right, both of which were once wrong here:
 * `screens` and `drawTabOn` overlap, so the screens they name are de-duplicated
 * rather than counted twice; and a drawer item with `to: null` (real on the
 * unit, no artwork captured) opens nothing and is not an edge.
 */
export function allEdges(navmap) {
  const edges = [];
  for (const [from, s] of Object.entries(navmap.screens)) {
    // A key that only toggles a lamp or types a digit has no `to` and is not
    // an edge; a wait pop-up that clears itself (autoNext) is one.
    for (const h of s.hotspots) if (h.to) edges.push({ from, to: h.to });
    if (s.autoNext) edges.push({ from, to: s.autoNext.to });
    // A screen that lands on a state first (a "loading" pop-up) leads there.
    if (s.onEnter) edges.push({ from, to: s.onEnter });
  }
  for (const drawer of drawers(navmap)) {
    const openable = drawer.items.filter((i) => i.to);
    for (const from of drawerScreens(drawer)) {
      for (const item of openable) edges.push({ from, to: item.to });
    }
  }
  return edges;
}

/** The screens that carry the given drawer's tab, each once. */
export function drawerScreens(drawer) {
  if (!drawer) return [];
  return [...new Set([...(drawer.screens || []), ...(drawer.drawTabOn || [])])];
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

/** The base screen a state belongs to: `run-feeder@bar` -> `run-feeder`. */
export function baseOf(navmap, slug) {
  const s = navmap.screens[slug];
  return (s && s.parent) || slug;
}

/**
 * Whether a key's conditions hold. `flags` is the machine's state — power,
 * running, access level and so on. Free mode passes everything, since it
 * withholds nothing by design.
 */
export function conditionsMet(requires, flags, freeMode) {
  if (freeMode || !requires || !requires.length) return true;
  const test = {
    power: () => Boolean(flags.power),
    running: () => Boolean(flags.running),
    stopped: () => !flags.running,
    level4: () => flags.level === 4,
    avg: () => Boolean(flags.avg),
    drain: () => Boolean(flags.drain),
    drainStopped: () => !flags.drain,
    homeDead: () => false,       // HOME is dimmed on this screen; Exit leaves
  };
  return requires.every((r) => (test[r] ? test[r]() : false));
}
