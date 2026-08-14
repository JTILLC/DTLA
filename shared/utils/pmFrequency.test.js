import { describe, it, expect } from 'vitest';
import {
  FREQUENCIES, FREQ_ORDER, isFrequency, labelOf, needsSignOff,
  frequencyOf, bucketOf, nextDueFor, frequenciesPresent, sectionsFor, boardFor,
  lineBoardFor, WHOLE_PLANT,
} from './pmFrequency.js';

const at = (iso, over = {}) => ({ performedAt: iso, ...over });

describe('the vocabulary', () => {
  it('is ordered shortest interval first, with as-needed last', () => {
    expect(FREQ_ORDER).toEqual(['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'asneeded']);
  });

  it('signs off only the long-interval checks', () => {
    expect(needsSignOff('daily')).toBe(false);
    expect(needsSignOff('weekly')).toBe(false);
    expect(needsSignOff('monthly')).toBe(true);
    expect(needsSignOff('quarterly')).toBe(true);
    expect(needsSignOff('annually')).toBe(true);
    expect(needsSignOff('asneeded')).toBe(false);
  });

  it('does not treat an unknown key as a frequency', () => {
    expect(isFrequency('fortnightly')).toBe(false);
    expect(isFrequency(undefined)).toBe(false);
    expect(labelOf('fortnightly')).toBe('Unscheduled');
  });

  it('gives as-needed no clock', () => {
    expect(FREQUENCIES.find((f) => f.key === 'asneeded').days).toBe(null);
  });
});

describe('frequencyOf — a section', () => {
  it('takes the explicit field over the title', () => {
    expect(frequencyOf({ title: 'Weekly checks', frequency: 'annually' })).toBe('annually');
  });

  it('ignores a field that is not a real frequency', () => {
    expect(frequencyOf({ title: 'Weekly checks', frequency: 'sometimes' })).toBe('weekly');
  });

  it('reads the legacy titles every existing checklist uses', () => {
    expect(frequencyOf({ title: 'Daily checks' })).toBe('daily');
    expect(frequencyOf({ title: 'Weekly checks' })).toBe('weekly');
    expect(frequencyOf({ title: 'Monthly inspection' })).toBe('monthly');
    expect(frequencyOf({ title: 'Quarterly service' })).toBe('quarterly');
    expect(frequencyOf({ title: 'Annual certification' })).toBe('annually');
    expect(frequencyOf({ title: 'Yearly load cell cert' })).toBe('annually');
    expect(frequencyOf({ title: 'Every shift — walk round' })).toBe('daily');
  });

  it('picks the SHORTER interval when a title names two', () => {
    // Running something too often is recoverable; not running it is not.
    expect(frequencyOf({ title: 'Monthly / quarterly checks' })).toBe('monthly');
    expect(frequencyOf({ title: 'Weekly and monthly' })).toBe('weekly');
  });

  it('falls back to as-needed rather than inventing a schedule', () => {
    expect(frequencyOf({ title: 'After a product changeover' })).toBe('asneeded');
    expect(frequencyOf({ title: '' })).toBe('asneeded');
    expect(frequencyOf(null)).toBe('asneeded');
  });
});

describe('bucketOf — a submitted entry', () => {
  it('takes the stamped frequency', () => {
    expect(bucketOf({ frequency: 'daily', intervalDays: 365 })).toBe('daily');
  });

  it('maps a legacy entry by the interval that was typed in', () => {
    expect(bucketOf({ intervalDays: 1 })).toBe('daily');
    expect(bucketOf({ intervalDays: 7 })).toBe('weekly');
    expect(bucketOf({ intervalDays: 30 })).toBe('monthly');   // the old default
    expect(bucketOf({ intervalDays: 90 })).toBe('quarterly');
    expect(bucketOf({ intervalDays: 365 })).toBe('annually');
  });

  it('does not guess at an interval nobody standardised', () => {
    expect(bucketOf({ intervalDays: 45 })).toBe('unscheduled');
    expect(bucketOf({ intervalDays: null })).toBe('unscheduled');
    expect(bucketOf({})).toBe('unscheduled');
  });
});

describe('nextDueFor', () => {
  it('adds the frequency interval to the date given', () => {
    expect(nextDueFor('daily', '2026-03-01T08:00:00.000Z').slice(0, 10)).toBe('2026-03-02');
    expect(nextDueFor('weekly', '2026-03-01T08:00:00.000Z').slice(0, 10)).toBe('2026-03-08');
    expect(nextDueFor('monthly', '2026-03-01T08:00:00.000Z').slice(0, 10)).toBe('2026-03-31');
  });

  it('gives as-needed no due date at all', () => {
    expect(nextDueFor('asneeded', '2026-03-01T08:00:00.000Z')).toBe(null);
  });

  it('returns null rather than an Invalid Date for junk', () => {
    expect(nextDueFor('daily', 'not-a-date')).toBe(null);
    expect(nextDueFor('nonsense', '2026-03-01T08:00:00.000Z')).toBe(null);
  });
});

describe('the checklist shape', () => {
  const sections = [
    { title: 'Daily checks', frequency: 'daily', items: [{ id: 'a' }] },
    { title: 'Load cells', frequency: 'annually', items: [{ id: 'b' }] },
    { title: 'More daily', frequency: 'daily', items: [{ id: 'c' }] },
  ];

  it('lists only the frequencies actually used, shortest first', () => {
    expect(frequenciesPresent(sections)).toEqual(['daily', 'annually']);
  });

  it('handles an empty checklist', () => {
    expect(frequenciesPresent([])).toEqual([]);
    expect(frequenciesPresent()).toEqual([]);
  });

  it('gathers every section on one frequency', () => {
    expect(sectionsFor(sections, 'daily').map((s) => s.title)).toEqual(['Daily checks', 'More daily']);
    expect(sectionsFor(sections, 'weekly')).toEqual([]);
  });
});

describe('boardFor', () => {
  const sections = [
    { title: 'Daily', frequency: 'daily' },
    { title: 'Monthly', frequency: 'monthly' },
  ];

  it('keeps each frequency on its own last-done — the whole point', () => {
    const entries = [
      at('2026-03-10T08:00:00.000Z', { frequency: 'daily', nextDueAt: '2026-03-11T08:00:00.000Z' }),
      at('2026-01-02T08:00:00.000Z', { frequency: 'monthly', nextDueAt: '2026-02-01T08:00:00.000Z' }),
    ];
    const board = boardFor(sections, entries);
    expect(board.map((r) => r.key)).toEqual(['daily', 'monthly']);
    // Doing the daily did NOT move the monthly.
    expect(board[1].nextDueAt).toBe('2026-02-01T08:00:00.000Z');
  });

  it('reports never-run as no schedule, not as overdue', () => {
    const board = boardFor(sections, []);
    expect(board.map((r) => r.nextDueAt)).toEqual([null, null]);
    expect(board.map((r) => r.last)).toEqual([null, null]);
  });

  it('takes the newest entry per frequency whatever order they arrive in', () => {
    const entries = [
      at('2026-03-01T08:00:00.000Z', { frequency: 'daily', nextDueAt: 'older' }),
      at('2026-03-09T08:00:00.000Z', { frequency: 'daily', nextDueAt: 'newest' }),
      at('2026-03-05T08:00:00.000Z', { frequency: 'daily', nextDueAt: 'middle' }),
    ];
    expect(boardFor(sections, entries)[0].nextDueAt).toBe('newest');
  });

  it('narrows to one line when asked, and to the plant when not', () => {
    const entries = [
      at('2026-03-09T08:00:00.000Z', { frequency: 'daily', lineTitle: 'Line 2', nextDueAt: 'l2' }),
      at('2026-03-08T08:00:00.000Z', { frequency: 'daily', lineTitle: 'Line 1', nextDueAt: 'l1' }),
    ];
    expect(boardFor(sections, entries, { lineTitle: 'Line 1' })[0].nextDueAt).toBe('l1');
    expect(boardFor(sections, entries)[0].nextDueAt).toBe('l2');   // newest of any line
  });

  it('flags a long-interval check that nobody has signed', () => {
    const entries = [
      at('2026-03-01T08:00:00.000Z', { frequency: 'monthly' }),
      at('2026-03-02T08:00:00.000Z', { frequency: 'daily' }),
    ];
    const board = boardFor(sections, entries);
    expect(board.find((r) => r.key === 'daily').awaitingSignOff).toBe(false);
    expect(board.find((r) => r.key === 'monthly').awaitingSignOff).toBe(true);
  });

  it('stops flagging once it is signed', () => {
    const entries = [at('2026-03-01T08:00:00.000Z', { frequency: 'monthly', supervisorSignedBy: 'R. Diaz' })];
    expect(boardFor(sections, entries).find((r) => r.key === 'monthly').awaitingSignOff).toBe(false);
  });

  it('places a legacy 30-day entry under monthly', () => {
    const entries = [at('2026-03-01T08:00:00.000Z', { intervalDays: 30, nextDueAt: '2026-03-31T08:00:00.000Z' })];
    const board = boardFor(sections, entries);
    expect(board.find((r) => r.key === 'monthly').nextDueAt).toBe('2026-03-31T08:00:00.000Z');
    expect(board.find((r) => r.key === 'daily').last).toBe(null);
  });

  it('carries the sections so the fill screen can show only what is due', () => {
    expect(boardFor(sections, [])[0].sections.map((s) => s.title)).toEqual(['Daily']);
  });
});

// The Overview groups by line AND frequency rather than by line alone. Keyed by
// line only, the newest entry of any kind won, so a daily walk-round done an
// hour ago hid a monthly that was a month late. This is that regression, at the
// level of the bucketing that drives it.
describe('grouping the log by line and frequency', () => {
  const groupKey = (e) => JSON.stringify([e.lineTitle || 'none', bucketOf(e)]);

  const log = [
    // newest first, as the subscription delivers it
    { lineTitle: 'Line 2', frequency: 'daily', performedAt: '2026-03-10T08:00:00.000Z', nextDueAt: '2026-03-11T08:00:00.000Z' },
    { lineTitle: 'Line 2', frequency: 'monthly', performedAt: '2026-01-05T08:00:00.000Z', nextDueAt: '2026-02-04T08:00:00.000Z' },
    { lineTitle: 'Line 1', frequency: 'daily', performedAt: '2026-03-10T07:00:00.000Z', nextDueAt: '2026-03-11T07:00:00.000Z' },
  ];

  it('keeps a line-2 daily and a line-2 monthly apart', () => {
    const latest = new Map();
    log.forEach((e) => { const k = groupKey(e); if (!latest.has(k)) latest.set(k, e); });
    expect(latest.size).toBe(3);
    const monthly = [...latest.values()].find((e) => e.lineTitle === 'Line 2' && e.frequency === 'monthly');
    expect(monthly.nextDueAt).toBe('2026-02-04T08:00:00.000Z');
  });

  it('would have collapsed to one row per line under the old key', () => {
    const byLineOnly = new Map();
    log.forEach((e) => { const k = e.lineTitle; if (!byLineOnly.has(k)) byLineOnly.set(k, e); });
    expect(byLineOnly.size).toBe(2);
    // Line 2's surviving entry is the daily, so the overdue monthly is invisible.
    expect(byLineOnly.get('Line 2').frequency).toBe('daily');
  });

  it('does not let one line name collide with another line plus a bucket', () => {
    const a = { lineTitle: 'Line 2', frequency: 'monthly' };
    const b = { lineTitle: 'Line 2 monthly', frequency: 'daily' };
    expect(groupKey(a)).not.toBe(groupKey(b));
  });
});

// Daily checks are run per line: one line's walk-round says nothing about
// another's, so the board has to answer "has Line 3 had its daily?" and not
// merely "has a daily happened somewhere today?".
describe('lineBoardFor', () => {
  const LINES = ['Line 1', 'Line 2', 'Line 3'];

  it('gives every known line a row, run or not', () => {
    const rows = lineBoardFor([], 'daily', LINES);
    expect(rows.map((r) => r.lineTitle)).toEqual(LINES);
    expect(rows.every((r) => r.last === null && r.nextDueAt === null)).toBe(true);
  });

  it('keeps one line\'s daily off another line', () => {
    const entries = [
      at('2026-03-10T08:00:00.000Z', { frequency: 'daily', lineTitle: 'Line 1', nextDueAt: 'l1-next' }),
    ];
    const rows = lineBoardFor(entries, 'daily', LINES);
    expect(rows.find((r) => r.lineTitle === 'Line 1').nextDueAt).toBe('l1-next');
    expect(rows.find((r) => r.lineTitle === 'Line 2').last).toBe(null);
    expect(rows.find((r) => r.lineTitle === 'Line 3').last).toBe(null);
  });

  it('does not let another frequency fill a line row', () => {
    const entries = [
      at('2026-03-10T08:00:00.000Z', { frequency: 'monthly', lineTitle: 'Line 1', nextDueAt: 'monthly' }),
    ];
    expect(lineBoardFor(entries, 'daily', LINES).find((r) => r.lineTitle === 'Line 1').last).toBe(null);
  });

  it('takes the newest per line, not the newest overall', () => {
    const entries = [
      at('2026-03-10T09:00:00.000Z', { frequency: 'daily', lineTitle: 'Line 2', nextDueAt: 'l2-new' }),
      at('2026-03-10T08:00:00.000Z', { frequency: 'daily', lineTitle: 'Line 1', nextDueAt: 'l1-new' }),
      at('2026-03-09T08:00:00.000Z', { frequency: 'daily', lineTitle: 'Line 1', nextDueAt: 'l1-old' }),
    ];
    const rows = lineBoardFor(entries, 'daily', LINES);
    expect(rows.find((r) => r.lineTitle === 'Line 1').nextDueAt).toBe('l1-new');
    expect(rows.find((r) => r.lineTitle === 'Line 2').nextDueAt).toBe('l2-new');
  });

  it('adds a whole-plant row only when there are plant-wide entries', () => {
    const perLine = [at('2026-03-10T08:00:00.000Z', { frequency: 'daily', lineTitle: 'Line 1' })];
    expect(lineBoardFor(perLine, 'daily', LINES).map((r) => r.lineTitle)).toEqual(LINES);

    const plantWide = [at('2026-03-10T08:00:00.000Z', { frequency: 'daily', nextDueAt: 'plant' })];
    const rows = lineBoardFor(plantWide, 'daily', LINES);
    expect(rows[0].lineTitle).toBe(WHOLE_PLANT);
    expect(rows[0].nextDueAt).toBe('plant');
    expect(rows).toHaveLength(4);
  });

  it('falls back to a whole-plant row when no lines are known yet', () => {
    const rows = lineBoardFor([], 'daily', []);
    expect(rows).toHaveLength(1);
    expect(rows[0].lineTitle).toBe(WHOLE_PLANT);
  });

  it('treats a legacy entry with no frequency by its interval, per line', () => {
    const entries = [at('2026-03-10T08:00:00.000Z', { intervalDays: 1, lineTitle: 'Line 3', nextDueAt: 'legacy' })];
    expect(lineBoardFor(entries, 'daily', LINES).find((r) => r.lineTitle === 'Line 3').nextDueAt).toBe('legacy');
  });
});

describe('boardFor carries the per-line breakdown', () => {
  const sections = [
    { title: 'Daily', frequency: 'daily' },
    { title: 'Monthly', frequency: 'monthly' },
  ];
  const LINES = ['Line 1', 'Line 2'];

  it('reports a daily done on one line as outstanding on the other', () => {
    const entries = [
      at('2026-03-10T08:00:00.000Z', { frequency: 'daily', lineTitle: 'Line 1', nextDueAt: 'l1' }),
    ];
    const daily = boardFor(sections, entries, { lineTitles: LINES }).find((r) => r.key === 'daily');
    // The headline says a daily happened...
    expect(daily.last).not.toBe(null);
    // ...but Line 2 has still not had one, which is the thing that matters.
    expect(daily.byLine.find((r) => r.lineTitle === 'Line 2').last).toBe(null);
  });

  it('breaks every frequency down the same way', () => {
    const board = boardFor(sections, [], { lineTitles: LINES });
    expect(board.map((r) => r.byLine.map((b) => b.lineTitle))).toEqual([LINES, LINES]);
  });
});
