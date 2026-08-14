// A permission error and an empty collection must stop looking identical.
import { describe, it, expect, beforeEach } from 'vitest';
import { recordFailure, recordSuccess, list, summarise, isPermission, subscribe, reset, isSignIn } from './dataHealth.js';

beforeEach(() => reset());

describe('recordFailure / recordSuccess', () => {
  it('remembers what failed', () => {
    recordFailure('jobs', new Error('boom'));
    expect(list()).toHaveLength(1);
    expect(list()[0].source).toBe('jobs');
    expect(list()[0].message).toBe('boom');
  });

  it('keeps one entry per source, however often it fails', () => {
    // A source failing on every refresh must not grow an unbounded pile.
    recordFailure('jobs', new Error('a'));
    recordFailure('jobs', new Error('b'));
    expect(list()).toHaveLength(1);
    expect(list()[0].message).toBe('b');
  });

  it('clears when the source loads again', () => {
    recordFailure('jobs', new Error('boom'));
    recordSuccess('jobs');
    expect(list()).toEqual([]);
  });

  it('is unbothered by a success for something that never failed', () => {
    expect(() => recordSuccess('never-failed')).not.toThrow();
  });

  it('copes with whatever gets thrown, not just Errors', () => {
    recordFailure('x', 'a string');
    recordFailure('y', null);
    expect(list().map((f) => f.message)).toContain('a string');
    expect(list().find((f) => f.source === 'y').message).toBe('Unknown error');
  });
});

describe('isPermission', () => {
  it('recognises the shapes Firebase actually returns', () => {
    ['Missing or insufficient permissions.', 'PERMISSION_DENIED', 'Unauthenticated', 'permission-denied']
      .forEach((m) => expect(isPermission(m)).toBe(true));
  });

  it('does not treat a network failure as a permission problem', () => {
    // The advice differs: reloading helps one and not the other.
    ['Failed to fetch', 'network error', 'timeout'].forEach((m) => expect(isPermission(m)).toBe(false));
  });
});

describe('summarise', () => {
  it('says nothing when nothing is wrong', () => {
    expect(summarise()).toBe('');
  });

  it('names one source', () => {
    recordFailure('timesheets', new Error('Failed to fetch'));
    expect(summarise()).toContain('timesheets');
  });

  it('reads as a list for several', () => {
    recordFailure('jobs', new Error('Failed to fetch'), '2026-08-14T10:00:00Z');
    recordFailure('timesheets', new Error('Failed to fetch'), '2026-08-14T10:00:01Z');
    recordFailure('parts', new Error('Failed to fetch'), '2026-08-14T10:00:02Z');
    expect(summarise()).toMatch(/parts, timesheets and jobs|jobs, timesheets and parts/);
  });

  it('gives permission problems their own advice', () => {
    // "Reload the page" is useless here and sends somebody down the wrong path.
    recordFailure('jobs', new Error('Missing or insufficient permissions.'));
    expect(summarise()).toMatch(/sign-in may have expired/);
  });

  it('falls back to the general message when the causes are mixed', () => {
    recordFailure('jobs', new Error('Missing or insufficient permissions.'), '2026-08-14T10:00:00Z');
    recordFailure('parts', new Error('Failed to fetch'), '2026-08-14T10:00:01Z');
    expect(summarise()).toMatch(/may be incomplete/);
  });
});

describe('subscribe', () => {
  it('fires immediately and on every change', () => {
    const seen = [];
    const off = subscribe((items) => seen.push(items.length));
    recordFailure('jobs', new Error('x'));
    recordSuccess('jobs');
    off();
    recordFailure('later', new Error('y'));
    expect(seen).toEqual([0, 1, 0]);   // nothing after unsubscribing
  });

  it('one broken listener does not stop the others being told', () => {
    const seen = [];
    subscribe(() => { throw new Error('bad listener'); });
    subscribe(() => seen.push(1));
    recordFailure('jobs', new Error('x'));
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('reset(keep)', () => {
  it('keeps what the predicate says and clears the rest', () => {
    // A data refresh rebuilds fetch failures but never retries the sign-ins, so
    // wiping those would hide the reason the data is empty.
    recordFailure('sign-in to timesheets', new Error('wrong password'));
    recordFailure('jobs data', new Error('Failed to fetch'));
    reset(isSignIn);
    expect(list().map((f) => f.source)).toEqual(['sign-in to timesheets']);
  });

  it('clears everything when given no predicate', () => {
    recordFailure('sign-in to timesheets', new Error('x'));
    recordFailure('jobs data', new Error('y'));
    reset();
    expect(list()).toEqual([]);
  });
});

describe('isSignIn', () => {
  it('recognises only the sign-in sources', () => {
    expect(isSignIn('sign-in to timesheets')).toBe(true);
    expect(isSignIn('timesheet data')).toBe(false);
    expect(isSignIn(null)).toBe(false);
  });
});
