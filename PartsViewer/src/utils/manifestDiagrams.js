// PartsViewer/src/utils/manifestDiagrams.js
//
// One diagram per drawing — not one per page, and not one page's worth of it.
//
// A ManualProcessor manifest groups pages by drawing number ("one diagram per
// Draw No"), so every exploded page inside one entry is THE SAME DRAWING. A
// drawing appears on several pages when its parts list is too long for one
// page: the identical exploded view is reprinted, and the list continues
// beside it.
//
// Two ways to get that wrong, and this module has been both:
//
//   - Take explodedViews[0] and drop the rest. The balloon numbers on the
//     later pages were read out of the PDF, written to the manifest, and
//     thrown away, and their parts with them.
//   - Make one diagram per page. Now the same drawing appears three times,
//     looking like three different drawings, each holding a third of the
//     parts. Worse than the bug it replaced.
//
// So: one diagram, one image, the hotspots from every page merged onto it, and
// the parts from every page in its single list.

/**
 * How close two readings of the same balloon land, as a percentage of the
 * image. Repeat scans of one printed page differ by well under this; two
 * genuinely different balloons that share a number are further apart than it.
 */
export const SAME_BALLOON_PCT = 1.5;

/**
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

/** The manifest stores 0..1 fractions; the viewer stores 0..100 percent. */
const toPercent = (v) => Math.round(Number(v) * 10000) / 100;

/**
 * The balloon numbers for one exploded view.
 *
 * Every view carries its own `detectedNumbers`; older exports also put the
 * first view's numbers in the entry's top-level `hotspots`.
 */
export const numbersForView = (entry, viewIndex) => {
  const view = (entry?.explodedViews || [])[viewIndex];
  const own = view?.detectedNumbers || [];
  if (own.length) return own;
  return viewIndex === 0 ? (entry?.hotspots || []) : [];
};

/**
 * Every balloon across every page of the drawing, each appearing once.
 *
 * Deduplication is on the number AND where it sits, never the number alone: a
 * drawing legitimately carries the same balloon number in two places, and
 * collapsing those would lose a real hotspot. Two readings of one balloon —
 * the same number in the same spot on two scans of the same page — become one.
 *
 * Merging is what makes the repeat pages worth keeping: OCR misses a different
 * balloon on each scan, so three passes over one drawing find more of them
 * than any single pass does.
 */
export const mergeHotspots = (entry, tolerance = SAME_BALLOON_PCT) => {
  const views = entry?.explodedViews || [];
  const count = views.length || 1;
  const placed = [];

  for (let i = 0; i < count; i += 1) {
    numbersForView(entry, i).filter(usableNumber).forEach((n) => {
      const partNumber = String(n.partNumber ?? n.text).trim();
      const x = toPercent(n.x);
      const y = toPercent(n.y);
      const alreadyThere = placed.some((p) => (
        p.partNumber === partNumber
        && Math.abs(p.x - x) <= tolerance
        && Math.abs(p.y - y) <= tolerance
      ));
      if (!alreadyThere) placed.push({ partNumber, x, y, fromView: i });
    });
  }

  const hotspots = {};
  placed.forEach((p, i) => {
    hotspots[`${p.partNumber}-mfst-${i}`] = { x: p.x, y: p.y, partNumber: p.partNumber };
  });
  return hotspots;
};

/**
 * One manifest entry becomes ONE diagram.
 *
 * The image is the first exploded page; the others are the same drawing again
 * and are not kept as extra reference images, which only made the parts-image
 * strip repeat itself. Which manual pages the drawing spanned is recorded so a
 * hotspot in the wrong place can be traced back.
 */
export const collapseManifestEntry = (entry, {
  id,
  partsData = {},
  partsListImages = [],
  partsListRawText = '',
  folder = 'General',
  customer = 'General',
  createdAt,
} = {}) => {
  const views = entry?.explodedViews || [];
  return {
    id,
    name: entry?.name || entry?.drawNo || 'Diagram',
    number: entry?.drawNo || '',
    // A drawing with no exploded page still imports: its parts list is worth
    // having, and a diagram with no image is visibly incomplete rather than
    // silently missing.
    pdfData: views[0]?.imageData || null,
    partsData,
    partsListImages,
    hotspots: mergeHotspots(entry),
    partsListRawText,
    folder,
    customer,
    createdAt,
    source: 'manual-processor-manifest',
    sourcePages: views.map((v) => v?.pageNum ?? null).filter((p) => p !== null),
    explodedPageCount: views.length,
  };
};

export default { SAME_BALLOON_PCT, numbersForView, mergeHotspots, collapseManifestEntry };
