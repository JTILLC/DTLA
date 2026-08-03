import { describe, it, expect } from 'vitest';
import {
  typeName, normalizeType, normalizeTypes, typeNames, hasPart, partForType, mappedPickedPart,
} from './boardTypes.js';

describe('reading both shapes', () => {
  it('treats a bare string as a type with no part', () => {
    expect(normalizeType('Power Supply')).toEqual({ name: 'Power Supply' });
    expect(hasPart('Power Supply')).toBe(false);
  });

  it('keeps a mapped part number', () => {
    expect(normalizeType({ name: 'I/O Board', partNumber: 'SB-104778', partName: 'PCB:I/O' }))
      .toEqual({ name: 'I/O Board', partNumber: 'SB-104778', partName: 'PCB:I/O' });
  });

  it('trims, and drops entries with no name', () => {
    expect(normalizeTypes(['  Main Board  ', '', '   ', null, { name: '' }]))
      .toEqual([{ name: 'Main Board' }]);
  });

  it('ignores a part name typed without a number — that is a half-filled row, not a mapping', () => {
    expect(normalizeType({ name: 'Stepper Driver', partName: 'DRIVER ASSY' }))
      .toEqual({ name: 'Stepper Driver' });
  });

  it('drops unknown keys rather than carrying them', () => {
    const t = normalizeType({ name: 'X', partNumber: 'P1', bogus: 'nope', __proto__x: 1 });
    expect(Object.keys(t).sort()).toEqual(['name', 'partNumber']);
  });

  it('omits empty optional fields instead of writing empty strings to Firestore', () => {
    expect(normalizeType({ name: 'X', partNumber: 'P1', itemNo: '', diagramName: '' }))
      .toEqual({ name: 'X', partNumber: 'P1' });
  });

  it('mixes both shapes in one list', () => {
    const list = ['Power Supply', { name: 'I/O Board', partNumber: 'SB-1' }];
    expect(typeNames(list)).toEqual(['Power Supply', 'I/O Board']);
    expect(normalizeTypes(list)[1].partNumber).toBe('SB-1');
  });

  it('survives junk input', () => {
    expect(normalizeTypes(null)).toEqual([]);
    expect(normalizeTypes(undefined)).toEqual([]);
    expect(normalizeTypes('not a list')).toEqual([]);
    expect(typeName(undefined)).toBe('');
  });
});

describe('partForType', () => {
  const types = [
    'Display / HMI',
    { name: 'Power Supply', partNumber: 'SB-104778', partName: 'PSU 24V', itemNo: '19' },
  ];

  it('finds the mapping for a chosen type', () => {
    expect(partForType(types, 'Power Supply').partNumber).toBe('SB-104778');
  });

  it('matches regardless of case', () => {
    expect(partForType(types, 'power supply').partNumber).toBe('SB-104778');
  });

  it('is null for a type with no part, an unknown type, or no type', () => {
    expect(partForType(types, 'Display / HMI')).toBe(null);
    expect(partForType(types, 'Nonexistent')).toBe(null);
    expect(partForType(types, '')).toBe(null);
    expect(partForType(types, undefined)).toBe(null);
  });
});

describe('mappedPickedPart', () => {
  it('fills one, and does not pretend to know the drawing count', () => {
    const p = mappedPickedPart({ name: 'PSU', partNumber: 'SB-1', partName: 'PSU 24V', itemNo: '19' });
    expect(p).toMatchObject({ partCode: 'SB-1', partName: 'PSU 24V', itemNo: '19', qty: 1, manualQty: null });
  });

  it('marks the part as coming from the board list, not the machine manual', () => {
    expect(mappedPickedPart({ name: 'PSU', partNumber: 'SB-1' }).fromBoardType).toBe(true);
  });

  it('is null when there is nothing mapped', () => {
    expect(mappedPickedPart('Power Supply')).toBe(null);
    expect(mappedPickedPart(null)).toBe(null);
  });
});
