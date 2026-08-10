// shared/utils/screenAccess.js
//
// Which screens a plant's crew can open, by the PIN that is currently active.
//
// Nothing is hidden. Every tab stays where it was, and one that is above the
// active person's level asks for a PIN instead of opening — so an operator who
// needs Parts/Boards hands the tablet to maintenance, who key their own PIN and
// carry on. Hiding them would teach people the app is missing features and send
// them to find another way round; asking is a two-second handover that also
// records who actually did the thing.
//
// The tiers are cumulative — each one can open everything below it:
//
//   Operator     the shift's own work: what is running, what broke, pre-start,
//                span adjust.
//   Maintenance  the maintenance record too: parts and boards, PM, activity,
//                issue history, the crew list.
//   Supervisor   as maintenance. Distinguished for authorising, not for reach.
//   Site Lead    the plant's own top role. The things that change how the plant
//                itself is set up.
//
// JTI is not a tier here. A JTI account is not plant crew and is not subject to
// this at all — its limits are in the security rules, where they cannot be
// argued with by app code.

export const TIER = { operator: 0, tech: 1, supervisor: 2, siteLead: 3 };

/** Highest tier a crew member holds. -1 when they are nobody we know. */
export const tierOf = (person) => {
  if (!person) return -1;
  if (person.siteLead ?? person.admin) return TIER.siteLead;
  const roles = person.roles || [];
  if (roles.includes('supervisor')) return TIER.supervisor;
  if (roles.includes('tech')) return TIER.tech;
  if (roles.includes('operator')) return TIER.operator;
  // On the roster but carrying no role: treated as an operator rather than as
  // an unknown, because they are somebody the plant put there deliberately.
  return TIER.operator;
};

// Keyed by the tab's own id so a screen cannot drift from its rule.
export const SCREEN_TIER = {
  overview: TIER.operator,
  current: TIER.operator,
  prestart: TIER.operator,
  span: TIER.operator,

  boards: TIER.tech,
  pm: TIER.tech,
  activity: TIER.tech,
  history: TIER.tech,
  crew: TIER.tech,

  // Who can sign in is how the plant controls its own access, and factory
  // layout is the plant's map of itself. Both belong with the lead.
  logins: TIER.siteLead,
  layout: TIER.siteLead,
};

export const TIER_LABEL = {
  [TIER.operator]: 'Operator',
  [TIER.tech]: 'Maintenance',
  [TIER.supervisor]: 'Supervisor',
  [TIER.siteLead]: 'Site Lead',
};

/** The tier a screen needs. Unknown screens are open — a new tab is not a lock. */
export const tierForScreen = (screen) =>
  (screen in SCREEN_TIER ? SCREEN_TIER[screen] : TIER.operator);

export const canOpen = (screen, person) => tierOf(person) >= tierForScreen(screen);

/** Does anyone on the roster hold this tier AND have a PIN to prove it with? */
export const someoneCanAuthorise = (people = [], minTier, hasPin = () => true) =>
  people.some((p) => tierOf(p) >= minTier && hasPin(p));

/**
 * The decision, in one place: open it, ask for a PIN, or let it through.
 *
 * `allow` when the active person is already high enough — the common case, and
 * it must not cost a prompt.
 *
 * `open` when a plant has not set PINs up at all, or has nobody at the required
 * tier who could unlock it. A gate nobody can pass is not security, it is a
 * plant locked out of its own maintenance record, and the way round it would be
 * to stop using the app. Restriction begins when the plant has actually said
 * who is who.
 *
 * `ask` otherwise.
 */
export const screenGate = (screen, activePerson, people = [], hasPin = () => true) => {
  const need = tierForScreen(screen);
  if (need <= TIER.operator) return { action: 'allow', need };
  if (tierOf(activePerson) >= need) return { action: 'allow', need };
  if (!someoneCanAuthorise(people, need, hasPin)) return { action: 'open', need };
  return { action: 'ask', need, label: TIER_LABEL[need] };
};

export default { TIER, tierOf, SCREEN_TIER, tierForScreen, canOpen, screenGate, someoneCanAuthorise };
