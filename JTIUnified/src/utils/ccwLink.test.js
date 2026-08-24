// The link back to the weigher app. Wrong and it opens the wrong visit, or the
// app's own list with no explanation.
import { describe, it, expect } from 'vitest';
import { ccwVisitLink } from './ccwLink.js';

describe('linking a record to its visit in CCW Issues', () => {
  it('builds the link CCW understands', () => {
    expect(ccwVisitLink({ visitId: 'visit_1765660014740', customerId: 'c1', line: 'Line 2', head: 13 }))
      .toBe('https://jti-issues.pages.dev/?id=visit_1765660014740&customer=c1&line=Line+2&head=13');
  });

  it('leaves out what it does not know', () => {
    // CCW searches every customer when no id is given; guessing one would send
    // it to the wrong plant.
    expect(ccwVisitLink({ visitId: 'v1' })).toBe('https://jti-issues.pages.dev/?id=v1');
  });

  it('escapes a line name with characters in it', () => {
    expect(ccwVisitLink({ visitId: 'v1', line: 'Line 3 / A&B' }))
      .toContain('line=Line+3+%2F+A%26B');
  });

  it('is null when there is no visit to open', () => {
    expect(ccwVisitLink({ visitId: '' })).toBeNull();
    expect(ccwVisitLink({})).toBeNull();
    expect(ccwVisitLink()).toBeNull();
  });

  it('passes a head named rather than numbered', () => {
    expect(ccwVisitLink({ visitId: 'v1', head: '13' })).toContain('head=13');
    expect(ccwVisitLink({ visitId: 'v1', head: '   ' })).not.toContain('head=');
  });
});
