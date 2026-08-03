import { describe, it, expect } from 'vitest';
import { planImport, cleanLineForImport, withFreshIds, openIssueCount } from './importLines.js';

const head = (n, over = {}) => ({ id: n, status: 'running', issues: [], photos: [], ...over });
const line = (t, over = {}) => ({ id: `l_${t}`, title: t, heads: [head(1), head(2)], ...over });

describe('planImport', () => {
  it('adds the lines the log does not have', () => {
    const plan = planImport([line('Line 1')], [line('Line 1'), line('Line 2')]);
    expect(plan.toAdd.map((l) => l.title)).toEqual(['Line 2']);
    expect(plan.skipped).toEqual(['Line 1']);
  });

  it('matches on title regardless of case or padding, so no second "Line 3" appears', () => {
    const plan = planImport([line('Line 3')], [line('  line 3  ')]);
    expect(plan.toAdd).toEqual([]);
    expect(plan.skipped).toEqual(['line 3']);
  });

  it('never returns an existing line for overwrite — the plant keeps their own', () => {
    const mine = line('Line 1', { heads: [head(1, { status: 'offline' })] });
    const theirs = line('Line 1', { heads: [head(1), head(2), head(3)] });
    const plan = planImport([mine], [theirs]);
    expect(plan.toAdd).toEqual([]);
    // The caller has nothing to apply, so the plant's offline head survives.
  });

  it('imports everything into an empty log', () => {
    const plan = planImport([], [line('Line 1'), line('Line 2')]);
    expect(plan.toAdd.map((l) => l.title)).toEqual(['Line 1', 'Line 2']);
    expect(plan.skipped).toEqual([]);
  });

  it('drops untitled lines — they cannot be matched or referred to', () => {
    const plan = planImport([], [line(''), line('   '), line('Line 1')]);
    expect(plan.toAdd.map((l) => l.title)).toEqual(['Line 1']);
  });

  it('does not add the same title twice from one visit', () => {
    const plan = planImport([], [line('Line 1'), line('Line 1')]);
    expect(plan.toAdd).toHaveLength(1);
  });

  it('survives junk', () => {
    expect(planImport(undefined, undefined)).toEqual({ toAdd: [], skipped: [] });
    expect(planImport([], null).toAdd).toEqual([]);
  });
});

describe('cleanLineForImport', () => {
  const dirty = line('Line 1', {
    heads: [head(1, {
      status: 'offline',
      photos: ['gs://a.jpg'],
      redzoneWorkOrderId: 'WO-1',
      redzoneWorkOrderUrl: 'https://x',
      redzoneSyncedAt: 'now',
      redzoneStatus: 'open',
      issues: [{ id: 1, text: 'load cell drifting', fixed: 'no', photos: ['gs://b.jpg'] }],
    })],
  });

  it('keeps the equipment and the open problems', () => {
    const c = cleanLineForImport(dirty);
    expect(c.title).toBe('Line 1');
    expect(c.heads[0].status).toBe('offline');
    expect(c.heads[0].issues[0].text).toBe('load cell drifting');
  });

  it('drops photos, which are authorised to whoever uploaded them', () => {
    const c = cleanLineForImport(dirty);
    expect(c.heads[0].photos).toEqual([]);
    expect(c.heads[0].issues[0].photos).toEqual([]);
  });

  it("drops JTI's work-order links", () => {
    const c = cleanLineForImport(dirty);
    expect(c.heads[0].redzoneWorkOrderId).toBeUndefined();
    expect(c.heads[0].redzoneWorkOrderUrl).toBeUndefined();
    expect(c.heads[0].redzoneStatus).toBeUndefined();
  });

  it('deep-copies, so editing the import cannot reach back into the visit', () => {
    const c = cleanLineForImport(dirty);
    c.heads[0].status = 'running';
    expect(dirty.heads[0].status).toBe('offline');
  });
});

describe('withFreshIds', () => {
  it('gives new line ids so they cannot collide with existing lines', () => {
    const out = withFreshIds([line('A'), line('B')], 1000);
    expect(out.map((l) => l.id)).toEqual(['line_1000_0', 'line_1000_1']);
  });

  it('leaves head numbering alone — head 3 is head 3 on the machine', () => {
    const out = withFreshIds([line('A')], 1000);
    expect(out[0].heads.map((h) => h.id)).toEqual([1, 2]);
  });
});

describe('openIssueCount', () => {
  it('counts heads that are down or carrying an unfixed issue', () => {
    const lines = [line('A', {
      heads: [
        head(1, { status: 'offline' }),
        head(2, { issues: [{ fixed: 'no' }] }),
        head(3, { issues: [{ fixed: 'fixed' }] }),
        head(4),
      ],
    })];
    expect(openIssueCount(lines)).toBe(2);
  });
  it('is zero for nothing', () => {
    expect(openIssueCount([])).toBe(0);
    expect(openIssueCount()).toBe(0);
  });
});
