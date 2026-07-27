// Migrate legacy single-error head format to multi-issue format
const migrateHeadData = (head) => {
  if (head.issues && Array.isArray(head.issues)) return head;
  const migratedHead = { ...head, issues: [] };
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

  history.sort((a, b) => new Date(b.date) - new Date(a.date));

  return history;
};
