// src/utils/backupStatus.js
//
// Reading last night's manifest as an answer to "did the backup run".
//
// The nightly job has been writing a manifest next to every dump since it was
// built, and nothing read it. The only way to see a backup happen was to press
// the button, which proves the machinery works and says nothing about whether
// the scheduled run did — the one thing you actually want to know.
//
// Two rules the wording follows, because a backup page that overstates itself
// is worse than no page:
//   - Silence is never success. No manifest, an unreadable one, or one too old
//     reads as a problem, not as "fine".
//   - A run that half worked says so. Three apps out of four is a failure with
//     a comforting shape.

/** Hours after which a nightly job that runs at 02:00 is overdue, not late. */
const STALE_HOURS = 36;

/** "3 hours ago" / "yesterday" / "6 days ago" — enough to judge, no clock maths. */
export function ago(then, now = Date.now()) {
  const at = typeof then === 'number' ? then : Date.parse(then || '');
  if (!Number.isFinite(at)) return 'at an unknown time';
  const mins = Math.round((now - at) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * Whether a manifest describes a scheduled run.
 *
 * `trigger` was added when this page was built, so manifests written before it
 * do not carry one. They can still be told apart: a run narrowed to one project
 * skips pruning and says so, and only the cron runs unnarrowed. Without this
 * fallback the page would report "never backed up" on the day it shipped, over
 * a month of backups that had run perfectly.
 */
const isNightly = (m) => (m?.trigger ? m.trigger === 'nightly' : !m?.retention?.skipped);

/** The most recent scheduled run, from either copy of the manifest. */
export function pickNightly(payload) {
  if (payload?.nightly) return payload.nightly;
  return isNightly(payload?.latest) ? payload.latest : null;
}

/**
 * The manifest, judged.
 *
 * @param payload what /admin/backup-status answered: { nightly, latest, error }
 * @returns { tone: 'ok'|'warn'|'bad', headline, detail, at, apps }
 */
export function backupStatus(payload, now = Date.now()) {
  if (!payload) {
    return { tone: 'bad', headline: 'Backup status unknown', detail: 'Nothing answered.', apps: [] };
  }
  if (payload.error) {
    return { tone: 'bad', headline: 'Could not check the backup', detail: payload.error, apps: [] };
  }

  const m = pickNightly(payload);
  if (!m) {
    return {
      tone: 'bad',
      headline: 'No nightly backup on record',
      detail: 'The scheduled job has not written a manifest. Until it does, the only copies are the ones taken by hand.',
      apps: [],
    };
  }

  const at = Date.parse(m.finishedAt || m.startedAt || '');
  const results = Array.isArray(m.results) ? m.results : [];
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const okResults = results.filter((r) => r.ok);
  const documents = results.reduce((s, r) => s + (Number(r.documents) || 0), 0);
  // A run that stopped early wrote a partial copy. It reports ok, because what
  // it wrote is real, but it is not a complete night.
  const truncated = okResults.filter((r) => r.truncated);
  const hours = Number.isFinite(at) ? (now - at) / 3600000 : Infinity;
  const stale = hours > STALE_HOURS;
  const when = ago(at, now);

  const apps = results.map((r) => ({
    name: r.name,
    state: r.ok ? 'ok' : r.skipped ? 'skipped' : 'failed',
    note: r.ok
      ? `${(Number(r.documents) || 0).toLocaleString()} documents${r.truncated ? ` — stopped early (${r.truncated})` : ''}`
      : (r.reason || r.error || ''),
  }));

  const counts = `${okResults.length} of ${results.length} apps · ${documents.toLocaleString()} documents`;

  if (failed.length) {
    return {
      tone: 'bad',
      headline: `${failed.length} of ${results.length} apps failed to back up ${when}`,
      detail: `${failed.map((r) => r.name).join(', ')} — the rest were written to ${m.day}.`,
      at, apps,
    };
  }
  if (stale) {
    return {
      tone: 'bad',
      headline: `Last nightly backup ran ${when}`,
      detail: `It should run every night at 02:00 Arizona time. ${counts} on ${m.day}.`,
      at, apps,
    };
  }
  if (truncated.length || skipped.length) {
    const why = [
      truncated.length ? `${truncated.map((r) => r.name).join(', ')} stopped early` : '',
      skipped.length ? `${skipped.map((r) => r.name).join(', ')} skipped` : '',
    ].filter(Boolean).join('; ');
    return {
      tone: 'warn',
      headline: `Backed up ${when}, not completely`,
      detail: `${why}. ${counts} on ${m.day}.`,
      at, apps,
    };
  }
  return {
    tone: 'ok',
    headline: `Backed up ${when}`,
    detail: `${counts} on ${m.day}.`,
    at, apps,
  };
}

/**
 * The by-hand run, mentioned only when it is the more recent of the two.
 *
 * `latest.json` is overwritten by the button as well as by the cron, so it is
 * never the evidence that the schedule works — but seeing that somebody ran one
 * app an hour ago explains a page that otherwise looks contradictory.
 */
export function manualNote(payload, now = Date.now()) {
  const latest = payload?.latest;
  const nightly = pickNightly(payload);
  if (!latest || isNightly(latest)) return '';
  const at = Date.parse(latest.finishedAt || latest.startedAt || '');
  const nightlyAt = Date.parse(nightly?.finishedAt || nightly?.startedAt || '');
  if (Number.isFinite(nightlyAt) && Number.isFinite(at) && at <= nightlyAt) return '';
  const names = (latest.results || []).filter((r) => r.ok).map((r) => r.name);
  return `Also run by hand ${ago(at, now)}${names.length ? ` (${names.join(', ')})` : ''}.`;
}

export default { backupStatus, manualNote, pickNightly, ago };
