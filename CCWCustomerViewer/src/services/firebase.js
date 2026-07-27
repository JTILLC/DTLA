import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs, onSnapshot, updateDoc, increment, query, orderBy } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDnhtjMPh5bkKgRyZEfqIJmVISrJ_UkrB4",
  authDomain: "downtimelogger-a96fb.firebaseapp.com",
  projectId: "downtimelogger-a96fb",
  storageBucket: "downtimelogger-a96fb.firebasestorage.app",
  messagingSenderId: "941297034751",
  appId: "1:941297034751:web:80322c27de1b1b2e0cf3ca",
  measurementId: "G-ZRNDDFPK74",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Once a share link (or its customer's public-read window) expires, the security
// rules deny the read outright, so the SDK throws permission-denied rather than
// returning an expired document. Translate that into something a customer can
// act on instead of a generic failure.
const EXPIRED_MESSAGE =
  'This link has expired or been revoked. Please ask JTI Service for a new link.';

const isDenied = (error) =>
  error?.code === 'permission-denied' || error?.code === 'firestore/permission-denied';

// Fetch share data by token
export const getShareData = async (token) => {
  try {
    const shareRef = doc(db, 'shared_visits', token);
    const shareSnap = await getDoc(shareRef);

    if (!shareSnap.exists()) {
      return { error: 'Share link not found or has expired' };
    }

    const shareData = shareSnap.data();

    // Check expiration
    if (shareData.expiresAt && shareData.expiresAt.toDate() < new Date()) {
      return { error: 'This share link has expired' };
    }

    // (Access-count tracking removed — the login-less viewer can't write to
    // shared_visits under the current rules, so it only added a failing round-trip.)

    return { success: true, data: shareData };
  } catch (error) {
    console.error('Error fetching share data:', error);
    return { error: isDenied(error) ? EXPIRED_MESSAGE : 'Failed to load share data' };
  }
};

// Fetch visit data using share info
export const getVisitData = async (shareData) => {
  try {
    const { userId, customerId, visitId } = shareData;

    // Get customer profile
    const customerRef = doc(db, 'user_files', userId, 'customers', customerId);
    const customerSnap = await getDoc(customerRef);

    if (!customerSnap.exists()) {
      return { error: 'Customer not found' };
    }

    const customerProfile = customerSnap.data().profile;

    // Get visit data
    const visitRef = doc(db, 'user_files', userId, 'customers', customerId, 'visits', visitId);
    const visitSnap = await getDoc(visitRef);

    if (!visitSnap.exists()) {
      return { error: 'Visit not found' };
    }

    const visitData = visitSnap.data();
    if (visitData.deleted) {
      return { error: 'Visit not found' };
    }

    return {
      success: true,
      customer: customerProfile,
      visit: visitData
    };
  } catch (error) {
    console.error('Error fetching visit data:', error);
    return { error: isDenied(error) ? EXPIRED_MESSAGE : 'Failed to load visit data' };
  }
};

// Subscribe to real-time visit updates
export const subscribeToVisit = (shareData, visitId, callback) => {
  const { userId, customerId } = shareData;
  const actualVisitId = visitId || shareData.visitId;
  const visitRef = doc(db, 'user_files', userId, 'customers', customerId, 'visits', actualVisitId);

  return onSnapshot(visitRef, (snapshot) => {
    if (snapshot.exists() && !snapshot.data().deleted) {
      callback({ success: true, visit: { id: snapshot.id, ...snapshot.data() } });
    } else {
      callback({ error: 'Visit no longer exists' });
    }
  }, (error) => {
    console.error('Subscription error:', error);
    callback({ error: 'Connection lost' });
  });
};

// Fetch all visits for a customer
export const getAllVisits = async (shareData) => {
  try {
    const { userId, customerId } = shareData;
    const visitsRef = collection(db, 'user_files', userId, 'customers', customerId, 'visits');
    const q = query(visitsRef, orderBy('date', 'desc'));
    const snapshot = await getDocs(q);

    const visits = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      // Hide soft-deleted visits (recycle bin) — the CCW Issues app filters
      // these out too, so the counts match.
      .filter(v => !v.deleted);

    return { success: true, visits };
  } catch (error) {
    console.error('Error fetching all visits:', error);
    return { error: isDenied(error) ? EXPIRED_MESSAGE : 'Failed to load visits' };
  }
};

// Fetch a specific visit
export const getSpecificVisit = async (shareData, visitId) => {
  try {
    const { userId, customerId } = shareData;
    const visitRef = doc(db, 'user_files', userId, 'customers', customerId, 'visits', visitId);
    const visitSnap = await getDoc(visitRef);

    if (!visitSnap.exists() || visitSnap.data().deleted) {
      return { error: 'Visit not found' };
    }

    return {
      success: true,
      visit: { id: visitSnap.id, ...visitSnap.data() }
    };
  } catch (error) {
    console.error('Error fetching visit:', error);
    return { error: isDenied(error) ? EXPIRED_MESSAGE : 'Failed to load visit' };
  }
};

export { db };
