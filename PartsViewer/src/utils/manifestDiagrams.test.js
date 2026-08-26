import { describe, it, expect } from 'vitest';
import {
  numbersForView, mergeHotspots, collapseManifestEntry, SAME_BALLOON_PCT,
} from './manifestDiagrams.js';

// One drawing reprinted across three pages because its parts list is long.
// Each scan reads MOST of the balloons and misses a different one, which is
// the whole reason the later pages are worth merging rather than dropping.
const repeatedDrawing = {
  drawNo: '4D-45854',
  name: '10-1-MAIN BODY UNIT-4D-45854',
  explodedViews: [
    { pageNum: 8, imageData: 'SCAN-A', detectedNumbers: [
      { text: '1', x: 0.10, y: 0.20 },
      { text: '2', x: 0.30, y: 0.40 },
    ] },
    { pageNum: 10, imageData: 'SCAN-B', detectedNumbers: [
      { text: '1', x: 0.101, y: 0.201 },   // same balloon, second scan
      { text: '3', x: 0.50, y: 0.60 },     // missed by the first scan
    ] },
    { pageNum: 12, imageData: 'SCAN-C', detectedNumbers: [
      { text: '2', x: 0.299, y: 0.399 },   // same balloon again
      { text: '4', x: 0.70, y: 0.80 },
    ] },
  ],
  partsLists: [{ pageNum: 9, extractedText: '1 ABC' }, { pageNum: 11, extractedText: '3 DEF' }],
};

describe('mergeHotspots', () => {
  it('gives one hotspot per balloon, however many pages it was read from', () => {
    const h = mergeHotspots(repeatedDrawing);
    expect(Object.values(h).map((v) => v.partNumber).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('keeps balloons the other scans missed', () => {
    // Dropping pages 2 and 3 would lose 3 and 4 entirely.
    const labels = Object.values(mergeHotspots(repeatedDrawing)).map((v) => v.partNumber);
    expect(labels).toContain('3');
    expect(labels).toContain('4');
  });

  it('keeps the same number twice when it is genuinely in two places', () => {
    // Real on plenty of drawings — dedup on the number alone would lose one.
    const twoPlaces = { explodedViews: [{ imageData: 'A', detectedNumbers: [
      { text: '5', x: 0.10, y: 0.10 },
      { text: '5', x: 0.90, y: 0.90 },
    ] }] };
    expect(Object.keys(mergeHotspots(twoPlaces))).toHaveLength(2);
  });

  it('treats a shifted rescan of one balloon as one balloon', () => {
    const within = SAME_BALLOON_PCT / 100 * 0.9;
    const jittered = { explodedViews: [
      { imageData: 'A', detectedNumbers: [{ text: '7', x: 0.5, y: 0.5 }] },
      { imageData: 'B', detectedNumbers: [{ text: '7', x: 0.5 + within, y: 0.5 }] },
    ] };
    expect(Object.keys(mergeHotspots(jittered))).toHaveLength(1);
  });

  it('converts the manifest fraction to the viewer percent', () => {
    const h = mergeHotspots({ explodedViews: [{ detectedNumbers: [{ text: '7', x: 0.1234, y: 0.5 }] }] });
    expect(Object.values(h)[0]).toEqual({ x: 12.34, y: 50, partNumber: '7' });
  });

  it('drops anything it could not place', () => {
    const h = mergeHotspots({ explodedViews: [{ detectedNumbers: [
      { text: '', x: 0.1, y: 0.1 },
      { text: '5', x: null, y: 0.1 },
      { text: '6', x: 0.1, y: NaN },
      { text: '7', x: 0.1, y: 0.1 },
    ] }] });
    expect(Object.values(h).map((v) => v.partNumber)).toEqual(['7']);
  });
});

describe('numbersForView', () => {
  it('reads each page its own numbers', () => {
    expect(numbersForView(repeatedDrawing, 1).map((n) => n.text)).toEqual(['1', '3']);
  });

  it('falls back to the top-level hotspots for the first page only', () => {
    const legacy = { hotspots: [{ partNumber: '1', x: 0.1, y: 0.1 }], explodedViews: [{}, {}] };
    expect(numbersForView(legacy, 0)).toHaveLength(1);
    expect(numbersForView(legacy, 1)).toEqual([]);
  });
});

describe('collapseManifestEntry', () => {
  const opts = { id: 'mfst-1', partsData: { 1: { partNo: '1' } }, partsListImages: ['P0', 'P1'], folder: 'F', customer: 'C' };

  it('is ONE diagram, whatever the page count', () => {
    // The same drawing must not appear three times looking like three drawings.
    const d = collapseManifestEntry(repeatedDrawing, opts);
    expect(Array.isArray(d)).toBe(false);
    expect(d.id).toBe('mfst-1');
    expect(d.name).toBe('10-1-MAIN BODY UNIT-4D-45854');
  });

  it('uses the first scan as the image and carries every balloon', () => {
    const d = collapseManifestEntry(repeatedDrawing, opts);
    expect(d.pdfData).toBe('SCAN-A');
    expect(Object.keys(d.hotspots)).toHaveLength(4);
  });

  it('records which manual pages the drawing spanned', () => {
    expect(collapseManifestEntry(repeatedDrawing, opts).sourcePages).toEqual([8, 10, 12]);
    expect(collapseManifestEntry(repeatedDrawing, opts).explodedPageCount).toBe(3);
  });

  it('does not repeat the drawing in the reference images', () => {
    // The other exploded pages ARE this drawing; keeping them made the strip
    // show the same picture three times.
    expect(collapseManifestEntry(repeatedDrawing, opts).partsListImages).toEqual(['P0', 'P1']);
  });

  it('still imports a drawing with no exploded page', () => {
    const d = collapseManifestEntry({ drawNo: 'B-1', name: 'Parts only' }, opts);
    expect(d.pdfData).toBeNull();
    expect(d.partsData).toEqual(opts.partsData);
    expect(d.sourcePages).toEqual([]);
  });
});
