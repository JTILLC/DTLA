/**
 * The process behind the Live toggle: product moving through the weigher,
 * so the screens answer to the settings the way a running CCW-R does.
 *
 * Built from Josh's "Running the CCW-R" and the Operation Manual:
 *
 * - The dispersion table (DF) is held near the DF target weight by the
 *   infeed, and throws product out to the fourteen radial feeders (RF) in
 *   proportion to the DF time and amplitude.
 * - Each RF doses its pool hopper (PH) in proportion to its own time and
 *   amplitude, and more when product has piled up on it - that is how a DF
 *   target set too high forces product into the hoppers.
 * - The PH drops into the weigh hopper (WH) as soon as the WH is empty.
 * - Each cycle the lightest combination not under target, inside the upper
 *   limit, is discharged. None in range is a MISSED cycle: 0.0 g with a red
 *   dash when there was not enough product (under), a yellow dash when every
 *   combination was over. Four overweight misses in a row is the OVERWEIGHT
 *   ERROR: production stops and offers ErrClr&Stop or ErrClr&Rst (Rst dumps
 *   a few weigh hoppers, re-feeds them and restarts).
 * - A WH past target + upper limit is an OVERSCALE: dumped on its own and
 *   marked with the red X for that cycle.
 *
 * With the default settings (25.0 / 50.0 on every feeder, DF at 500 g, a
 * 90 g target at 80 wpm) the numbers balance: about a quarter of the target
 * per head, four heads to a combination, the DF throwing off one target's
 * worth per cycle.
 */

export const HEADS = 14;

export const round1 = (v) => Math.round(v * 10) / 10;

/** A primed machine, as at the end of the start-up: product on the DF and
 *  the trays, a dose in every pool and weigh hopper (a little uneven, so the
 *  first combinations are real ones). */
export function initialProcess(inputs, spec) {
  const nominal = inputs.target * (spec?.rf.doseFrac ?? 0.25);
  const spread = (i) => 0.86 + 0.07 * (i % 5);
  return {
    df: inputs.dfTargetWt,
    tray: Array.from({ length: HEADS }, () => nominal * (spec?.rf.pileNominal ?? 3)),
    ph: Array.from({ length: HEADS }, (_, i) => round1(nominal * spread(i + 2))),
    wh: Array.from({ length: HEADS }, (_, i) => (inputs.deactivated?.includes(i + 1) ? 0 : round1(nominal * spread(i)))),
    cycle: 0,
    result: 'idle',          // 'ok' | 'under' | 'over' | 'idle'
    combo: [],
    weight: null,
    overMisses: 0,
    overscale: [],           // heads dumped this cycle for being past target + upper
    error: null,             // null | 'overweight'
    log: [],                 // last few cycle results, newest last
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The lightest combination not under target, inside the upper limit. */
export function bestCombination(wh, active, target, upper, lower, size) {
  const heads = active.filter((no) => wh[no - 1] > 0);
  const lo = lower === null || lower === undefined ? target : target - lower;
  const hi = target + upper;
  let best = null;
  let lightestAbove = Infinity;     // the lightest combination that reaches target at all
  const n = heads.length;
  const rec = (start, chosen, sum) => {
    if (chosen.length >= size.min && sum >= lo) {
      if (sum < lightestAbove) lightestAbove = sum;
      if (sum <= hi && (!best || sum < best.sum)) best = { sum, nos: [...chosen] };
    }
    if (chosen.length === size.max) return;
    for (let i = start; i < n; i += 1) {
      const s = sum + wh[heads[i] - 1];
      if (s > hi) {
        // Past the limit already: note it as a reachable-but-over sum and
        // do not go deeper, since every deeper sum is heavier still.
        if (chosen.length + 1 >= size.min && s < lightestAbove) lightestAbove = s;
        continue;
      }
      chosen.push(heads[i]);
      rec(i + 1, chosen, s);
      chosen.pop();
    }
  };
  rec(0, [], 0);
  if (best) return { ok: true, ...best };
  // Nothing in range: OVER when the lightest combination that reaches target
  // is past the upper limit (too much product), UNDER when none reaches it.
  return { ok: false, reason: Number.isFinite(lightestAbove) ? 'over' : 'under', sum: 0 };
}

export function stepProcess(state, inputs, spec, rnd = Math.random) {
  const s = {
    ...state,
    tray: [...state.tray], ph: [...state.ph], wh: [...state.wh],
    overscale: [], cycle: state.cycle + 1,
  };
  const active = [];
  for (let no = 1; no <= HEADS; no += 1) if (!inputs.deactivated.includes(no)) active.push(no);
  const noise = () => 1 + (rnd() * 2 - 1) * spec.rf.noise;

  // 1. The infeed keeps the dispersion table near its target weight.
  if (inputs.infeed !== false) s.df += (inputs.dfTargetWt - s.df) * spec.df.infeedFrac;

  // 2. The DF throws product out to the radial feeders.
  const dfOut = s.df * spec.df.outFrac * (inputs.dfAmp / 50) * (inputs.dfTime / 25);
  s.df = Math.max(0, s.df - dfOut);
  for (const no of active) s.tray[no - 1] += dfOut / active.length;

  // 3. Each RF doses its pool hopper when the pool hopper is empty.
  const nominalDose = inputs.target * spec.rf.doseFrac;
  for (const no of active) {
    const i = no - 1;
    if (s.ph[i] > 0) continue;
    const rf = inputs.rf[no] || { time: 25, amp: 50 };
    const pile = s.tray[i] / (nominalDose * spec.rf.pileNominal);
    let dose = nominalDose * (rf.amp / 50) * (rf.time / 25) * (1 + spec.rf.pileGain * Math.max(0, pile - 1)) * noise();
    dose = Math.min(dose, s.tray[i]);
    s.tray[i] -= dose;
    s.ph[i] = Math.round(dose * 10) / 10;
  }

  // 4. The pool hopper drops into an empty weigh hopper.
  for (const no of active) {
    const i = no - 1;
    if (s.wh[i] === 0 && s.ph[i] > 0) { s.wh[i] = s.ph[i]; s.ph[i] = 0; }
  }

  // 5. Overscale: a weigh hopper past target + upper limit is dumped.
  for (const no of active) {
    const i = no - 1;
    if (s.wh[i] > inputs.target + inputs.upper) { s.overscale.push(no); s.wh[i] = 0; }
  }

  // 6. The combination.
  const c = bestCombination(s.wh, active, inputs.target, inputs.upper, inputs.lower, spec.combo);
  if (c.ok) {
    s.result = 'ok';
    s.combo = c.nos;
    s.weight = Math.round(c.sum * 10) / 10;
    s.overMisses = 0;
    for (const no of c.nos) s.wh[no - 1] = 0;
  } else {
    s.result = c.reason;
    s.combo = [];
    s.weight = 0;
    s.overMisses = c.reason === 'over' ? s.overMisses + 1 : 0;
    if (s.overMisses >= spec.missesToError) s.error = 'overweight';
  }
  s.log = [...s.log.slice(-9), s.result];
  return s;
}

/** ErrClr&Rst: dump the heaviest few weigh hoppers so they re-feed, and go on. */
export function clearAndRestart(state) {
  const order = state.wh.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]).slice(0, 3);
  const wh = [...state.wh];
  for (const [, i] of order) wh[i] = 0;
  return { ...state, wh, error: null, overMisses: 0, result: 'idle', combo: [], weight: null };
}

/** ErrClr&Stop: the error goes, the product stays where it is. */
export const clearAndStop = (state) => ({ ...state, error: null, overMisses: 0, result: 'idle', combo: [] });

