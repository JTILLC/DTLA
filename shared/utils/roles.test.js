import { describe, it, expect } from 'vitest';
import { isSiteLead, roleLabel, SITE_LEAD_LABEL } from './roles.js';

describe('isSiteLead', () => {
  it('reads the new field', () => {
    expect(isSiteLead({ siteLead: true })).toBe(true);
    expect(isSiteLead({ siteLead: false })).toBe(false);
  });

  it('falls back to the old `admin` flag so nobody loses access in the rename', () => {
    // Existing crew were stored as { admin: true }. Without this they would all
    // silently lose the right to hand out PINs the moment the rename shipped.
    expect(isSiteLead({ admin: true })).toBe(true);
    expect(isSiteLead({ admin: false })).toBe(false);
  });

  it('lets the new field win when both are present', () => {
    // Demoting someone must actually demote them, even while the old field
    // lingers on the record.
    expect(isSiteLead({ siteLead: false, admin: true })).toBe(false);
    expect(isSiteLead({ siteLead: true, admin: false })).toBe(true);
  });

  it('is false for anyone with neither, and for nobody at all', () => {
    expect(isSiteLead({ name: 'x' })).toBe(false);
    expect(isSiteLead(undefined)).toBe(false);
    expect(isSiteLead(null)).toBe(false);
  });
});

describe('labels', () => {
  it('names the plant role without using the word admin', () => {
    expect(SITE_LEAD_LABEL).toBe('Site Lead');
    expect(SITE_LEAD_LABEL.toLowerCase()).not.toContain('admin');
  });

  it('reads back the crew roles', () => {
    expect(roleLabel('tech')).toBe('Maintenance');
    expect(roleLabel('supervisor')).toBe('Supervisor');
    expect(roleLabel('operator')).toBe('Operator');
  });
});
