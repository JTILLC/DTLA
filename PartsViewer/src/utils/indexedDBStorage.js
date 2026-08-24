/**
 * IndexedDB storage utilities for PartsViewer
 * Used for storing large binary data (images, PDFs) that exceed localStorage limits
 */

const DB_NAME = 'PartsViewerDB';
const DB_VERSION = 1;
const DIAGRAMS_STORE = 'diagrams';

/**
 * Open IndexedDB connection
 */
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[IndexedDB] Error opening database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create diagrams object store if it doesn't exist
      if (!db.objectStoreNames.contains(DIAGRAMS_STORE)) {
        db.createObjectStore(DIAGRAMS_STORE, { keyPath: 'id' });
        console.log('[IndexedDB] Created diagrams object store');
      }
    };
  });
};

/**
 * Save all diagrams to IndexedDB
 */
export const saveDiagramsToIndexedDB = async (diagrams) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([DIAGRAMS_STORE], 'readwrite');
    const store = transaction.objectStore(DIAGRAMS_STORE);

    // Clear existing data first
    store.clear();

    // Save each diagram
    const promises = Object.values(diagrams).map(diagram => {
      console.log(`[IndexedDB] Saving diagram: ${diagram.name}, has pdfData: ${!!diagram.pdfData}`);
      if (diagram.pdfData && typeof diagram.pdfData === 'string') {
        console.log(`[IndexedDB]   - pdfData length: ${diagram.pdfData.length}`);
      }
      return new Promise((resolve, reject) => {
        const request = store.put(diagram);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });

    await Promise.all(promises);
    console.log(`[IndexedDB] Saved ${Object.keys(diagrams).length} diagrams`);

    db.close();
    return true;
  } catch (error) {
    console.error('[IndexedDB] Error saving diagrams:', error);
    return false;
  }
};

/**
 * Load all diagrams from IndexedDB
 */
export const loadDiagramsFromIndexedDB = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([DIAGRAMS_STORE], 'readonly');
    const store = transaction.objectStore(DIAGRAMS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const diagrams = {};
        request.result.forEach(diagram => {
          diagrams[diagram.id] = diagram;
          console.log(`[IndexedDB] Loaded diagram: ${diagram.name}, has pdfData: ${!!diagram.pdfData}`);
          if (diagram.pdfData && typeof diagram.pdfData === 'string') {
            console.log(`[IndexedDB]   - pdfData length: ${diagram.pdfData.length}`);
          }
        });
        console.log(`[IndexedDB] Loaded ${Object.keys(diagrams).length} diagrams total`);
        db.close();
        resolve(diagrams);
      };

      request.onerror = () => {
        console.error('[IndexedDB] Error loading diagrams:', request.error);
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[IndexedDB] Error opening database:', error);
    return {};
  }
};

/**
 * Load a single diagram from IndexedDB
 */
export const loadSingleDiagramFromIndexedDB = async (diagramId) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([DIAGRAMS_STORE], 'readonly');
    const store = transaction.objectStore(DIAGRAMS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.get(diagramId);

      request.onsuccess = () => {
        const diagram = request.result;
        if (diagram) {
          console.log(`[IndexedDB] Loaded single diagram: ${diagram.name}, has pdfData: ${!!diagram.pdfData}`);
          if (diagram.pdfData && typeof diagram.pdfData === 'string') {
            console.log(`[IndexedDB]   - pdfData length: ${diagram.pdfData.length}`);
          }
        } else {
          console.log(`[IndexedDB] Diagram not found: ${diagramId}`);
        }
        db.close();
        resolve(diagram || null);
      };

      request.onerror = () => {
        console.error('[IndexedDB] Error loading diagram:', request.error);
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[IndexedDB] Error loading single diagram:', error);
    return null;
  }
};

/**
 * Delete a single diagram from IndexedDB
 */
export const deleteDiagramFromIndexedDB = async (diagramId) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([DIAGRAMS_STORE], 'readwrite');
    const store = transaction.objectStore(DIAGRAMS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.delete(diagramId);

      request.onsuccess = () => {
        console.log(`[IndexedDB] Deleted diagram: ${diagramId}`);
        db.close();
        resolve(true);
      };

      request.onerror = () => {
        console.error('[IndexedDB] Error deleting diagram:', request.error);
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[IndexedDB] Error deleting diagram:', error);
    return false;
  }
};

/**
 * Clear all data from IndexedDB
 */
export const clearIndexedDB = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([DIAGRAMS_STORE], 'readwrite');
    const store = transaction.objectStore(DIAGRAMS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.clear();

      request.onsuccess = () => {
        console.log('[IndexedDB] Cleared all diagrams');
        db.close();
        resolve(true);
      };

      request.onerror = () => {
        console.error('[IndexedDB] Error clearing data:', request.error);
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('[IndexedDB] Error clearing data:', error);
    return false;
  }
};
