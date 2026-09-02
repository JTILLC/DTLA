import { describe, it, expect } from 'vitest';
import { paintSelected, liftToHopperRange, BLUE_BASE } from './selectionBlue';

const paint = (rgb, lift) => {
  const d = new Uint8ClampedArray([...rgb, 255]);
  paintSelected(d, 0, lift);
  return [d[0], d[1], d[2]];
};
const lum = (c) => (c[0] + c[1] + c[2]) / 3;

describe('the selection blue', () => {
  it('is blue: more blue than red, and never darker than the base', () => {
    const out = paint([160, 160, 160]);
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[2]).toBeGreaterThanOrEqual(BLUE_BASE[2]);
  });

  it('keeps shading — a lighter source stays lighter', () => {
    expect(lum(paint([200, 200, 200]))).toBeGreaterThan(lum(paint([80, 80, 80])));
  });

  it('turns the printed blue text near-white so it survives the fill', () => {
    const out = paint([40, 40, 120]);          // the RCU's own ink blue
    expect(Math.min(...out)).toBeGreaterThan(200);
  });
});

describe('the trough lift', () => {
  // The trough artwork is far darker than the Zero Adjustment hoppers, so the
  // same ramp turned selected wedges into muddy near-black while a selected
  // hopper came out clearly blue. These are the two ends that were measured.
  it('lifts the trough\'s darkest pixels to where the hoppers start', () => {
    expect(Math.round(liftToHopperRange(19))).toBe(67);
  });

  it('leaves the bright end where it already agreed', () => {
    expect(Math.round(liftToHopperRange(209))).toBe(203);
  });

  it('makes a dark wedge read as bright as a mid hopper, not darker', () => {
    const wedgeDark = paint([30, 30, 30], liftToHopperRange);
    const hopperMid = paint([105, 105, 105]);
    expect(lum(wedgeDark)).toBeGreaterThan(lum(hopperMid) * 0.9);
  });

  it('still keeps one wedge lighter than another — shading is not flattened', () => {
    const a = paint([60, 60, 60], liftToHopperRange);
    const b = paint([170, 170, 170], liftToHopperRange);
    expect(lum(b)).toBeGreaterThan(lum(a) + 10);
  });
});

describe('printed white marks', () => {
  // Measured on the one wedge the capture had selected: everything at 230 and
  // up came back pure white. The machine draws the head numbers ON the blue.
  it('leaves a white head number white', () => {
    const d = new Uint8ClampedArray([250, 250, 250, 255]);
    paintSelected(d, 0, liftToHopperRange);
    expect([d[0], d[1], d[2]]).toEqual([250, 250, 250]);
  });

  it('still tints the artwork just below it', () => {
    const d = new Uint8ClampedArray([200, 200, 200, 255]);
    paintSelected(d, 0);
    expect(d[2]).toBeGreaterThan(d[0] + 40);
  });
});
