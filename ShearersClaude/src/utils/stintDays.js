export const sortAsc = (arr) => [...(arr || [])].sort((a, b) => new Date(a) - new Date(b));

// Format a free-text day label for display. A bare number becomes "Day 4" so
// the common case is one keystroke, while anything else (e.g. "PM shift") is
// shown exactly as typed — that flexibility is the whole point of free text.
export function formatDayLabel(label) {
  const t = (label || '').trim();
  if (!t) return '';
  return /^\d{1,2}$/.test(t) ? `Day ${t}` : t;
}
