// shared/utils/customerDefaults.js
//
// The customer record, in the shape a timesheet wants it.
//
// A technician filling in a timesheet retypes the same eight fields for the
// same plant every visit — company, contact, address, city, state, phone,
// email, and the mileage — and gets one of them slightly wrong often enough
// that the same plant appears under three spellings. All of it is already on
// the customer record. This is the translation between the two shapes, in one
// place, so the timesheet does not have to know how a customer record is laid
// out and the record does not have to be stored the way a timesheet wants it.
//
// The rule throughout: return '' rather than undefined for a field with no
// value. A form bound to undefined becomes an uncontrolled input and React
// complains at it; '' just shows an empty box, which is the truth anyway.

/**
 * "Yuma, AZ" → { city: 'Yuma', state: 'AZ' }.
 *
 * Stored as one line because that is how an address is written and how CCW has
 * always kept it, but a timesheet has separate boxes. Splitting on the last
 * comma handles "Kansas City, MO" — splitting on the first would give the state
 * as "MO" and the city as "Kansas".
 */
export const splitCityState = (cityState) => {
  const raw = String(cityState || '').trim();
  if (!raw) return { city: '', state: '' };
  const at = raw.lastIndexOf(',');
  if (at === -1) {
    // No comma: a bare two-letter token is a state, anything else is a city.
    return /^[A-Za-z]{2}$/.test(raw) ? { city: '', state: raw.toUpperCase() } : { city: raw, state: '' };
  }
  return {
    city: raw.slice(0, at).trim(),
    state: raw.slice(at + 1).trim().toUpperCase(),
  };
};

/**
 * The contact a timesheet should name.
 *
 * The first contact with a name wins, unless one is marked primary. Plants list
 * a maintenance manager and three others, and the first is the one somebody
 * bothered to enter first — which is the closest thing to a signal there is.
 */
export const primaryContact = (contacts = []) => {
  const usable = contacts.filter((c) => c && (c.name || c.phone || c.email));
  return usable.find((c) => c.primary) || usable[0] || null;
};

/**
 * Everything a timesheet needs about a customer, ready to drop into its form.
 *
 * `miles` is the round trip somebody has agreed for this plant. It is a
 * default, not a rule — a job run from a different starting point has different
 * mileage, and the timesheet must let it be overwritten.
 */
export const customerDefaults = (record) => {
  const p = record?.profile || {};
  const { city, state } = splitCityState(p.cityState);
  const contact = primaryContact(p.contacts);
  return {
    company: record?.name || '',
    contact: contact?.name || '',
    phone: contact?.phone || '',
    email: contact?.email || '',
    address: p.address || '',
    city,
    state,
    miles: p.miles === 0 || p.miles ? String(p.miles) : '',
    // Standing invoice terms for this plant ("Net 30"). Belongs to the
    // customer, not the job, so it is the same on every invoice we raise.
    paymentTerms: p.paymentTerms || '',
    // Deliberately not defaulted: what a visit was FOR changes every time, and
    // a pre-filled purpose is one somebody forgets to correct.
    purpose: '',
  };
};

/** Which of these a record cannot supply — for telling somebody what to fill in. */
export const missingDefaults = (record) => {
  const d = customerDefaults(record);
  return [
    !d.address && !d.city ? 'address' : null,
    !d.contact ? 'contact' : null,
    !d.phone && !d.email ? 'phone or email' : null,
    !d.miles ? 'mileage' : null,
  ].filter(Boolean);
};

export default { customerDefaults, splitCityState, primaryContact, missingDefaults };
