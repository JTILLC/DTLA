// Firebase persistence for factory layout
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

// Get reference to customer's default layout
export const getDefaultLayoutRef = (userId, customerId) => {
  return firebase
    .firestore()
    .collection('user_files')
    .doc(userId)
    .collection('customers')
    .doc(customerId)
    .collection('factoryLayout')
    .doc('default');
};

// Get reference to visit-specific layout
export const getVisitLayoutRef = (userId, customerId, visitId) => {
  return firebase
    .firestore()
    .collection('user_files')
    .doc(userId)
    .collection('customers')
    .doc(customerId)
    .collection('factoryLayout')
    .doc(`visit_${visitId}`);
};

// Load layout - checks for visit-specific first, falls back to default
export const loadLayout = async (userId, customerId, visitId = null) => {
  try {
    // If visitId provided, check for visit-specific layout first
    if (visitId) {
      const visitRef = getVisitLayoutRef(userId, customerId, visitId);
      const visitDoc = await visitRef.get();

      if (visitDoc.exists) {
        const data = visitDoc.data();
        return {
          ...DEFAULT_LAYOUT,
          ...data,
          canvasSettings: { ...DEFAULT_LAYOUT.canvasSettings },
          _isVisitSpecific: true,
          _visitId: visitId
        };
      }
    }

    // Fall back to default layout
    const defaultRef = getDefaultLayoutRef(userId, customerId);
    const defaultDoc = await defaultRef.get();

    if (defaultDoc.exists) {
      const data = defaultDoc.data();
      return {
        ...DEFAULT_LAYOUT,
        ...data,
        canvasSettings: { ...DEFAULT_LAYOUT.canvasSettings },
        _isVisitSpecific: false
      };
    }

    return { ...DEFAULT_LAYOUT, _isVisitSpecific: false };
  } catch (error) {
    console.error('Error loading factory layout:', error);
    return { ...DEFAULT_LAYOUT, _isVisitSpecific: false };
  }
};

// Save layout as customer default
export const saveDefaultLayout = async (userId, customerId, layout) => {
  try {
    const ref = getDefaultLayoutRef(userId, customerId);
    const { _isVisitSpecific, _visitId, ...layoutData } = layout;
    await ref.set({
      ...layoutData,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error saving default layout:', error);
    return false;
  }
};

// Save layout for specific visit
export const saveVisitLayout = async (userId, customerId, visitId, layout) => {
  try {
    const ref = getVisitLayoutRef(userId, customerId, visitId);
    const { _isVisitSpecific, _visitId, ...layoutData } = layout;
    await ref.set({
      ...layoutData,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error saving visit layout:', error);
    return false;
  }
};

// Delete visit-specific layout (revert to default)
export const deleteVisitLayout = async (userId, customerId, visitId) => {
  try {
    const ref = getVisitLayoutRef(userId, customerId, visitId);
    await ref.delete();
    return true;
  } catch (error) {
    console.error('Error deleting visit layout:', error);
    return false;
  }
};

// Check if visit has specific layout
export const hasVisitLayout = async (userId, customerId, visitId) => {
  try {
    const ref = getVisitLayoutRef(userId, customerId, visitId);
    const doc = await ref.get();
    return doc.exists;
  } catch (error) {
    console.error('Error checking visit layout:', error);
    return false;
  }
};

export { DEFAULT_LAYOUT };
