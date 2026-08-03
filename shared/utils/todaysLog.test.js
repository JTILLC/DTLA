import { describe, it, expect } from 'vitest';
import { chooseOpeningLog, logLabel, daysOld, isSameDay, editableLogs } from './todaysLog.js';

// A fixed "now" so these never depend on when they run. Local time on purpose —
// the module answers in local calendar days, and that is the thing under test.
const NOW = new Date(2026, 7, 3, 9, 30); // Mon 3 Aug 2026, 09:30
const at = (y, m, d, h = 8, min = 0) => new Date(y, m, d, h, min).toISOString();

const log = (over = {}) => ({ id: 'v1', date: at(2026, 7, 3), shift: '1st Shift', ...over });

describe('isSameDay', () => {
  it('compares local calendar days, not 24-hour spans', () => {
    expect(isSameDay(at(2026, 7, 3, 23, 40), NOW)).toBe(true);
    // Ten hours apart but a different day on the wall clock.
    expect(isSameDay(at(2026, 7, 2, 23, 40), NOW)).toBe(false);
  });
  it('is false for junk dates rather than throwing', () => {
    expect(isSameDay(undefined, NOW)).toBe(false);
    expect(isSameDay('not a date', NOW)).toBe(false);
  });
});

describe('editableLogs', () => {
  it('hides shift-less JTI visits from a plant but not from JTI', () => {
    const logs = [log({ id: 'plant' }), log({ id: 'jti', shift: undefined })];
    expect(editableLogs(logs).map(l => l.id)).toEqual(['plant']);
    expect(editableLogs(logs, { isAdmin: true }).map(l => l.id).sort()).toEqual(['jti', 'plant']);
  });
  it('drops deleted logs for everyone', () => {
    expect(editableLogs([log({ deleted: true })], { isAdmin: true })).toEqual([]);
  });
});

describe('chooseOpeningLog', () => {
  it('opens a log dated today', () => {
    const r = chooseOpeningLog([log({ id: 'today' })], { now: NOW });
    expect(r).toMatchObject({ action: 'open', log: { id: 'today' } });
  });

  it('offers — never opens — a log from an earlier day', () => {
    const r = chooseOpeningLog([log({ id: 'sat', date: at(2026, 7, 1) })], { now: NOW });
    expect(r.action).toBe('offer');
    expect(r.log.id).toBe('sat');
  });

  it('says start when the customer has no logs at all', () => {
    expect(chooseOpeningLog([], { now: NOW })).toEqual({ action: 'start' });
  });

  it('says start when the only logs are JTI visits a plant may not edit', () => {
    expect(chooseOpeningLog([log({ shift: undefined })], { now: NOW })).toEqual({ action: 'start' });
  });

  it('keeps you in the shift you were already in when today has two', () => {
    const first = log({ id: 'first', date: at(2026, 7, 3, 6), shift: '1st Shift' });
    const third = log({ id: 'third', date: at(2026, 7, 3, 22), shift: '3rd Shift' });
    // Newest wins by default...
    expect(chooseOpeningLog([first, third], { now: NOW }).log.id).toBe('third');
    // ...but the one this device had open wins over the sort order.
    expect(chooseOpeningLog([first, third], { now: NOW, rememberedId: 'first' }).log.id).toBe('first');
  });

  it('ignores a remembered log that is no longer today', () => {
    const stale = log({ id: 'stale', date: at(2026, 7, 1) });
    const fresh = log({ id: 'fresh', date: at(2026, 7, 3) });
    // The whole point: yesterday's remembered log must not reopen.
    expect(chooseOpeningLog([stale, fresh], { now: NOW, rememberedId: 'stale' }).log.id).toBe('fresh');
  });

  it('offers the newest of several old logs', () => {
    const logs = [
      log({ id: 'older', date: at(2026, 6, 20) }),
      log({ id: 'newer', date: at(2026, 7, 1) }),
    ];
    expect(chooseOpeningLog(logs, { now: NOW }).log.id).toBe('newer');
  });

  it('does not offer a deleted log even when it is the newest', () => {
    const logs = [
      log({ id: 'binned', date: at(2026, 7, 2), deleted: true }),
      log({ id: 'kept', date: at(2026, 7, 1) }),
    ];
    expect(chooseOpeningLog(logs, { now: NOW }).log.id).toBe('kept');
  });

  it('sorts unparseable dates last instead of letting them win', () => {
    const logs = [log({ id: 'junk', date: 'whenever' }), log({ id: 'real', date: at(2026, 7, 1) })];
    expect(chooseOpeningLog(logs, { now: NOW }).log.id).toBe('real');
  });
});

describe('logLabel', () => {
  it('says Today for today, and a weekday for anything else', () => {
    expect(logLabel(log(), { now: NOW })).toBe('Today · 1st Shift');
    // 1 Aug 2026 is a Saturday. Exact separator formatting is the platform's
    // business, so assert the parts rather than the punctuation between them.
    const older = logLabel(log({ date: at(2026, 7, 1) }), { now: NOW });
    expect(older).toContain('Sat');
    expect(older).toContain('8/1');
    expect(older).toContain('· 1st Shift');
    expect(older).not.toContain('Today');
  });
  it('omits a missing shift rather than printing a stray separator', () => {
    expect(logLabel(log({ shift: undefined }), { now: NOW })).toBe('Today');
  });
  it('is empty for no log', () => {
    expect(logLabel(null)).toBe('');
  });
});

describe('daysOld', () => {
  it('counts calendar days, so late last night is 1 day', () => {
    expect(daysOld(log({ date: at(2026, 7, 2, 23, 0) }), { now: NOW })).toBe(1);
    expect(daysOld(log({ date: at(2026, 7, 3, 1, 0) }), { now: NOW })).toBe(0);
    expect(daysOld(log({ date: at(2026, 6, 27) }), { now: NOW })).toBe(7);
  });
  it('returns null for a junk date', () => {
    expect(daysOld(log({ date: 'nope' }), { now: NOW })).toBe(null);
  });
});
