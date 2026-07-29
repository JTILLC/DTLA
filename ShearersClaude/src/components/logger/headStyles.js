// src/components/logger/headStyles.js
// Status tint helpers + the memo comparator shared by HeadRow and HeadCard.

// Stronger fill for table rows.
export const rowTint = (h) => {
  if (h.offline === 'Active') return 'bg-green-100 dark:bg-green-900/30';
  const issues = h.issues || [];
  if (issues.some((i) => i.type === 'WDU Replacement')) return 'bg-purple-100 dark:bg-purple-900/30';
  if (issues.length > 0 && issues.every((i) => i.repaired === 'Fixed')) return 'bg-orange-100 dark:bg-orange-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
};

// Softer tint + border for cards (mobile).
export const cardTint = (h) => {
  if (h.offline === 'Active') return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700';
  const issues = h.issues || [];
  if (issues.some((i) => i.type === 'WDU Replacement')) return 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700';
  if (issues.length > 0 && issues.every((i) => i.repaired === 'Fixed')) return 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700';
  return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700';
};

// Custom React.memo comparator: re-render a head only when its own data
// (or its callbacks) actually change — not on every parent edit. The parent
// preserves object identity for unchanged head objects, so comparing the
// meaningful fields lets unchanged heads skip re-rendering entirely.
export const headPropsEqual = (a, b) =>
  a.date === b.date &&
  a.currentLine === b.currentLine &&
  a.repeatCount === b.repeatCount &&
  a.repeatTitle === b.repeatTitle &&
  a.onUpdateField === b.onUpdateField &&
  a.onOpenHistory === b.onOpenHistory &&
  a.head.head === b.head.head &&
  a.head.offline === b.head.offline &&
  a.head.notes === b.head.notes &&
  a.head.issues === b.head.issues;
