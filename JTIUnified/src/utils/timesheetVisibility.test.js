// An emptied timesheet must stay emptied.
//
// The delete used to remove the whole document, which at least made the day go
// away. Keeping the document is the fix, but the calendar dates an entry-less
// timesheet by its save timestamp — so without this guard the deleted day would
// reappear immediately, on a different date, looking like the delete failed.
import { describe, it, expect } from 'vitest';
import { showsWithoutEntries } from './timesheetVisibility.js';

describe('showsWithoutEntries', () => {
  it('shows an old record that predates day rows', () => {
    // The reason the fallback exists: real content, no entries array, and
    // hiding it would make it unreachable from the calendar.
    expect(showsWithoutEntries({ timestamp: '2025-03-04T18:00:00Z' })).toBe(true);
  });

  it('does NOT show one whose days were deleted on purpose', () => {
    expect(showsWithoutEntries({
      timestamp: '2025-03-04T18:00:00Z',
      entriesEmptiedAt: '2026-08-14T17:20:00Z',
    })).toBe(false);
  });

  it('shows nothing it cannot date', () => {
    expect(showsWithoutEntries({})).toBe(false);
    expect(showsWithoutEntries()).toBe(false);
  });

  it('treats any recorded emptying as intent, whatever the value looks like', () => {
    // Written as an ISO string today; a Firestore timestamp object later would
    // still mean "somebody emptied this" and must not fall through to showing.
    [{ seconds: 1 }, '2026-08-14', new Date(0).toISOString()].forEach((mark) => {
      expect(showsWithoutEntries({ timestamp: 'x', entriesEmptiedAt: mark })).toBe(false);
    });
  });
});
