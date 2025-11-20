// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics'; // Optional, for analytics

const firebaseConfig = {
  apiKey: "AIzaSyAawMdb8BDr-1l5GKcPk_k0_vhRgvK0ptg",
  authDomain: "timesheetapp-c4e54.firebaseapp.com",
  projectId: "timesheetapp-c4e54",
  storageBucket: "timesheetapp-c4e54.firebasestorage.app",
  messagingSenderId: "97633147981",
  appId: "1:97633147981:web:ee0509bda375a968c71004",
  measurementId: "G-9PQVG8DCJK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app); // Firestore instance
const analytics = getAnalytics(app); // Optional

export { db };