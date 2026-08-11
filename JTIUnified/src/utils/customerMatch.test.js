// Joining a customer name to a customer record. A wrong join shows one plant's
// address and invoice addresses under another plant's name, so the tests that
// matter most are the ones proving it refuses rather than guesses.
import { describe, it, expect } from 'vitest';
import { normalizeCustomerName, matchCustomer, isSameCustomer, namesFor } from './customerMatch.js';

const rec = (name, over = {}) => ({ id: name.toLowerCase().replace(/\W/g, ''), name, ...over });

describe('normalizeCustomerName', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalizeCustomerName('B & G Foods, Inc.')).toBe(normalizeCustomerName('b&g foods'));
    // A possessive stays attached to its word rather than splitting it.
    expect(normalizeCustomerName("Shearer's Foods")).toBe('shearers foods');
  });

  it('drops legal suffixes but keeps the words that identify a company', () => {
    expect(normalizeCustomerName('Seneca Foods LLC')).toBe('seneca foods');
    // "Foods" is what separates Seneca Foods from Seneca — it must survive.
    expect(normalizeCustomerName('Seneca Foods')).not.toBe(normalizeCustomerName('Seneca'));
  });

  it('survives nothing', () => {
    expect(normalizeCustomerName('')).toBe('');
    expect(normalizeCustomerName(null)).toBe('');
  });
});

describe('matchCustomer', () => {
  const records = [rec('Oasis Date'), rec('Seneca Foods'), rec('Shearer\'s Foods'), rec('Seneca')];

  it('matches the same name written differently', () => {
    expect(matchCustomer('oasis date', records).name).toBe('Oasis Date');
    expect(matchCustomer("Shearers Foods, Inc.", records).name).toBe("Shearer's Foods");
  });

  it('follows a rename in both directions', () => {
    // The plant is filed under its current name; the old name still finds it.
    expect(matchCustomer('DatePac', records).name).toBe('Oasis Date');
    expect(matchCustomer('B&G Foods', records).name).toBe('Seneca Foods');
  });

  it('finds a record still filed under the FORMER name when searching the new one', () => {
    const old = [rec('DatePac')];
    expect(matchCustomer('Oasis Date', old).name).toBe('DatePac');
  });

  it('uses an alias recorded on the customer', () => {
    const withAlias = [rec('Oasis Date', { profile: { aliases: ['Date Pac Arizona'] } })];
    expect(matchCustomer('Date Pac Arizona', withAlias).name).toBe('Oasis Date');
  });

  it('NEVER matches on a substring — this is the join that has gone wrong', () => {
    // "Seneca" must not pick up "Seneca Foods", nor the reverse.
    expect(matchCustomer('Seneca', records).name).toBe('Seneca');
    expect(matchCustomer('Seneca Foods', records).name).toBe('Seneca Foods');
    // A name nobody has a record for is unmatched, not force-fitted.
    expect(matchCustomer('Seneca Foods Yakima', records)).toBeNull();
  });

  it('returns null rather than guessing', () => {
    expect(matchCustomer('Some Plant We Have Never Billed', records)).toBeNull();
    expect(matchCustomer('', records)).toBeNull();
    expect(matchCustomer('Oasis Date', [])).toBeNull();
  });
});

describe('isSameCustomer', () => {
  it('knows a rename is the same plant', () => {
    expect(isSameCustomer('DatePac', 'Oasis Date')).toBe(true);
    expect(isSameCustomer('Oasis Date', 'DatePac')).toBe(true);
    expect(isSameCustomer('B & G Foods Inc', 'Seneca Foods')).toBe(true);
  });

  it('does not confuse two different plants', () => {
    expect(isSameCustomer('Seneca', 'Seneca Foods')).toBe(false);
    expect(isSameCustomer('Oasis Date', 'Seneca Foods')).toBe(false);
    expect(isSameCustomer('', 'Oasis Date')).toBe(false);
  });
});

describe('namesFor', () => {
  it('includes the record name and its aliases', () => {
    expect(namesFor({ name: 'Oasis Date', profile: { aliases: ['DatePac'] } }))
      .toEqual(['oasis date', 'datepac']);
  });

  it('copes with a record that has no profile', () => {
    expect(namesFor({ name: 'Oasis Date' })).toEqual(['oasis date']);
    expect(namesFor({})).toEqual([]);
  });
});
