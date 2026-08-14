import { db } from './config';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  updateDoc,
  serverTimestamp,
  increment
} from 'firebase/firestore';

// Collection name for customer shares
const SHARES_COLLECTION = 'customer_shares';

// Generate a unique 20-character token
export const generateToken = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 20; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
};

// Create a new share link for a customer (optionally with folder)
export const createShare = async (customerName, folderName = null, equipmentInfo = null) => {
  const token = generateToken();

  const shareData = {
    token,
    customerName,
    folderName, // null means all folders for this customer
    createdAt: serverTimestamp(),
    expiresAt: null, // No expiration
    accessCount: 0,
    lastAccessedAt: null,
    isActive: true
  };

  // Add equipment info if provided
  if (equipmentInfo) {
    if (equipmentInfo.model) shareData.model = equipmentInfo.model;
    if (equipmentInfo.serial) shareData.serial = equipmentInfo.serial;
    if (equipmentInfo.job) shareData.job = equipmentInfo.job;
  }

  await setDoc(doc(db, SHARES_COLLECTION, token), shareData);

  return { token, ...shareData };
};

// Get share data by token (for viewing)
export const getShareByToken = async (token) => {
  const docRef = doc(db, SHARES_COLLECTION, token);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  const data = docSnap.data();

  // Check if share is active
  if (!data.isActive) {
    return null;
  }

  // Increment access count
  await updateDoc(docRef, {
    accessCount: increment(1),
    lastAccessedAt: serverTimestamp()
  });

  return { id: docSnap.id, ...data };
};

// Get all shares for a customer
export const getSharesForCustomer = async (customerName) => {
  const q = query(
    collection(db, SHARES_COLLECTION),
    where('customerName', '==', customerName),
    where('isActive', '==', true)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

// Update equipment info on an existing share
export const updateShareEquipmentInfo = async (token, equipmentInfo) => {
  const docRef = doc(db, SHARES_COLLECTION, token);
  const updateData = {
    model: equipmentInfo.model || null,
    serial: equipmentInfo.serial || null,
    job: equipmentInfo.job || null
  };
  // Remove null values so Firestore deletes the fields
  Object.keys(updateData).forEach(key => {
    if (updateData[key] === null) updateData[key] = '';
  });
  await updateDoc(docRef, updateData);
};

// Revoke (delete) a share
export const revokeShare = async (token) => {
  await deleteDoc(doc(db, SHARES_COLLECTION, token));
};

// Get all active shares (for admin view)
export const getAllShares = async () => {
  const q = query(
    collection(db, SHARES_COLLECTION),
    where('isActive', '==', true)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};
