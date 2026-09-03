/**
 * What is selected for zero adjustment.
 *
 * Blue means selected, and Start only zeroes what is selected. Two rules from
 * the machine, both of which shape this:
 *
 * - Individual pans can be picked by tapping them, not just the whole ring.
 *   Operation Manual 6.5 lists the hopper keys as "press an individual hopper
 *   to select it for adjustment".
 * - The weigh hoppers and the dispersion pan are NEVER selected together.
 *   4.4.6 zeroes the hoppers, then says "follow up with the zero adjustment for
 *   the dispersion table" and runs the whole procedure again. Picking one side
 *   clears the other.
 *
 * So the state is a set of hopper numbers OR the dispersion pan, never both.
 */

export const PAN_COUNT = 14;
export const TABLE = 'table';

/** The menu opens with every weigh hopper selected and the pan not. */
export const initialPans = () => ({
  heads: Array.from({ length: PAN_COUNT }, (_, i) => i + 1),
  table: false,
});

export const nothingSelected = (s) => !s.table && s.heads.length === 0;

/** Tap one weigh hopper. Selecting one clears the dispersion pan. */
export function togglePan(state, no) {
  const on = state.heads.includes(no);
  return {
    table: false,
    heads: on ? state.heads.filter((h) => h !== no)
              : [...state.heads, no].sort((a, b) => a - b),
  };
}

/**
 * Make sure one hopper is selected. Production's Feeder Adjust uses this when
 * a head is tapped while the dispersion feeder is picked: the tap brings the
 * radial feeders back with THAT head lit, and never toggles it off.
 */
export const ensurePan = (state, no) => (
  !state.table && state.heads.includes(no) ? state : togglePan(state, no)
);

/** The same selection in Feeder Adjust's words: heads, not weigh hoppers. */
export function describeHeads(state) {
  const n = state.heads.length;
  if (state.table || n === 0) return 'no head';
  if (n === PAN_COUNT) return 'all 14 heads';
  return `${n === 1 ? 'head' : 'heads'} ${state.heads.join(', ')}`;
}

/** Tap the dispersion pan. Selecting it clears every hopper. */
export function toggleTable(state) {
  return state.table ? { heads: [], table: false } : { heads: [], table: true };
}

/** Slct All WH — select every hopper, and clear the pan. */
export const selectAllHeads = (state) => (
  state.heads.length === PAN_COUNT && !state.table
    ? { heads: [], table: false }                 // pressed again: clear
    : { ...initialPans() }
);

/** Slct All DF — the pan alone. */
export const selectTable = (state) => toggleTable(
  state.table ? state : { heads: [], table: false },
);

/** Which label values in the map should be drawn blue. */
export function litLabels(state, tableLabel) {
  return state.table ? [tableLabel] : state.heads;
}

/** What Start would act on, for the message and the notes. */
export function describe(state) {
  if (state.table) return 'the dispersion table';
  const n = state.heads.length;
  if (n === 0) return 'nothing';
  if (n === PAN_COUNT) return 'all 14 weigh hoppers';
  if (n === 1) return `weigh hopper ${state.heads[0]}`;
  return `weigh hoppers ${state.heads.join(', ')}`;
}
