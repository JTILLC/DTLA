// PartsViewer/src/utils/manifestDiagrams.js
//
// One diagram per exploded view, not one per drawing.
//
// A ManualProcessor manifest groups pages by drawing number, and a drawing
// often runs to several exploded pages. The importer took `explodedViews[0]` as
// the diagram, placed hotspots from that page alone, and demoted every other
// exploded page to a flat reference image with no hotspots on it at all — even
// though the manifest carries the detected balloon numbers, with positions, for
// every one of them. On a drawing with three exploded pages, two thirds of the
// hotspots were read out of the PDF, written to the manifest, and thrown away
// on import.
//
// Each exploded page is its own drawing to look at, so each becomes its own
// diagram, sharing the drawing's parts list. Nothing about the manifest format
// changes, which means manifests exported before this fix gain the pages too.

/**
 * A balloon number worth pinning. Positions arrive as fractions of the image.
 *
 * The coordinate check is deliberately not `Number.isFinite(Number(v))`:
 * `Number(null)` and `Number('')` are both 0, so a hotspot with a MISSING
 * position would pass and be pinned to the top-left corner of the drawing —
 * a confidently wrong hotspot, which is worse than none.
 */
const placeable = (v) =>
  v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

const usableNumber = (n) => {
  if (!n) return false;
  const label = String(n.partNumber ?? n.text ?? '').trim();
  if (!label) return false;
  return placeable(n.x) && placeable(n.y);
};

/**
 * InteractiveDiagram's hotspot map, keyed by part number plus an index.
 *
 * Positions convert from the manifest's 0..1 fractions to the 0..100 percent
 * the viewer stores. Percentages are what make a hotspot survive the image
 * being displayed at any size.
 */
export const hotspotsFromNumbers = (numbers = [], keySuffix = 'mfst') => {
  const hotspots = {};
  numbers.filter(usableNumber).forEach((n, i) => {
    const partNumber = String(n.partNumber ?? n.text).trim();
    hotspots[`${partNumber}-${keySuffix}-${i}`] = {
      x: Math.round(Number(n.x) * 10000) / 100,
      y: Math.round(Number(n.y) * 10000) / 100,
      partNumber,
    };
  });
  return hotspots;
};

/**
 * The balloon numbers for one exploded view.
 *
 * The first view can also read them off the manifest's top-level `hotspots`,
 * which is where older exports put them; every view has carried its own
 * `detectedNumbers` all along.
 */
export const numbersForView = (entry, viewIndex) => {
  const view = (entry?.explodedViews || [])[viewIndex];
  const own = view?.detectedNumbers || [];
  if (own.length) return own;
  return viewIndex === 0 ? (entry?.hotspots || []) : [];
};

/**
 * "Feeder Unit" for a single-page drawing; "Feeder Unit (view 2 of 3)" when
 * there are more. Named rather than numbered silently, so a tech who opens the
 * second page knows there is a first.
 */
export const diagramNameFor = (base, viewIndex, viewCount) =>
  (viewCount > 1 ? `${base} (view ${viewIndex + 1} of ${viewCount})` : base);

/**
 * One manifest entry becomes one diagram per exploded view.
 *
 * `partsData`, the parts-list images and the raw text are the drawing's, so
 * every view of it gets the same ones — the parts list covers the whole
 * drawing, not one page of it.
 */
export const expandManifestEntry = (entry, {
  idBase,
  partsData = {},
  partsListImages = [],
  partsListRawText = '',
  folder = 'General',
  customer = 'General',
  createdAt,
} = {}) => {
  const views = entry?.explodedViews || [];
  const base = entry?.name || entry?.drawNo || 'Diagram';

  // A drawing with no exploded page at all still imports: its parts list is
  // worth having, and a diagram with no image is visibly incomplete rather
  // than silently missing.
  if (views.length === 0) {
    return [{
      id: idBase,
      name: base,
      number: entry?.drawNo || '',
      pdfData: null,
      partsData,
      partsListImages,
      hotspots: hotspotsFromNumbers(numbersForView(entry, 0)),
      partsListRawText,
      folder,
      customer,
      createdAt,
      source: 'manual-processor-manifest',
    }];
  }

  return views.map((view, i) => ({
    id: i === 0 ? idBase : `${idBase}-v${i}`,
    name: diagramNameFor(base, i, views.length),
    number: entry?.drawNo || '',
    pdfData: view?.imageData || null,
    partsData,
    partsListImages,
    hotspots: hotspotsFromNumbers(numbersForView(entry, i), `mfst-v${i}`),
    partsListRawText,
    folder,
    customer,
    createdAt,
    source: 'manual-processor-manifest',
    // Which page of the manual this view came from, so a wrong hotspot can be
    // traced back to the page it was read off.
    sourcePage: view?.pageNum ?? null,
    viewIndex: i,
    viewCount: views.length,
  }));
};

export default { hotspotsFromNumbers, numbersForView, diagramNameFor, expandManifestEntry };
