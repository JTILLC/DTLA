// Whether the new per-job mirror can be read from yet.
//
// The danger is a check that is too forgiving: it would wave through a mirror
// that is quietly missing jobs, and the dashboard would under-report income
// with nothing anywhere saying so.
import { describe, it, expect } from 'vitest';
import { jobSignature, compareSources, describeDrift, duplicateIds } from './jobMirror.js';

const job = (over = {}) => ({
  id: 'a1', sr: '2026024', customer: 'Flagstone Foods', actual: '4200', paid: true, year: '2026', ...over,
});

describe('jobSignature', () => {
  it('ignores key order', () => {
    expect(jobSignature({ a: 1, b: 2 })).toBe(jobSignature({ b: 2, a: 1 }));
  });

  it('ignores how it was stored, not what it says', () => {
    expect(jobSignature(job({ updatedAt: 'x', updatedBy: 'josh@jtiaz.com' }))).toBe(jobSignature(job()));
  });

  it('treats absent, null and empty string alike', () => {
    // The two stores round-trip these differently; counting them as different
    // would report drift on every job, forever, and train everyone to ignore it.
    expect(jobSignature(job({ city: '' }))).toBe(jobSignature(job()));
    expect(jobSignature(job({ city: null }))).toBe(jobSignature(job()));
  });

  it('still notices a real change', () => {
    expect(jobSignature(job({ actual: '4200' }))).not.toBe(jobSignature(job({ actual: '4300' })));
    expect(jobSignature(job({ paid: true }))).not.toBe(jobSignature(job({ paid: false })));
  });
});

describe('compareSources', () => {
  it('agrees when both hold the same jobs', () => {
    const cmp = compareSources([job(), job({ id: 'b2' })], [job({ id: 'b2' }), job()]);
    expect(cmp.agree).toBe(true);
  });

  it('catches a job the mirror never received', () => {
    // The important failure: income silently short.
    const cmp = compareSources([job(), job({ id: 'b2' })], [job()]);
    expect(cmp.agree).toBe(false);
    expect(cmp.missingFromMirror).toEqual(['b2']);
  });

  it('catches a job the mirror kept after it was deleted', () => {
    const cmp = compareSources([job()], [job(), job({ id: 'ghost' })]);
    expect(cmp.agree).toBe(false);
    expect(cmp.notInFiles).toEqual(['ghost']);
  });

  it('catches a job whose figures differ', () => {
    const cmp = compareSources([job({ actual: '4200' })], [job({ actual: '9999' })]);
    expect(cmp.agree).toBe(false);
    expect(cmp.differing).toEqual(['a1']);
  });

  it('refuses to agree when a job has no id', () => {
    // Uncomparable, which means the mirror may be incomplete in a way this
    // cannot see. That is not the same as agreement.
    const cmp = compareSources([job(), { sr: '2026099', customer: 'X' }], [job()]);
    expect(cmp.agree).toBe(false);
    expect(cmp.withoutIds).toBe(1);
  });

  it('does not agree when the mirror is empty and the files are not', () => {
    expect(compareSources([job()], []).agree).toBe(false);
  });

  it('agrees when both are empty', () => {
    expect(compareSources([], []).agree).toBe(true);
  });

  it('survives junk', () => {
    expect(() => compareSources([null, undefined], [null])).not.toThrow();
  });
});

describe('describeDrift', () => {
  it('says nothing when they agree', () => {
    expect(describeDrift(compareSources([job()], [job()]))).toBe('');
  });

  it('says what is wrong and what it did instead', () => {
    const msg = describeDrift(compareSources([job(), job({ id: 'b2' })], [job()]));
    expect(msg).toMatch(/1 missing from the mirror/);
    expect(msg).toMatch(/Reading the year files instead/);
  });
});

describe('duplicateIds', () => {
  it('finds a job counted twice', () => {
    // What a doubled income total actually looks like in the data.
    expect(duplicateIds([job(), job(), job({ id: 'b2' })])).toEqual(['a1']);
  });

  it('is quiet when every job appears once', () => {
    expect(duplicateIds([job(), job({ id: 'b2' })])).toEqual([]);
  });

  it('ignores jobs with no id rather than calling them duplicates of each other', () => {
    expect(duplicateIds([{ sr: '1' }, { sr: '2' }])).toEqual([]);
  });

  it('survives junk', () => {
    expect(() => duplicateIds([null, undefined])).not.toThrow();
    expect(duplicateIds()).toEqual([]);
  });
});
