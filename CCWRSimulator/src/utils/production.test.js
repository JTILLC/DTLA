import { describe, it, expect } from 'vitest';
import navmap from '../data/navmap.json';
import { pickCombination, toggleDeactivated } from './production';

const spec = navmap.production;
const seeded = (seed) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

describe('the combination cycle', () => {
  it('picks three to five heads and reads a few tenths over target, never under', () => {
    for (let s = 1; s < 40; s += 1) {
      const { nos, weight } = pickCombination(spec, seeded(s));
      expect(nos.length).toBeGreaterThanOrEqual(spec.combSize[0]);
      expect(nos.length).toBeLessThanOrEqual(spec.combSize[1]);
      expect(weight).toBeGreaterThanOrEqual(spec.target + 0.3);
      expect(weight).toBeLessThanOrEqual(spec.target + 3.3);
    }
  });

  it('never picks a deactivated head', () => {
    for (let s = 1; s < 40; s += 1) {
      const { nos } = pickCombination(spec, seeded(s), [3, 9, 14]);
      expect(nos).not.toContain(3);
      expect(nos).not.toContain(9);
      expect(nos).not.toContain(14);
    }
  });

  it('a tap while stopped toggles a head off and back on', () => {
    let d = toggleDeactivated([], 5);
    expect(d).toEqual([5]);
    d = toggleDeactivated(d, 2);
    expect(d).toEqual([2, 5]);
    expect(toggleDeactivated(d, 5)).toEqual([2]);
  });
});
