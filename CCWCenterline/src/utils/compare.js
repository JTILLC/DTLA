// Comparing two centerlines.
//
// This is what a centerline is FOR. Having written down what a machine should
// be set to, the question that matters later is what has moved since — after a
// rebuild, after a shift that "adjusted something", after a month of running.
//
// The comparison is deliberately conservative. Where two values differ at all
// once obvious noise is removed, it says they differ and lets the engineer
// judge; it does not decide that 90 and 90.0 are the same number, because on a
// panel whose display format is fixed, a reading of "90" where "90.0" was
// recorded means the two readings really were different.

import { normalizeLabel } from './centerline';

/**
 * A value reduced to what two recordings of the same setting should share.
 *
 * Case and spacing are noise: one path types "Off", another reads "off", a
 * third writes "0.30 g" where the screen shows "0.30g". None of those is drift.
 * Digits, letters and punctuation are all kept.
 */
export const normalizeValue = (value) =>
  String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();

/** A stable identity for a setting: which screen it was on, and its name. */
const keyOf = (row) => `${normalizeLabel(row.section)}::${normalizeLabel(row.label)}`;

export const CHANGED = 'changed';
export const ONLY_A = 'only-a';
export const ONLY_B = 'only-b';
export const SAME = 'same';

/**
 * Compare two sets of settings rows (as `settingsTable` produces them).
 *
 * Returns every setting once, classified. Order is deliberate: what changed
 * first, then what each side has that the other does not, then what held. The
 * first of those is the answer to the question actually being asked, and it
 * should not have to be hunted for below two hundred unchanged rows.
 */
export function compareSettings(rowsA, rowsB) {
  const a = new Map();
  const b = new Map();
  for (const row of rowsA || []) a.set(keyOf(row), row);
  for (const row of rowsB || []) b.set(keyOf(row), row);

  const changed = [];
  const onlyA = [];
  const onlyB = [];
  const same = [];

  // Walk A in its own order, then anything of B's that A never had, so the
  // result reads in document order rather than in hash order.
  for (const [key, rowA] of a) {
    const rowB = b.get(key);
    if (!rowB) {
      onlyA.push({ status: ONLY_A, section: rowA.section, label: rowA.label,
        a: rowA.value, b: null });
      continue;
    }
    const entry = { section: rowA.section, label: rowA.label, a: rowA.value, b: rowB.value };
    if (normalizeValue(rowA.value) === normalizeValue(rowB.value)) {
      same.push({ ...entry, status: SAME });
    } else {
      changed.push({ ...entry, status: CHANGED });
    }
  }
  for (const [key, rowB] of b) {
    if (a.has(key)) continue;
    onlyB.push({ status: ONLY_B, section: rowB.section, label: rowB.label,
      a: null, b: rowB.value });
  }

  return {
    changed,
    onlyA,
    onlyB,
    same,
    // A single number for "is this machine where we left it?".
    differences: changed.length + onlyA.length + onlyB.length,
    identical: changed.length === 0 && onlyA.length === 0 && onlyB.length === 0,
  };
}

/** How a centerline should be named when picking one to compare. */
export const centerlineLabel = (centerline) =>
  [centerline?.customer, centerline?.product, centerline?.date]
    .filter(Boolean).join(' · ') || 'Untitled centerline';

/**
 * The comparison as CSV.
 *
 * Both sides are named in the header. A column of "before" and "after" figures
 * with no record of which centerline each came from is worse than useless — it
 * looks authoritative and cannot be checked.
 */
export function comparisonCsv(left, right, result) {
  const field = (value) => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [];
  lines.push(field('Centerline comparison — target settings, not a record of running values'));
  lines.push(['A', centerlineLabel(left)].map(field).join(','));
  lines.push(['B', centerlineLabel(right)].map(field).join(','));
  lines.push(['Differences', result.differences].map(field).join(','));
  lines.push('');
  lines.push(['Status', 'Screen', 'Setting', 'A', 'B'].map(field).join(','));
  const label = { [CHANGED]: 'Changed', [ONLY_A]: 'Only in A', [ONLY_B]: 'Only in B', [SAME]: 'Same' };
  for (const row of [...result.changed, ...result.onlyA, ...result.onlyB, ...result.same]) {
    lines.push([label[row.status], row.section, row.label,
      row.a ?? '', row.b ?? ''].map(field).join(','));
  }
  return lines.join('\r\n');
}

export const comparisonFileName = (left, right) => {
  const part = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '');
  return `Compare_${part(left?.customer) || 'A'}_${left?.date || ''}_vs_${right?.date || ''}.csv`
    .replace(/_+/g, '_');
};
