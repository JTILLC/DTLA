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

    const matchingHead = matchingLine.heads?.find(h => h.id === headId);
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
