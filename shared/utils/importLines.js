// shared/utils/importLines.js
//
// Bringing JTI's lines into a plant's log.
//
// A line is not a thing that exists at a plant — it exists INSIDE a log
// document, and every log gets its lines by carrying them from the one before.
// That works from the second log onwards and leaves the first with nothing, so a
// site JTI has serviced for years starts with a blank screen while the whole
// equipment layout sits in JTI's visits.
//
// This copies a visit's lines into a log that is already open. Two rules:
//
//   Match on TITLE. "Line 3" is how every other record in this system refers to
//   a line — the span log, the board log, the parts binding all key on it — so a
//   line that exists is one whose title exists. Anything else would produce a
//   second "Line 3" and quietly split its history in two.
//
//   Never overwrite. An existing line is left exactly as it is, even when JTI's
//   copy looks newer. The plant's version is what their shift has been recording
//   into; replacing it would discard today's readings in favour of a snapshot
//   from a visit weeks ago.

// A line as it should arrive in someone else's log: same equipment, same open
// problems, none of the previous owner's attachments.
//
// Photos go because they live in Storage under a path authorised for the account
// that uploaded them — a copied reference would render as a broken image. Work
// order links go because they point at a job that was JTI's, not this plant's.
export function cleanLineForImport(line) {
  const copy = JSON.parse(JSON.stringify(line || {}));
  return {
    ...copy,
    heads: (copy.heads || []).map((h) => {
      const { redzoneWorkOrderId, redzoneWorkOrderUrl, redzoneSyncedAt, redzoneStatus, ...rest } = h;
      return {
        ...rest,
        photos: [],
        issues: (h.issues || []).map((iss) => ({ ...iss, photos: [] })),
      };
    }),
  };
}

const title = (l) => String(l?.title ?? '').trim();

/**
 * What importing this visit would do.
 *
 * { toAdd: [line], skipped: [title] } — skipped are the ones the log already
 * has. The caller shows both, so "nothing happened" is never a silent outcome.
 */
export function planImport(existingLines = [], visitLines = []) {
  const have = new Set(existingLines.map((l) => title(l).toLowerCase()).filter(Boolean));
  const toAdd = [];
  const skipped = [];
  const seen = new Set();

  (visitLines || []).forEach((l) => {
    const t = title(l);
    if (!t) return;                      // an untitled line cannot be matched or referred to
    const key = t.toLowerCase();
    if (have.has(key)) { skipped.push(t); return; }
    if (seen.has(key)) return;           // the same title twice in one visit
    seen.add(key);
    toAdd.push(cleanLineForImport(l));
  });

  return { toAdd, skipped };
}

// Fresh ids for the lines being added, so they cannot collide with a line the
// plant already has. Heads keep their numbering — head 3 is head 3 on the
// machine, and renumbering would break every record that names one.
export function withFreshIds(lines = [], now = Date.now()) {
  return lines.map((l, i) => ({ ...l, id: `line_${now}_${i}` }));
}

// How many heads are carrying an unresolved problem — the number worth showing
// before someone imports, because it is what they are inheriting.
export function openIssueCount(lines = []) {
  return lines.reduce((n, l) => n + (l.heads || []).filter((h) => {
    const issues = h.issues || [];
    if (h.status === 'offline') return true;
    return issues.some((i) => i.fixed !== 'fixed');
  }).length, 0);
}

export default { planImport, cleanLineForImport, withFreshIds, openIssueCount };
