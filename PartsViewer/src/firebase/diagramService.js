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
import {
  ref,
  uploadString,
  getDownloadURL,
  deleteObject
} from 'firebase/storage';
import { db, storage } from './config';

// Using a separate collection name to keep Parts Viewer data separate from other apps
const DIAGRAMS_COLLECTION = 'parts-viewer-diagrams';
const STORAGE_FOLDER = 'diagram-images';

/**
 * Save a diagram to Firebase
 * @param {string} diagramId - The diagram ID
 * @param {object} diagramData - The diagram data
 * @returns {Promise<void>}
 */
export const saveDiagram = async (diagramId, diagramData) => {
  try {
    // Preserve existing pdfStoragePath if no new pdfData is being uploaded
    let pdfStoragePath = diagramData.pdfStoragePath || null;

    // If no pdfStoragePath provided, check if image already exists in Firebase Storage
    if (!pdfStoragePath && !diagramData.pdfData) {
      try {
        const storageRef = ref(storage, `${STORAGE_FOLDER}/${diagramId}.jpg`);
        await getDownloadURL(storageRef);
        // Image exists! Preserve the path
        pdfStoragePath = `${STORAGE_FOLDER}/${diagramId}.jpg`;
        console.log(`[Firebase Storage] Found existing image, preserving path: ${pdfStoragePath}`);
      } catch (error) {
        // No existing image, that's ok
        if (error.code !== 'storage/object-not-found') {
          console.warn('[Firebase Storage] Error checking for existing image:', error);
        }
      }
    }

    // Check if pdfData is base64 (starts with 'data:') or HTTPS URL
    const isBase64 = diagramData.pdfData && diagramData.pdfData.startsWith('data:');
    const isHttpsUrl = diagramData.pdfData && diagramData.pdfData.startsWith('https://');

    // Only upload if we have base64 data (not an HTTPS URL from previous Firebase load)
    if (isBase64) {
      try {
        console.log(`[Firebase Storage] Uploading image for diagram ${diagramId}...`);

        // Create a reference to the storage location
        const storageRef = ref(storage, `${STORAGE_FOLDER}/${diagramId}.jpg`);

        // Upload the base64 image data
        await uploadString(storageRef, diagramData.pdfData, 'data_url');

        // Get the download URL
        pdfStoragePath = `${STORAGE_FOLDER}/${diagramId}.jpg`;

        console.log(`✓ Image uploaded to Firebase Storage: ${pdfStoragePath}`);
      } catch (storageError) {
        console.error('Failed to upload image to Storage:', storageError);
        // Continue without storage - will save locally only
      }
    } else if (isHttpsUrl) {
      // pdfData is already a Firebase URL, preserve the existing storage path
      console.log(`[Firebase Storage] Skipping upload - pdfData is already a Firebase URL`);
    } else if (pdfStoragePath) {
      console.log(`[Firebase Storage] Preserving existing image reference: ${pdfStoragePath}`);
    }

    // Save metadata to Firestore (without pdfData to stay under 1MB limit)
    const { pdfData, ...metadataOnly } = diagramData;

    // Deep clean function to remove all undefined values recursively (but keep empty objects)
    const deepClean = (obj) => {
      if (obj === null || obj === undefined) return null;
      if (typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(item => deepClean(item)).filter(item => item !== null && item !== undefined);
      }

      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        // Skip undefined and internal debug fields
        if (value === undefined || key.startsWith('_')) continue;

        if (value === null) {
          cleaned[key] = null;
        } else if (typeof value === 'object') {
          const cleanedValue = deepClean(value);
          // Keep empty objects and arrays (needed for partsData, hotspots)
          if (cleanedValue !== null && cleanedValue !== undefined) {
            cleaned[key] = cleanedValue;
          } else if (Array.isArray(value) || Object.keys(value).length === 0) {
            cleaned[key] = value;
          }
        } else {
          cleaned[key] = value;
        }
      }
      return cleaned;
    };

    const cleanMetadata = deepClean(metadataOnly);

    // Ensure required fields exist with defaults
    const finalData = {
      ...cleanMetadata,
      pdfStoragePath,
      lastModified: serverTimestamp(),
      // Ensure critical fields exist
      hotspots: cleanMetadata.hotspots || {},
      partsData: cleanMetadata.partsData || {},
      name: cleanMetadata.name || 'Untitled',
      folder: cleanMetadata.folder || '',
      customer: cleanMetadata.customer || '',
      number: cleanMetadata.number || '',
      itemNo: cleanMetadata.itemNo || ''
    };

    // Log any undefined values found
    const findUndefined = (obj, path = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (value === undefined) {
          console.error(`[Firebase] Found undefined at: ${currentPath}`);
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          findUndefined(value, currentPath);
        }
      }
    };
    findUndefined(finalData);

    const diagramRef = doc(db, DIAGRAMS_COLLECTION, diagramId);
    await setDoc(diagramRef, finalData);

    console.log(`✓ Diagram metadata saved to Firestore (${diagramId})`);
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
      const diagramData = { id: diagramSnap.id, ...diagramSnap.data() };

      // If diagram has image in Storage, get the download URL
      if (diagramData.pdfStoragePath) {
        try {
          console.log(`[Firebase Storage] Getting download URL for ${diagramData.pdfStoragePath}...`);

          const storageRef = ref(storage, diagramData.pdfStoragePath);
          const downloadURL = await getDownloadURL(storageRef);

          // Use the download URL directly (no CORS issues with img tags)
          diagramData.pdfData = downloadURL;
          console.log(`✓ Got download URL from Firebase Storage`);
        } catch (storageError) {
          console.error('Failed to get download URL from Storage:', storageError);
          // Continue without image - will show loading state
        }
      }

      return diagramData;
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
    // Delete image from Storage if it exists
    try {
      const storageRef = ref(storage, `${STORAGE_FOLDER}/${diagramId}.jpg`);
      await deleteObject(storageRef);
      console.log('✓ Diagram image deleted from Firebase Storage:', diagramId);
    } catch (storageError) {
      // Image might not exist in storage, that's ok
      if (storageError.code !== 'storage/object-not-found') {
        console.warn('Failed to delete image from Storage:', storageError);
      }
    }

    // Delete metadata from Firestore
    const diagramRef = doc(db, DIAGRAMS_COLLECTION, diagramId);
    await deleteDoc(diagramRef);
    console.log('✓ Diagram metadata deleted from Firestore:', diagramId);
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

/**
 * Repair diagrams that have images in Storage but missing pdfStoragePath in Firestore
 * @returns {Promise<{repaired: number, checked: number}>}
 */
export const repairMissingImageReferences = async () => {
  try {
    console.log('[Repair] Loading all diagrams from Firestore...');
    const diagrams = await loadAllDiagrams();

    let checked = 0;
    let repaired = 0;

    for (const diagram of diagrams) {
      checked++;

      // Skip if already has pdfStoragePath
      if (diagram.pdfStoragePath) {
        console.log(`[Repair] ${diagram.id}: Already has pdfStoragePath, skipping`);
        continue;
      }

      // Check if image exists in Storage
      try {
        const storageRef = ref(storage, `${STORAGE_FOLDER}/${diagram.id}.jpg`);
        const downloadURL = await getDownloadURL(storageRef);

        // Image exists! Update Firestore to add the pdfStoragePath
        console.log(`[Repair] ${diagram.id}: Found orphaned image, reconnecting...`);
        const diagramRef = doc(db, DIAGRAMS_COLLECTION, diagram.id);
        await setDoc(diagramRef, {
          ...diagram,
          pdfStoragePath: `${STORAGE_FOLDER}/${diagram.id}.jpg`
        });

        repaired++;
        console.log(`[Repair] ✓ ${diagram.id}: Reconnected to image`);
      } catch (storageError) {
        // Image doesn't exist in Storage, that's ok
        if (storageError.code === 'storage/object-not-found') {
          console.log(`[Repair] ${diagram.id}: No image in Storage, skipping`);
        } else {
          console.warn(`[Repair] ${diagram.id}: Error checking Storage:`, storageError);
        }
      }
    }

    console.log(`[Repair] Complete: Checked ${checked} diagrams, repaired ${repaired}`);
    return { checked, repaired };
  } catch (error) {
    console.error('[Repair] Error:', error);
    throw error;
  }
};

/**
 * Convert an image URL to base64
 * @param {string} url - The image URL
 * @returns {Promise<string>} - Base64 string
 */
const urlToBase64 = async (url) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting URL to base64:', error);
    throw error;
  }
};

/**
 * Load diagram images for export (converts to base64 for embedding in JSON)
 * @param {Array<object>} diagrams - Array of diagram objects
 * @param {function} onProgress - Progress callback (current, total)
 * @returns {Promise<Array<object>>} - Diagrams with base64 images
 */
export const loadDiagramImagesForExport = async (diagrams, onProgress) => {
  const total = diagrams.length;
  const diagramsWithImages = [];

  for (let i = 0; i < diagrams.length; i++) {
    const diagram = diagrams[i];

    // Report progress
    if (onProgress) {
      onProgress(i + 1, total);
    }

    try {
      let pdfData = diagram.pdfData;

      // If no pdfData or it's a Firebase URL, load from Storage
      if (!pdfData || (typeof pdfData === 'string' && pdfData.startsWith('https://'))) {
        if (diagram.pdfStoragePath) {
          console.log(`[Export] Loading image for ${diagram.name} from Storage...`);

          const storageRef = ref(storage, diagram.pdfStoragePath);
          const downloadURL = await getDownloadURL(storageRef);

          // Convert to base64 for embedding in JSON
          pdfData = await urlToBase64(downloadURL);

          console.log(`[Export] ✓ Loaded and converted image for ${diagram.name}`);
        } else {
          console.warn(`[Export] No image found for ${diagram.name}`);
        }
      } else if (pdfData && pdfData.startsWith('data:image/')) {
        // Already base64, keep it
        console.log(`[Export] ${diagram.name} already has base64 image`);
      }

      // Add diagram with image data
      diagramsWithImages.push({
        ...diagram,
        pdfData
      });
    } catch (error) {
      console.error(`[Export] Error loading image for ${diagram.name}:`, error);
      // Add diagram without image
      diagramsWithImages.push({
        ...diagram,
        pdfData: null
      });
    }
  }

  return diagramsWithImages;
};
