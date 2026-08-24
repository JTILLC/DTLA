import { describe, it, expect } from 'vitest';
import { isSuperAdminEmail, superPersonFor, SUPER_ADMIN_EMAILS } from './superUser.js';
import { tierOf, TIER } from './screenAccess.js';
import { mayEditLine, resolvePerson } from './lineAccess.js';

describe('who counts as a JTI super admin', () => {
  it('recognises the account on the list, however it is typed', () => {
    expect(isSuperAdminEmail('josh@jtiaz.com')).toBe(true);
    expect(isSuperAdminEmail('  JOSH@JTIAZ.COM  ')).toBe(true);
  });

  it('recognises nobody else', () => {
    expect(isSuperAdminEmail('someone@jtiaz.com')).toBe(false);
    expect(isSuperAdminEmail('josh@example.com')).toBe(false);
    // A plant login must never pick up the bypass by accident.
    expect(isSuperAdminEmail('')).toBe(false);
    expect(isSuperAdminEmail(null)).toBe(false);
    expect(isSuperAdminEmail(undefined)).toBe(false);
  });

  it('keeps the list short enough to read', () => {
    expect(SUPER_ADMIN_EMAILS).toEqual(['josh@jtiaz.com']);
  });
});

describe('the identity a super admin acts under', () => {
  const user = { uid: 'u1', email: 'josh@jtiaz.com', displayName: 'Josh' };

  it('is nobody for an account that is not one', () => {
    expect(superPersonFor({ uid: 'u2', email: 'plant@example.com' })).toBeNull();
    expect(superPersonFor(null)).toBeNull();
  });

  it('is named, so an entry says who made it', () => {
    expect(superPersonFor(user).name).toBe('Josh');
    // No display name set: the email is still a name somebody can act on.
    expect(superPersonFor({ uid: 'u1', email: 'josh@jtiaz.com' }).name).toBe('josh@jtiaz.com');
  });

  it('cannot collide with a crew member', () => {
    const me = superPersonFor(user);
    const crew = [{ id: 'p1', name: 'Dana' }, { id: 'p2', name: 'Luis' }];
    expect(crew.some((p) => p.id === me.id)).toBe(false);
    // Not on the roster means unrestricted, not locked out.
    expect(resolvePerson(crew, me)).toBeNull();
    expect(mayEditLine(resolvePerson(crew, me), 'Line 3')).toBe(true);
  });

  it('outranks every plant role, so no screen asks for a PIN', () => {
    expect(tierOf(superPersonFor(user))).toBe(TIER.siteLead);
  });

  it('is marked, so the badge does not offer to sign it off', () => {
    expect(superPersonFor(user).isSuper).toBe(true);
  });
});
