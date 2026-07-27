// src/utils/headHelpers.js - Shared head/issue utility functions

import { FIXED_STATUS, FIXED_STATUS_LABELS, FIXED_STATUS_COLORS, DEFAULT_HEAD } from '../config/constants';

/**
 * Migrate legacy head data to new format with issues array
 * @param {Object} head - Head object to migrate
 * @returns {Object} - Migrated head object
 */
export const migrateHeadData = (head) => {
  // Already migrated if issues array exists
  if (head.issues && Array.isArray(head.issues)) {
    return head;
  }

  const migratedHead = { ...head, issues: [] };

  // Migrate legacy error/fixed fields to issues array
  if (head.error && head.error !== 'None') {
    migratedHead.issues.push({
      type: head.error,
      fixed: head.fixed || 'na',
      notes: head.notes || ''
    });
  }

  return migratedHead;
};

/**
 * Migrate all heads in a line
 * @param {Object} line - Line object with heads array
 * @returns {Object} - Line with migrated heads
 */
export const migrateLineHeads = (line) => ({
  ...line,
  heads: line.heads.map(migrateHeadData)
});

/**
 * Check if a head has any issues
 * @param {Object} head - Head object
 * @returns {boolean}
 */
export const headHasIssues = (head) => {
  const migrated = migrateHeadData(head);
  return migrated.status !== 'active' || migrated.issues.length > 0;
};

/**
 * Check if a head is offline
 * @param {Object} head - Head object
 * @returns {boolean}
 */
export const isHeadOffline = (head) => {
  return head.status === 'offline';
};

/**
 * Get the display label for a fixed status
 * @param {string} status - Fixed status value
 * @returns {string} - Human-readable label
 */
export const getFixedStatusLabel = (status) => {
  return FIXED_STATUS_LABELS[status] || status || 'N/A';
};

/**
 * Get the color for a fixed status
 * @param {string} status - Fixed status value
 * @returns {string} - CSS color value
 */
export const getFixedStatusColor = (status) => {
  return FIXED_STATUS_COLORS[status] || FIXED_STATUS_COLORS[FIXED_STATUS.NA];
};

/**
 * Get issues text for display
 * @param {Object} head - Head object
 * @returns {string} - Comma-separated list of issues
 */
export const getIssuesText = (head) => {
  const migrated = migrateHeadData(head);
  if (migrated.issues.length === 0) return 'None';
  return migrated.issues.map(iss => iss.type).join(', ');
};

/**
 * Get the overall fixed status for a head with multiple issues
 * @param {Object} head - Head object
 * @returns {string} - Overall status (fixed, not_fixed, active_with_issues, na)
 */
export const getHeadFixedStatus = (head) => {
  const migrated = migrateHeadData(head);
  if (migrated.issues.length === 0) return FIXED_STATUS.NA;

  const allFixed = migrated.issues.every(iss => iss.fixed === FIXED_STATUS.FIXED);
  const someActiveWithIssues = migrated.issues.some(iss => iss.fixed === FIXED_STATUS.ACTIVE_WITH_ISSUES);

  if (allFixed) return FIXED_STATUS.FIXED;
  if (someActiveWithIssues) return FIXED_STATUS.ACTIVE_WITH_ISSUES;
  return FIXED_STATUS.NOT_FIXED;
};

/**
 * Get row background color based on head status
 * @param {Object} head - Head object
 * @returns {string} - CSS class or color
 */
export const getHeadRowClass = (head) => {
  const migrated = migrateHeadData(head);

  if (migrated.status === 'active' && migrated.issues.length === 0) {
    return ''; // No special styling for active heads
  }

  const fixedStatus = getHeadFixedStatus(migrated);

  switch (fixedStatus) {
    case FIXED_STATUS.FIXED:
      return 'table-warning'; // Yellow for fixed
    case FIXED_STATUS.ACTIVE_WITH_ISSUES:
      return 'table-info'; // Blue for active with issues
    case FIXED_STATUS.NOT_FIXED:
      return 'table-danger'; // Red for not fixed
    default:
      return migrated.status === 'offline' ? 'table-danger' : '';
  }
};

/**
 * Create a new head with default values
 * @param {number} id - Head ID/number
 * @returns {Object} - New head object
 */
export const createDefaultHead = (id) => ({
  id,
  ...DEFAULT_HEAD
});

/**
 * Create an array of default heads
 * @param {number} count - Number of heads to create
 * @returns {Array} - Array of head objects
 */
export const createDefaultHeads = (count) => {
  return Array.from({ length: count }, (_, i) => createDefaultHead(i + 1));
};

/**
 * Filter heads that are offline or have issues
 * @param {Array} heads - Array of head objects
 * @returns {Array} - Filtered heads
 */
export const filterOfflineHeads = (heads) => {
  return heads.filter(head => headHasIssues(head));
};

/**
 * Filter heads that are active with no issues
 * @param {Array} heads - Array of head objects
 * @returns {Array} - Filtered heads
 */
export const filterActiveHeads = (heads) => {
  return heads.filter(head => !headHasIssues(head));
};

/**
 * Build issue history for a specific head across past visits
 * @param {string} lineTitle - Title of the line the head belongs to
 * @param {number} headId - Head ID/number (1-based)
 * @param {Array} allVisits - Array of all visit objects with lines/heads data
 * @param {string} currentVisitId - ID of the current visit to exclude
 * @returns {Array} - Array of { date, visitName, issues[] } sorted newest first
 */
export const buildHeadIssueHistory = (lineTitle, headId, allVisits, currentVisitId) => {
  if (!allVisits || !lineTitle || !headId) return [];

  const history = [];

  allVisits.forEach(visit => {
    // Skip current visit
    if (visit.id === currentVisitId) return;

    const lines = visit.lines || [];
    const matchingLine = lines.find(l => l.title === lineTitle);
    if (!matchingLine) return;

    // Match by head id; fall back to position (headId is 1-based) so legacy
    // heads saved without an `id` still appear in the history.
    const heads = matchingLine.heads || [];
    const matchingHead = heads.find(h => h.id === headId) || heads[headId - 1];
    if (!matchingHead) return;

    const migrated = migrateHeadData(matchingHead);

    // Only include if head was offline and had issues
    if (migrated.status !== 'offline' && migrated.issues.length === 0) return;

    if (migrated.issues.length > 0 || migrated.status === 'offline') {
      history.push({
        date: visit.date,
        visitName: visit.name || 'Unnamed Visit',
        visitId: visit.id,
        issues: migrated.issues
      });
    }
  });

  // Sort newest first
  history.sort((a, b) => new Date(b.date) - new Date(a.date));

  return history;
};

/**
 * Count heads by status in a line
 * @param {Object} line - Line object with heads array
 * @returns {Object} - Counts { total, active, offline, fixed, notFixed }
 */
export const getHeadCounts = (line) => {
  const heads = line.heads.map(migrateHeadData);
  const total = heads.length;
  const offline = heads.filter(h => headHasIssues(h)).length;
  const active = total - offline;
  const fixed = heads.filter(h => getHeadFixedStatus(h) === FIXED_STATUS.FIXED).length;
  const notFixed = heads.filter(h => getHeadFixedStatus(h) === FIXED_STATUS.NOT_FIXED).length;
  const activeWithIssues = heads.filter(h => getHeadFixedStatus(h) === FIXED_STATUS.ACTIVE_WITH_ISSUES).length;

  return { total, active, offline, fixed, notFixed, activeWithIssues };
};


// Worst-first status for a line, used to colour its dot in the line chip strip.
// Mirrors the head-tile colour logic in Line.jsx: red beats blue beats orange.
export const lineStatusKey = (line) => {
  const heads = line?.heads || [];
  let sawAttn = false;
  let sawFixed = false;

  for (const head of heads) {
    const issues = head.issues || [];
    const offline = head.status === 'offline';
    if (!offline && issues.length === 0) continue;

    const allFixed = issues.length > 0 && issues.every(iss => iss.fixed === 'fixed');
    const someAttn = issues.some(iss => iss.fixed === 'active_with_issues');

    if (offline && !allFixed && !someAttn) return 'offline';
    if (someAttn || (!offline && issues.length > 0)) sawAttn = true;
    else if (allFixed) sawFixed = true;
  }

  if (sawAttn) return 'attn';
  if (sawFixed) return 'fixed';
  return 'ok';
};

// Carry a prior visit's machine setup into a new visit: the lines themselves,
// each line's head COUNT, and the identifying/constant fields (model, job #,
// serial, running, span-cal constants). Everything logged during that visit is
// reset — head status back to Active, no issues, weights zeroed, notes/audit
// cleared — unless `keepIssues` is set, which preserves each head's status,
// issues and notes so an unresolved problem carries forward to the next visit.
export const scaffoldLinesFrom = (src, { keepIssues = false } = {}) =>
  (src?.lines || []).map((line) => ({
    ...line,
    notes: keepIssues ? (line.notes || '') : '',
    audit: {},
    auditNotes: '',
    avgWeight100: '',   // measured this-visit result
    stdDev100: '',      // measured this-visit result
    signerName: '',     // calibration cert is signed per visit
    calDate: '',
    calDueDate: '',
    heads: (line.heads || []).map((head, i) => ({
      id: head.id || i + 1,
      status: keepIssues ? (head.status || 'active') : 'active',
      error: keepIssues ? (head.error || 'None') : 'None',
      fixed: keepIssues ? (head.fixed || 'na') : 'na',
      notes: keepIssues ? (head.notes || '') : '',
      issues: keepIssues ? (head.issues || []) : [],
      photos: keepIssues ? (head.photos || []) : [],
      currentWeight: 0,
      spanWeight: 0,
      weightDifference: 0,
    })),
  }));
