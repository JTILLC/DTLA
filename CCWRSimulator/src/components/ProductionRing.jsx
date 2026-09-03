import React, { useEffect, useRef, useState } from 'react';

/**
 * The Combination screen while Production runs.
 *
 * Watched on the running program (twenty frames a quarter-second apart):
 * every cycle a combination of hoppers is chosen and its members get the
 * filled "Selected" badge; the readout shows that combination's weight, near
 * the target; now and then a hopper shows the cyan triangle (Auto Zero) or the
 * red dash (Empty) in place of its number; the hoppers themselves stay blue;
 * and the legend strip along the bottom scrolls. Stopped, the badges are all
 * "Available" - the artwork - and the readout holds its last value.
 *
 * The weights are made up to look right: each head holds a random amount
 * around a seventh of the target and the closest subset is chosen, which is
 * what a combination weigher does, at the program's 80 wpm cadence.
 */
const SYMBOL = {
  selected: { text: null, cls: 'pr-badge--selected' },
  autozero: { text: '△', cls: 'pr-badge--autozero' },
  empty: { text: '—', cls: 'pr-badge--empty' },
};

function pickCombination(spec, rnd) {
  const { mean, spread } = spec.headWeight;
  const heads = spec.badges.map((b) => ({ no: b.no, w: mean + (rnd() * 2 - 1) * spread }));
  const [lo, hi] = spec.combSize;
  let best = null;
  for (let t = 0; t < 400; t += 1) {
    const size = lo + Math.floor(rnd() * (hi - lo + 1));
    const pool = [...heads].sort(() => rnd() - 0.5).slice(0, size);
    const sum = pool.reduce((s, h) => s + h.w, 0);
    // A weigher picks the lightest combination that is not under target,
    // so a subset under target ranks below any that is over.
    const err = sum >= spec.target ? sum - spec.target : (spec.target - sum) + 50;
    if (!best || err < best.err) best = { err, sum, nos: pool.map((h) => h.no) };
  }
  // The program's readouts sat a few tenths over target, never under.
  const over = best.sum >= spec.target ? best.sum : spec.target + 0.1 + rnd() * 0.6;
  const weight = Math.round(over * 10) / 10;
  return { nos: best.nos, weight };
}

export default function ProductionRing({ spec, running, rectStyle, pct, CW }) {
  const [cycle, setCycle] = useState({ selected: [], special: {}, weight: null, phase: 0 });
  const last = useRef(null);

  useEffect(() => {
    if (!running) return undefined;
    const rnd = Math.random;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const { nos, weight } = pickCombination(spec, rnd);
      const special = {};
      if (rnd() < 0.35) {
        const no = 1 + Math.floor(rnd() * spec.badges.length);
        if (!nos.includes(no)) special[no] = rnd() < 0.6 ? 'autozero' : 'empty';
      }
      last.current = weight;
      setCycle({ selected: nos, special, weight, phase: 1 });
      // The badges show for the first part of the cycle, then clear.
      setTimeout(() => { if (alive) setCycle((c) => ({ ...c, selected: [], phase: 0 })); }, spec.cycleMs * 0.55);
    };
    tick();
    const id = setInterval(tick, spec.cycleMs);
    return () => { alive = false; clearInterval(id); };
  }, [running, spec]);

  const weight = running ? cycle.weight : last.current;
  const fontPx = (px) => `clamp(6px, ${(px / CW) * 100}cqw, ${px * 1.5}px)`;
  const d = spec.badge.d;

  return (
    <>
      {/* The readout: the combination weight while running, held after Stop. */}
      <div className="pr-readout" style={{ ...rectStyle(spec.readout), fontSize: fontPx(spec.readout.textPx), color: spec.readout.colour }} aria-live="off">
        {weight === null ? '0.0' : weight.toFixed(1)}&nbsp;g
      </div>

      {spec.badges.map((b) => {
        const state = running
          ? (cycle.selected.includes(b.no) ? 'selected' : cycle.special[b.no] || null)
          : null;
        if (!state) return null;
        const sym = SYMBOL[state];
        return (
          <div
            key={b.no}
            className={'pr-badge ' + sym.cls}
            style={{ ...rectStyle({ x: b.x - d / 2, y: b.y - d / 2, w: d, h: d }), fontSize: fontPx(spec.badge.textPx) }}
            aria-hidden="true"
          >
            {sym.text ?? b.no}
          </div>
        );
      })}

      {/* The legend strip: it scrolls on the program. */}
      <div className="pr-legend" style={{ ...rectStyle(spec.legend), fontSize: fontPx(spec.legend.textPx) }} aria-hidden="true">
        <div className={'pr-legend__track' + (running ? ' pr-legend__track--run' : '')}>
          {[0, 1].map((rep) => (
            <span key={rep} className="pr-legend__set">
              {spec.legend.items.map(([k, label]) => (
                <span key={k} className="pr-legend__item">
                  <i className={'pr-sym pr-sym--' + k} />{label}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
