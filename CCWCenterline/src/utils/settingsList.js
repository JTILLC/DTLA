// The plain list: every setting and its value, nothing else.
//
// The full centerline shows each RCU screen as the operator will see it, which
// is what makes it checkable against a live machine. But a lot of the time what
// somebody actually wants is the two columns — to paste into a spreadsheet, to
// diff against last month's, or to read down the phone. That is this.
//
// Same rows as the document's summary page, so the two can never disagree.

/**
 * Setting/value pairs, in document order, grouped by the screen they came from.
 *
 * `settingsTable` already drops anything without a value; this keeps that rule.
 * A setting that was never recorded does not belong on a list whose whole job is
 * to say what the machine should be set to.
 */
export function listRows(tableRows) {
  return (tableRows || []).map((row) => ({
    section: row.section,
    setting: row.label,
    value: String(row.value),
    source: row.source || '',
  }));
}

/** One CSV field, quoted only when it has to be. */
const csvField = (value) => {
  const text = String(value ?? '');
  // A setting name can genuinely contain a comma ("Disch.Priority Count" does
  // not, but "1:1Mix, standard" would), and a stray quote inside an unquoted
  // field silently truncates the row in Excel.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The list as CSV, for a spreadsheet.
 *
 * The header carries the machine and product, because a bare two-column file
 * detached from its centerline says what a machine should be set to without
 * saying WHICH machine — and these get emailed around.
 */
export function toCsv(centerline, tableRows) {
  const lines = [];
  lines.push(['Centerline — target settings, not a record of running values'].map(csvField).join(','));
  const facts = [
    ['Customer', centerline.customer], ['Plant', centerline.plant],
    ['Machine', centerline.machine], ['Line', centerline.line],
    ['Product', centerline.product], ['Preset', centerline.presetNo],
    ['Set by', centerline.engineer], ['Date', centerline.date],
  ].filter(([, v]) => v);
  for (const [label, value] of facts) lines.push([label, value].map(csvField).join(','));
  lines.push('');
  lines.push(['Screen', 'Setting', 'Value', 'Source'].map(csvField).join(','));
  for (const row of listRows(tableRows)) {
    lines.push([row.section, row.setting, row.value, row.source].map(csvField).join(','));
  }
  // CRLF: Excel on Windows is where these end up, and it is the one that cares.
  return lines.join('\r\n');
}

/** The list as plain text, for pasting into an email or reading out. */
export function toText(centerline, tableRows) {
  const rows = listRows(tableRows);
  const width = rows.reduce((w, r) => Math.max(w, r.setting.length), 0);
  const out = ['CENTERLINE — TARGET SETTINGS'];
  const who = [centerline.customer, centerline.plant, centerline.machine, centerline.line]
    .filter(Boolean).join(' · ');
  if (who) out.push(who);
  const what = [centerline.product, centerline.presetNo && `Preset ${centerline.presetNo}`,
    centerline.date].filter(Boolean).join(' · ');
  if (what) out.push(what);

  let current = null;
  for (const row of rows) {
    if (row.section !== current) {
      current = row.section;
      out.push('', current);
    }
    out.push(`  ${row.setting.padEnd(width)}  ${row.value}`);
  }
  return out.join('\n');
}

export const listFileName = (centerline, extension) => {
  const part = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '');
  return [
    'Settings',
    part(centerline.customer) || 'Machine',
    part(centerline.product),
    centerline.date,
  ].filter(Boolean).join('_') + '.' + extension;
};

/** Hand a built string to the browser as a file. */
export function downloadText(text, filename, mime = 'text/csv;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/** Hand bytes to the browser as a file. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not immediately: Safari has not started the
  // download by the time click() returns and gets an empty file if the URL is
  // already gone.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
