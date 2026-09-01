import { describe, it, expect } from 'vitest';
import { repaintBox, displayValue, RCU_BLUE } from './overlay';

// A tiny fake ImageData: a vertical gradient with blue "ink" written across it.
const makeFrame = (w, h) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const shade = 150 + y * 5;          // the field's gradient
      data[i] = shade; data[i + 1] = shade; data[i + 2] = shade; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
};
const px = (f, x, y) => {
  const i = (y * f.width + x) * 4;
  return [f.data[i], f.data[i + 1], f.data[i + 2]];
};
const setPx = (f, x, y, rgb) => {
  const i = (y * f.width + x) * 4;
  [f.data[i], f.data[i + 1], f.data[i + 2]] = rgb;
};

describe('repaintBox', () => {
  it('removes the ink it was pointed at', () => {
    const f = makeFrame(10, 6);
    setPx(f, 4, 2, [0, 0, 204]);           // a pixel of RCU blue
    setPx(f, 5, 2, [0, 0, 204]);
    repaintBox(f, [1, 1, 8, 4]);
    expect(px(f, 4, 2)).not.toEqual([0, 0, 204]);
  });

  it('follows the gradient instead of flattening the field', () => {
    // A flat fill is what makes an overlaid screen look doctored: the repainted
    // patch sits at one shade against a face that changes down its height.
    const f = makeFrame(10, 6);
    setPx(f, 4, 2, [0, 0, 204]);
    setPx(f, 4, 3, [0, 0, 204]);
    repaintBox(f, [1, 1, 8, 4]);
    const row2 = px(f, 4, 2)[0];
    const row3 = px(f, 4, 3)[0];
    expect(row3).toBeGreaterThan(row2);     // still darker at the top
    expect(row2).toBe(160);                 // and each row keeps its own shade
    expect(row3).toBe(165);
  });

  it('leaves everything outside the box alone', () => {
    const f = makeFrame(10, 6);
    const before = px(f, 0, 0);
    setPx(f, 9, 5, [0, 0, 204]);
    repaintBox(f, [1, 1, 4, 3]);
    expect(px(f, 0, 0)).toEqual(before);
    expect(px(f, 9, 5)).toEqual([0, 0, 204]);   // untouched ink outside the box
  });

  it('does not read past the edges of the frame', () => {
    const f = makeFrame(6, 4);
    expect(() => repaintBox(f, [-5, -5, 99, 99])).not.toThrow();
  });

  it('leaves a row it cannot sample alone rather than painting it black', () => {
    // An all-ink row has no field colour to take a median from. Painting it
    // with a default would put a black bar across the screen.
    const f = makeFrame(3, 3);
    for (let x = 0; x < 3; x += 1) setPx(f, x, 1, [0, 0, 204]);
    repaintBox(f, [0, 1, 2, 1]);
    expect(px(f, 1, 1)).toEqual([0, 0, 204]);
  });
});

describe('displayValue', () => {
  it('appends the unit when the value does not carry one', () => {
    expect(displayValue('227.0', 'g')).toBe('227.0g');
  });

  it('does not double the unit when the value already has it', () => {
    expect(displayValue('227.0g', 'g')).toBe('227.0g');
  });

  it('keeps trailing zeros, which are part of the specification', () => {
    expect(displayValue('90.0', 'g')).toBe('90.0g');
  });

  it('is empty for a value that was never set', () => {
    // An empty string means "leave the screenshot alone", not "print nothing
    // over the top", so it must be distinguishable from a real value.
    expect(displayValue('', 'g')).toBe('');
    expect(displayValue(undefined, 'g')).toBe('');
    expect(displayValue(null, 'g')).toBe('');
  });

  it('handles a value that is not a number at all', () => {
    expect(displayValue('1:1Mix', '')).toBe('1:1Mix');
    expect(displayValue('Off')).toBe('Off');
  });

  it('uses the RCU\'s own blue', () => {
    expect(RCU_BLUE).toBe('#0000cc');
  });
});
