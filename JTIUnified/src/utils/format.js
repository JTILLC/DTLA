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
export const jobAmount = (job) => {
  const actual = parseFloat(job?.actual || 0);
  const quote = parseFloat(job?.quote || 0);
  return actual > 0 ? actual : quote;
};

// Total billable income across jobs, optionally restricted to paid jobs.
export const sumIncome = (jobs, { paidOnly = false } = {}) =>
  (jobs || []).reduce((sum, job) => {
    if (paidOnly && !isPaid(job.paid)) return sum;
    return sum + jobAmount(job);
  }, 0);

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
  return `$${parseFloat(amount).toLocaleString()}`;
};

// Locale date string from a Firestore Timestamp / Date / parseable string.
export const formatDate = (date) => {
  if (!date) return 'N/A';
  const d = date?.toDate?.() || new Date(date);
  return d.toLocaleDateString();
};
