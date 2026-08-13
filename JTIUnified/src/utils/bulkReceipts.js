// src/utils/bulkReceipts.js
//
// Working out which job each of a few hundred old receipts belongs to.
//
// The receipts are already organised by job — a folder or a filename says so —
// so this reads the job from the path rather than inferring it from anything.
// That distinction is the whole design: a receipt filed against the wrong
// service report is worse than one left unfiled, because it inflates one job's
// costs and understates another's, and nothing downstream can tell.
//
// So the rules are deliberately strict:
//   - a number is only accepted if it is a service report number this system
//     already knows. A folder called "2019" or an invoice number that happens
//     to have seven digits does not create a packet for a job that never
//     existed.
//   - the FOLDER wins over the filename. "2026024/receipt from 2026018.jpg" is
//     in the 2026024 folder because somebody put it there; the other number is
//     probably a note.
//   - anything unresolved is reported, not dropped and not guessed. Unassigned
//     is a legitimate resting state for a records import.

// Service report numbers look like 2026024 — a year then three digits.
//
// Bounded by "not a digit" rather than \b: "SR2026018" has no word boundary
// between the R and the 2, so \b missed exactly the naming people use. Digit
// boundaries still refuse a longer run of numbers, which is what keeps
// IMG_20260812_1422.jpg and invoice 998877 out.
const SR_PATTERN = /(?<![0-9])(20\d{2})[-_ ]?(\d{3})(?![0-9])/g;

/**
 * Every service-report-shaped number in a string, most specific first.
 *
 * Returns them normalised (2026-024 and "SR 2026024" both give 2026024) so the
 * caller compares like with like.
 */
export const candidateSrs = (text) => {
  const out = [];
  const s = String(text || '');
  SR_PATTERN.lastIndex = 0;
  let m = SR_PATTERN.exec(s);
  while (m) {
    out.push(`${m[1]}${m[2]}`);
    m = SR_PATTERN.exec(s);
  }
  return out;
};

/**
 * The job a file belongs to, from its path.
 *
 * `path` is the relative path when a folder was chosen (a/b/c.jpg), else just
 * the filename. Folder segments are searched from the deepest inwards, because
 * the folder a file sits in is a stronger statement than the folder above it.
 */
export const detectSr = (path, knownSrs = []) => {
  const known = new Set(knownSrs.map((s) => String(s).trim().toUpperCase()));
  const parts = String(path || '').split('/').filter(Boolean);
  const fileName = parts.pop() || '';

  // Deepest folder first, then outwards: .../2026024/fuel/x.jpg prefers 2026024
  // over anything higher up.
  for (const segment of [...parts].reverse()) {
    const hit = candidateSrs(segment).find((sr) => known.has(sr));
    if (hit) return hit;
  }
  // Only then the filename.
  return candidateSrs(fileName).find((sr) => known.has(sr)) || null;
};

/** Files this importer will accept. Anything else is reported, not silently dropped. */
export const IMPORTABLE = /\.(jpe?g|png|pdf)$/i;

/**
 * Turn a pile of files into a plan somebody can look at before anything is
 * uploaded.
 *
 * Nothing is written by this function. The point is that the whole import is
 * reviewable first: a mis-set folder should be caught while it is still a table
 * on screen, not after three hundred receipts have landed on the wrong jobs.
 */
export const planImport = (files = [], knownSrs = [], existingByS = {}) => {
  const matched = [];
  const unmatched = [];
  const skipped = [];

  [...files].forEach((file) => {
    const path = file.webkitRelativePath || file.name || '';
    if (!IMPORTABLE.test(path)) {
      skipped.push({ file, path, reason: 'not a JPEG, PNG or PDF' });
      return;
    }
    const sr = detectSr(path, knownSrs);
    if (!sr) {
      unmatched.push({ file, path });
      return;
    }
    // A second run of the same folder should not double every receipt.
    const already = (existingByS[sr] || []).some((f) => f.name === (file.name || '').replace(/[^A-Za-z0-9._-]/g, '_'));
    if (already) {
      skipped.push({ file, path, sr, reason: 'already on this job' });
      return;
    }
    matched.push({ file, path, sr });
  });

  return { matched, unmatched, skipped };
};

/** How the plan reads in one line, for somebody deciding whether to run it. */
export const summarise = ({ matched = [], unmatched = [], skipped = [] } = {}) => {
  const jobs = new Set(matched.map((m) => m.sr)).size;
  const bits = [`${matched.length} receipt${matched.length === 1 ? '' : 's'} across ${jobs} job${jobs === 1 ? '' : 's'}`];
  if (unmatched.length) bits.push(`${unmatched.length} with no job`);
  if (skipped.length) bits.push(`${skipped.length} skipped`);
  return bits.join(' · ');
};

export default { detectSr, candidateSrs, planImport, summarise, IMPORTABLE };
