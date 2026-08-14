// src/utils/timesheetVisibility.js
//
// Whether a timesheet with no day rows still belongs on the calendar.
//
// Two different situations produce a timesheet with no entries, and they want
// opposite treatment:
//
//   - An OLD record saved before day rows existed. It has real content and a
//     save timestamp, and hiding it would make it invisible in the one place
//     people look. It shows, dated by its timestamp.
//
//   - A record whose days were DELETED on purpose. Showing it again — on the
//     date it happened to be saved rather than the date that was removed —
//     reads as the deletion not working, and the obvious response is to delete
//     it again, which is how somebody ends up reaching for the whole record.
//
// Nothing distinguishes them except intent, so the delete records intent and
// this reads it.

/**
 * Should a timesheet with zero entries appear on the calendar?
 *
 * @param {{timestamp?: any, entriesEmptiedAt?: string}} doc - the stored record
 */
export const showsWithoutEntries = (doc = {}) => {
  if (!doc.timestamp) return false;          // nothing to date it by
  if (doc.entriesEmptiedAt) return false;    // emptied deliberately
  return true;
};

export default { showsWithoutEntries };
