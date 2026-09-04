/**
 * Production's combination cycle, as watched on the running program: a
 * combination of three to five hoppers is chosen each cycle and the readout
 * shows its weight, a few tenths over target. The weights are made up: each
 * head holds a random amount around a share of the target, and the lightest
 * combination not under target wins, which is what a combination weigher does.
 * A deactivated head never takes part.
 */
export function pickCombination(spec, rnd, deactivated = []) {
  const { mean, spread } = spec.headWeight;
  const heads = spec.badges
    .filter((b) => !deactivated.includes(b.no))
    .map((b) => ({ no: b.no, w: mean + (rnd() * 2 - 1) * spread }));
  const [lo, hi] = spec.combSize;
  let best = null;
  for (let t = 0; t < 400; t += 1) {
    const size = Math.min(heads.length, lo + Math.floor(rnd() * (hi - lo + 1)));
    const pool = [...heads].sort(() => rnd() - 0.5).slice(0, size);
    const sum = pool.reduce((s, h) => s + h.w, 0);
    // A subset under target ranks below any that is over.
    const err = sum >= spec.target ? sum - spec.target : (spec.target - sum) + 50;
    if (!best || err < best.err) best = { err, sum, nos: pool.map((h) => h.no) };
  }
  if (!best) return { nos: [], weight: spec.target };
  const over = best.sum >= spec.target ? best.sum : spec.target + 0.1 + rnd() * 0.6;
  return { nos: best.nos, weight: Math.round(over * 10) / 10 };
}

/** Stopped: a tap on a head deactivates it, or brings a deactivated one back. */
export function toggleDeactivated(list, no) {
  return list.includes(no) ? list.filter((n) => n !== no) : [...list, no].sort((a, b) => a - b);
}
