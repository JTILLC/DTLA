import { describe, it, expect } from 'vitest';
import {
  mayEditLine, personLines, isRestricted, resolvePerson, refusalMessage, overrideStamp,
} from './lineAccess.js';

const op = (lines) => ({ id: 'p1', name: 'J. Rodriguez', roles: ['operator'], lines });
const sup = { id: 'p2', name: 'M. Ellis', roles: ['supervisor'], lines: ['JLA'] };

describe('who may file against a line', () => {
  it('allows the lines a person is assigned to', () => {
    expect(mayEditLine(op(['JLA', 'Roberts 1']), 'JLA')).toBe(true);
    expect(mayEditLine(op(['JLA', 'Roberts 1']), 'Roberts 1')).toBe(true);
  });

  it('refuses a line they are not assigned to', () => {
    expect(mayEditLine(op(['JLA']), 'SN2')).toBe(false);
  });

  it('treats an empty assignment as every line, never as none', () => {
    // The difference decides whether a plant that never opened this screen can
    // still log anything at all.
    expect(mayEditLine(op([]), 'SN2')).toBe(true);
    expect(mayEditLine({ id: 'p', name: 'x', roles: ['operator'] }, 'SN2')).toBe(true);
    expect(isRestricted(op([]))).toBe(false);
    expect(isRestricted(op(['JLA']))).toBe(true);
  });

  it('lets a supervisor file against anything, whatever their own list says', () => {
    expect(mayEditLine(sup, 'SN2')).toBe(true);
  });

  it('does not block a plant that has not identified anybody', () => {
    expect(mayEditLine(null, 'SN2')).toBe(true);
    expect(mayEditLine(undefined, 'SN2')).toBe(true);
  });

  it('does not guard machine-level entries, which have no line to be wrong about', () => {
    expect(mayEditLine(op(['JLA']), '')).toBe(true);
    expect(mayEditLine(op(['JLA']), null)).toBe(true);
  });

  it('ignores blank entries in an assignment list', () => {
    expect(personLines({ lines: ['JLA', '', null, 'SN2'] })).toEqual(['JLA', 'SN2']);
  });
});

describe('resolvePerson', () => {
  const people = [op(['JLA']), sup];

  it('joins the remembered actor to their crew record', () => {
    // useVerifiedPerson only remembers { id, name } — roles and line
    // assignments live on the crew record and must be looked up.
    expect(resolvePerson(people, { id: 'p2', name: 'M. Ellis' })).toBe(sup);
  });

  it('returns nothing for an actor who has left the roster', () => {
    expect(resolvePerson(people, { id: 'gone', name: 'Old Hand' })).toBeNull();
    expect(resolvePerson(people, null)).toBeNull();
    expect(resolvePerson(undefined, { id: 'p1' })).toBeNull();
  });
});

describe('what the operator is told', () => {
  it('names the line and what they are assigned to', () => {
    const msg = refusalMessage(op(['JLA', 'Roberts 1']), 'SN2');
    expect(msg).toContain('J. Rodriguez');
    expect(msg).toContain('SN2');
    expect(msg).toContain('JLA, Roberts 1');
  });
});

describe('overrideStamp', () => {
  it('records who authorised it and for which line', () => {
    const stamp = overrideStamp(sup, 'SN2');
    expect(stamp).toMatchObject({
      authorisedBy: 'M. Ellis', authorisedById: 'p2', authorisedForLine: 'SN2',
    });
    expect(Date.parse(stamp.authorisedAt)).not.toBeNaN();
  });

  it('stamps nothing when no override happened', () => {
    // An ordinary entry must not carry empty authorisation fields, or every
    // entry starts looking like it needed permission.
    expect(overrideStamp(null, 'SN2')).toEqual({});
  });
});
