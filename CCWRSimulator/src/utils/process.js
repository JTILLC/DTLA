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
 * - The weigher never dumps exactly the target: the window is target +
 *   0.3 g up to target + upper limit + 0.3 g (90.3 to 93.3 g on this preset).
 * - A WH past that ceiling is the OVERSCALE ERROR: production stops, the
 *   dialog offers the same two keys, and clearing it dumps the hopper.
 *
 * Calibrated to the field rule of about three times the target on the DF:
 * at 25.0 / 50.0 on every feeder with 300 g on the DF and a 90 g target at
 * 80 wpm the numbers balance - about a quarter of the target per head, four
 * heads to a combination, the DF throwing off one target's worth per cycle.
 * The program's 500 g default feeds two thirds more than the heads take
 * away and floods the hoppers within a few dozen cycles. A feeder whose
 * amplitude x time falls below a threshold moves no product at all.
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
    overscale: [],           // heads past target + upper this cycle (the error)
    error: null,             // null | 'overweight' | 'overscale'
    errorInfo: null,         // for overscale: { no, weight, limit }
    log: [],                 // last few cycle results, newest last
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The lightest combination not under target, inside the upper limit. */
export function bestCombination(wh, active, target, upper, lower, size) {
  const heads = active.filter((no) => wh[no - 1] > 0);
  // The window is target + 0.3 up to target + upper + 0.3 (90.3 to 93.3 g on
  // this preset); the lower limit is not used here - a dump is never light.
  const minOver = size.minOver ?? 0;
  const lo = target + minOver;
  const hi = target + upper + minOver;
  let best = null;
  const n = heads.length;
  const rec = (start, chosen, sum) => {
    if (chosen.length >= size.min && sum >= lo && sum <= hi && (!best || sum < best.sum)) best = { sum, nos: [...chosen] };
    if (chosen.length === size.max) return;
    for (let i = start; i < n; i += 1) {
      const s = sum + wh[heads[i] - 1];
      if (s > hi) continue;           // every deeper sum is heavier still
      chosen.push(heads[i]);
      rec(i + 1, chosen, s);
      chosen.pop();
    }
  };
  rec(0, [], 0);
  if (best) return { ok: true, ...best };
  // Nothing in range. OVER means too much product in the weigh hoppers: the
  // heads hold so much that fewer than three of them would make the weight,
  // so every combination overshoots. Anything else is UNDER - not enough
  // product to make the weight.
  const held = heads.map((no) => wh[no - 1]);
  const mean = held.reduce((a, b) => a + b, 0) / Math.max(1, held.length);
  const over = held.length >= size.min && mean > target / (size.overHeads ?? 3);
  return { ok: false, reason: over ? 'over' : 'under', sum: 0 };
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

  // 2. The DF throws product out to the radial feeders - nothing at all
  //    below the feed threshold, where the pan does not move product.
  const dfFactor = (inputs.dfAmp / 50) * (inputs.dfTime / 25);
  const dfMoving = dfFactor >= (spec.df.minFeed ?? 0);
  const dfOut = dfMoving ? s.df * spec.df.outFrac * dfFactor : 0;
  s.df = Math.max(0, s.df - dfOut);
  for (const no of active) s.tray[no - 1] += dfOut / active.length;

  // 3. Each RF doses its pool hopper when the pool hopper is empty.
  const nominalDose = inputs.target * spec.rf.doseFrac;
  for (const no of active) {
    const i = no - 1;
    if (s.ph[i] > 0) continue;
    const rf = inputs.rf[no] || { time: 25, amp: 50 };
    const factor = (rf.amp / 50) * (rf.time / 25);
    if (factor < (spec.rf.minFeed ?? 0)) continue;      // too little drive: the trough does not feed
    const pile = s.tray[i] / (nominalDose * spec.rf.pileNominal);
    let dose = nominalDose * factor * (1 + spec.rf.pileGain * Math.max(0, pile - 1)) * noise();
    // The trough feeds first; a feeder driven harder than the trough holds
    // pulls the rest straight off the table's edge (its share of the DF),
    // which the infeed then makes up - that is how a hot feeder overloads
    // its hopper while the DF target stays where it is.
    const fromTray = Math.min(dose, s.tray[i]);
    const fromDf = dfMoving ? Math.min(dose - fromTray, s.df / active.length) : 0;
    dose = fromTray + fromDf;
    s.tray[i] -= fromTray;
    s.df -= fromDf;
    s.ph[i] = Math.round(dose * 10) / 10;
  }

  // 4. The pool hopper drops into an empty weigh hopper.
  for (const no of active) {
    const i = no - 1;
    if (s.wh[i] === 0 && s.ph[i] > 0) { s.wh[i] = s.ph[i]; s.ph[i] = 0; }
  }

  // 5. Overscale: a weigh hopper past target + upper limit (+ the 0.3 the
  //    weigher never dumps under) is the error; production stops here.
  const ceiling = inputs.target + inputs.upper + (spec.combo.minOver ?? 0);
  for (const no of active) {
    const i = no - 1;
    if (s.wh[i] > ceiling) s.overscale.push(no);
  }
  if (s.overscale.length && !s.error) {
    const no = s.overscale.reduce((a, b) => (s.wh[b - 1] > s.wh[a - 1] ? b : a));
    s.error = 'overscale';
    s.errorInfo = { no, weight: round1(s.wh[no - 1]), limit: round1(ceiling) };
    s.result = 'idle';
    s.combo = [];
    s.log = [...s.log.slice(-9), 'overscale'];
    return s;
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

/** ErrClr&Rst: an overweight error dumps the heaviest few weigh hoppers so
 *  they re-feed; an overscale error dumps the hopper that was over. */
export function clearAndRestart(state) {
  const wh = [...state.wh];
  if (state.error === 'overscale') {
    for (const no of state.overscale) wh[no - 1] = 0;
  } else {
    const order = state.wh.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]).slice(0, 3);
    for (const [, i] of order) wh[i] = 0;
  }
  return { ...state, wh, overscale: [], error: null, errorInfo: null, overMisses: 0, result: 'idle', combo: [], weight: null };
}

/** ErrClr&Stop: the error goes; an overscale hopper is still dumped, the rest stays. */
export function clearAndStop(state) {
  const wh = [...state.wh];
  if (state.error === 'overscale') for (const no of state.overscale) wh[no - 1] = 0;
  return { ...state, wh, overscale: [], error: null, errorInfo: null, overMisses: 0, result: 'idle', combo: [] };
}

