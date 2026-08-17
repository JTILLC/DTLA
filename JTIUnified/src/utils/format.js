// Shared formatting / predicate helpers used across the dashboard and data layer.

// Check if a job is paid (handles boolean, number, and the various string
// spellings that show up in the imported job data).
export const isPaid = (paidValue) => {
  if (paidValue === true || paidValue === 1) return true;
  if (typeof paidValue === 'string') {
    const lower = paidValue.toLowerCase().trim();
    return lower === 'yes' || lower === 'true' || lower === '1' || lower === 'paid';
  }
  return false;
};

// The billable amount for a job: prefer the actual cost once it's known,
// otherwise fall back to the quote. This is the single source of truth for the
// dashboard's income math.
/**
 * Money as people type it, as a number.
 *
 * The amounts in the Jobs Tracker are free text, so they arrive as "4200",
 * "4,200", "$4,200" and "12,500.50". parseFloat reads the first of those and
 * mangles the rest: "4,200" is 4, "12,500.50" is 12, and "$4,200" is NaN —
 * which then poisons whatever total it is added to.
 *
 * So every job whose amount carried a comma has been counting as single digits
 * in the income figures, and one carrying a dollar sign would have turned the
 * whole total into NaN.
 */
export const parseMoney = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

export const jobAmount = (job) => {
  const actual = parseMoney(job?.actual);
  const quote = parseMoney(job?.quote);
  return actual > 0 ? actual : quote;
};

// sumIncome lives in payments.js now: what counts as income depends on what
// was received, and that would have made this file import the module that
// imports it. A cycle here is a live hazard rather than a tidiness question —
// whichever module evaluated second would see the other's exports undefined.

// Compact "time ago" used by the activity feed / dashboard.
export const formatRelativeTime = (date) => {
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// "$1,234" or 'N/A'
export const formatCurrency = (amount) => {
  if (!amount) return 'N/A';
  return `$${parseMoney(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

// Locale date string from a Firestore Timestamp / Date / parseable string.
/**
 * A stored date as a LOCAL Date.
 *
 * A bare "2026-08-02" is parsed by JS as UTC midnight, which in Arizona is 5pm
 * the previous day — so every date typed into a date input rendered a day
 * early. Date-only strings carry no timezone and mean the day somebody wrote
 * down, so they are built as local rather than handed to the UTC parser. A full
 * timestamp does carry a zone and is left alone.
 */
export const asLocalDate = (date) => {
  if (date?.toDate) return date.toDate();
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(date);
};

export const formatDate = (date) => {
  if (!date) return 'N/A';
  return asLocalDate(date).toLocaleDateString();
};
