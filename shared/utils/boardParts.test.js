import { describe, it, expect } from 'vitest';
import {
  machineKey, machineLabel, partsForMachine, resolveBoardPart,
  cleanMapping, withMachine, countMappings,
} from './boardParts.js';

const BINDING = { partsCustomer: 'Shearers', folder: 'CCW-R-214 #2' };
const BIG = { partsCustomer: 'Shearers', folder: 'CCW-R-235 #1' };

const BOARD_PARTS = {
  byMachine: {
    'Shearers//CCW-R-214 #2': {
      'Main Control Board': { partNumber: 'SB-100', partName: 'PCB:MAIN', itemNo: '4' },
    },
    'Shearers//CCW-R-235 #1': {
      'Main Control Board': { partNumber: 'SB-900', partName: 'PCB:MAIN LARGE' },
    },
  },
};

// The generic fallback: one number for every machine.
const TYPES = [
  { name: 'Main Control Board', partNumber: 'SB-GENERIC' },
  { name: 'Power Supply', partNumber: 'SB-PSU' },
  'Display / HMI',
];

describe('machineKey', () => {
  it('namespaces the folder by its parts customer', () => {
    expect(machineKey(BINDING)).toBe('Shearers//CCW-R-214 #2');
  });
  it('is null for a half-set or missing binding', () => {
    expect(machineKey({ partsCustomer: 'Shearers' })).toBe(null);
    expect(machineKey({ folder: 'X' })).toBe(null);
    expect(machineKey(null)).toBe(null);
  });
  it('reads as a machine name', () => {
    expect(machineLabel(BINDING)).toBe('Shearers · CCW-R-214 #2');
    expect(machineLabel(null)).toBe('');
  });
});

describe('resolveBoardPart', () => {
  const call = (binding, boardType) =>
    resolveBoardPart({ boardParts: BOARD_PARTS, binding, boardTypes: TYPES, boardType });

  it('gives the SAME board a different part on a different machine', () => {
    expect(call(BINDING, 'Main Control Board').part.partCode).toBe('SB-100');
    expect(call(BIG, 'Main Control Board').part.partCode).toBe('SB-900');
  });

  it('marks a machine-specific part as coming from that machine', () => {
    const r = call(BINDING, 'Main Control Board');
    expect(r.source).toBe('machine');
    expect(r.part.fromMachine).toBe(true);
    expect(r.part).toMatchObject({ partName: 'PCB:MAIN', itemNo: '4', qty: 1 });
  });

  it('falls back to the board type default when the machine has no mapping', () => {
    const r = call(BINDING, 'Power Supply');
    expect(r.source).toBe('type');
    expect(r.part.partCode).toBe('SB-PSU');
    expect(r.part.fromBoardType).toBe(true);
  });

  it('falls back when the line is not bound to any machine', () => {
    const r = resolveBoardPart({ boardParts: BOARD_PARTS, binding: null, boardTypes: TYPES, boardType: 'Main Control Board' });
    expect(r.source).toBe('type');
    expect(r.part.partCode).toBe('SB-GENERIC');
  });

  it('is null when neither the machine nor the type has a part', () => {
    expect(call(BINDING, 'Display / HMI')).toBe(null);
    expect(call(BINDING, 'Nonexistent')).toBe(null);
    expect(call(BINDING, '')).toBe(null);
  });

  it('matches a renamed-case board type', () => {
    expect(call(BINDING, 'main control board').part.partCode).toBe('SB-100');
  });

  it('survives an empty document', () => {
    const r = resolveBoardPart({ boardParts: null, binding: BINDING, boardTypes: TYPES, boardType: 'Power Supply' });
    expect(r.part.partCode).toBe('SB-PSU');
  });
});

describe('partsForMachine', () => {
  it('returns only that machine', () => {
    expect(Object.keys(partsForMachine(BOARD_PARTS, BINDING))).toEqual(['Main Control Board']);
    expect(partsForMachine(BOARD_PARTS, BINDING)['Main Control Board'].partNumber).toBe('SB-100');
  });
  it('is empty for an unbound line', () => {
    expect(partsForMachine(BOARD_PARTS, null)).toEqual({});
    expect(partsForMachine(BOARD_PARTS, { partsCustomer: 'Other', folder: 'X' })).toEqual({});
  });
});

describe('cleanMapping', () => {
  it('drops rows with no part number', () => {
    expect(cleanMapping({ A: { partName: 'typed but no number' }, B: { partNumber: 'P1' } }))
      .toEqual({ B: { partNumber: 'P1' } });
  });
  it('drops blank optional fields rather than storing empty strings', () => {
    expect(cleanMapping({ B: { partNumber: ' P1 ', partName: '', itemNo: '  ' } }))
      .toEqual({ B: { partNumber: 'P1' } });
  });
  it('keeps a drawing count when one is known', () => {
    expect(cleanMapping({ B: { partNumber: 'P1', manualQty: 4 } }).B.manualQty).toBe(4);
  });
});

describe('withMachine', () => {
  it('adds a machine without touching the others', () => {
    const next = withMachine(BOARD_PARTS, { partsCustomer: 'Acme', folder: 'F1' }, { X: { partNumber: 'P9' } });
    expect(Object.keys(next.byMachine).sort()).toEqual(
      ['Acme//F1', 'Shearers//CCW-R-214 #2', 'Shearers//CCW-R-235 #1']);
    expect(next.byMachine['Shearers//CCW-R-214 #2']['Main Control Board'].partNumber).toBe('SB-100');
  });

  it('removes the machine entirely when its last mapping is cleared', () => {
    const next = withMachine(BOARD_PARTS, BINDING, { 'Main Control Board': { partNumber: '' } });
    expect('Shearers//CCW-R-214 #2' in next.byMachine).toBe(false);
    expect('Shearers//CCW-R-235 #1' in next.byMachine).toBe(true);
  });

  it('leaves the document alone for an unbound line', () => {
    expect(withMachine(BOARD_PARTS, null, { X: { partNumber: 'P' } })).toEqual(BOARD_PARTS);
  });

  it('does not mutate what it was given', () => {
    const before = JSON.stringify(BOARD_PARTS);
    withMachine(BOARD_PARTS, BINDING, { 'Main Control Board': { partNumber: 'CHANGED' } });
    expect(JSON.stringify(BOARD_PARTS)).toBe(before);
  });
});

describe('countMappings', () => {
  it('counts every board across every machine', () => {
    expect(countMappings(BOARD_PARTS)).toBe(2);
    expect(countMappings(null)).toBe(0);
  });
});
