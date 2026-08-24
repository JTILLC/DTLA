// Same Firebase project as the TimeSheet app — that is the whole point: what
// this app parses lands in an `import_inbox` collection the timesheet reads,
// instead of a downloaded JSON file a person carries between the two by hand.
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAawMdb8BDr-1l5GKcPk_k0_vhRgvK0ptg",
  authDomain: "timesheetapp-c4e54.firebaseapp.com",
  projectId: "timesheetapp-c4e54",
  storageBucket: "timesheetapp-c4e54.firebasestorage.app",
  messagingSenderId: "97633147981",
  appId: "1:97633147981:web:ee0509bda375a968c71004",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
