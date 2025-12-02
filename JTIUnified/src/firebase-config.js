import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';

// CCW Issues (Downtime Logger) Configuration
const ccwIssuesConfig = {
  apiKey: "AIzaSyDnhtjMPh5bkKgRyZEfqIJmVISrJ_UkrB4",
  authDomain: "downtimelogger-a96fb.firebaseapp.com",
  projectId: "downtimelogger-a96fb",
  storageBucket: "downtimelogger-a96fb.firebasestorage.app",
  messagingSenderId: "941297034751",
  appId: "1:941297034751:web:80322c27de1b1b2e0cf3ca",
  measurementId: "G-ZRNDDFPK74"
};

// Jobs Master Configuration
const jobsMasterConfig = {
  apiKey: "AIzaSyCnBuhq5hT62J3_O5kQRsTQucNDyYxMnsM",
  authDomain: "jobs-data-17ee4.firebaseapp.com",
  projectId: "jobs-data-17ee4",
  storageBucket: "jobs-data-17ee4.firebasestorage.app",
  messagingSenderId: "243005500287",
  appId: "1:243005500287:web:439852c7875e42cc14484a",
  measurementId: "G-3JJSP5QEFM"
};

// Timesheet Configuration
const timesheetConfig = {
  apiKey: "AIzaSyAawMdb8BDr-1l5GKcPk_k0_vhRgvK0ptg",
  authDomain: "timesheetapp-c4e54.firebaseapp.com",
  projectId: "timesheetapp-c4e54",
  storageBucket: "timesheetapp-c4e54.firebasestorage.app",
  messagingSenderId: "97633147981",
  appId: "1:97633147981:web:ee0509bda375a968c71004",
  measurementId: "G-9PQVG8DCJK"
};

// Shearers Head History Configuration (Realtime Database)
const shearersConfig = {
  apiKey: "AIzaSyDXtvrCHrjU_e0v46BbWiBb-e-lAviCSR0",
  authDomain: "shearers-4c4b4.firebaseapp.com",
  databaseURL: "https://shearers-4c4b4-default-rtdb.firebaseio.com",
  projectId: "shearers-4c4b4",
  storageBucket: "shearers-4c4b4.firebasestorage.app",
  messagingSenderId: "178658388175",
  appId: "1:178658388175:web:f85bf8ecb0c88570222fba",
  measurementId: "G-DG6MNF459P"
};

// Initialize Firebase Apps
const ccwIssuesApp = initializeApp(ccwIssuesConfig, 'ccwIssues');
const jobsMasterApp = initializeApp(jobsMasterConfig, 'jobsMaster');
const timesheetApp = initializeApp(timesheetConfig, 'timesheet');
const shearersApp = initializeApp(shearersConfig, 'shearers');

// Initialize Firestore instances
export const ccwIssuesDb = getFirestore(ccwIssuesApp);
export const jobsMasterDb = getFirestore(jobsMasterApp);
export const timesheetDb = getFirestore(timesheetApp);

// Initialize Storage instances
export const jobsStorage = getStorage(jobsMasterApp);
export const ccwIssuesStorage = getStorage(ccwIssuesApp);

// Initialize Realtime Database instance
export const shearersRealtimeDb = getDatabase(shearersApp);
