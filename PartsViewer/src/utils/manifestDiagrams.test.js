import { describe, it, expect } from 'vitest';
import {
  hotspotsFromNumbers, numbersForView, diagramNameFor, expandManifestEntry,
} from './manifestDiagrams.js';

// A drawing spanning three exploded pages, the case the importer used to drop.
const threePageEntry = {
  drawNo: 'A-1234',
  name: '12-Feeder Unit-A-1234',
  explodedViews: [
    { pageNum: 10, imageData: 'IMG0', detectedNumbers: [{ text: '1', x: 0.1, y: 0.2 }, { text: '2', x: 0.3, y: 0.4 }] },
    { pageNum: 11, imageData: 'IMG1', detectedNumbers: [{ text: '3', x: 0.5, y: 0.6 }] },
    { pageNum: 12, imageData: 'IMG2', detectedNumbers: [{ text: '4', x: 0.7, y: 0.8 }] },
  ],
  partsLists: [{ pageNum: 13, extractedText: '1 ABC Bolt 4' }],
  hotspots: [{ partNumber: '1', x: 0.1, y: 0.2 }, { partNumber: '2', x: 0.3, y: 0.4 }],
};

describe('hotspotsFromNumbers', () => {
  it('converts the manifest fraction to the viewer percent', () => {
    const h = hotspotsFromNumbers([{ text: '7', x: 0.1234, y: 0.5 }]);
    expect(Object.values(h)[0]).toEqual({ x: 12.34, y: 50, partNumber: '7' });
  });

  it('accepts either shape the manifest uses', () => {
    expect(Object.values(hotspotsFromNumbers([{ partNumber: '9', x: 0, y: 0 }]))[0].partNumber).toBe('9');
    expect(Object.values(hotspotsFromNumbers([{ text: '9', x: 0, y: 0 }]))[0].partNumber).toBe('9');
  });

  it('drops anything it could not place', () => {
    const h = hotspotsFromNumbers([
      { text: '', x: 0.1, y: 0.1 },
      { text: '5', x: null, y: 0.1 },
      { text: '6', x: 0.1, y: NaN },
      { text: '7', x: 0.1, y: 0.1 },
    ]);
    expect(Object.values(h).map((v) => v.partNumber)).toEqual(['7']);
  });

  it('keeps repeated part numbers apart', () => {
    // The same balloon number appears more than once on plenty of drawings.
    const h = hotspotsFromNumbers([{ text: '1', x: 0.1, y: 0.1 }, { text: '1', x: 0.9, y: 0.9 }]);
    expect(Object.keys(h)).toHaveLength(2);
  });

  it('keeps views from colliding on hotspot ids', () => {
    const a = hotspotsFromNumbers([{ text: '1', x: 0.1, y: 0.1 }], 'mfst-v0');
    const b = hotspotsFromNumbers([{ text: '1', x: 0.2, y: 0.2 }], 'mfst-v1');
    expect(Object.keys(a)[0]).not.toBe(Object.keys(b)[0]);
  });
});

describe('numbersForView', () => {
  it('reads each view its own numbers', () => {
    expect(numbersForView(threePageEntry, 1).map((n) => n.text)).toEqual(['3']);
    expect(numbersForView(threePageEntry, 2).map((n) => n.text)).toEqual(['4']);
  });

  it('falls back to the top-level hotspots for the first view only', () => {
    const legacy = { hotspots: [{ partNumber: '1', x: 0.1, y: 0.1 }], explodedViews: [{ imageData: 'A' }, { imageData: 'B' }] };
    expect(numbersForView(legacy, 0)).toHaveLength(1);
    // View 2's numbers are not view 1's — better nothing than wrong positions.
    expect(numbersForView(legacy, 1)).toEqual([]);
  });
});

describe('diagramNameFor', () => {
  it('leaves a single-page drawing alone', () => {
    expect(diagramNameFor('Feeder Unit', 0, 1)).toBe('Feeder Unit');
  });
  it('says which view, and how many there are', () => {
    expect(diagramNameFor('Feeder Unit', 1, 3)).toBe('Feeder Unit (view 2 of 3)');
  });
});

describe('expandManifestEntry', () => {
  const opts = { idBase: 'mfst-1', partsData: { 1: { partNo: '1' } }, partsListImages: ['P0'], folder: 'F', customer: 'C' };

  it('makes one diagram per exploded page', () => {
    const out = expandManifestEntry(threePageEntry, opts);
    expect(out).toHaveLength(3);
    expect(out.map((d) => d.pdfData)).toEqual(['IMG0', 'IMG1', 'IMG2']);
  });

  it('places the hotspots that used to be thrown away', () => {
    const out = expandManifestEntry(threePageEntry, opts);
    expect(Object.keys(out[0].hotspots)).toHaveLength(2);
    expect(Object.keys(out[1].hotspots)).toHaveLength(1);
    expect(Object.keys(out[2].hotspots)).toHaveLength(1);
    expect(Object.values(out[2].hotspots)[0]).toEqual({ x: 70, y: 80, partNumber: '4' });
  });

  it('gives every view the parts list for the whole drawing', () => {
    const out = expandManifestEntry(threePageEntry, opts);
    out.forEach((d) => {
      expect(d.partsData).toEqual(opts.partsData);
      expect(d.partsListImages).toEqual(['P0']);
    });
  });

  it('gives every view a distinct id, and keeps the first one stable', () => {
    const out = expandManifestEntry(threePageEntry, opts);
    expect(out[0].id).toBe('mfst-1');
    expect(new Set(out.map((d) => d.id)).size).toBe(3);
  });

  it('records the manual page each view came from', () => {
    // So a hotspot in the wrong place can be traced to the page it was read off.
    expect(expandManifestEntry(threePageEntry, opts).map((d) => d.sourcePage)).toEqual([10, 11, 12]);
  });

  it('still imports a drawing with no exploded page', () => {
    const out = expandManifestEntry({ drawNo: 'B-1', name: 'Parts only', partsLists: [{ extractedText: 'x' }] }, opts);
    expect(out).toHaveLength(1);
    expect(out[0].pdfData).toBeNull();
    expect(out[0].partsData).toEqual(opts.partsData);
  });

  it('does not suffix a single-view drawing', () => {
    const one = { name: 'Solo', explodedViews: [{ imageData: 'X', detectedNumbers: [] }] };
    expect(expandManifestEntry(one, opts)[0].name).toBe('Solo');
  });
});
