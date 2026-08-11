// Turning a customer record into timesheet fields. Wrong here means a
// technician's sheet is quietly pre-filled with the wrong plant's address or
// mileage and signed without a second look, so the edge cases matter.
import { describe, it, expect } from 'vitest';
import { customerDefaults, splitCityState, primaryContact, missingDefaults } from './customerDefaults.js';

const rec = (profile = {}, name = 'Flagstone Foods') => ({ id: 'x', name, profile });

describe('splitCityState', () => {
  it('splits the ordinary case', () => {
    expect(splitCityState('Yuma, AZ')).toEqual({ city: 'Yuma', state: 'AZ' });
  });

  it('splits on the LAST comma, so a two-word city survives', () => {
    // Splitting on the first comma would give city "Kansas", state "City, MO".
    expect(splitCityState('Kansas City, MO')).toEqual({ city: 'Kansas City', state: 'MO' });
  });

  it('uppercases the state and trims the spacing people actually type', () => {
    expect(splitCityState('  el paso ,  tx ')).toEqual({ city: 'el paso', state: 'TX' });
  });

  it('copes with only one of the two', () => {
    expect(splitCityState('Yuma')).toEqual({ city: 'Yuma', state: '' });
    expect(splitCityState('AZ')).toEqual({ city: '', state: 'AZ' });
  });

  it('gives empty strings, never undefined, for nothing', () => {
    expect(splitCityState('')).toEqual({ city: '', state: '' });
    expect(splitCityState(null)).toEqual({ city: '', state: '' });
  });
});

describe('primaryContact', () => {
  it('prefers one marked primary over the first', () => {
    const c = primaryContact([{ name: 'Al' }, { name: 'Bea', primary: true }]);
    expect(c.name).toBe('Bea');
  });

  it('otherwise takes the first with anything on it', () => {
    expect(primaryContact([{ name: 'Al' }, { name: 'Bea' }]).name).toBe('Al');
  });

  it('skips blank rows left behind by a half-finished edit', () => {
    expect(primaryContact([{ name: '', phone: '', email: '' }, { name: 'Bea' }]).name).toBe('Bea');
  });

  it('is null when there is nobody', () => {
    expect(primaryContact([])).toBeNull();
    expect(primaryContact()).toBeNull();
  });
});

describe('customerDefaults', () => {
  it('produces exactly the fields a timesheet asks for', () => {
    const d = customerDefaults(rec({
      address: '11 Leigh Fisher Blvd',
      cityState: 'El Paso, TX',
      contacts: [{ name: 'Sam Reed', role: 'Maintenance', phone: '555-0100', email: 'sam@fs.com' }],
      miles: 240,
    }));
    expect(d).toEqual({
      company: 'Flagstone Foods',
      contact: 'Sam Reed',
      phone: '555-0100',
      email: 'sam@fs.com',
      address: '11 Leigh Fisher Blvd',
      city: 'El Paso',
      state: 'TX',
      miles: '240',
      purpose: '',
    });
  });

  it('keeps a mileage of zero — a plant across the road is not "unset"', () => {
    expect(customerDefaults(rec({ miles: 0 })).miles).toBe('0');
  });

  it('never defaults the purpose — it changes every visit', () => {
    expect(customerDefaults(rec({ purpose: 'Annual PM' })).purpose).toBe('');
  });

  it('returns empty strings rather than undefined for an empty record', () => {
    const d = customerDefaults(rec({}));
    Object.values(d).forEach((v) => expect(typeof v).toBe('string'));
    expect(d.company).toBe('Flagstone Foods');
  });

  it('survives no record at all', () => {
    const d = customerDefaults(null);
    expect(d.company).toBe('');
    expect(d.miles).toBe('');
  });
});

describe('missingDefaults', () => {
  it('names what still has to be typed by hand', () => {
    expect(missingDefaults(rec({}))).toEqual(['address', 'contact', 'phone or email', 'mileage']);
  });

  it('a city alone counts as an address', () => {
    expect(missingDefaults(rec({ cityState: 'Yuma, AZ' }))).not.toContain('address');
  });

  it('is empty when the record can fill the sheet', () => {
    expect(missingDefaults(rec({
      address: '1 Road', cityState: 'Yuma, AZ',
      contacts: [{ name: 'Sam', phone: '555' }], miles: 12,
    }))).toEqual([]);
  });
});
