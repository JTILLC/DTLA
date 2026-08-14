// A number whose only record is its job packet still has to be clickable.
import { describe, it, expect } from 'vitest';
import { withPacketNumbers } from './reportRows.js';

const reports = [
  { number: '2026028', norm: '2026028', year: '2026', timesheets: [{}], visits: [] },
  { number: '2026024', norm: '2026024', year: '2026', timesheets: [], visits: [{}] },
];

const packetMap = (obj) => new Map(Object.entries(obj));

describe('withPacketNumbers', () => {
  it('adds a number that exists only as a packet', () => {
    // The reported case: an invoice uploaded to 2026027's packet, no timesheet
    // or visit yet, and no row on the screen to click.
    const out = withPacketNumbers(reports, packetMap({
      2026027: { sr: '2026027', files: [{ kind: 'invoice', name: 'inv.pdf' }] },
    }));
    expect(out.map((r) => r.norm)).toContain('2026027');
    expect(out.find((r) => r.norm === '2026027').packetOnly).toBe(true);
  });

  it('leaves existing rows exactly as they were', () => {
    const out = withPacketNumbers(reports, packetMap({
      2026028: { sr: '2026028', files: [{ kind: 'invoice' }] },
    }));
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.norm === '2026028').timesheets).toHaveLength(1);
    expect(out.find((r) => r.norm === '2026028').packetOnly).toBeUndefined();
  });

  it('ignores a packet with no files — a reserved number that was never used', () => {
    const out = withPacketNumbers(reports, packetMap({ 2026099: { sr: '2026099', files: [] } }));
    expect(out.map((r) => r.norm)).not.toContain('2026099');
  });

  it('matches on the normalised number, so 2026-027 does not double up', () => {
    const withDash = [{ number: '2026-027', norm: '2026027', year: '2026', timesheets: [], visits: [] }];
    const out = withPacketNumbers(withDash, packetMap({ 2026027: { sr: '2026027', files: [{ kind: 'po' }] } }));
    expect(out).toHaveLength(1);
  });

  it('sorts the new rows in with the rest, newest first', () => {
    const out = withPacketNumbers(reports, packetMap({
      2026030: { sr: '2026030', files: [{ kind: 'invoice' }] },
    }));
    expect(out.map((r) => r.norm)).toEqual(['2026030', '2026028', '2026024']);
  });

  it('gives a packet-only row the right year, so the year filter finds it', () => {
    const out = withPacketNumbers([], packetMap({ 2025003: { sr: '2025003', files: [{ kind: 'invoice' }] } }));
    expect(out[0].year).toBe('2025');
  });

  it('does nothing when packets have not loaded yet', () => {
    expect(withPacketNumbers(reports, null)).toBe(reports);
    expect(withPacketNumbers(reports, undefined)).toBe(reports);
  });

  it('survives junk in the map', () => {
    expect(() => withPacketNumbers(reports, packetMap({ x: null, y: {} }))).not.toThrow();
  });
});
