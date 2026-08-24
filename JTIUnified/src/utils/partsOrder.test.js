// Reading a parts order out of whichever app exported it. The files being
// uploaded are years of real exports, so the shapes here are copied from them
// rather than invented.
import { describe, it, expect } from 'vitest';
import { readOrderExport, isDiagramExport, orderMatches, matchingLines, byNewest } from './partsOrder.js';

// The customer viewer's shape — every real file in the iCloud folders.
const CUSTOMER_EXPORT = {
  customer: 'Multiple Customers (6)',
  exportDate: '2026-04-16T22:56:32.587Z',
  orderCount: 2,
  totalQuantity: 30,
  orderItems: [
    {
      orderKey: 'default-wdu-flagstone-32',
      partName: 'HANGER:SPRING:', pmst: '3', qty: '4',
      partCode: '000-052-3359-08', partNumber: '32', orderQty: 20,
      diagramId: 'default-wdu-flagstone',
      diagramName: 'Drive Weigh Unit (4D-33519)', diagramNumber: '4D-33519',
    },
    {
      orderKey: 'default-wdu-flagstone-33',
      qty: '2', partCode: '000-060-5047-17', partName: 'SPRING:COIL:COMPRESSIVE',
      partNumber: '33', orderQty: 10,
      diagramId: 'default-wdu-flagstone',
      diagramName: 'Drive Weigh Unit (4D-33519)', diagramNumber: '4D-33519',
    },
  ],
};

// The internal viewer's shape — same information, different container.
const INTERNAL_EXPORT = {
  exportDate: '2026-07-21T16:54:33.318Z',
  orderList: {
    'd1-22': { partCode: '000-066-6937-00', partName: 'DIAPHRAGM: 60', partNumber: '22', qty: '1', orderQty: 10, diagramId: 'd1', diagramName: '20-1-DRIVE-WEIGH-UNIT', diagramNumber: '4D-44711' },
  },
  metadata: { totalItems: 1, totalQuantity: 10, diagrams: ['20-1-DRIVE-WEIGH-UNIT'] },
};

const AT = new Date('2026-08-22T12:00:00.000Z');

describe('reading an exported order', () => {
  it('reads the customer viewer\'s shape', () => {
    const { order, error } = readOrderExport(CUSTOMER_EXPORT, { customer: 'Flagstone Foods', fileName: 'Flagstone Parts 041626.json', now: AT });
    expect(error).toBeUndefined();
    expect(order.itemCount).toBe(2);
    expect(order.totalQuantity).toBe(30);
    expect(order.items[0].partCode).toBe('000-052-3359-08');
    expect(order.diagrams).toEqual(['Drive Weigh Unit (4D-33519)']);
  });

  it('reads the internal viewer\'s shape into the same record', () => {
    const { order } = readOrderExport(INTERNAL_EXPORT, { customer: 'Utz', now: AT });
    expect(order.itemCount).toBe(1);
    expect(order.totalQuantity).toBe(10);
    expect(order.items[0].orderKey).toBe('d1-22');
    expect(order.items[0].partName).toBe('DIAPHRAGM: 60');
  });

  it('keeps the date the order was BUILT, not the day it was uploaded', () => {
    const { order } = readOrderExport(CUSTOMER_EXPORT, { customer: 'Flagstone Foods', now: AT });
    expect(order.orderedAt).toBe('2026-04-16T22:56:32.587Z');
    expect(order.uploadedAt).toBe(AT.toISOString());
  });

  it('files it against the customer given, never the one in the file', () => {
    // Every real export says "Multiple Customers (6)", which is not a plant.
    const { order } = readOrderExport(CUSTOMER_EXPORT, { customer: 'Flagstone Foods', customerId: 'c-flag', now: AT });
    expect(order.customer).toBe('Flagstone Foods');
    expect(order.customerId).toBe('c-flag');
  });

  it('refuses to file an order against nobody', () => {
    const { error } = readOrderExport(CUSTOMER_EXPORT, { customer: '   ', now: AT });
    expect(error).toMatch(/customer/i);
  });
});

describe('a file that is not an order', () => {
  it('names a diagram export for what it is', () => {
    const ipm = { customer: 'Trident Seafood (Complete)', exportDate: '2026-01-11', diagramCount: 38, diagrams: new Array(38).fill({}) };
    expect(isDiagramExport(ipm)).toBe(true);
    const { error, order } = readOrderExport(ipm, { customer: 'Trident Seafood', now: AT });
    expect(order).toBeUndefined();
    expect(error).toMatch(/diagram export \(38 diagrams\)/);
  });

  it('says so for a file with no order lines at all', () => {
    expect(readOrderExport({ exportDate: '2026-01-01' }, { customer: 'Utz', now: AT }).error).toMatch(/no order lines/);
  });

  it('says so for an order with nothing in it', () => {
    const empty = { orderItems: [{ orderQty: 0 }] };
    expect(readOrderExport(empty, { customer: 'Utz', now: AT }).error).toMatch(/empty/i);
  });

  it('does not throw on junk', () => {
    expect(readOrderExport(null, { customer: 'Utz' }).error).toBeTruthy();
    expect(readOrderExport('not json', { customer: 'Utz' }).error).toBeTruthy();
  });
});

describe('finding an order from the search box', () => {
  const { order } = readOrderExport(CUSTOMER_EXPORT, { customer: 'Flagstone Foods', now: AT });
  const matches = (term) => (v) => String(v || '').toLowerCase().includes(term);

  it('matches a part code', () => {
    expect(orderMatches(order, matches('000-052-3359-08'))).toBe(true);
    expect(matchingLines(order, matches('000-052-3359-08'))).toHaveLength(1);
  });

  it('matches a part name', () => {
    expect(matchingLines(order, matches('spring'))[0].partCode).toBe('000-052-3359-08');
    expect(matchingLines(order, matches('spring'))).toHaveLength(2);
  });

  it('matches the manual it came from', () => {
    expect(orderMatches(order, matches('4d-33519'))).toBe(true);
  });

  it('does not match something that is not in it', () => {
    expect(orderMatches(order, matches('gasket'))).toBe(false);
  });
});

describe('ordering the list', () => {
  it('puts the newest order first', () => {
    const list = [{ orderedAt: '2026-02-25' }, { orderedAt: '2026-07-21' }, { orderedAt: '2026-04-16' }];
    expect([...list].sort(byNewest).map((o) => o.orderedAt))
      .toEqual(['2026-07-21', '2026-04-16', '2026-02-25']);
  });
});
