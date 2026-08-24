// Reading a head the way the app that wrote it reads it. Getting this wrong
// reported a fixed fault as outstanding on the customer's page.
import { describe, it, expect } from 'vitest';
import { issueTypes, headFixedStatus, FIXED_STATUS } from './headIssue.js';

describe('a head in the current shape', () => {
  it('names every issue on it', () => {
    const head = { id: 13, status: 'active', issues: [
      { type: 'Other', fixed: 'fixed' }, { type: 'Load Cell', fixed: 'fixed' },
    ] };
    expect(issueTypes(head)).toBe('Other, Load Cell');
    expect(headFixedStatus(head)).toBe(FIXED_STATUS.FIXED);
  });

  it('is not fixed while any issue is outstanding', () => {
    const head = { issues: [{ type: 'Other', fixed: 'fixed' }, { type: 'PH', fixed: 'not_fixed' }] };
    expect(headFixedStatus(head)).toBe(FIXED_STATUS.NOT_FIXED);
  });

  it('reports running-with-issues over not-fixed', () => {
    const head = { issues: [{ type: 'Other', fixed: 'active_with_issues' }, { type: 'PH', fixed: 'not_fixed' }] };
    expect(headFixedStatus(head)).toBe(FIXED_STATUS.ACTIVE_WITH_ISSUES);
  });

  it('says nothing is recorded when the list is empty', () => {
    // An empty issues array is a head somebody looked at and found fine — not
    // an unfixed fault, which is how the old reading showed it.
    expect(issueTypes({ issues: [] })).toBe('None');
    expect(headFixedStatus({ issues: [] })).toBe(FIXED_STATUS.NA);
  });
});

describe('a head written before the change', () => {
  it('reads its single error as the issue', () => {
    const head = { error: 'Load Cell', fixed: 'fixed', notes: 'replaced' };
    expect(issueTypes(head)).toBe('Load Cell');
    expect(headFixedStatus(head)).toBe(FIXED_STATUS.FIXED);
  });

  it('treats the old "None" as no issue at all', () => {
    expect(issueTypes({ error: 'None' })).toBe('None');
    expect(headFixedStatus({ error: 'None' })).toBe(FIXED_STATUS.NA);
  });

  it('reads a legacy issue with no fixed field as NOT fixed', () => {
    // Which is what CCW does — the migration gives it `fixed: 'na'`, and a head
    // whose issues are not all fixed is not fixed. Encoded here because it is
    // surprising, and because this file's job is to agree with CCW rather than
    // to be independently reasonable.
    expect(headFixedStatus({ error: 'Other' })).toBe(FIXED_STATUS.NOT_FIXED);
  });

  it('survives an empty head', () => {
    expect(issueTypes({})).toBe('None');
    expect(issueTypes(null)).toBe('None');
    expect(headFixedStatus(undefined)).toBe(FIXED_STATUS.NA);
  });
});
