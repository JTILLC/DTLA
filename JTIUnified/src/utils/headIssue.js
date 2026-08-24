// src/utils/headIssue.js
//
// What a weigh head's issue actually is, read the way CCW Issues reads it.
//
// CCW moved a head from one error to a list of them years ago: a head now
// carries `issues: [{ type, fixed, notes }]`, and the old top-level `error` and
// `fixed` are legacy fields left where they were for records written before the
// change. This app never got the memo and was still reading the legacy pair, so
// a head with a real, fixed "Other" issue was reported here as "Error: None —
// Not Fixed" while CCW showed the truth one click away.
//
// SOURCE OF TRUTH: `shared/utils/headHelpers.js` (`getIssuesText`,
// `getHeadFixedStatus`). It cannot be imported here — it reaches for
// `@app/config/constants`, an alias only the two CCW apps define — so the rule
// is mirrored, deliberately and in one place. If the rule changes there, it has
// to change here; the tests below encode it so the copy is at least visible.

export const FIXED_STATUS = {
  NA: 'na',
  FIXED: 'fixed',
  NOT_FIXED: 'not_fixed',
  ACTIVE_WITH_ISSUES: 'active_with_issues',
};

export const FIXED_LABEL = {
  [FIXED_STATUS.NA]: 'No issue recorded',
  [FIXED_STATUS.FIXED]: 'Fixed',
  [FIXED_STATUS.NOT_FIXED]: 'Not fixed',
  [FIXED_STATUS.ACTIVE_WITH_ISSUES]: 'Running with issues',
};

/** The head with its legacy single error folded into the issues list. */
export const migratedIssues = (head) => {
  if (Array.isArray(head?.issues)) return head.issues;
  // Pre-migration record: one error on the head itself. 'None' is how the old
  // form said "nothing", not an issue called None.
  if (head?.error && head.error !== 'None') {
    return [{ type: head.error, fixed: head.fixed || FIXED_STATUS.NA, notes: head.notes || '' }];
  }
  return [];
};

/** Every issue type on this head, as one readable string. */
export const issueTypes = (head) => {
  const issues = migratedIssues(head);
  if (!issues.length) return 'None';
  return issues.map((i) => i?.type).filter(Boolean).join(', ') || 'None';
};

/** One status for a head that may carry several issues. */
export const headFixedStatus = (head) => {
  const issues = migratedIssues(head);
  if (!issues.length) return FIXED_STATUS.NA;
  if (issues.every((i) => i?.fixed === FIXED_STATUS.FIXED)) return FIXED_STATUS.FIXED;
  if (issues.some((i) => i?.fixed === FIXED_STATUS.ACTIVE_WITH_ISSUES)) return FIXED_STATUS.ACTIVE_WITH_ISSUES;
  return FIXED_STATUS.NOT_FIXED;
};

export default { migratedIssues, issueTypes, headFixedStatus, FIXED_STATUS, FIXED_LABEL };
