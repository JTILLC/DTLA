import React, { useEffect, useRef, useState } from 'react';
import { litLabels } from '../utils/panSelect';

/**
 * The Zero Adjustment ring, with each pan selectable.
 *
 * Selecting individual pans rules out pre-rendered artwork — that would need an
 * image per combination, and there are 2^14 of them. So the screen is drawn on
 * a canvas: the extracted screenshot underneath, and the selected pans
 * recoloured on top.
 *
 * A label map does both jobs. It is a greyscale PNG where a pixel's value says
 * which pan it belongs to (1-14, 15 for the dispersion pan, 0 for everything
 * else), built by tools/hopper_masks.py from the artwork itself. Tapping looks
 * up the label under the cursor; recolouring tints the pixels whose label is
 * selected. Because both read the same map, what looks selected and what
 * responds to a tap can never disagree.
 *
 * The blue is measured off a capture of the running original: selecting does not
 * tint the grey, it REPLACES it with a blue that keeps a little of the original
 * shading, so the recolour is built from luminance rather than multiplied.
 */

const BLUE_BASE = [38, 39, 148];
const BLUE_GAIN = [0.30, 0.30, 0.35];
// The head numbers and weights are printed in the RCU's blue and would vanish
// into the new fill, so they are lifted to near-white as the real unit does.
const TEXT_ON_BLUE = [235, 238, 255];
const isInk = (r, g, b) => r < 140 && g < 140 && b > r + 30;

export default function ZeroAdjustPans({
  image, labelMap, tableLabel, selection, lit: litProp,
  onTapPan, onTapTable, showHotspots,
}) {
  const canvasRef = useRef(null);
  const dataRef = useRef(null);           // { base: ImageData, labels: Uint8Array, w, h }
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(0);

  /* Load the screen and its label map once. */
  useEffect(() => {
    let live = true;
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error(src));
      img.src = src;
    });

    Promise.all([load(`/${image}`), load(`/${labelMap}`)])
      .then(([screen, map]) => {
        if (!live) return;
        const w = screen.naturalWidth;
        const h = screen.naturalHeight;

        const sc = document.createElement('canvas');
        sc.width = w; sc.height = h;
        sc.getContext('2d').drawImage(screen, 0, 0);
        const base = sc.getContext('2d').getImageData(0, 0, w, h);

        const mc = document.createElement('canvas');
        mc.width = w; mc.height = h;
        mc.getContext('2d').drawImage(map, 0, 0, w, h);
        const md = mc.getContext('2d').getImageData(0, 0, w, h).data;
        const labels = new Uint8Array(w * h);
        for (let i = 0; i < labels.length; i += 1) labels[i] = md[i * 4];

        dataRef.current = { base, labels, w, h };
        setReady(true);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [image, labelMap]);

  /* Repaint whenever the selection changes. */
  useEffect(() => {
    if (!ready || !dataRef.current || !canvasRef.current) return;
    const { base, labels, w, h } = dataRef.current;
    const lit = new Set(litProp || litLabels(selection, tableLabel));

    const out = new ImageData(new Uint8ClampedArray(base.data), w, h);
    const d = out.data;
    for (let i = 0; i < labels.length; i += 1) {
      if (!lit.has(labels[i])) continue;
      const o = i * 4;
      const r = d[o]; const g = d[o + 1]; const b = d[o + 2];
      if (isInk(r, g, b)) {
        d[o] = TEXT_ON_BLUE[0]; d[o + 1] = TEXT_ON_BLUE[1]; d[o + 2] = TEXT_ON_BLUE[2];
      } else {
        const lum = (r + g + b) / 3;
        d[o] = BLUE_BASE[0] + lum * BLUE_GAIN[0];
        d[o + 1] = BLUE_BASE[1] + lum * BLUE_GAIN[1];
        d[o + 2] = BLUE_BASE[2] + lum * BLUE_GAIN[2];
      }
    }
    const canvas = canvasRef.current;
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').putImageData(out, 0, 0);
  }, [ready, selection, tableLabel, litProp]);

  /* A tap or hover resolves to a pan through the same map. */
  const labelAt = (event) => {
    const data = dataRef.current;
    if (!data) return 0;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * data.w);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * data.h);
    if (x < 0 || y < 0 || x >= data.w || y >= data.h) return 0;
    return data.labels[y * data.w + x];
  };

  const click = (event) => {
    const label = labelAt(event);
    if (!label) return;                    // wallpaper or chrome: not ours
    if (tableLabel && label === tableLabel) onTapTable?.();
    else onTapPan?.(label);
  };

  if (failed) {
    return (
      <p style={{ padding: '1rem', color: 'var(--danger)' }}>
        Could not load the Zero Adjustment screen.
      </p>
    );
  }

  const hoverName = (tableLabel && hover === tableLabel) ? 'dispersion table'
    : hover ? `head ${hover}` : '';

  return (
    <canvas
      ref={canvasRef}
      className={'za-pans' + (showHotspots ? ' za-pans--outlined' : '')}
      style={{ cursor: hover ? 'pointer' : 'default' }}
      title={hoverName ? `${hoverName} — tap to select` : ''}
      onClick={click}
      onMouseMove={(e) => setHover(labelAt(e))}
      onMouseLeave={() => setHover(0)}
      aria-label="Zero Adjustment pans — tap a pan to select it"
    />
  );
}
