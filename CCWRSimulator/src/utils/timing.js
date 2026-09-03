/**
 * Timing Adjustment — the delays between the units acting (Operation Manual
 * 6.13), as the running program and a running machine do them:
 *
 * - One row is selected at a time; tapping a row selects it, and the 3-D
 *   cutaway paints the hoppers that row is about.
 * - The single arrows move the selected row by 10 ms, the double arrows by
 *   100. A row at 0 does not go below it; nothing goes above 2550.
 * - The Entr keypad ("Time Input", 1..2550) writes straight into the row.
 * - The bars are a timeline: each interval starts where the ones before it
 *   end, so raising IS-WH slides everything after it right.
 *
 * Which rows exist depends on the machine (navmap.timingAdjust.options): a
 * booster-hopper machine has the BH rows; a timing hopper or diverting timing
 * hoppers make it two sections, C1 (heads 1-8) and C2 (9-16). C1 adjusts TH1
 * and owns DTH1 and DTH2; C2 adjusts TH2 and owns DTH3 and DTH4. The values
 * are kept per unit, so TH1 and TH2 are separate numbers.
 */

export const OPTIONS = ['bh', 'th', 'dth'];

export const visibleRows = (spec, options) => spec.rows.filter((r) => !r.option || options?.[r.option]);

export const hasSections = (options) => Boolean(options?.th || options?.dth);

export const rowOf = (spec, key) => spec.rows.find((r) => r.key === key);

/** The unit number a per-section or per-DTH row is about right now. */
export function unitNo(row, state) {
  if (row.perSection) return state.section;
  if (row.perDth) return (state.section - 1) * 2 + state.dthPick + 1;
  return null;
}

/** Where the row's value lives: TH1/TH2 and DTH1..4 are separate numbers. */
export function valueKey(row, state) {
  const n = unitNo(row, state);
  return n === null ? row.key : `${row.key}${n}`;
}

export const rowLabel = (row, state) => row.label.replace('{n}', unitNo(row, state) ?? '');

export function initialTiming(spec) {
  const values = {};
  for (const r of spec.rows) {
    if (r.perSection) { values[`${r.key}1`] = r.default; values[`${r.key}2`] = r.default; }
    else if (r.perDth) for (let i = 1; i <= 4; i += 1) values[`${r.key}${i}`] = r.default;
    else values[r.key] = r.default;
  }
  return { sel: spec.rows[0].key, section: 1, dthPick: 0, values };
}

export function migrateTiming(saved, spec) {
  const fresh = initialTiming(spec);
  const values = { ...fresh.values };
  for (const [k, v] of Object.entries(saved?.values || {})) {
    if (k in values && Number.isFinite(v)) values[k] = v;
  }
  return {
    sel: rowOf(spec, saved?.sel) ? saved.sel : fresh.sel,
    section: saved?.section === 2 ? 2 : 1,
    dthPick: saved?.dthPick === 1 ? 1 : 0,
    values,
  };
}

export const selectRow = (state, key) => ({ ...state, sel: key });
export const setSection = (state, section) => ({ ...state, section: section === 2 ? 2 : 1 });
export const setDthPick = (state, pick) => ({ ...state, dthPick: pick === 1 ? 1 : 0 });

/** A row that the machine no longer has cannot stay selected. */
export function ensureVisible(state, spec, options) {
  const row = rowOf(spec, state.sel);
  if (row && (!row.option || options?.[row.option])) return state;
  return { ...state, sel: spec.rows[0].key };
}

export const current = (state, spec) => state.values[valueKey(rowOf(spec, state.sel), state)];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** An arrow press: ±10 or ±100 on the selected row, held inside the range. */
export function step(state, spec, delta) {
  const key = valueKey(rowOf(spec, state.sel), state);
  const cur = state.values[key];
  const next = clamp(cur + delta, spec.min, spec.max);
  return { state: { ...state, values: { ...state.values, [key]: next } }, changed: next - cur };
}

/** Enter on the Time Input keypad. */
export function enter(state, spec, typed) {
  const n = parseInt(String(typed).replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(n)) return { state, reason: 'empty' };
  const key = valueKey(rowOf(spec, state.sel), state);
  const next = clamp(n, spec.keypad.min, spec.keypad.max);
  return { state: { ...state, values: { ...state.values, [key]: next } }, reason: next === n ? null : 'clamped' };
}

/** Where a row's bar starts and how wide it is, in screen px. */
export function bar(state, spec, layout, row) {
  // A timeline of delays: the bar starts where the intervals before it end.
  const start = (row.after || []).reduce((sum, k) => sum + state.values[k], 0) * layout.pxPerMs;
  const x = Math.min(layout.max, layout.x + start);   // a start past the column stays at its edge
  const w = Math.min(state.values[valueKey(row, state)] * layout.pxPerMs, Math.max(0, layout.max - x));
  return { x, w };
}
