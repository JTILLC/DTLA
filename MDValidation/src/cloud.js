import { db } from './firebase';
import { collection, doc, setDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';

// Save (create or update) a validation in the given collection for the signed-in user.
export async function saveValidation(col, uid, data) {
  const id = data.cloudId || `${uid}-${Date.now()}`;
  const payload = { ...data, cloudId: id, ownerId: uid, updatedAt: Date.now() };
  await setDoc(doc(db, col, id), payload);
  return id;
}

// List this user's saved validations from a collection, newest first.
export async function listValidations(col, uid) {
  const snap = await getDocs(query(collection(db, col), where('ownerId', '==', uid)));
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function deleteValidation(col, id) {
  await deleteDoc(doc(db, col, id));
}
