// src/utils/pin.js
//
// PINs for the plant's own people.
//
// What this is and is not
// -----------------------
// A 4–6 digit PIN is a low-entropy secret. Hashing it does NOT make it strong —
// anyone who can read the roster document can brute-force a 4-digit hash in
// milliseconds. What hashing buys is that the PIN is not sitting in plain text
// where a screen-share, a support session, or an export would expose it, and
// that one plant's hashes cannot be replayed at another.
//
// It is the right strength for what it does: distinguishing Dana from Luis on a
// shared tablet. It is NOT an access-control boundary — that stays with the
// Firebase login and the Firestore rules, which is what actually keeps one
// customer out of another's data.
//
// Salted with customer + person id so the same PIN yields different hashes for
// different people, and a hash lifted from one plant means nothing at another.

const enc = new TextEncoder();

const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPin(customerId, personId, pin) {
  const salted = `ccw-pin:${customerId}:${personId}:${String(pin).trim()}`;
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(salted)));
}

export async function verifyPin(customerId, person, pin) {
  if (!person?.pinHash) return false;
  const candidate = await hashPin(customerId, person.id, pin);
  // Length-independent compare is pointless against a local attacker who has
  // the hash anyway; plain equality is honest here.
  return candidate === person.pinHash;
}

export const hasPin = (person) => !!person?.pinHash;

// Digits only, 4–6. Short enough to type at a machine, long enough that a
// shoulder-surfed guess isn't automatic.
export function pinProblem(pin) {
  const v = String(pin || '').trim();
  if (!/^\d+$/.test(v)) return 'PIN must be digits only';
  if (v.length < 4) return 'PIN must be at least 4 digits';
  if (v.length > 6) return 'PIN must be at most 6 digits';
  if (/^(\d)\1+$/.test(v)) return 'That PIN is too easy to guess';
  if ('0123456789'.includes(v) || '9876543210'.includes(v)) return 'That PIN is too easy to guess';
  return null;
}

export default { hashPin, verifyPin, hasPin, pinProblem };
