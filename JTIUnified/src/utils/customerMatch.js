// src/utils/customerMatch.js
//
// Tying a customer NAME to the customer RECORD it belongs to.
//
// This app discovers customers by name: jobs, issues and timesheets each carry
// a free-typed customer string, and the list on screen is those strings pooled
// together. The address, contacts and invoice emails live somewhere else — on
// the customer document in the CCW database, which has a real id. Joining the
// two is therefore a name-matching problem, and name matching here has a
// history of going wrong in a specific way: plants get renamed. DatePac became
// Oasis Date. B&G Foods became Seneca Foods. Nothing in either name says they
// are the same plant.
//
// So this matches EXACTLY (after normalising punctuation and legal suffixes) or
// through a rename somebody has recorded. It never matches on "looks similar"
// and never on substrings — "Seneca" would otherwise swallow "Seneca Foods",
// and the cost of a wrong join is one plant's address and invoice addresses
// shown against another's name.
//
// When there is no match the answer is null, and the screen asks somebody to
// link it. A person picking from a list is more reliable than a guess, and the
// pick is stored so it is only ever asked once.

/** Legal suffixes only. Industry words ("Foods", "Farms") distinguish real
 *  companies from each other and must survive. */
const LEGAL_SUFFIX = /\b(inc|llc|llp|ltd|co|corp|corporation|company)\b/g;

/**
 * A name reduced to the part worth comparing: case, punctuation, spacing and
 * the legal suffix removed. "B & G Foods, Inc." and "B&G Foods" agree here.
 */
export const normalizeCustomerName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Apostrophes are removed rather than spaced: a possessive is part of the
    // word, so "Shearer's Foods" and "Shearers Foods" are one plant, while
    // spacing them would leave "shearer s foods" matching neither.
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Plants that changed name. The authoritative place for this is the customer
 * record's own alias list, which anybody can edit from the app — this is a
 * starting set for renames already known, so the two that have caused trouble
 * are joined without somebody having to notice and fix them first.
 */
export const KNOWN_FORMER_NAMES = {
  'datepac': 'oasis date',
  'b and g foods': 'seneca foods',
};

/** Every name a record answers to: its own, plus any recorded alias. */
export const namesFor = (record) => {
  const names = [record?.name, ...(record?.profile?.aliases || record?.aliases || [])];
  return names.map(normalizeCustomerName).filter(Boolean);
};

/**
 * The record this name belongs to, or null.
 *
 * `records` is [{ id, name, profile }] straight from the customer collection.
 * Null is a real answer — it means "ask somebody", not "give up".
 */
export const matchCustomer = (name, records = []) => {
  const target = normalizeCustomerName(name);
  if (!target) return null;

  const exact = records.find((r) => namesFor(r).includes(target));
  if (exact) return exact;

  // The same name typed differently — truncated, pluralised, or missing a
  // space. Never a name with a word missing; see sameCustomerName.
  const spelled = records.find((r) => namesFor(r).some((n) => sameCustomerName(n, target)));
  if (spelled) return spelled;

  // A former name maps forward to what the plant is called now.
  const renamed = KNOWN_FORMER_NAMES[target];
  if (renamed) {
    const byRename = records.find((r) => namesFor(r).includes(renamed));
    if (byRename) return byRename;
  }

  // ...and the reverse, so searching the CURRENT name still finds a record
  // filed under the old one.
  const formerOf = Object.entries(KNOWN_FORMER_NAMES)
    .filter(([, now]) => now === target)
    .map(([was]) => was);
  for (const was of formerOf) {
    const byFormer = records.find((r) => namesFor(r).includes(was));
    if (byFormer) return byFormer;
  }

  return null;
};

/** Do these two names refer to the same plant? Same rules, no record needed. */
export const isSameCustomer = (a, b) => {
  const na = normalizeCustomerName(a);
  const nb = normalizeCustomerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return KNOWN_FORMER_NAMES[na] === nb || KNOWN_FORMER_NAMES[nb] === na;
};


/**
 * Two spellings of one name — as opposed to two plants.
 *
 * Sources truncate ("National Froz", "Trident Sea"), pluralise ("Oasis Date"
 * / "Oasis Dates") and lose spaces ("FoodPharma"). All three are the same
 * customer typed differently, and all three are safe to merge because the
 * DISTINGUISHING word is still there and still agrees.
 *
 * What is deliberately NOT here is the shorter name with FEWER words:
 * "Ajinomoto" against "Ajinomoto Portland", "Trident" against "Trident
 * Seafoods". A missing word is where the city lives, so merging those would be
 * the exact mistake this whole module exists to avoid — one plant's invoices
 * under another's name. Those stay apart until a person links them.
 */
export const sameCustomerName = (a, b) => {
  const na = normalizeCustomerName(a);
  const nb = normalizeCustomerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Spacing only: "Food Pharma" and "FoodPharma".
  if (na.replace(/\s/g, '') === nb.replace(/\s/g, '')) return true;

  const ta = na.split(' ');
  const tb = nb.split(' ');
  // Same number of words, differing only in the last, one a prefix of the
  // other: a truncated or pluralised tail. Three characters minimum, so "S"
  // does not swallow "Seafoods".
  if (ta.length !== tb.length) return false;
  if (ta.slice(0, -1).join(' ') !== tb.slice(0, -1).join(' ')) return false;
  const [la, lb] = [ta[ta.length - 1], tb[tb.length - 1]];
  const [short, long] = la.length <= lb.length ? [la, lb] : [lb, la];
  return short.length >= 3 && long.startsWith(short);
};

/**
 * Collapse the customer names found across jobs, issues and timesheets into one
 * entry per actual customer.
 *
 * The same plant reaches this app under several spellings — "Flagstone",
 * "Flagstone Foods", "flagstone_foods" — because each source has its own typed
 * or generated string. Showing all of them means picking one and seeing a third
 * of the plant's history.
 *
 * Two names are the same customer when they resolve to the same customer
 * RECORD, or, failing that, when they normalise identically. Both rules keep
 * sites apart on their own, which is the requirement that matters here: a city
 * or site on the end of a name is part of the name. "Ajinomoto Oakland" and
 * "Ajinomoto Portland" normalise differently and match different records, so
 * they never merge — and neither absorbs a bare "Ajinomoto", because nothing
 * says which plant that one meant. Same for "Shearers" and "Shearers Brewster".
 *
 * `entries` is [{ name, sources }]. Returns one entry per customer, named after
 * the record where there is one, carrying every spelling it stands for.
 */
export const consolidateCustomers = (entries = [], records = []) => {
  const groups = new Map();

  entries.forEach((entry) => {
    const name = String(entry?.name || '').trim();
    if (!name) return;
    const record = matchCustomer(name, records);
    // The record is the identity when there is one; otherwise the normalised
    // name is, which merges spellings without ever merging two locations.
    let key = record ? `rec:${record.id}` : `name:${normalizeCustomerName(name)}`;
    // No record to anchor it: fold in with an existing unanchored group whose
    // name is the same name typed differently.
    if (!record) {
      for (const [k, g] of groups) {
        if (k.startsWith('name:') && g.variants.some((v) => sameCustomerName(v, name))) { key = k; break; }
      }
    }

    if (!groups.has(key)) {
      groups.set(key, {
        name: record?.name || name,
        recordId: record?.id || null,
        variants: [],
        sources: [],
      });
    }
    const group = groups.get(key);
    if (!group.variants.includes(name)) group.variants.push(name);
    (entry.sources || []).forEach((s) => { if (!group.sources.includes(s)) group.sources.push(s); });
    // Prefer the record's name; failing that the longest spelling, which is the
    // one that reads like a company rather than a database key.
    if (!group.recordId && name.length > group.name.length) group.name = name;
  });

  return [...groups.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
};

/**
 * Would linking these two put two different sites under one record?
 *
 * True when one name is the other plus extra words — "Ajinomoto" against
 * "Ajinomoto Portland", "Shearers" against "Shearers Brewster". Not a refusal:
 * plants really are called "Flagstone" and "Flagstone Foods". It is the
 * difference between a link somebody meant and one worth asking about first.
 */
export const looksLikeADifferentSite = (name, recordName) => {
  const a = normalizeCustomerName(name).split(' ').filter(Boolean);
  const b = normalizeCustomerName(recordName).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length === longer.length) return false;
  return shorter.every((tok, i) => longer[i] === tok);
};

export default {
  normalizeCustomerName, matchCustomer, isSameCustomer, namesFor,
  consolidateCustomers, looksLikeADifferentSite, sameCustomerName, KNOWN_FORMER_NAMES,
};
