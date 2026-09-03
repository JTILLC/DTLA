/**
 * The machine's state beyond which screen is showing.
 *
 * The original keeps this in `_global` — Power, KRlevel, MenuOpenSW, the lamp
 * flags — and every key reads it before deciding whether to do anything. The
 * map carries the same idea as data: a key may `requires` some of these to be
 * live, and `sets` or `toggles` them when pressed. This module is the list of
 * flags, their starting values, and the words for a key that is dead because
 * of one.
 */

export const initialFlags = () => ({
  level: 1,            // 1 Operator, 2 Site Engineer, 3 Installation, 4 Maintenance
  pendingLevel: null,  // the level picked on the list, waiting on the password
  running: false,      // Production started (Start) and not yet stopped
  drain: false,        // Drain START pressed and not yet stopped
  avg: false,          // Preset > Machine > Average Control
  infeed: false,       // Production's Infeed Control lamp
  headMean: false,     // Feeder Adjust's Head mean lamp
  sectionMean: false,  // Feeder Adjust's Section mean lamp
  drainAutoZero: false,
  drainInfeed: false,
  foDF: false, foRF: false, foPH: false, foWH: false,   // Full Open Lock unit lamps
  hdrvParam: {},       // H DRV Spec Set: which parameter set (1–3) each unit runs
  optBH: false,        // the machine has booster hoppers (Timing Adjustment rows)
  optTH: false,        // ... a timing hopper: two sections, C1 and C2
  optDTH: false,       // ... diverting timing hoppers, two per section
  packInterface: 'master', // Peripheral > Pckr Intrlck Set: Interface
  packParam: 1,        // ... its parameter set (1-4)
});

export const applySets = (flags, sets) => {
  const next = { ...flags };
  for (const [k, v] of Object.entries(sets || {})) {
    if (k === 'power' || k === 'zeroDone') continue;   // handled by the app itself
    next[k] = v;
  }
  return next;
};

export const toggleFlag = (flags, name) => ({ ...flags, [name]: !flags[name] });

/** Why a key is dead, in the machine's own terms. */
export const REQUIRE_MESSAGES = {
  power: 'The machine is not powered on — press the Power key first. On the '
    + 'real unit this key is dimmed and completely dead until power is on.',
  stopped: 'The machine is running. Press Stop first — while it runs, HOME and '
    + 'Exit are dimmed and dead, exactly as on the real unit.',
  running: 'The machine is stopped; this key only works while it is running.',
  level4: 'Maintenance level only. Open the key icon in the header, pick '
    + 'Maintenance, and enter 1 2 3 — then this key appears.',
  avg: 'Lower Weight Limit only appears with Average Control on: Preset > '
    + 'Machine tab > Average Control > On.',
  drain: 'Nothing is draining. Drain START first.',
  drainStopped: 'Already draining — press Drain STOP first.',
  homeDead: 'HOME is dimmed on this screen. Press Exit — it leaves the same way, '
    + 'and on Select Preset it is also what commits the preset you picked.',
};
