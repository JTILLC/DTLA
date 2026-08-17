// What the Backups page is allowed to claim.
//
// The failure this guards against is a green line on a page while nothing has
// been backed up for a week — the exact reassurance that makes people stop
// checking.
import { describe, it, expect } from 'vitest';
import { backupStatus, manualNote, ago } from './backupStatus';

const NOW = Date.parse('2026-08-16T18:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

const nightly = (over = {}) => ({
  day: '2026-08-16',
  trigger: 'nightly',
  finishedAt: hoursAgo(16),
  results: [
    { name: 'CCW Issues', ok: true, documents: 144 },
    { name: 'Jobs and packets', ok: true, documents: 781 },
    { name: 'Timesheets', ok: true, documents: 168 },
    { name: 'Shearers downtime', ok: true, documents: 1 },
  ],
  ...over,
});

describe('backupStatus', () => {
  it('says it ran, with what it covered', () => {
    const s = backupStatus({ nightly: nightly() }, NOW);
    expect(s.tone).toBe('ok');
    expect(s.headline).toMatch(/Backed up 16 hours ago/);
    expect(s.detail).toMatch(/4 of 4 apps · 1,094 documents/);
    expect(s.apps).toHaveLength(4);
  });

  it('treats a missing manifest as a problem, not as quiet success', () => {
    const s = backupStatus({ nightly: null, latest: null }, NOW);
    expect(s.tone).toBe('bad');
    expect(s.headline).toMatch(/No nightly backup/);
  });

  it('reads a pre-`trigger` manifest by whether it pruned', () => {
    // Manifests written before this page existed carry no trigger. Only the
    // unnarrowed run prunes, so a run that pruned was the cron.
    const old = nightly({ trigger: undefined, retention: { deleted: 4 } });
    const s = backupStatus({ nightly: null, latest: old }, NOW);
    expect(s.tone).toBe('ok');
    expect(s.headline).toMatch(/Backed up/);
  });

  it('does NOT accept a by-hand run as evidence the schedule works', () => {
    const byHand = nightly({
      trigger: undefined,
      retention: { skipped: 'pruning runs on the nightly job' },
    });
    const s = backupStatus({ nightly: null, latest: byHand }, NOW);
    expect(s.tone).toBe('bad');
    expect(s.headline).toMatch(/No nightly backup/);
  });

  it('treats a failed check as a problem too', () => {
    const s = backupStatus({ error: 'read failed: 403' }, NOW);
    expect(s.tone).toBe('bad');
    expect(s.detail).toMatch(/403/);
  });

  it('goes red once a nightly job has missed more than a night', () => {
    const s = backupStatus({ nightly: nightly({ finishedAt: hoursAgo(50) }) }, NOW);
    expect(s.tone).toBe('bad');
    expect(s.headline).toMatch(/2 days ago/);
  });

  it('does NOT call a run successful when one app failed', () => {
    const s = backupStatus({
      nightly: nightly({
        results: [
          { name: 'CCW Issues', ok: true, documents: 144 },
          { name: 'Jobs and packets', ok: false, error: 'worker killed' },
        ],
      }),
    }, NOW);
    expect(s.tone).toBe('bad');
    expect(s.headline).toMatch(/1 of 2 apps failed/);
    expect(s.detail).toMatch(/Jobs and packets/);
  });

  it('flags a run that stopped early, which reports ok and is not a whole copy', () => {
    const s = backupStatus({
      nightly: nightly({
        results: [{ name: 'CCW Issues', ok: true, documents: 144, truncated: 'byte cap' }],
      }),
    }, NOW);
    expect(s.tone).toBe('warn');
    expect(s.detail).toMatch(/stopped early/);
  });

  it('flags a skipped app rather than counting it as covered', () => {
    const s = backupStatus({
      nightly: nightly({
        results: [
          { name: 'CCW Issues', ok: true, documents: 144 },
          { name: 'Shearers downtime', skipped: true, reason: 'no database url configured' },
        ],
      }),
    }, NOW);
    expect(s.tone).toBe('warn');
    expect(s.detail).toMatch(/Shearers downtime skipped/);
  });
});

describe('manualNote', () => {
  it('mentions a by-hand run that happened after the last nightly one', () => {
    const note = manualNote({
      nightly: nightly(),
      latest: { trigger: 'manual', finishedAt: hoursAgo(1), results: [{ name: 'Timesheets', ok: true }] },
    }, NOW);
    expect(note).toMatch(/by hand 1 hour ago \(Timesheets\)/);
  });

  it('stays quiet when the nightly run is the more recent', () => {
    const note = manualNote({
      nightly: nightly(),
      latest: { trigger: 'manual', finishedAt: hoursAgo(40), results: [] },
    }, NOW);
    expect(note).toBe('');
  });

  it('stays quiet when the last run WAS the nightly one', () => {
    expect(manualNote({ nightly: nightly(), latest: nightly() }, NOW)).toBe('');
  });
});

describe('ago', () => {
  it('reads as a person would say it', () => {
    expect(ago(hoursAgo(0.01), NOW)).toBe('just now');
    expect(ago(hoursAgo(0.5), NOW)).toBe('30 minutes ago');
    expect(ago(hoursAgo(5), NOW)).toBe('5 hours ago');
    expect(ago(hoursAgo(24), NOW)).toBe('yesterday');
    expect(ago(hoursAgo(24 * 6), NOW)).toBe('6 days ago');
    expect(ago('not a date', NOW)).toBe('at an unknown time');
  });
});
