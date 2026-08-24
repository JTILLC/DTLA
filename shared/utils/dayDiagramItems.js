// shared/utils/dayDiagramItems.js
//
// Everything replaced on one drawing, on one line, on one day.
//
// A shift's work is logged as several entries — one per head — so opening the
// drawing from any one of them ringed a single balloon and said nothing about
// the other four gaskets that went on the same assembly that morning. The
// drawing is the natural place to see the shape of the day's work: which parts
// of this unit were touched, all at once.
//
// Scoped to the LINE as well as the day, deliberately. Two lines can be the
// same machine and therefore share a drawing, and ringing a part replaced on
// Line 2 while looking at Line 1's entry would say the work happened on a
// machine it did not.

/** Parts on a log entry that belong to a given drawing, old shape or new. */
const itemsOnDiagram = (entry, diagramId) => {
  if (!entry || !diagramId) return [];
  const list = Array.isArray(entry.parts) && entry.parts.length
    ? entry.parts.filter((p) => p?.diagramId === diagramId)
    // Entries written before a replacement could hold several parts carry the
    // one part in flat fields.
    : (entry.partDiagramId === diagramId && entry.partItemNo
        ? [{ itemNo: entry.partItemNo, partNumber: entry.partNumber }]
        : []);

  return list
    .map((p) => ({
      itemNo: p.itemNo == null ? '' : String(p.itemNo).trim(),
      partNumber: p.partNumber || '',
      headNumber: entry.headNumber == null ? null : entry.headNumber,
    }))
    // '*' is the assembly the drawing depicts, not a part on it, and it has no
    // balloon to ring.
    .filter((p) => p.itemNo && p.itemNo !== '*');
};

/** Same calendar day, by the clock on the wall rather than UTC. */
const dayKey = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/**
 * Every balloon to ring when the drawing is opened from `entry`.
 *
 * The clicked entry's own parts come first so the part somebody asked to see is
 * never buried, and an item balloned by two entries is listed once — the ring
 * would be drawn in the same place twice.
 */
export function sameDayItemsOnDiagram(entries = [], entry = null) {
  const diagramId = entry?.partDiagramId;
  if (!diagramId) return [];
  const day = dayKey(entry.performedAt);

  const sameDay = (entries || []).filter((e) => (
    e && e !== entry
    && e.lineTitle === entry.lineTitle
    && day && dayKey(e.performedAt) === day
  ));

  const out = [];
  const seen = new Set();
  [entry, ...sameDay].forEach((e) => {
    itemsOnDiagram(e, diagramId).forEach((p) => {
      if (seen.has(p.itemNo)) return;
      seen.add(p.itemNo);
      out.push(p);
    });
  });
  return out;
}

/** "3 parts replaced on this drawing today" — or the part's own number. */
export function diagramLabel(items = [], fallback = '') {
  if (items.length > 1) return `${items.length} parts on this drawing`;
  return items[0]?.partNumber || fallback || 'Part';
}

export default { sameDayItemsOnDiagram, diagramLabel };
