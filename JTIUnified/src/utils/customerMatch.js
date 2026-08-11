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

export default { normalizeCustomerName, matchCustomer, isSameCustomer, namesFor, KNOWN_FORMER_NAMES };
