/**
 * Display & Data Manager's copy managers: Preset Manager (seen working on the
 * running program) and Machine Set Mngr (inert there; given the same
 * mechanics by analogy, Service 4.4.2.2).
 *
 * Two stores, Memory and Card, ten slots each. The Source side is where an
 * item is read from, the Destination side is where it is written to: pick a
 * row on each, press Copy, answer Yes, and the source lands in the destination
 * slot. An empty source copied over a slot empties it - that is how a preset
 * is removed on the machine. Initialize wipes Memory.
 */
export const SLOTS = 10;

export const initialStores = (spec) => ({ memory: [...spec.initial.memory], card: [...spec.initial.card] });

export const migrateStores = (saved, spec) => {
  const fresh = initialStores(spec);
  for (const store of ['memory', 'card']) {
    if (Array.isArray(saved?.[store]) && saved[store].length === SLOTS) fresh[store] = saved[store].map((v) => String(v ?? ''));
  }
  return fresh;
};

export const initialPick = () => ({ src: null, dst: null });

export const pickRow = (pick, side, no) => ({ ...pick, [side]: pick[side] === no ? null : no });

export const canCopy = (pick) => Boolean(pick.src && pick.dst);

/** Yes on the confirm: the source is written into the destination slot. */
export function copyItem(stores, pick, srcStore, dstStore) {
  if (!canCopy(pick)) return stores;
  const name = stores[srcStore][pick.src - 1];
  const dst = [...stores[dstStore]];
  dst[pick.dst - 1] = name;
  return { ...stores, [dstStore]: dst };
}

export const wipeMemory = (stores) => ({ ...stores, memory: Array(SLOTS).fill('') });

/* Every manager's stores and picks, keyed by manager. */
export const initialManagers = (specs) => Object.fromEntries(
  Object.entries(specs).map(([key, spec]) => [key, { stores: initialStores(spec), pick: initialPick() }]),
);

export const migrateManagers = (saved, specs) => Object.fromEntries(
  Object.entries(specs).map(([key, spec]) => [key, {
    stores: migrateStores(saved?.[key]?.stores, spec),
    pick: initialPick(),
  }]),
);

/** Which manager a screen (or one of its pop-ups) belongs to. */
export const managerOf = (specs, screens, slug) => {
  const base = screens[slug]?.parent || slug;
  return Object.keys(specs).find((k) => specs[k].screen === base) || null;
};

// The Preset Manager names, kept for the notes and tests.
export const initialPresets = initialStores;
export const migratePresets = migrateStores;
export const copyPreset = copyItem;
