// Who gets into which screen. The failure that matters is not "an operator saw
// the PM log" — it is a plant locked out of its own maintenance record because
// the gate had nobody who could open it.
import { describe, it, expect } from 'vitest';
import {
  TIER, tierOf, tierForScreen, canOpen, screenGate, someoneCanAuthorise,
} from './screenAccess.js';

const op = { id: 'a', name: 'Op', roles: ['operator'] };
const tech = { id: 'b', name: 'Tech', roles: ['tech'] };
const sup = { id: 'c', name: 'Sup', roles: ['supervisor'] };
const lead = { id: 'd', name: 'Lead', roles: ['operator'], siteLead: true };
const roster = [op, tech, sup, lead];

describe('tierOf', () => {
  it('ranks the roles', () => {
    expect(tierOf(op)).toBe(TIER.operator);
    expect(tierOf(tech)).toBe(TIER.tech);
    expect(tierOf(sup)).toBe(TIER.supervisor);
    expect(tierOf(lead)).toBe(TIER.siteLead);
  });

  it('takes the highest role a person holds', () => {
    expect(tierOf({ roles: ['operator', 'tech'] })).toBe(TIER.tech);
    expect(tierOf({ roles: ['operator', 'supervisor'] })).toBe(TIER.supervisor);
  });

  it('still reads the pre-rename siteLead flag', () => {
    // Stored as `admin` before the rename; existing crew must keep their reach.
    expect(tierOf({ roles: [], admin: true })).toBe(TIER.siteLead);
  });

  it('treats somebody on the roster with no role as an operator, not a stranger', () => {
    expect(tierOf({ id: 'x', name: 'New', roles: [] })).toBe(TIER.operator);
  });

  it('is nobody when there is nobody', () => {
    expect(tierOf(null)).toBe(-1);
    expect(tierOf(undefined)).toBe(-1);
  });
});

describe('what each tier reaches', () => {
  it('gives an operator the shift screens and nothing above', () => {
    ['overview', 'current', 'prestart', 'span'].forEach((s) => {
      expect(canOpen(s, op)).toBe(true);
    });
    ['boards', 'pm', 'activity', 'history', 'crew', 'logins', 'layout']
      .forEach((s) => expect(canOpen(s, op)).toBe(false));
  });

  it('gives maintenance everything except logins and factory layout', () => {
    ['overview', 'current', 'prestart', 'span', 'boards', 'pm', 'activity', 'history', 'crew']
      .forEach((s) => expect(canOpen(s, tech)).toBe(true));
    expect(canOpen('layout', tech)).toBe(false);
    expect(canOpen('logins', tech)).toBe(false);
  });

  it('gives a supervisor the same reach as maintenance', () => {
    expect(canOpen('boards', sup)).toBe(true);
    expect(canOpen('layout', sup)).toBe(false);
  });

  it('gives the site lead everything', () => {
    Object.keys({ overview: 1, current: 1, prestart: 1, span: 1, boards: 1, pm: 1, activity: 1, history: 1, crew: 1, logins: 1, layout: 1 })
      .forEach((s) => expect(canOpen(s, lead)).toBe(true));
  });

  it('leaves an unknown screen open — a new tab is not a lock', () => {
    expect(tierForScreen('somethingNew')).toBe(TIER.operator);
    expect(canOpen('somethingNew', op)).toBe(true);
  });
});

describe('screenGate', () => {
  const withPins = () => true;

  it('lets the shift screens through without a prompt, even with nobody signed in', () => {
    expect(screenGate('overview', null, roster, withPins).action).toBe('allow');
    expect(screenGate('span', null, roster, withPins).action).toBe('allow');
  });

  it('asks when an operator reaches for a maintenance screen', () => {
    const g = screenGate('boards', op, roster, withPins);
    expect(g.action).toBe('ask');
    expect(g.label).toBe('Maintenance');
  });

  it('asks for a Site Lead by name on the lead-only screens', () => {
    expect(screenGate('layout', tech, roster, withPins).label).toBe('Site Lead');
    expect(screenGate('logins', tech, roster, withPins).label).toBe('Site Lead');
  });

  it('does not ask someone who is already high enough', () => {
    expect(screenGate('boards', tech, roster, withPins).action).toBe('allow');
    expect(screenGate('layout', lead, roster, withPins).action).toBe('allow');
  });

  it('asks when nobody is signed in and someone could authorise', () => {
    expect(screenGate('pm', null, roster, withPins).action).toBe('ask');
  });

  // The one that keeps a plant working.
  it('opens up when the plant has set no PINs at all', () => {
    expect(screenGate('pm', null, roster, () => false).action).toBe('open');
    expect(screenGate('layout', op, roster, () => false).action).toBe('open');
  });

  it('opens up when nobody on the roster holds the tier it needs', () => {
    // An all-operator crew must still reach their own maintenance record.
    expect(screenGate('pm', op, [op], withPins).action).toBe('open');
    // And a plant with no site lead is not locked out of its own layout.
    expect(screenGate('layout', tech, [op, tech], withPins).action).toBe('open');
  });

  it('opens up when there is no roster yet', () => {
    expect(screenGate('crew', null, [], withPins).action).toBe('open');
  });

  it('counts only people who could actually prove it', () => {
    const hasPin = (p) => p.id !== 'd';     // the lead has no PIN set
    expect(someoneCanAuthorise(roster, TIER.siteLead, hasPin)).toBe(false);
    expect(screenGate('layout', op, roster, hasPin).action).toBe('open');
  });
});
