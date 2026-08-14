/**
 * IndexedDB utility for storing diagram images and metadata
 * Keeps data in IndexedDB to avoid localStorage quota issues
 */

const DB_NAME = 'PartsViewerCustomerDB';
const DB_VERSION = 2;  // Incremented to add diagrams store
const IMAGES_STORE = 'diagramImages';
const DIAGRAMS_STORE = 'diagrams';

/**
 * Open IndexedDB connection
 */
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create images store if it doesn't exist
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE, { keyPath: 'id' });
        console.log('[IndexedDB] Created diagramImages store');
      }

      // Create diagrams store if it doesn't exist
      if (!db.objectStoreNames.contains(DIAGRAMS_STORE)) {
        db.createObjectStore(DIAGRAMS_STORE, { keyPath: 'id' });
        console.log('[IndexedDB] Created diagrams store');
      }
    };
  });
};

/**
 * Save an image to IndexedDB
 * @param {string} diagramId - The diagram ID
 * @param {string} imageData - Base64 image data
 */
export const saveImage = async (diagramId, imageData) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([IMAGES_STORE], 'readwrite');
    const store = transaction.objectStore(IMAGES_STORE);

    await new Promise((resolve, reject) => {
      const request = store.put({ id: diagramId, imageData });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`[IndexedDB] Saved image for diagram: ${diagramId}`);
  } catch (error) {
    console.error('[IndexedDB] Error saving image:', error);
    throw error;
  }
};

/**
 * Get an image from IndexedDB
 * @param {string} diagramId - The diagram ID
 * @returns {Promise<string|null>} Base64 image data or null
 */
export const getImage = async (diagramId) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([IMAGES_STORE], 'readonly');
    const store = transaction.objectStore(IMAGES_STORE);

    return new Promise((resolve, reject) => {
      const request = store.get(diagramId);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.imageData : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[IndexedDB] Error getting image:', error);
    return null;
  }
};

/**
 * Delete an image from IndexedDB
 * @param {string} diagramId - The diagram ID
 */
export const deleteImage = async (diagramId) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([IMAGES_STORE], 'readwrite');
    const store = transaction.objectStore(IMAGES_STORE);

    await new Promise((resolve, reject) => {
      const request = store.delete(diagramId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`[IndexedDB] Deleted image for diagram: ${diagramId}`);
  } catch (error) {
    console.error('[IndexedDB] Error deleting image:', error);
    throw error;
  }
};

/**
 * Save multiple images in batch
 * @param {Array<{id: string, imageData: string}>} images - Array of images to save
 * @param {Function} onProgress - Progress callback (current, total)
 */
export const saveImagesBatch = async (images, onProgress) => {
  const total = images.length;
  let current = 0;

  for (const image of images) {
    await saveImage(image.id, image.imageData);
    current++;
    if (onProgress) {
      onProgress(current, total);
    }
  }
};

/**
 * Clear all images from IndexedDB
 */
export const clearAllImages = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([IMAGES_STORE], 'readwrite');
    const store = transaction.objectStore(IMAGES_STORE);

    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('[IndexedDB] Cleared all images');
  } catch (error) {
    console.error('[IndexedDB] Error clearing images:', error);
    throw error;
  }
};

/**
 * Get storage usage statistics
 */
export const getStorageStats = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([IMAGES_STORE], 'readonly');
    const store = transaction.objectStore(IMAGES_STORE);

    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => {
        resolve({
          imageCount: request.result
        });
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[IndexedDB] Error getting stats:', error);
    return { imageCount: 0 };
  }
};

/**
 * Save all diagrams to IndexedDB
 * @param {Object} diagrams - Object with diagram IDs as keys
 * @param {string} customerName - Customer name
 */
export const saveDiagrams = async (diagrams, customerName) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([DIAGRAMS_STORE], 'readwrite');
    const store = transaction.objectStore(DIAGRAMS_STORE);

    const request = store.put({ 
      id: 'customer-diagrams',
      customerName,
      diagrams 
    });

    await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('[IndexedDB] Saved diagrams for', customerName);
    db.close();
  } catch (error) {
    console.error('[IndexedDB] Error saving diagrams:', error);
    throw error;
  }
};

/**
 * Load all diagrams from IndexedDB
 * @returns {Promise<{diagrams: Object, customerName: string}>}
 */
export const loadDiagrams = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([DIAGRAMS_STORE], 'readonly');
    const store = transaction.objectStore(DIAGRAMS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.get('customer-diagrams');
      request.onsuccess = () => {
        const result = request.result;
        db.close();
        if (result) {
          console.log('[IndexedDB] Loaded diagrams');
          resolve({
            diagrams: result.diagrams || {},
            customerName: result.customerName || ''
          });
        } else {
          resolve({ diagrams: {}, customerName: '' });
        }
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[IndexedDB] Error loading diagrams:', error);
    return { diagrams: {}, customerName: '' };
  }
};
