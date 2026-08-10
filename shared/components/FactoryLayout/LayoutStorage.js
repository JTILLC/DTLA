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

const clean = (data) => {
  const { _isVisitSpecific, _visitId, updatedAt, ...rest } = data || {};
  return { ...DEFAULT_LAYOUT, ...rest, canvasSettings: { ...DEFAULT_LAYOUT.canvasSettings } };
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

    const layout = clean(adopted.data);
    await saveLayout(userId, customerId, layout);   // adopt once; next load finds it here
    return layout;
  } catch (error) {
    console.error('Error loading factory layout:', error);
    return { ...DEFAULT_LAYOUT };
  }
};

/** Save the plant's layout. */
export const saveLayout = async (userId, customerId, layout) => {
  try {
    const { _isVisitSpecific, _visitId, ...layoutData } = layout || {};
    await getLayoutRef(userId, customerId).set({
      ...layoutData,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error saving factory layout:', error);
    return false;
  }
};

// Old name, same single destination.
export const saveDefaultLayout = saveLayout;

export { DEFAULT_LAYOUT };
