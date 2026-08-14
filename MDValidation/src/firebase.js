// Shared JTI Firebase project (same one used by the CCW / Inventory apps).
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export const auth = getAuth(app);
export const db = getFirestore(app);
