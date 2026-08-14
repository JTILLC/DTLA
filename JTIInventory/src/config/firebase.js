// Shared Firebase project across the JTI apps (data isolated per user under user_files/{uid}).
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyDnhtjMPh5bkKgRyZEfqIJmVISrJ_UkrB4',
  authDomain: 'downtimelogger-a96fb.firebaseapp.com',
  projectId: 'downtimelogger-a96fb',
  storageBucket: 'downtimelogger-a96fb.firebasestorage.app',
  messagingSenderId: '941297034751',
  appId: '1:941297034751:web:80322c27de1b1b2e0cf3ca',
  measurementId: 'G-ZRNDDFPK74',
};

export const app = initializeApp(firebaseConfig);

// Multi-tab persistent cache so data is available offline + stays in sync across tabs.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  // If persistence can't initialize (e.g. in private browsing), fall back to in-memory.
  console.warn('Firestore persistence unavailable, using memory cache:', err?.message);
  db = getFirestore(app);
}

export { db };
export const auth = getAuth(app);
export const storage = getStorage(app);
