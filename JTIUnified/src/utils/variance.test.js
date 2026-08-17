// Quote against actual — the only feedback a quote ever gets.
//
// The trap is counting jobs that have not been invoiced yet. A missing actual
// is not a job that came in at zero, and letting those through would drag every
// figure toward "under quote" by arithmetic rather than fact.
import { describe, it, expect } from 'vitest';
import { jobVariance, varianceSummary, varianceByCustomer } from './variance.js';

describe('jobVariance', () => {
  it('measures overrun against the quote', () => {
    const v = jobVariance({ quote: '4000', actual: '4200' });
    expect(v.delta).toBe(200);
    expect(v.pct).toBeCloseTo(5);
    expect(v.state).toBe('over');
  });

  it('measures coming in under', () => {
    const v = jobVariance({ quote: '4000', actual: '3600' });
    expect(v.delta).toBe(-400);
    expect(v.state).toBe('under');
  });

  it('treats within a percent as the same number', () => {
    // Not a pricing signal, just two ways of writing it.
    expect(jobVariance({ quote: '4000', actual: '4020' }).state).toBe('on');
  });

  it('reads amounts with commas, like everything else here', () => {
    expect(jobVariance({ quote: '4,000', actual: '$4,200' }).delta).toBe(200);
  });

  it('refuses to compare a job that has not been invoiced', () => {
    // The important one: no actual yet is unknown, not zero.
    expect(jobVariance({ quote: '4000', actual: '' }).state).toBeNull();
    expect(jobVariance({ quote: '4000' }).state).toBeNull();
    expect(jobVariance({ quote: '', actual: '4200' }).state).toBeNull();
    expect(jobVariance({}).state).toBeNull();
  });
});

describe('varianceSummary', () => {
  const jobs = [
    { sr: '1', customer: 'A', quote: '1000', actual: '1200' },   // +200
    { sr: '2', customer: 'A', quote: '1000', actual: '900' },    // -100
    { sr: '3', customer: 'B', quote: '1000', actual: '1005' },   // on
    { sr: '4', customer: 'B', quote: '1000', actual: '2000' },   // +1000
    { sr: '5', customer: 'C', quote: '1000' },                   // not invoiced
  ];

  it('counts only the jobs it can compare', () => {
    const s = varianceSummary(jobs);
    expect(s.counted).toBe(4);
    expect(s.over).toBe(2);
    expect(s.under).toBe(1);
    expect(s.on).toBe(1);
  });

  it('adds up the money left on the table', () => {
    expect(varianceSummary(jobs).totalDelta).toBe(1105);
  });

  it('reports the MEDIAN, so one runaway job does not decide the year', () => {
    // Mean here is skewed by the +100% job; the median says what usually
    // happens, which is the question being asked.
    const s = varianceSummary(jobs);
    expect(s.medianPct).toBeCloseTo(10.25);
  });

  it('surfaces the biggest misses in either direction', () => {
    const s = varianceSummary(jobs);
    expect(s.worst[0].sr).toBe('4');
    expect(s.worst.map((w) => w.sr)).toContain('1');
  });

  it('says nothing rather than zero when there is nothing to compare', () => {
    const s = varianceSummary([{ quote: '1000' }]);
    expect(s.counted).toBe(0);
    expect(s.medianPct).toBeNull();
  });

  it('survives junk', () => {
    expect(() => varianceSummary([null, undefined])).not.toThrow();
    expect(() => varianceSummary()).not.toThrow();
  });
});

describe('varianceByCustomer', () => {
  const jobs = [
    { customer: 'Flagstone', quote: '1000', actual: '1300' },
    { customer: 'Flagstone', quote: '1000', actual: '1200' },
    { customer: 'Oasis', quote: '1000', actual: '1100' },
  ];

  it('groups the pattern, not the anecdote', () => {
    // One job is not a pricing pattern.
    const rows = varianceByCustomer(jobs);
    expect(rows.map((r) => r.customer)).toEqual(['Flagstone']);
    expect(rows[0].jobs).toBe(2);
    expect(rows[0].totalDelta).toBe(500);
    expect(rows[0].avgPct).toBeCloseTo(25);
  });

  it('includes single jobs when asked', () => {
    expect(varianceByCustomer(jobs, { minJobs: 1 })).toHaveLength(2);
  });

  it('ignores jobs with no customer rather than grouping them together', () => {
    expect(varianceByCustomer([{ quote: '1', actual: '2' }], { minJobs: 1 })).toEqual([]);
  });
});
