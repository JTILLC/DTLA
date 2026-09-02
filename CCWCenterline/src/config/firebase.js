// Sign-in, and only sign-in.
//
// This app stores nothing in Firebase — centerlines live on the device. The
// only reason an account is needed is that reading a screen costs money per
// call, so the Worker route behind it will not talk to an unidentified caller.
// Auth is therefore the whole of this file: no Firestore, no Storage, no
// persistence layer to go wrong.
//
// The project is downtimelogger-a96fb, the same one the CCW apps use, because
// the Worker's allow-list (SCAN_PROJECT_IDS) already accepts its tokens and Josh
// already has an account on it. Adding a new project would mean a new entry in
// that allow-list and a second set of credentials for no gain.
//
// The config below is not a secret. Firebase web config identifies a project;
// what protects the data is the security rules and, for the reader, the Worker's
// own claims check. The API key that IS a secret — Anthropic's — lives in the
// Worker and never reaches a browser.
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, signInWithEmailAndPassword, signOut as fbSignOut,
  onAuthStateChanged, browserLocalPersistence, setPersistence,
} from 'firebase/auth';

const config = {
  apiKey: 'AIzaSyDnhtjMPh5bkKgRyZEfqIJmVISrJ_UkrB4',
  authDomain: 'downtimelogger-a96fb.firebaseapp.com',
  projectId: 'downtimelogger-a96fb',
  storageBucket: 'downtimelogger-a96fb.firebasestorage.app',
  messagingSenderId: '941297034751',
  appId: '1:941297034751:web:80322c27de1b1b2e0cf3ca',
};

const app = getApps()[0] || initializeApp(config);
export const auth = getAuth(app);

// An engineer signs in once on a tablet and expects it to still be signed in
// the next morning on the next plant floor, quite possibly without signal.
setPersistence(auth, browserLocalPersistence).catch(() => {
  /* private browsing: the session simply won't outlive the tab */
});

export const watchAuth = (fn) => onAuthStateChanged(auth, fn);

export async function signIn(email, password) {
  await signInWithEmailAndPassword(auth, String(email).trim(), password);
}

export const signOut = () => fbSignOut(auth);

/** A fresh ID token for the Worker, or null when nobody is signed in. */
export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

/**
 * Whether this account may actually use the reader, and why not if it may not.
 *
 * The Worker's gate for this project needs `admin` or a `customerId` custom
 * claim — the same rule the CCW storage rules use. Checking it here means a
 * missing claim reads as "your account is not provisioned for this" rather than
 * as an unexplained 403 the moment somebody photographs a screen on site.
 */
export async function readerPermission() {
  const user = auth.currentUser;
  if (!user) return { allowed: false, reason: 'signed-out' };
  const { claims } = await user.getIdTokenResult();
  if (claims?.firebase?.sign_in_provider === 'anonymous') {
    return { allowed: false, reason: 'anonymous' };
  }
  if (claims?.admin === true || claims?.customerId) return { allowed: true };
  return { allowed: false, reason: 'not-provisioned' };
}

/** Firebase's auth errors are codes; these are for a plant floor. */
export function signInMessage(error) {
  switch (error?.code) {
    case 'auth/invalid-email':
      return 'That does not look like an email address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password not recognized.';
    case 'auth/too-many-requests':
      return 'Too many attempts — wait a minute and try again.';
    case 'auth/network-request-failed':
      return 'No connection. You can still type settings in and photograph screens.';
    case 'auth/user-disabled':
      return 'That account has been disabled.';
    default:
      return error?.message || 'Could not sign in.';
  }
}
