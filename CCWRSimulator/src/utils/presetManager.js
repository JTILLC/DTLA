/**
 * Display & Data Manager > Preset Manager (seen on the running program).
 *
 * Two stores, Memory and Card, ten slots each. The Source side is where a
 * preset is read from, the Destination side is where it is written to: pick a
 * row on each, press Copy, answer Yes, and the source preset lands in the
 * destination slot. Initialize wipes Memory.
 */
export const SLOTS = 10;

export const initialPresets = (spec) => ({
  memory: [...spec.initial.memory],
  card: [...spec.initial.card],
});

export const migratePresets = (saved, spec) => {
  const fresh = initialPresets(spec);
  for (const store of ['memory', 'card']) {
    if (Array.isArray(saved?.[store]) && saved[store].length === SLOTS) fresh[store] = saved[store].map((v) => String(v ?? ''));
  }
  return fresh;
};

export const initialPick = () => ({ src: null, dst: null });

export const pickRow = (pick, side, no) => ({ ...pick, [side]: pick[side] === no ? null : no });

export const canCopy = (pick) => Boolean(pick.src && pick.dst);

/** Yes on the confirm: the source preset is written into the destination slot. */
export function copyPreset(presets, pick, srcStore, dstStore) {
  if (!canCopy(pick)) return presets;
  const name = presets[srcStore][pick.src - 1];
  const dst = [...presets[dstStore]];
  dst[pick.dst - 1] = name;
  return { ...presets, [dstStore]: dst };
}

export const wipeMemory = (presets) => ({ ...presets, memory: Array(SLOTS).fill('') });
