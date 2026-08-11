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

  it('is satisfied by one contact, one invoice email and a mileage', () => {
    expect(missingFrom({
      cityState: 'Yuma, AZ',
      contacts: [{ name: 'Sam' }],
      invoiceEmails: ['billing@example.com'],
      miles: 240,
    })).toEqual([]);
  });

  it('counts a mileage of zero as recorded — a plant across the road is not unset', () => {
    expect(missingFrom({ miles: 0 })).not.toContain('mileage');
  });
});
