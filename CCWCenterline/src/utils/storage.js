// Saved centerlines, on the device.
//
// A centerline is written on a plant floor, often on a tablet, often with no
// usable signal. It is saved locally the moment anything changes and never
// waits on a network to be safe. Nothing here can dead-end the engineer: a
// failed write reports that it failed, it does not throw away what is on
// screen.

const KEY = 'ccw-centerlines';
const CURRENT = 'ccw-centerline-current';

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const listCenterlines = () => {
  const all = read(KEY, []);
  return Array.isArray(all) ? all : [];
};

/** Save (or replace) one centerline. Returns true when it actually landed. */
export function saveCenterline(centerline) {
  try {
    const all = listCenterlines().filter((c) => c.id !== centerline.id);
    all.unshift({ ...centerline, savedAt: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function deleteCenterline(id) {
  try {
    localStorage.setItem(KEY, JSON.stringify(listCenterlines().filter((c) => c.id !== id)));
    return true;
  } catch {
    return false;
  }
}

/**
 * The work in progress, kept separately from the saved list.
 *
 * Photographs make a centerline large, and a quota failure while autosaving a
 * draft must not take the saved library down with it — so the draft has its own
 * key and its own failure.
 */
export const readDraft = () => read(CURRENT, null);

export function writeDraft(centerline) {
  try {
    localStorage.setItem(CURRENT, JSON.stringify(centerline));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(CURRENT);
  } catch {
    /* nothing to undo */
  }
}
