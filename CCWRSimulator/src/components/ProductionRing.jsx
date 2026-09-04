import React, { useEffect, useRef, useState } from 'react';
import { pickCombination } from '../utils/production';

/**
 * The Combination screen, drawn live.
 *
 * Watched on the running program (twenty frames a quarter-second apart):
 * every cycle a combination of hoppers is chosen and its members get the
 * filled "Selected" badge while the rest keep the outline "Available" badge;
 * the readout shows that combination's weight, near the target; now and then
 * a hopper shows the cyan triangle (Auto Zero) or the red dash (Empty) in
 * place of its number; the hoppers themselves stay blue; and the legend strip
 * along the bottom scrolls. Stop ends it at once: every badge back to
 * Available, the readout holding its last value.
 *
 * Stopped, a tap on a hopper deactivates it - the hopper goes grey with a
 * yellow star - and a tap on a deactivated hopper brings it back. A
 * deactivated head never joins a combination. The greying is done on a canvas
 * from a label map of the hoppers (tools/combination_masks.py).
 */
const SYMBOL = {
  selected: { text: null, cls: 'pr-badge--selected' },
  available: { text: null, cls: 'pr-badge--available' },
  autozero: { text: '△', cls: 'pr-badge--autozero' },
  empty: { text: '—', cls: 'pr-badge--empty' },
  deactivated: { text: '✳', cls: 'pr-badge--deactivated' },
};

export default function ProductionRing({
  spec, running, deactivated, onTapHead, rectStyle, CW, showHotspots,
}) {
  const [cycle, setCycle] = useState({ selected: [], special: {}, weight: null });
  const last = useRef(null);
  const canvasRef = useRef(null);
  const dataRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState(0);

  // The artwork and the label map, once.
  useEffect(() => {
    let live = true;
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error(src));
      img.src = src;
    });
    Promise.all([load(`/${spec.baseImage}`), load(`/${spec.labelMap}`)]).then(([screen, labels]) => {
      if (!live) return;
      const w = screen.naturalWidth;
      const h = screen.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(screen, 0, 0);
      const base = c.getContext('2d').getImageData(0, 0, w, h);
      const lc = document.createElement('canvas');
      lc.width = w; lc.height = h;
      lc.getContext('2d').drawImage(labels, 0, 0, w, h);
      const ld = lc.getContext('2d').getImageData(0, 0, w, h).data;
      const map = new Uint8Array(w * h);
      for (let i = 0; i < map.length; i += 1) map[i] = ld[i * 4];
      dataRef.current = { base, map, w, h };
      setReady(true);
    }).catch(() => {});
    return () => { live = false; };
  }, [spec.baseImage, spec.labelMap]);

  // Grey the deactivated hoppers.
  useEffect(() => {
    if (!ready || !dataRef.current || !canvasRef.current) return;
    const { base, map, w, h } = dataRef.current;
    const out = new ImageData(new Uint8ClampedArray(base.data), w, h);
    const d = out.data;
    const off = new Set(deactivated || []);
    if (off.size) {
      for (let i = 0; i < map.length; i += 1) {
        if (off.has(map[i])) {
          const p = i * 4;
          const l = Math.round(0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2]);
          const g = Math.min(255, l + 40);      // the blue is dark; lift it to a metal grey
          d[p] = g; d[p + 1] = g; d[p + 2] = g;
        }
      }
    }
    const canvas = canvasRef.current;
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').putImageData(out, 0, 0);
  }, [ready, deactivated]);

  // The cycle, while running. Stop clears it at once.
  useEffect(() => {
    if (!running) { setCycle((c) => ({ selected: [], special: {}, weight: c.weight })); return undefined; }
    const rnd = Math.random;
    let alive = true;
    let clear = null;
    const tick = () => {
      if (!alive) return;
      const { nos, weight } = pickCombination(spec, rnd, deactivated);
      const special = {};
      if (rnd() < 0.35) {
        const no = 1 + Math.floor(rnd() * spec.badges.length);
        if (!nos.includes(no) && !(deactivated || []).includes(no)) special[no] = rnd() < 0.6 ? 'autozero' : 'empty';
      }
      last.current = weight;
      setCycle({ selected: nos, special, weight });
      clear = setTimeout(() => { if (alive) setCycle((c) => ({ ...c, selected: [] })); }, spec.cycleMs * 0.55);
    };
    tick();
    const id = setInterval(tick, spec.cycleMs);
    return () => { alive = false; clearInterval(id); clearTimeout(clear); };
  }, [running, spec, deactivated]);

  const labelAt = (event) => {
    const data = dataRef.current;
    if (!data) return 0;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * data.w);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * data.h);
    if (x < 0 || y < 0 || x >= data.w || y >= data.h) return 0;
    return data.map[y * data.w + x];
  };

  const weight = running ? cycle.weight : (cycle.weight ?? last.current);
  const fontPx = (px) => `clamp(6px, ${(px / CW) * 100}cqw, ${px * 1.5}px)`;
  const d = spec.badge.d;
  const off = deactivated || [];

  return (
    <>
      <canvas
        ref={canvasRef}
        className={'za-pans' + (showHotspots ? ' za-pans--outlined' : '')}
        style={{ cursor: hover ? 'pointer' : 'default' }}
        title={hover ? (running ? `Head ${hover} — press Stop, then tap it to deactivate` : `Head ${hover} — tap to ${off.includes(hover) ? 'reactivate' : 'deactivate'}`) : ''}
        onClick={(e) => { const l = labelAt(e); if (l) onTapHead(l); }}
        onMouseMove={(e) => setHover(labelAt(e))}
        onMouseLeave={() => setHover(0)}
        aria-label="Combination — stopped, tap a hopper to deactivate it or bring it back"
      />

      {/* The readout: the combination weight while running, held after Stop. */}
      <div className="pr-readout" style={{ ...rectStyle(spec.readout), fontSize: fontPx(spec.readout.textPx), color: spec.readout.colour }} aria-live="off">
        {weight === null || weight === undefined ? '0.0' : weight.toFixed(1)}&nbsp;g
      </div>

      {spec.badges.map((b) => {
        const state = off.includes(b.no) ? 'deactivated'
          : running && cycle.selected.includes(b.no) ? 'selected'
            : (running && cycle.special[b.no]) || 'available';
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

      {/* The legend strip: it scrolls on the program while running. */}
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
