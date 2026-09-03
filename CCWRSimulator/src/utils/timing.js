/**
 * Timing Adjustment — the intervals between the units acting (Operation
 * Manual 6.13), as the running program does them:
 *
 * - One row is selected at a time; tapping a row selects it, and the 3-D
 *   cutaway paints the hoppers that row is about.
 * - The single arrows move the selected row by 10 ms, the double arrows by
 *   100. A row at 0 does not go below it; nothing goes above 2550.
 * - The Entr keypad ("Time Input", 1..2550) writes straight into the row.
 */

export const initialTiming = (spec) => ({
  sel: spec.rows[0].key,
  values: Object.fromEntries(spec.rows.map((r) => [r.key, r.default])),
});

export const migrateTiming = (saved, spec) => {
  const fresh = initialTiming(spec);
  const values = { ...fresh.values, ...(saved?.values || {}) };
  const sel = spec.rows.some((r) => r.key === saved?.sel) ? saved.sel : fresh.sel;
  return { sel, values };
};

export const selectRow = (state, key) => ({ ...state, sel: key });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** An arrow press: ±10 or ±100 on the selected row, held inside the range. */
export function step(state, spec, delta) {
  const cur = state.values[state.sel];
  const next = clamp(cur + delta, spec.min, spec.max);
  return {
    state: { ...state, values: { ...state.values, [state.sel]: next } },
    changed: next - cur,
  };
}

/** Enter on the Time Input keypad. */
export function enter(state, spec, typed) {
  const n = parseInt(String(typed).replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(n)) return { state, reason: 'empty' };
  const next = clamp(n, spec.keypad.min, spec.keypad.max);
  return {
    state: { ...state, values: { ...state.values, [state.sel]: next } },
    reason: next === n ? null : 'clamped',
  };
}

/** Where a row's bar starts and how wide it is, in screen px. */
export function bar(state, spec, layout, key) {
  const row = spec.rows.find((r) => r.key === key);
  // A timeline of delays: the bar starts where the intervals before it end.
  const start = (row.startsAfter || []).reduce((sum, k) => sum + state.values[k], 0) * layout.pxPerMs;
  const x = Math.min(layout.max, layout.x + start);   // a start past the column stays at its edge
  const w = Math.min(state.values[key] * layout.pxPerMs, Math.max(0, layout.max - x));
  return { x, w };
}
