/**
 * Feeder adjustment — the amplitude and time of the radial and dispersion
 * feeders, which is how you change the amount of product reaching the pool
 * hoppers (Operation Manual 6.12).
 *
 * The procedure the manual sets out, and which this models:
 *
 *   1. Press the head numbers to adjust. More than one is allowed, and the
 *      pressed heads turn blue.
 *   2. Light the Time lamp key to change the feeder driving time, the AMP lamp
 *      key to change the amplitude. Both may be lit at once.
 *   3. Press Increase or Decrease. The values of the SELECTED heads change.
 *
 * RF is per head — there is one radial feeder behind each pool hopper — while
 * DF is the single dispersion feeder, so its values are not per head and the
 * head strip does not apply to it.
 *
 * No range is enforced. The limits live in Feeder Drive Specifications, and the
 * pages covering it (4.4.3.1, manual pages 4-19 to 4-25) are missing from both
 * copies of the Service Manual we hold. Inventing a ceiling would be teaching a
 * number nobody can check, so the values simply move and the notes say where
 * the real limits are documented.
 */

export const FEEDERS = ['rf', 'df'];
export const PARAMS = ['time', 'amp'];

/** Starting state: every head at the machine's own displayed values. */
export function initialFeeder(spec) {
  const { time, amp } = spec.defaults;
  const rf = {};
  for (const h of spec.heads) rf[h.no] = { time, amp };
  return {
    feeder: 'rf',            // which feeder the keys act on
    heads: [1],              // selected head numbers (RF only)
    params: { time: true, amp: false },
    rf,
    df: { time, amp },
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Toggle a head in or out of the selection. */
export function toggleHead(state, no) {
  const on = state.heads.includes(no);
  return {
    ...state,
    heads: on ? state.heads.filter((h) => h !== no) : [...state.heads, no].sort((a, b) => a - b),
  };
}

export const toggleParam = (state, which) => ({
  ...state,
  params: { ...state.params, [which]: !state.params[which] },
});

export const selectFeeder = (state, feeder) => ({ ...state, feeder });

/**
 * Increase or decrease the lit parameters.
 *
 * On RF this moves every selected head; on DF there is only one feeder. With no
 * lamp lit nothing moves — the manual makes lighting a lamp step 2 of the
 * procedure, and a key that silently changed something without it would teach
 * the wrong habit.
 */
export function adjust(state, spec, direction) {
  const lit = PARAMS.filter((p) => state.params[p]);
  if (!lit.length) return { state, changed: [], reason: 'no-param' };
  if (state.feeder === 'rf' && !state.heads.length) {
    return { state, changed: [], reason: 'no-head' };
  }

  const changed = [];
  const bump = (values) => {
    const next = { ...values };
    for (const p of lit) {
      next[p] = round1(Math.max(0, values[p] + direction * spec.step[p]));
      changed.push(p);
    }
    return next;
  };

  if (state.feeder === 'df') {
    return { state: { ...state, df: bump(state.df) }, changed, reason: null };
  }
  const rf = { ...state.rf };
  for (const h of state.heads) rf[h] = bump(rf[h]);
  return { state: { ...state, rf }, changed, reason: null };
}

/** The values the keys are currently acting on, for the readout. */
export function shownValues(state) {
  if (state.feeder === 'df') return state.df;
  const heads = state.heads.length ? state.heads : [1];
  const first = state.rf[heads[0]];
  // With several heads selected they can hold different values; say so rather
  // than showing one head's number as if it spoke for all of them.
  const mixed = (p) => heads.some((h) => state.rf[h][p] !== first[p]);
  return {
    time: mixed('time') ? null : first.time,
    amp: mixed('amp') ? null : first.amp,
  };
}

export const formatValue = (v) => (v === null ? '– –' : v.toFixed(1));
