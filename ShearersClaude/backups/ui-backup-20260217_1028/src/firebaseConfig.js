import { initializeApp } from 'firebase/app';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDXtvrCHrjU_e0v46BbWiBb-e-lAviCSR0",
  authDomain: "shearers-4c4b4.firebaseapp.com",
  databaseURL: "https://shearers-4c4b4-default-rtdb.firebaseio.com",
  projectId: "shearers-4c4b4",
  storageBucket: "shearers-4c4b4.firebasestorage.app",
  messagingSenderId: "178658388175",
  appId: "1:178658388175:web:f85bf8ecb0c88570222fba",
  measurementId: "G-DG6MNF459P"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
// --- Custom UID override (persistent across sessions) ---
export const FIXED_UID = 'I2tTAyeThDOKGRj5wc9xAuklmvo2';

