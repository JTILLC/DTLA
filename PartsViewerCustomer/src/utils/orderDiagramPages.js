// Diagram pages for the parts-order PDF, with every ordered balloon ringed in red.
//
// A part code means nothing to somebody standing at a machine; the drawing with
// that balloon circled does. This is the same idea as the replacement log in the
// CCW Issues app, moved onto the order that gets emailed to a supplier.
//
// Hotspot coordinates are PERCENTAGES of the image, so a ring drawn at those
// percentages lands on the balloon whatever size the drawing is placed at.
//
// The stored rotation is deliberately ignored: hotspot percentages are recorded
// against the unrotated image, so rotating the page would slide every ring off
// its balloon — the exact thing this is meant to prevent.

const RING_COLOR = [255, 59, 48];

// Ordered parts, grouped by the diagram they were picked from. One drawing with
// eight rings, not eight copies of the same drawing.
export const groupOrderByDiagram = (orderEntries, diagrams) => {
  const byDiagram = new Map();

  orderEntries.forEach(([, item]) => {
    const id = item.diagramId;
    if (!id) return;
    if (!byDiagram.has(id)) byDiagram.set(id, []);
    byDiagram.get(id).push(item);
  });

  const sections = [...byDiagram.entries()].map(([id, items]) => {
    const diagram = (diagrams && diagrams[id]) || null;
    const wanted = new Set(items.map((i) => String(i.partNumber)));

    // Every hotspot for every ordered part: a part can be balloned more than
    // once on one drawing, and ringing an arbitrary first leaves the rest
    // looking un-ordered.
    const spots = Object.values(diagram?.hotspots || {})
      .filter((h) => wanted.has(String(h.partNumber)));
    const ringed = new Set(spots.map((h) => String(h.partNumber)));

    const byNumber = (a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b));

    return {
      id,
      diagram,
      name: items[0]?.diagramName || diagram?.name || 'Diagram',
      number: items[0]?.diagramNumber || diagram?.number || '',
      spots,
      ringed: [...ringed].sort(byNumber),
      // Ordered but not balloned — say so, rather than let a missing ring read
      // as "that part isn't on this drawing".
      unringed: [...wanted].filter((n) => !ringed.has(n)).sort(byNumber)
    };
  });

  return sections.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
};

const toDataUrl = async (src) => {
  if (!src) return null;
  if (src.startsWith('data:')) return src;

  const response = await fetch(src);
  if (!response.ok) throw new Error(`image request failed: ${response.status}`);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('could not read image data'));
    reader.readAsDataURL(blob);
  });
};

const measure = (dataUrl) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
  img.onerror = () => reject(new Error('could not decode image'));
  img.src = dataUrl;
});

const formatOf = (dataUrl) => (/^data:image\/(png|gif|webp)/i.test(dataUrl) ? 'PNG' : 'JPEG');

/**
 * Append one page per diagram to an existing jsPDF document.
 *
 * @param {object} doc            jsPDF instance, already holding the order table
 * @param {Array}  orderEntries   Object.entries(orderList) of the ordered lines
 * @param {object} diagrams       every diagram, keyed by id
 * @param {Function} resolveImage async (diagram) => image src, for apps that keep
 *                                images outside the diagram record (IndexedDB)
 * @returns {Promise<number>}     how many diagram pages were added
 */
export const appendOrderDiagramPages = async (doc, { orderEntries, diagrams, resolveImage }) => {
  const sections = groupOrderByDiagram(orderEntries, diagrams);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let added = 0;

  for (const section of sections) {
    // One bad image must never cost somebody their order PDF, so every section
    // is attempted on its own and a failure just means no picture for that one.
    try {
      const src = resolveImage
        ? await resolveImage(section.diagram)
        : section.diagram?.pdfData;
      if (!src) continue;

      const dataUrl = await toDataUrl(src);
      const { width, height } = await measure(dataUrl);
      if (!width || !height) continue;

      doc.addPage();
      let cursorY = margin;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(33, 33, 33);
      doc.text(section.number ? `${section.number} — ${section.name}` : section.name, margin, cursorY);
      cursorY += 16;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      doc.text(
        section.ringed.length
          ? `Circled in red: ${section.ringed.join(', ')}`
          : 'None of the ordered parts are balloned on this drawing.',
        margin,
        cursorY
      );
      cursorY += 13;
      if (section.unringed.length) {
        doc.text(`Not balloned on this drawing: ${section.unringed.join(', ')}`, margin, cursorY);
        cursorY += 13;
      }
      cursorY += 4;

      const maxWidth = pageWidth - margin * 2;
      const maxHeight = pageHeight - cursorY - margin;
      const scale = Math.min(maxWidth / width, maxHeight / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const drawX = margin + (maxWidth - drawWidth) / 2;

      doc.addImage(dataUrl, formatOf(dataUrl), drawX, cursorY, drawWidth, drawHeight);

      const radius = Math.max(7, drawWidth * 0.03);
      doc.setDrawColor(RING_COLOR[0], RING_COLOR[1], RING_COLOR[2]);
      doc.setLineWidth(2);
      section.spots.forEach((spot) => {
        doc.circle(
          drawX + (Number(spot.x) / 100) * drawWidth,
          cursorY + (Number(spot.y) / 100) * drawHeight,
          radius,
          'S'
        );
      });

      added += 1;
    } catch (err) {
      console.warn(`[Order PDF] Skipped diagram "${section.name}":`, err);
    }
  }

  return added;
};
