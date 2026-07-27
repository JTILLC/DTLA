// src/utils/photoQueue.js
//
// Firestore's offline persistence (enabled in App.jsx) already queues DATA
// writes and replays them on reconnect, so a visit logged in a dead zone syncs
// on its own. Firebase Storage has no equivalent — an upload attempted without
// signal simply fails — which is why photos were the one thing a tech could
// genuinely lose on a plant floor.
//
// This is that missing piece: the image blob is parked in IndexedDB, the caller
// gets an immediate local preview, and the upload is retried whenever the
// browser regains connectivity (and on app start). Queued photos survive a
// reload and a force-quit because the blob itself is persisted, not just a
// reference to a File the page no longer holds.

const DB_NAME = 'ccw-photo-queue';
const DB_VERSION = 1;
const STORE = 'pending';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const result = fn(store);
        t.oncomplete = () => resolve(result?.result ?? result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export const photoQueue = {
  // Park a photo for later upload. `id` doubles as the local preview key so the
  // UI can show the pending thumbnail immediately.
  async add(entry) {
    await tx('readwrite', (store) => store.put(entry));
    return entry;
  },

  async all() {
    const items = await tx('readonly', (store) => store.getAll());
    return items || [];
  },

  async remove(id) {
    return tx('readwrite', (store) => store.delete(id));
  },

  async count() {
    const items = await this.all();
    return items.length;
  },
};

export default photoQueue;
