// shared/utils/lineAccess.js
//
// Which lines a person may file against.
//
// A supervisor ticks the lines each person is responsible for, and entries
// against any other line need a supervisor standing there to authorise them.
//
// WHAT THIS IS: a guardrail against filing work on the wrong line — the mistake
// that actually happens on a plant floor with eight lines and a shared tablet.
//
// WHAT IT IS NOT: a security boundary. The tablet signs in as one Firebase
// account for the whole plant, so the database rules authenticate the ACCOUNT,
// not the person; and a PIN is hashed on the client. Anyone who opens devtools
// can get past this. Enforcing it properly would need a login per person, or a
// server-side check, and neither is what this is.
//
// Two deliberate escapes, both because a record of work that was genuinely done
// must never be impossible to file:
//
//   * nobody ticked = every line. A plant that has not set this up is
//     unaffected, exactly as a plant with no PINs still logs freely.
//   * a supervisor can authorise anything, on the spot, and the entry records
//     that they did.

export const isSupervisor = (person) => (person?.roles || []).includes('supervisor');

// Roles that are never pinned to particular lines.
//
// Maintenance goes wherever the fault is — that is the job. Restricting a tech
// to a line would stop the one person qualified to put a head back on from
// doing it, which is the opposite of the point. Supervisors are unrestricted
// because they can authorise anyone else anyway.
const UNRESTRICTED_ROLES = ['supervisor', 'tech'];
export const hasFreeRoam = (person) =>
  (person?.roles || []).some((r) => UNRESTRICTED_ROLES.includes(r));

// The lines a person is pinned to. An empty list means "no restriction", not
// "no lines" — the difference matters, and reading it the other way would lock
// out every plant that never opened the screen.
export const personLines = (person) =>
  (Array.isArray(person?.lines) ? person.lines : []).filter(Boolean);

export const isRestricted = (person) => personLines(person).length > 0;

// The full crew record for whoever is currently acting.
//
// useVerifiedPerson only remembers { id, name } — enough to stamp an entry, not
// enough to judge one. Roles and line assignments live on the crew record, so
// the two have to be joined before any decision is made.
export function resolvePerson(people, actor) {
  if (!actor?.id) return null;
  return (people || []).find((p) => p.id === actor.id) || null;
}

// May this person file against this line?
export function mayEditLine(person, lineTitle) {
  // No identified actor — a plant that has not set PINs. Unchanged behaviour:
  // logging is never blocked by an identity nobody was asked for.
  if (!person) return true;
  if (hasFreeRoam(person)) return true;
  if (!isRestricted(person)) return true;
  // Machine-level entries carry no line (a main board, a power supply). There
  // is no line to be wrong about, so there is nothing to guard.
  if (!lineTitle) return true;
  return personLines(person).includes(lineTitle);
}

// Why a save was stopped, in words meant for whoever is holding the tablet.
export function refusalMessage(person, lineTitle) {
  const who = person?.name || 'This person';
  const mine = personLines(person);
  return `${who} isn't assigned to ${lineTitle}.`
    + (mine.length ? ` Assigned to ${mine.join(', ')}.` : '');
}

// What gets written onto an entry that a supervisor let through. Kept together
// so every log stamps an override the same way and a reader can always tell an
// authorised entry from an ordinary one.
export function overrideStamp(supervisor, lineTitle) {
  if (!supervisor) return {};
  return {
    authorisedBy: supervisor.name || '',
    authorisedById: supervisor.id || '',
    authorisedAt: new Date().toISOString(),
    authorisedForLine: lineTitle || '',
  };
}

export default {
  isSupervisor, personLines, isRestricted, resolvePerson,
  mayEditLine, refusalMessage, overrideStamp,
};
