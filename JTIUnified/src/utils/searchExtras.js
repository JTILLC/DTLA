// src/utils/searchExtras.js
//
// The two things the one search box could not find: job packets and the
// customer directory.
//
// Search already covered jobs, issues, timesheets, head history, parts, boards
// and diagrams — but not the receipts and packets added later, and not the
// customer records that hold the addresses and AP emails. So the box that was
// meant to be "type anything, find it" quietly did not know about a receipt
// from Shell or the invoice address for Flagstone.
//
// Both take the caller's `matches` predicate rather than doing their own
// comparing, so "WH1" finding "WH 1" and "100-689" finding "100689" work here
// exactly as they do everywhere else in the box.

/** Fields worth reporting a hit on, as [label, value] pairs. */
const hits = (pairs, matches) => pairs
  .filter(([, v]) => v != null && v !== '' && matches(v))
  .map(([field, value]) => ({ field, value: String(value) }));

/**
 * Packets and the receipts inside them.
 *
 * A packet matches on its own number and notes, and on anything about a file it
 * holds — the vendor read off a receipt, the expense type, the filename. The
 * matching file is named in the result: "2026024 — Shell" is useful, "2026024"
 * on its own sends somebody hunting.
 */
export const matchPackets = (packets = [], matches = () => false) => {
  const out = [];
  [...packets].forEach((p) => {
    if (!p) return;
    const files = p.files || [];
    const own = hits([['Service report', p.sr || p.id], ['Notes', p.notes]], matches);

    const fileHits = [];
    files.forEach((f) => {
      const fh = hits([
        ['File', f.name], ['Vendor', f.vendor], ['Type', f.category], ['Amount', f.amount],
      ], matches);
      if (fh.length) fileHits.push({ name: f.name, kind: f.kind, vendor: f.vendor || '', category: f.category || '', amount: f.amount ?? null, matches: fh });
    });

    if (!own.length && !fileHits.length) return;
    out.push({
      kind: 'packet',
      sr: String(p.sr || p.id || ''),
      fileCount: files.length,
      builtAt: p.builtAt || null,
      sentAt: p.sentAt || null,
      matches: own,
      files: fileHits,
    });
  });
  return out;
};

/**
 * The customer directory — name, address, contacts, invoice emails.
 *
 * Searching a contact's name or an AP email address should find the customer
 * they belong to; that is most of why the directory exists.
 */
export const matchCustomerRecords = (records = [], matches = () => false) => {
  const out = [];
  [...records].forEach((r) => {
    if (!r) return;
    const p = r.profile || {};
    const found = hits([
      ['Name', r.name], ['Address', p.address], ['City', p.city], ['State', p.state],
      ['Phone', p.phone], ['Notes', p.notes],
    ], matches);

    (p.contacts || []).forEach((c) => {
      found.push(...hits([
        ['Contact', c?.name], ['Contact email', c?.email],
        ['Contact phone', c?.phone], ['Role', c?.role],
      ], matches));
    });
    (p.invoiceEmails || []).forEach((e) => {
      found.push(...hits([['Invoice email', e]], matches));
    });

    if (!found.length) return;
    out.push({
      kind: 'customer',
      name: r.name || '',
      city: p.city || '',
      state: p.state || '',
      matches: found,
    });
  });
  return out;
};

export default { matchPackets, matchCustomerRecords };
