// shared/utils/photoGrid.js
//
// Photos laid out in a grid on a PDF page.
//
// Every one of these reports drew photos in a column, and none of them had a
// broken row layout — all three wrapped correctly. They were each CALLED once
// per group, with a heading above it, and most groups hold a single photo: a
// heading, a thumbnail, a heading, a thumbnail. The column was in the calling,
// not the wrapping.
//
// So the fix is the same everywhere, which is why this lives here rather than
// three times: collect the photos, caption each one, and lay the lot out as a
// grid.
//
// The arithmetic is separate from the drawing so it can be tested without a
// PDF — a cell one row too low is invisible in review and obvious in a test.

// Where each photo goes on a grid, in page coordinates.
//
// Separated from the drawing so the arithmetic can be tested without a PDF:
// getting a cell one row too low is invisible in code review and obvious in a
// test.
//
// Photos used to be grouped under a heading per line and head, which read as a
// single column down the page because most issues have exactly one photo — a
// heading, one thumbnail, a heading, one thumbnail. A grid puts a dozen on a
// page instead of a dozen pages, and the label moves under each photo so
// nothing loses its attribution in the process.
export function layoutGrid(count, {
  x = 14, y = 20, cols = 3, cellW = 58, imgH = 40, captionH = 5, gap = 4,
  pageTop = 20, pageBottom = 282,
} = {}) {
  const cells = [];
  const rowH = imgH + captionH + gap;
  let row = 0;
  let cursorY = y;

  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    if (i > 0 && col === 0) { row += 1; cursorY += rowH; }
    // A row that would run off the bottom starts a new page — the whole row,
    // not just the photo that crossed the line, or one cell ends up orphaned
    // above its neighbours.
    if (cursorY + imgH + captionH > pageBottom) {
      cursorY = pageTop;
      row = 0;
      cells.push({ index: i, x: x, y: cursorY, newPage: true, col, cellW, imgH, captionH });
      continue;
    }
    cells.push({ index: i, x: x + col * (cellW + gap), y: cursorY, newPage: false, col, cellW, imgH, captionH });
  }

  // A page break mid-row leaves the cells after it on the wrong x — recompute
  // every cell after a break from the break itself.
  let pageStartIndex = 0;
  return cells.map((c, i) => {
    if (c.newPage) pageStartIndex = i;
    const n = i - pageStartIndex;
    const col = n % cols;
    const rowOnPage = Math.floor(n / cols);
    const cellY = (c.newPage ? pageTop : (cells[pageStartIndex].newPage ? pageTop : y)) + rowOnPage * rowH;
    return { ...c, col, x: x + col * (cellW + gap), y: cellY };
  });
}

/** Fit an image inside a cell without distorting it. */
export const fitInCell = (w, h, cellW, cellH) => {
  const scale = Math.min(cellW / w, cellH / h, 1e6);
  return { w: Math.max(1, w * scale), h: Math.max(1, h * scale) };
};

// Draw the thumbnails as a grid, captioned, paginating by row.
// Returns the y position after the last row.
export function drawPhotoGrid(doc, photos, startY, opts = {}) {
  const usable = (photos || []).filter((t) => t && t.dataUrl);
  if (!usable.length) return startY;

  const pageH = doc.internal.pageSize.getHeight();
  const conf = {
    x: 14, cols: 3, cellW: 58, imgH: 40, captionH: 5, gap: 4,
    pageTop: 20, pageBottom: pageH - 12, ...opts,
  };
  // A report with a running header has to redraw it after a page break. This
  // DRAWS only — where the content resumes is `pageTop`, which the layout
  // needs up front. Letting the callback move the first cell would leave the
  // rest of that row at the old top, which is a stagger nobody would guess at
  // from the code.
  const onNewPage = opts.onNewPage || null;
  const cells = layoutGrid(usable.length, { ...conf, y: startY });

  let last = startY;
  cells.forEach((cell, i) => {
    if (cell.newPage) {
      doc.addPage();
      if (onNewPage) onNewPage();
    }
    const t = usable[i];
    const { w, h } = fitInCell(t.w, t.h, cell.cellW, cell.imgH);
    // Centred in its cell so a portrait photo beside a landscape one still
    // reads as a row rather than as a stagger.
    const ix = cell.x + (cell.cellW - w) / 2;
    const iy = cell.y + (cell.imgH - h) / 2;
    try {
      doc.addImage(t.dataUrl, 'JPEG', ix, iy, w, h);
    } catch {
      /* a single bad image must not abort the export */
    }
    if (t.label) {
      doc.setFontSize(6.5);
      // Trimmed to the cell: an untrimmed caption runs under the next photo
      // and the two become unreadable together.
      const text = doc.splitTextToSize(t.label, cell.cellW)[0] || '';
      doc.text(text, cell.x, cell.y + cell.imgH + 3.5);
    }
    last = Math.max(last, cell.y + cell.imgH + cell.captionH);
  });
  doc.setFontSize(9);
  return last + 2;
}

export default { layoutGrid, fitInCell, drawPhotoGrid };
