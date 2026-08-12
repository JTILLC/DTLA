// What counts as a gap. The list is only useful if "complete" means complete
// and "missing" is worth acting on — a row that nags about a field somebody
// deliberately left blank teaches people to ignore the whole page.
import { describe, it, expect } from 'vitest';
import { missingFrom } from './CustomerRecordsPanel.jsx';

describe('missingFrom', () => {
  it('reports every empty field', () => {
    expect(missingFrom({})).toEqual(['address', 'contacts', 'invoice email', 'mileage']);
  });

  it('accepts a city alone as an address — plenty of plants are known that way', () => {
    expect(missingFrom({ cityState: 'Yuma, AZ' })).not.toContain('address');
    expect(missingFrom({ address: '11 Leigh Fisher Blvd' })).not.toContain('address');
  });

  it('treats whitespace as empty', () => {
    expect(missingFrom({ address: '   ', cityState: '' })).toContain('address');
  });

  it('treats an empty list as missing, not as done', () => {
    expect(missingFrom({ contacts: [], invoiceEmails: [] }))
      .toEqual(expect.arrayContaining(['contacts', 'invoice email']));
  });

  it('a contact with no phone or email is not a usable contact', () => {
    // The timesheet cannot fill two of its boxes from a name alone, so this
    // page must not call it complete while the timesheet says otherwise.
    expect(missingFrom({
      cityState: 'Yuma, AZ',
      contacts: [{ name: 'Sam' }],
      invoiceEmails: ['billing@example.com'],
      miles: 240,
    })).toEqual(['contact phone/email']);
  });

  it('is satisfied once a contact can actually be reached', () => {
    expect(missingFrom({
      cityState: 'Yuma, AZ',
      contacts: [{ name: 'Sam', phone: '555-0100' }],
      invoiceEmails: ['billing@example.com'],
      miles: 240,
    })).toEqual([]);
  });

  it('one reachable contact among several is enough', () => {
    expect(missingFrom({
      cityState: 'Yuma, AZ',
      contacts: [{ name: 'Sam' }, { name: 'Bea', email: 'bea@x.com' }],
      invoiceEmails: ['b@x.com'],
      miles: 1,
    })).toEqual([]);
  });

  it('counts a mileage of zero as recorded — a plant across the road is not unset', () => {
    expect(missingFrom({ miles: 0 })).not.toContain('mileage');
  });
});
