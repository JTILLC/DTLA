// Tests for the visit carry-forward logic.
//
// scaffoldLinesFrom decides what a NEW visit inherits from the last one. Getting
// it wrong is a data problem, not a cosmetic one: too little and the tech
// re-enters the whole machine setup; too much and last month's resolved issues
// reappear as if they were still open, which is exactly what a customer would
// dispute.
import { describe, it, expect } from 'vitest';
import { scaffoldLinesFrom, lineStatusKey } from './headHelpers.js';

const priorVisit = () => ({
  name: 'March service',
  lines: [
    {
      id: 1,
      title: 'Line 1',
      model: 'CCW-RV-214',
      jobNumber: 'J-100',
      serialNumber: 'SN-1',
      running: true,
      notes: 'belt slipping',
      audit: { 'Check A': { status: 'bad' } },
      auditNotes: 'needs work',
      avgWeight100: '99.4',
      stdDev100: '0.8',
      signerName: 'J. Tech',
      calDate: '2026-03-01',
      calDueDate: '2027-02-28',
      spanCalWeight: '100',
      targetWeight: '100',
      heads: [
        {
          id: 1,
          status: 'offline',
          error: 'Chute',
          fixed: 'not_fixed',
          notes: 'jammed',
          issues: [{ type: 'Chute', fixed: 'not_fixed', notes: 'jammed' }],
          photos: [{ url: 'u', path: 'p' }],
          currentWeight: 12,
          spanWeight: 100,
          weightDifference: 88,
        },
        { id: 2, status: 'active', issues: [], notes: '', photos: [] },
      ],
    },
  ],
});

describe('scaffoldLinesFrom — default (setup only)', () => {
  const [line] = scaffoldLinesFrom(priorVisit());

  it('keeps the machine identity so it need not be re-entered', () => {
    expect(line.title).toBe('Line 1');
    expect(line.model).toBe('CCW-RV-214');
    expect(line.jobNumber).toBe('J-100');
    expect(line.serialNumber).toBe('SN-1');
    expect(line.running).toBe(true);
  });

  it('keeps span-cal constants but clears this-visit measurements', () => {
    expect(line.spanCalWeight).toBe('100');
    expect(line.targetWeight).toBe('100');
    expect(line.avgWeight100).toBe('');
    expect(line.stdDev100).toBe('');
  });

  it('keeps the head COUNT', () => {
    expect(line.heads).toHaveLength(2);
  });

  it('resets every head to active with nothing logged', () => {
    expect(line.heads[0].status).toBe('active');
    expect(line.heads[0].issues).toEqual([]);
    expect(line.heads[0].photos).toEqual([]);
    expect(line.heads[0].notes).toBe('');
    expect(line.heads[0].error).toBe('None');
    expect(line.heads[0].fixed).toBe('na');
  });

  it('zeroes weights', () => {
    expect(line.heads[0].currentWeight).toBe(0);
    expect(line.heads[0].spanWeight).toBe(0);
    expect(line.heads[0].weightDifference).toBe(0);
  });

  it('clears line notes, audit and per-visit signature fields', () => {
    expect(line.notes).toBe('');
    expect(line.audit).toEqual({});
    expect(line.auditNotes).toBe('');
    expect(line.signerName).toBe('');
    expect(line.calDate).toBe('');
    expect(line.calDueDate).toBe('');
  });

  it('does not mutate the source visit', () => {
    const src = priorVisit();
    scaffoldLinesFrom(src);
    expect(src.lines[0].heads[0].status).toBe('offline');
    expect(src.lines[0].heads[0].issues).toHaveLength(1);
  });
});

describe('scaffoldLinesFrom — keepIssues (explicit opt-in)', () => {
  const [line] = scaffoldLinesFrom(priorVisit(), { keepIssues: true });

  it('carries head status, issues and notes forward', () => {
    expect(line.heads[0].status).toBe('offline');
    expect(line.heads[0].issues).toHaveLength(1);
    expect(line.heads[0].notes).toBe('jammed');
    expect(line.notes).toBe('belt slipping');
  });

  it('still zeroes weights and clears the per-visit audit/signature', () => {
    // Weights and the audit are measured fresh every visit even when the
    // outstanding issues carry over.
    expect(line.heads[0].currentWeight).toBe(0);
    expect(line.audit).toEqual({});
    expect(line.signerName).toBe('');
  });
});

describe('scaffoldLinesFrom — edge cases', () => {
  it('handles a visit with no lines', () => {
    expect(scaffoldLinesFrom({ lines: [] })).toEqual([]);
    expect(scaffoldLinesFrom({})).toEqual([]);
    expect(scaffoldLinesFrom(null)).toEqual([]);
  });

  it('assigns head ids positionally when the source lacks them', () => {
    const [line] = scaffoldLinesFrom({ lines: [{ id: 1, heads: [{}, {}, {}] }] });
    expect(line.heads.map((h) => h.id)).toEqual([1, 2, 3]);
  });
});

describe('lineStatusKey', () => {
  const line = (heads) => ({ heads });

  it('is ok when every head is active and clean', () => {
    expect(lineStatusKey(line([{ status: 'active', issues: [] }]))).toBe('ok');
  });

  it('is offline when a head is down with unresolved issues', () => {
    expect(
      lineStatusKey(line([{ status: 'offline', issues: [{ fixed: 'not_fixed' }] }]))
    ).toBe('offline');
  });

  it('is offline when a head is down with nothing logged yet', () => {
    expect(lineStatusKey(line([{ status: 'offline', issues: [] }]))).toBe('offline');
  });

  it('is fixed when the only down head has all issues resolved', () => {
    expect(
      lineStatusKey(line([{ status: 'offline', issues: [{ fixed: 'fixed' }] }]))
    ).toBe('fixed');
  });

  it('is attn for a head running with known issues', () => {
    expect(
      lineStatusKey(line([{ status: 'active', issues: [{ fixed: 'active_with_issues' }] }]))
    ).toBe('attn');
  });

  it('reports the WORST head, not the first', () => {
    expect(
      lineStatusKey(
        line([
          { status: 'active', issues: [] },
          { status: 'offline', issues: [{ fixed: 'fixed' }] },
          { status: 'offline', issues: [{ fixed: 'not_fixed' }] },
        ])
      )
    ).toBe('offline');
  });

  it('handles an empty or malformed line', () => {
    expect(lineStatusKey({ heads: [] })).toBe('ok');
    expect(lineStatusKey({})).toBe('ok');
    expect(lineStatusKey(null)).toBe('ok');
  });
});
