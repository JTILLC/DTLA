import { describe, it, expect } from 'vitest';
import navmap from '../data/navmap.json';
import { initialProcess, stepProcess, bestCombination, clearAndRestart, HEADS } from './process';

const spec = navmap.process;
const seeded = (seed) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const rf = (time, amp) => Object.fromEntries(Array.from({ length: HEADS }, (_, i) => [i + 1, { time, amp }]));
const base = { target: 90, upper: 3, lower: null, dfTargetWt: 500, dfTime: 25, dfAmp: 50, rf: rf(25, 50), deactivated: [], infeed: true };

const run = (inputs, cycles, seed = 7) => {
  let s = initialProcess(inputs, spec);
  const rnd = seeded(seed);
  const results = [];
  for (let i = 0; i < cycles; i += 1) { s = stepProcess(s, inputs, spec, rnd); results.push(s.result); if (s.error) break; }
  return { s, results };
};

describe('the process model', () => {
  it('runs clean on the default settings: combinations near target, no misses once fed', () => {
    const { s, results } = run(base, 40);
    const settled = results.slice(10);
    expect(settled.filter((r) => r === 'ok').length).toBeGreaterThan(settled.length * 0.8);
    expect(s.weight).toBeGreaterThanOrEqual(90.3);      // never exactly the target
    expect(s.weight).toBeLessThanOrEqual(93.3);         // upper limit + the same 0.3
    expect(s.error).toBeNull();
    expect(s.df).toBeGreaterThan(400);
  });

  it('a weigh hopper holds about a quarter of the target, four heads to a combination', () => {
    const { s } = run(base, 30);
    const held = s.wh.filter((w) => w > 0);
    const mean = held.reduce((a, b) => a + b, 0) / held.length;
    expect(mean).toBeGreaterThan(17);
    expect(mean).toBeLessThan(34);
  });

  it('radial feeders turned up overload the hoppers: overweight misses, then the Overweight error', () => {
    const { s, results } = run({ ...base, rf: rf(25, 100) }, 60);
    expect(results.filter((r) => r === 'over').length).toBeGreaterThanOrEqual(4);
    expect(s.error).toBe('overweight');
  });

  it('a DF target set far too high forces product into the hoppers and overloads them', () => {
    const clean = run({ ...base, dfTargetWt: 500 }, 60);
    const heavy = run({ ...base, dfTargetWt: 4000 }, 60);
    const mean = (st) => st.wh.filter((w) => w > 0).reduce((a, b) => a + b, 0) / Math.max(1, st.wh.filter((w) => w > 0).length);
    expect(mean(heavy.s)).toBeGreaterThan(mean(clean.s));
    expect(heavy.results.filter((r) => r !== 'ok').length).toBeGreaterThan(clean.results.filter((r) => r !== 'ok').length);
  });

  it('starved feeders miss underweight, with the red dash, and never raise the overweight error', () => {
    const { s, results } = run({ ...base, rf: rf(25, 10) }, 40);
    expect(results.filter((r) => r === 'under').length).toBeGreaterThan(10);
    expect(s.error).toBeNull();
  });

  it('a weigh hopper past target + upper limit + 0.3 is the Overscale error, dumped on clearing', () => {
    let s = initialProcess(base, spec);
    s.wh[2] = 120;
    s = stepProcess(s, { ...base, rf: rf(25, 10) }, spec, seeded(3));
    expect(s.error).toBe('overscale');
    expect(s.errorInfo).toMatchObject({ no: 3, weight: 120, limit: 93.3 });
    expect(s.wh[2]).toBe(120);                          // still there until cleared
    const r = clearAndRestart(s);
    expect(r.error).toBeNull();
    expect(r.wh[2]).toBe(0);
    // 93.2 g is inside the window; 93.4 is over it
    let t = initialProcess(base, spec); t.wh[0] = 93.2;
    expect(stepProcess(t, { ...base, rf: rf(25, 10) }, spec, seeded(3)).error).toBeNull();
    t = initialProcess(base, spec); t.wh[0] = 93.4;
    expect(stepProcess(t, { ...base, rf: rf(25, 10) }, spec, seeded(3)).error).toBe('overscale');
  });

  it('time and amplitude set far too high reach the Overscale error', () => {
    const { s } = run({ ...base, rf: rf(80, 100) }, 80);
    expect(s.error).toBe('overscale');
    expect(s.errorInfo.weight).toBeGreaterThan(93.3);
  });

  it('deactivated heads never join a combination', () => {
    const { s, results } = run({ ...base, deactivated: [3, 9] }, 40);
    expect(results.includes('ok')).toBe(true);
    expect(s.combo).not.toContain(3);
    expect(s.wh[2]).toBe(0);
  });

  it('bestCombination is the lightest one not under target and inside the upper limit', () => {
    const wh = [22.3, 23, 21, 24, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const active = [1, 2, 3, 4, 5, 6];
    const c = bestCombination(wh, active, 90, 3, null, spec.combo);
    expect(c.ok).toBe(true);
    expect(c.sum).toBeGreaterThanOrEqual(90.3);
    expect(c.sum).toBeLessThanOrEqual(93.3);
    // exactly 90.0 is not a dump: 22 + 23 + 21 + 24 = 90 misses, 22.3 + ... does not
    expect(bestCombination([22, 23, 21, 24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], active, 90, 3, null, spec.combo).ok).toBe(false);
    expect(bestCombination([22.3, 23, 21, 24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], active, 90, 3, null, spec.combo).ok).toBe(true);
    expect(bestCombination([50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], active, 90, 3, null, spec.combo)).toMatchObject({ ok: false, reason: 'over' });
    expect(bestCombination([5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], active, 90, 3, null, spec.combo)).toMatchObject({ ok: false, reason: 'under' });
  });

  it('ErrClr&Rst dumps the heaviest three and clears the error', () => {
    const { s } = run({ ...base, rf: rf(25, 100) }, 60);
    expect(s.error).toBe('overweight');
    const r = clearAndRestart(s);
    expect(r.error).toBeNull();
    expect(r.wh.filter((w) => w === 0).length).toBeGreaterThanOrEqual(3);
  });
});
