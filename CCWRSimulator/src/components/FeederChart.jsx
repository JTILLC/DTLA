import React, { useEffect, useRef, useState } from 'react';
import { paintSelected, liftToHopperRange } from '../utils/selectionBlue';

/**
 * The Production feeder screen, drawn live.
 *
 * Three things move with the settings, and all three are drawn on one canvas
 * over a neutralised base (see tools/trough_masks.py and tools/radar_chart.py,
 * which grey out the wedge and the ring segment that were selected in the
 * capture, and erase the baked trace):
 *
 * - The radial-trough WEDGE for each selected head turns blue.
 * - The radar chart's outer RING SEGMENT for each selected head turns blue.
 * - The two TRACES, one marker per head, each drawn at a radius proportional to
 *   its value. In the capture amplitude read 50.0 and its trace sat at r=61,
 *   and time read 25.0 and its trace sat at r=30 — the same scale twice over,
 *   putting full scale (100) at r=120, the inner edge of the ring.
 *
 * Amplitude is drawn as triangles and time as squares, matching the markers the
 * chart itself uses. A trace is in colour when its lamp is lit and grey when it
 * is not: that is what the capture shows, where RF AMP's lamp is green and its
 * trace magenta, while RF Time's lamp is off and its squares are grey.
 */

const TRACES = {
  amp: { colour: '#ff00ff', marker: 'triangle' },   // measured off the trace
  time: { colour: '#210482', marker: 'square' },    // the legend's navy diamond
};
const UNLIT = '#808080';

export default function FeederChart({
  baseImage, wedgeMap, ringMap, chart, heads, values, params,
  df, dfValues, onTapHead, showHotspots,
}) {
  const canvasRef = useRef(null);
  const dataRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(0);

  useEffect(() => {
    let live = true;
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error(src));
      img.src = src;
    });
    const gray = (img, w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const d = c.getContext('2d').getImageData(0, 0, w, h).data;
      const out = new Uint8Array(w * h);
      for (let i = 0; i < out.length; i += 1) out[i] = d[i * 4];
      return out;
    };

    Promise.all([load(`/${baseImage}`), load(`/${wedgeMap}`), load(`/${ringMap}`)])
      .then(([screen, wedges, ring]) => {
        if (!live) return;
        const w = screen.naturalWidth;
        const h = screen.naturalHeight;
        const sc = document.createElement('canvas');
        sc.width = w; sc.height = h;
        sc.getContext('2d').drawImage(screen, 0, 0);
        dataRef.current = {
          base: sc.getContext('2d').getImageData(0, 0, w, h),
          wedges: gray(wedges, w, h),
          ring: gray(ring, w, h),
          w, h,
        };
        setReady(true);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [baseImage, wedgeMap, ringMap]);

  useEffect(() => {
    if (!ready || !dataRef.current || !canvasRef.current) return;
    const { base, wedges, ring, w, h } = dataRef.current;
    const lit = new Set(heads);

    const out = new ImageData(new Uint8ClampedArray(base.data), w, h);
    const d = out.data;
    for (let i = 0; i < wedges.length; i += 1) {
      // The trough is far darker than the Zero Adjustment hoppers, so its
      // luminance is lifted into their range first and a selected wedge comes
      // out the same clear blue a selected hopper does.
      if (!df && lit.has(wedges[i])) paintSelected(d, i * 4, liftToHopperRange);
      else if (!df && lit.has(ring[i])) paintSelected(d, i * 4);
    }
    // The dispersion feeder is selected by its own key — the ① on the centre
    // disc — and the disc turns blue (measured off the original with DF
    // selected: bbox 136,213 to 247,295, an ellipse in perspective).
    if (df) {
      const [ex, ey, rx, ry] = [191, 254, 56, 41];
      for (let y = ey - ry; y <= ey + ry; y += 1) {
        for (let x = ex - rx; x <= ex + rx; x += 1) {
          const nx = (x - ex) / rx; const ny = (y - ey) / ry;
          if (nx * nx + ny * ny <= 1) paintSelected(d, (y * w + x) * 4);
        }
      }
    }

    const canvas = canvasRef.current;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(out, 0, 0);

    /* The traces. Each head's marker sits at its own value's radius, and the
       markers are joined up the way the chart draws them. */
    const [cx, cy] = chart.centre;
    const step = 360 / chart.segments;
    const at = (param, no) => {
      const v = values?.[no]?.[param] ?? 0;
      const rad = (v / 100) * chart.rFull;
      const a = ((chart.seg1Centre - (no - 1) * step) * Math.PI) / 180;
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    };

    for (const [param, { colour, marker }] of Object.entries(TRACES)) {
      const ink = params?.[param] ? colour : UNLIT;
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = 1.2;

      // With DF selected there is one value per parameter, not fourteen, and
      // the original draws each as a plain circle at that radius (seen with
      // DF selected: a navy circle at r≈30 for time 25.0, magenta at r≈61).
      if (df) {
        const v = dfValues?.[param] ?? 0;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, (v / 100) * chart.rFull, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      ctx.beginPath();
      for (let n = 1; n <= chart.segments; n += 1) {
        const [x, y] = at(param, n);
        if (n === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();

      for (let n = 1; n <= chart.segments; n += 1) {
        const [x, y] = at(param, n);
        ctx.beginPath();
        if (marker === 'triangle') {
          ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3);
          ctx.closePath();
        } else {
          ctx.rect(x - 3, y - 3, 6, 6);
        }
        ctx.fill();
      }
    }
  }, [ready, heads, values, params, chart, df, dfValues]);

  const labelAt = (event) => {
    const data = dataRef.current;
    if (!data) return 0;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * data.w);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * data.h);
    if (x < 0 || y < 0 || x >= data.w || y >= data.h) return 0;
    const i = y * data.w + x;
    return data.wedges[i] || data.ring[i];    // either picture selects the head
  };

  if (failed) {
    return (
      <p style={{ padding: '1rem', color: 'var(--danger)' }}>
        Could not load the Feeder Adjust screen.
      </p>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={'za-pans' + (showHotspots ? ' za-pans--outlined' : '')}
      style={{ cursor: hover ? 'pointer' : 'default' }}
      title={hover ? `Head ${hover} — tap to select` : ''}
      onClick={(e) => { const l = labelAt(e); if (l) onTapHead(l); }}
      onMouseMove={(e) => setHover(labelAt(e))}
      onMouseLeave={() => setHover(0)}
      aria-label="Feeder adjust — tap a head on the trough or the ring to select it"
    />
  );
}
