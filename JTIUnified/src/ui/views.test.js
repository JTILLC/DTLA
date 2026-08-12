// URL ↔ view. The pair has to round-trip: if parsing and building disagree,
// the address bar and the screen drift apart and the back button starts lying.
import { describe, it, expect } from 'vitest';
import { parsePath, toPath, toSlug, customerFromSlug, VIEWS, HOME, CUSTOMER } from './views.js';

describe('parsePath', () => {
  it('reads the dashboard', () => {
    expect(parsePath('/')).toEqual({ view: HOME });
    expect(parsePath('')).toEqual({ view: HOME });
  });

  it('reads each view', () => {
    Object.values(VIEWS).forEach((v) => {
      expect(parsePath(`/${v}`).view).toBe(v);
    });
  });

  it('reads a customer', () => {
    expect(parsePath('/customer/flagstone-foods')).toEqual({ view: CUSTOMER, customerSlug: 'flagstone-foods' });
  });

  it('reads a packet with and without its service report', () => {
    expect(parsePath('/packet/2026028')).toEqual({ view: VIEWS.packet, sr: '2026028' });
    expect(parsePath('/packet')).toEqual({ view: VIEWS.packet, sr: '' });
  });

  it('sends anything unrecognised to the dashboard rather than a dead end', () => {
    // A stale bookmark should land somewhere useful.
    expect(parsePath('/nonsense').view).toBe(HOME);
    expect(parsePath('/customer').view).toBe(HOME);   // no name given
    expect(parsePath(null).view).toBe(HOME);
  });
});

describe('toPath', () => {
  it('is the inverse of parsePath', () => {
    ['/', '/calendar', '/map', '/troubleshoot', '/reports', '/records', '/packet',
     '/packet/2026028', '/customer/flagstone-foods'].forEach((p) => {
      expect(toPath(parsePath(p))).toBe(p);
    });
  });

  it('falls back to the dashboard for anything it cannot express', () => {
    expect(toPath({})).toBe('/');
    expect(toPath({ view: 'invented' })).toBe('/');
    expect(toPath({ view: CUSTOMER })).toBe('/');   // customer with no name
  });
});

describe('toSlug', () => {
  it('survives punctuation that would otherwise break a URL', () => {
    expect(toSlug("Reser's Fine Foods")).toBe('resers-fine-foods');
    expect(toSlug('B&G Foods, Inc.')).toBe('b-and-g-foods-inc');
    expect(toSlug('  Trident   Seafood ')).toBe('trident-seafood');
  });

  it('keeps two different plants different', () => {
    expect(toSlug('Ajinomoto Oakland')).not.toBe(toSlug('Ajinomoto Portland'));
    expect(toSlug('Shearers')).not.toBe(toSlug('Shearers Brewster'));
  });

  it('copes with nothing', () => {
    expect(toSlug('')).toBe('');
    expect(toSlug(null)).toBe('');
  });
});

describe('customerFromSlug', () => {
  const customers = [{ name: "Reser's Fine Foods" }, { name: 'Ajinomoto Portland' }, { name: 'Ajinomoto' }];

  it('finds a customer whose name a URL would have mangled', () => {
    expect(customerFromSlug('resers-fine-foods', customers).name).toBe("Reser's Fine Foods");
  });

  it('does not confuse a plant with the site-specific one', () => {
    expect(customerFromSlug('ajinomoto', customers).name).toBe('Ajinomoto');
    expect(customerFromSlug('ajinomoto-portland', customers).name).toBe('Ajinomoto Portland');
  });

  it('returns null for a customer that no longer exists', () => {
    expect(customerFromSlug('gone-away', customers)).toBeNull();
    expect(customerFromSlug('', customers)).toBeNull();
  });

  it('accepts plain strings as well as objects', () => {
    expect(customerFromSlug('utz', ['Utz', 'Simplot'])).toBe('Utz');
  });
});
