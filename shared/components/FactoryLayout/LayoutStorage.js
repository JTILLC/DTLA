// Firebase persistence for the factory layout.
//
// ONE layout per plant. The floor is a fact about the building — where the
// weighers stand, where the walls are — and it does not change because somebody
// opened a different log. It used to be possible to save a layout "for this
// visit only", which meant the map you drew could silently stop being the map
// you saw: open yesterday's log and the floor was somewhere else, or empty.
// A plan of the building belongs to the building.
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const DEFAULT_LAYOUT = {
  version: 1,
  canvasSettings: {
    width: 10000,
    height: 4000
  },
  lineBoxes: [],
  walls: [],
  labels: []
};

const layoutCollection = (userId, customerId) =>
  firebase
    .firestore()
    .collection('user_files')
    .doc(userId)
    .collection('customers')
    .doc(customerId)
    .collection('factoryLayout');

/** The plant's layout. The only one there is. */
export const getLayoutRef = (userId, customerId) =>
  layoutCollection(userId, customerId).doc('default');

// Kept under its old name so existing callers and docs still resolve.
export const getDefaultLayoutRef = getLayoutRef;

/** Nothing drawn on it yet. An empty canvas is not worth preferring over one. */
export const isEmptyLayout = (layout) =>
  !layout
  || ((layout.lineBoxes || []).length === 0
      && (layout.walls || []).length === 0
      && (layout.labels || []).length === 0);

/**
 * The best of the old per-visit layouts to adopt as the plant's own.
 *
 * These exist because "Save for this visit only" used to be a button. Whoever
 * pressed it was drawing their floor, not making a throwaway — and if we simply
 * stopped reading those documents, their work would appear to have been
 * deleted. The most recently updated one is the closest thing to what the plant
 * currently looks like.
 *
 * `docs` is [{ id, data }] straight from the collection.
 */
export const pickAdoptableLayout = (docs = []) => {
  const when = (d) => {
    const t = new Date(d?.data?.updatedAt || 0).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const candidates = docs
    .filter((d) => String(d?.id || '').startsWith('visit_'))
    .filter((d) => !isEmptyLayout(d?.data));
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => when(b) - when(a))[0];
};

// updatedAt/updatedBy are kept on the loaded layout: they say who drew this and
// when, and the timestamp is the baseline a later save is checked against.
const clean = (data) => {
  const { _isVisitSpecific, _visitId, ...rest } = data || {};
  return {
    ...DEFAULT_LAYOUT,
    ...rest,
    canvasSettings: { ...DEFAULT_LAYOUT.canvasSettings },
    updatedAt: data?.updatedAt || null,
    updatedBy: data?.updatedBy || null,
    rev: data?.rev ?? null,
  };
};

/**
 * Load the plant's layout.
 *
 * If it has none but has one of the old per-visit layouts, that one is adopted
 * — read, written back as the plant's own, and the original left where it is.
 * Nothing is deleted on a path whose whole job is to avoid losing a drawing.
 */
export const loadLayout = async (userId, customerId) => {
  try {
    const ref = getLayoutRef(userId, customerId);
    const doc = await ref.get();
    if (doc.exists && !isEmptyLayout(doc.data())) return clean(doc.data());

    // Nothing of the plant's own yet — look for work left in a visit layout.
    const snap = await layoutCollection(userId, customerId).get();
    const adopted = pickAdoptableLayout(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
    if (!adopted) return doc.exists ? clean(doc.data()) : { ...DEFAULT_LAYOUT };

    // Adopt once; next load finds it as the plant's own. Whoever drew it keeps
    // the credit — adoption is a move, not a new drawing.
    const layout = clean(adopted.data);
    const written = await saveLayout(userId, customerId, layout, { author: layout.updatedBy, force: true });
    return { ...layout, rev: written?.rev ?? null, updatedAt: written?.updatedAt ?? layout.updatedAt };
  } catch (error) {
    console.error('Error loading factory layout:', error);
    return { ...DEFAULT_LAYOUT };
  }
};

/**
 * Save the plant's layout.
 *
 * One document now has two authors: JTI plots a floor for a plant, and the
 * plant may then adjust it. Whoever saves last would otherwise win outright,
 * so a save carries the timestamp it was working from. If the stored layout has
 * moved on since, this refuses rather than overwrites and hands back the newer
 * copy — losing an afternoon of somebody's plotting to a stray drag is not a
 * trade the app gets to make on its own.
 *
 * `author` is a display name ('JTI', or the plant's), recorded so the screen
 * can say where the layout came from.
 *
 * The version token is a counter, not the timestamp. Timestamps come from each
 * client's own clock and only have millisecond resolution, so two saves close
 * together can carry the SAME stamp — and a guard that compares stamps would
 * wave the second one straight through, which is the exact case it exists to
 * catch. A counter incremented inside the transaction cannot collide.
 *
 * Returns { ok, rev } on success, or { ok: false, conflict: true, theirs } when
 * the stored copy has moved on. Pass force to overwrite deliberately.
 */
export const saveLayout = async (userId, customerId, layout, options = {}) => {
  const { author = null, baseRev = null, force = false } = options;
  const ref = getLayoutRef(userId, customerId);
  const { _isVisitSpecific, _visitId, updatedAt, updatedBy, rev, ...layoutData } = layout || {};

  const stamp = (nextRev) => ({
    ...layoutData,
    rev: nextRev,
    updatedAt: new Date().toISOString(),
    updatedBy: author,
  });

  try {
    if (force || baseRev === null) {
      // No baseline to check against: a first write, an adoption, or somebody
      // who has already been asked and said replace it.
      let written;
      await firebase.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        written = stamp(((snap.exists && snap.data()?.rev) || 0) + 1);
        tx.set(ref, written);
      });
      return { ok: true, rev: written.rev, updatedAt: written.updatedAt };
    }

    let conflict = null;
    let written = null;
    await firebase.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const theirs = snap.exists ? snap.data() : null;
      // A missing rev means nobody has saved since this document was last
      // written by an older build — not a clash.
      if (theirs?.rev != null && theirs.rev !== baseRev) {
        conflict = clean(theirs);
        return;
      }
      written = stamp((theirs?.rev || 0) + 1);
      tx.set(ref, written);
    });

    if (conflict) return { ok: false, conflict: true, theirs: conflict };
    return { ok: true, rev: written?.rev ?? null, updatedAt: written?.updatedAt ?? null };
  } catch (error) {
    console.error('Error saving factory layout:', error);
    return { ok: false, error };
  }
};

// Old name, same single destination.
export const saveDefaultLayout = saveLayout;

export { DEFAULT_LAYOUT };
