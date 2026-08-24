// shared/utils/superUser.js
//
// The JTI account that is never asked for a plant PIN.
//
// PINs answer one question: which of the plant's own people is holding this
// tablet. A JTI engineer signed in on their own laptop is not one of them and
// never will be — there is no row on the crew list to pick and no PIN to type,
// so the prompt is a dead end that has to be worked around by borrowing
// somebody else's name. Borrowed names are exactly what the PIN exists to
// prevent, so the bypass makes the log MORE honest, not less: the entry is
// stamped with the JTI account that actually did it.
//
// Scope, deliberately narrow:
//   * it skips the "who are you?" prompt and the role gates in front of it;
//   * it does NOT touch the Firestore rules or the media broker, which is where
//     access is actually decided. A PIN was never an access boundary (see
//     pin.js) — it is attribution — so removing it removes no protection.
//
// Keyed on the signed-in email rather than on a flag in the data, because the
// bypass must hold on the very first screen, before any customer document has
// loaded, and because a list of two lines that lives in the source is auditable
// by reading it.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import { useEffect, useState } from 'react';

// JTI accounts that outrank every plant role. Lower-case; compared lower-cased.
export const SUPER_ADMIN_EMAILS = ['josh@jtiaz.com'];

export const isSuperAdminEmail = (email) =>
  SUPER_ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());

// The shape the rest of the app expects a "verified person" to have, built from
// a Firebase user.
//
// `id` is prefixed so it can never collide with a crew id: a crew lookup for it
// finds nobody, which is the right answer — a JTI account is not on the roster,
// so the line-assignment rules treat it as unrestricted rather than as an
// operator pinned to somebody else's lines.
//
// `siteLead` and the roles are what make the tier checks pass. JTI sits above
// the plant's own top role, so it is given that role's reach rather than a new
// tier nothing knows how to compare.
export function superPersonFor(user) {
  if (!user || !isSuperAdminEmail(user.email)) return null;
  return {
    id: `jti:${user.uid || user.email}`,
    name: user.displayName || user.email,
    email: user.email,
    isSuper: true,
    siteLead: true,
    roles: ['operator', 'tech', 'supervisor'],
  };
}

// Whoever is signed in RIGHT NOW, if they are a super admin.
//
// Read from Firebase rather than passed in, so a gate buried three components
// deep does not need a prop threaded to it from the top of the app. Wrapped
// because this module is imported by code that runs in tests with no Firebase
// app initialised, where the honest answer is "no super admin".
export function getSuperUser() {
  try {
    if (!firebase.apps?.length) return null;
    return superPersonFor(firebase.auth().currentUser);
  } catch {
    return null;
  }
}

/**
 * The super admin as React state — null when nobody, or when whoever is signed
 * in is not one.
 *
 * Subscribed rather than read once: the first render of the app happens before
 * Firebase has restored the session, so a one-shot read says "nobody" and never
 * corrects itself.
 */
export function useSuperUser() {
  const [superUser, setSuperUser] = useState(() => getSuperUser());

  useEffect(() => {
    let unsub = () => {};
    try {
      if (!firebase.apps?.length) return undefined;
      unsub = firebase.auth().onAuthStateChanged((u) => {
        const next = superPersonFor(u);
        // Compared by id so the object identity only changes when the ACCOUNT
        // does. Effects downstream depend on this value; a fresh object every
        // auth tick would re-run all of them for no reason.
        setSuperUser((prev) => (prev?.id === next?.id ? prev : next));
      });
    } catch {
      return undefined;
    }
    return () => unsub();
  }, []);

  return superUser;
}

export default { SUPER_ADMIN_EMAILS, isSuperAdminEmail, superPersonFor, getSuperUser, useSuperUser };
