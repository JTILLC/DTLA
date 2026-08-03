// shared/utils/roles.js
//
// Who is what, in one place.
//
// "Admin" used to mean two unrelated things: a JTI account with access to every
// plant, and a crew member allowed to hand out PINs. The same word for a
// cross-customer superuser and for a shift lead is how someone eventually
// grants the wrong one.
//
// It now means exactly one thing — JTI — and it is never shown to a plant. The
// plant's own top role is the SITE LEAD.
//
//   JTI Staff    every plant. The `admin` claim / app_roles document. Not
//                represented here: it lives on the auth token and in the
//                security rules, deliberately out of reach of app code.
//   Site Lead    one plant. Manages the crew list, hands out PINs, decides who
//                is a supervisor.
//   Supervisor   leads crewing; authorises an entry against a line someone is
//                not assigned to.
//   Maintenance  any line, always — goes where the fault is.
//   Operator     the lines they are assigned to.

// The stored flag was `admin` before the rename. Both are read so that existing
// crew keep their access without a migration step, and the day the old field
// stops appearing in the data it can simply be deleted from here.
export const isSiteLead = (person) => !!(person?.siteLead ?? person?.admin);

// The label shown for that flag. Kept beside the predicate so a screen can
// never disagree with the check that governs it.
export const SITE_LEAD_LABEL = 'Site Lead';

export const ROLES = [
  { key: 'operator', label: 'Operator', help: 'Files against the lines they are assigned to.' },
  { key: 'tech', label: 'Maintenance', help: 'Any line, always — goes where the fault is.' },
  { key: 'supervisor', label: 'Supervisor', help: 'Leads crewing and authorises off-assignment entries.' },
];

export const roleLabel = (key) => ROLES.find((r) => r.key === key)?.label || key;

export default { isSiteLead, SITE_LEAD_LABEL, ROLES, roleLabel };
