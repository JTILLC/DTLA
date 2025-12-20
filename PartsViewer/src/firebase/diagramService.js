import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { db } from './config';

// Using a separate collection name to keep Parts Viewer data separate from other apps
const DIAGRAMS_COLLECTION = 'parts-viewer-diagrams';

/**
 * Save a diagram to Firebase
 * @param {string} diagramId - The diagram ID
 * @param {object} diagramData - The diagram data
 * @returns {Promise<void>}
 */
export const saveDiagram = async (diagramId, diagramData) => {
  try {
    const diagramRef = doc(db, DIAGRAMS_COLLECTION, diagramId);
    await setDoc(diagramRef, {
      ...diagramData,
      lastModified: serverTimestamp()
    });
    console.log('Diagram saved to Firebase:', diagramId);
  } catch (error) {
    console.error('Error saving diagram:', error);
    throw error;
  }
};

/**
 * Load a diagram from Firebase
 * @param {string} diagramId - The diagram ID
 * @returns {Promise<object|null>}
 */
export const loadDiagram = async (diagramId) => {
  try {
    const diagramRef = doc(db, DIAGRAMS_COLLECTION, diagramId);
    const diagramSnap = await getDoc(diagramRef);

    if (diagramSnap.exists()) {
      return { id: diagramSnap.id, ...diagramSnap.data() };
    } else {
      console.log('No such diagram!');
      return null;
    }
  } catch (error) {
    console.error('Error loading diagram:', error);
    throw error;
  }
};

/**
 * Load all diagrams from Firebase
 * @returns {Promise<Array>}
 */
export const loadAllDiagrams = async () => {
  try {
    const q = query(collection(db, DIAGRAMS_COLLECTION), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    const diagrams = [];
    querySnapshot.forEach((doc) => {
      diagrams.push({ id: doc.id, ...doc.data() });
    });

    console.log('Loaded diagrams from Firebase:', diagrams.length);
    return diagrams;
  } catch (error) {
    console.error('Error loading diagrams:', error);
    throw error;
  }
};

/**
 * Delete a diagram from Firebase
 * @param {string} diagramId - The diagram ID
 * @returns {Promise<void>}
 */
export const deleteDiagram = async (diagramId) => {
  try {
    const diagramRef = doc(db, DIAGRAMS_COLLECTION, diagramId);
    await deleteDoc(diagramRef);
    console.log('Diagram deleted from Firebase:', diagramId);
  } catch (error) {
    console.error('Error deleting diagram:', error);
    throw error;
  }
};

/**
 * Sync local diagrams to Firebase
 * @param {object} localDiagrams - Object of local diagrams
 * @returns {Promise<void>}
 */
export const syncDiagramsToFirebase = async (localDiagrams) => {
  try {
    const savePromises = Object.entries(localDiagrams).map(([id, diagram]) =>
      saveDiagram(id, diagram)
    );
    await Promise.all(savePromises);
    console.log('All diagrams synced to Firebase');
  } catch (error) {
    console.error('Error syncing diagrams:', error);
    throw error;
  }
};
