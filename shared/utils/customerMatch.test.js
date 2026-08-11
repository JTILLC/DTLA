// Joining a customer name to a customer record. A wrong join shows one plant's
// address and invoice addresses under another plant's name, so the tests that
// matter most are the ones proving it refuses rather than guesses.
import { describe, it, expect } from 'vitest';
import {
  normalizeCustomerName, matchCustomer, isSameCustomer, namesFor,
  consolidateCustomers, looksLikeADifferentSite, sameCustomerName,
} from './customerMatch.js';

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

// Consolidation. The rule is "same name merges, a different city does not",
// and the second half is the one that costs money if it goes wrong: two plants
// under one entry means one plant's invoices and history shown for the other.
describe('consolidateCustomers', () => {
  const e = (name, ...sources) => ({ name, sources });

  it('merges spellings of one name into a single entry', () => {
    // "Flagstone" merges because somebody LINKED it — it is on the record's
    // alias list. Spelling variants ("flagstone_foods") merge on their own.
    const out = consolidateCustomers(
      [e('Flagstone', 'Jobs'), e('Flagstone Foods', 'Jobs', 'Timesheets'), e('flagstone_foods', 'Downtime')],
      [rec('Flagstone Foods', { profile: { aliases: ['Flagstone'] } })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Flagstone Foods');
    expect(out[0].variants).toEqual(['Flagstone', 'Flagstone Foods', 'flagstone_foods']);
    expect(out[0].sources).toEqual(['Jobs', 'Timesheets', 'Downtime']);
  });

  it('does NOT merge a shorter name until somebody links it', () => {
    // This is the guarantee that keeps "Ajinomoto" out of "Ajinomoto Portland".
    // Merging on a shared prefix would be a guess, and the guess is wrong
    // exactly when two plants share a company name.
    const out = consolidateCustomers(
      [e('Flagstone', 'Jobs'), e('Flagstone Foods', 'Jobs')],
      [rec('Flagstone Foods')],
    );
    expect(out.map((g) => g.name)).toEqual(['Flagstone', 'Flagstone Foods']);
  });

  it('KEEPS SITES APART — a city on the end is part of the name', () => {
    const out = consolidateCustomers(
      [e('Ajinomoto'), e('Ajinomoto Oakland'), e('Ajinomoto Portland')],
      [rec('Ajinomoto Portland')],
    );
    expect(out.map((g) => g.name)).toEqual(['Ajinomoto', 'Ajinomoto Oakland', 'Ajinomoto Portland']);
  });

  it('keeps Shearers Brewster separate from Shearers', () => {
    const out = consolidateCustomers(
      [e("Shearer's"), e('Shearers'), e('Shearers Brewster')],
      [rec('Shearers')],
    );
    expect(out).toHaveLength(2);
    expect(out.find((g) => g.name === 'Shearers').variants).toEqual(["Shearer's", 'Shearers']);
    expect(out.find((g) => g.name === 'Shearers Brewster')).toBeTruthy();
  });

  it('merges a renamed plant with its current record', () => {
    const out = consolidateCustomers([e('B&G Foods'), e('Seneca Foods')], [rec('Seneca Foods')]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Seneca Foods');
  });

  it('merges spellings even with no record to anchor them', () => {
    const out = consolidateCustomers([e('Tru Infusion'), e('TRU INFUSION, LLC')], []);
    expect(out).toHaveLength(1);
    // The fuller spelling wins over a database-looking key.
    expect(out[0].name).toBe('TRU INFUSION, LLC');
  });

  it('survives nothing', () => {
    expect(consolidateCustomers([], [])).toEqual([]);
    expect(consolidateCustomers()).toEqual([]);
    expect(consolidateCustomers([e('')], [])).toEqual([]);
  });
});

describe('looksLikeADifferentSite', () => {
  it('flags a name that is another plus a location', () => {
    expect(looksLikeADifferentSite('Ajinomoto', 'Ajinomoto Portland')).toBe(true);
    expect(looksLikeADifferentSite('Shearers Brewster', 'Shearers')).toBe(true);
  });

  it('does not flag an ordinary longer company name', () => {
    // "Flagstone" / "Flagstone Foods" IS one plant — this must stay a question,
    // not a block, or the link somebody actually wants gets refused.
    expect(looksLikeADifferentSite('Flagstone', 'Flagstone Foods')).toBe(true);
  });

  it('does not flag unrelated names or equal-length ones', () => {
    expect(looksLikeADifferentSite('Oasis Date', 'Seneca Foods')).toBe(false);
    expect(looksLikeADifferentSite('Shearers', 'Shearers')).toBe(false);
    expect(looksLikeADifferentSite('', 'Shearers')).toBe(false);
  });
});

// The three ways one name reaches this app looking like two, and the one way
// two plants look like one.
describe('sameCustomerName', () => {
  it('merges a lost space', () => {
    expect(sameCustomerName('Food Pharma', 'FoodPharma')).toBe(true);
  });

  it('merges a truncated tail', () => {
    expect(sameCustomerName('National Froz', 'National Frozen')).toBe(true);
    expect(sameCustomerName('Trident Sea', 'Trident Seafoods')).toBe(true);
    expect(sameCustomerName('Safeway Ice', 'Safeway Ice')).toBe(true);
  });

  it('merges a plural', () => {
    expect(sameCustomerName('Oasis Date', 'Oasis Dates')).toBe(true);
    expect(sameCustomerName('Trident Seafood', 'Trident Seafoods')).toBe(true);
  });

  it('REFUSES a name with a word missing — that word is where the city is', () => {
    expect(sameCustomerName('Ajinomoto', 'Ajinomoto Portland')).toBe(false);
    expect(sameCustomerName('Trident', 'Trident Seafoods')).toBe(false);
    expect(sameCustomerName('Safeway Ice', 'Safeway Ice Cream')).toBe(false);
    expect(sameCustomerName('Shearers', 'Shearers Brewster')).toBe(false);
  });

  it('refuses two different sites of one company', () => {
    expect(sameCustomerName('Ajinomoto Oakland', 'Ajinomoto Portland')).toBe(false);
  });

  it('will not let a stub swallow a name', () => {
    expect(sameCustomerName('Trident Se', 'Trident Seafoods')).toBe(false);
    expect(sameCustomerName('', 'Trident')).toBe(false);
  });
});

describe('consolidateCustomers — spelling variants', () => {
  const e = (name) => ({ name, sources: [] });

  it('folds truncations and plurals together without a record', () => {
    const out = consolidateCustomers(
      [e('Trident Sea'), e('Trident Seafood'), e('Trident Seafoods')], []);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Trident Seafoods');
  });

  it('still keeps the two Ajinomoto plants and the bare name apart', () => {
    const out = consolidateCustomers(
      [e('Ajinomoto'), e('Ajinomoto Oakland'), e('Ajinomoto Portland')], []);
    expect(out.map((g) => g.name)).toEqual(['Ajinomoto', 'Ajinomoto Oakland', 'Ajinomoto Portland']);
  });
});
