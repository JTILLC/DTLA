// src/config/timesheetApp.js
//
// A second, READ-ONLY Firebase connection to the timesheet project.
//
// Service report numbers are minted on the invoice side. A job can be worked,
// written up and billed without anybody opening this app, and when that happens
// the visit simply never exists — the machine's history has a hole in it that
// nothing here can see, because the two halves live in different Firebase
// projects. This is the connection that lets the visit list notice.
//
// Everything below is read-only by intent. Nothing in this app writes to the
// timesheet project, and nothing should start: those records belong to the
// timesheet app, and a weigher logger quietly editing invoices is a surprise
// nobody wants.
//
// Same login. Josh signs into all of these with one account, so the second
// sign-in takes the credentials already being typed rather than storing
// anything new.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

const TIMESHEET_CONFIG = {
  apiKey: 'AIzaSyAawMdb8BDr-1l5GKcPk_k0_vhRgvK0ptg',
  authDomain: 'timesheetapp-c4e54.firebaseapp.com',
  projectId: 'timesheetapp-c4e54',
  storageBucket: 'timesheetapp-c4e54.firebasestorage.app',
  messagingSenderId: '97633147981',
  appId: '1:97633147981:web:ee0509bda375a968c71004',
};

const APP_NAME = 'timesheet';

const timesheetApp = () => {
  const existing = firebase.apps.find((a) => a.name === APP_NAME);
  return existing || firebase.initializeApp(TIMESHEET_CONFIG, APP_NAME);
};

export const timesheetDb = () => timesheetApp().firestore();
export const timesheetAuth = () => timesheetApp().auth();

// Sign in alongside the main login.
//
// Deliberately NOT fire-and-forget. The dashboard next door swallows this exact
// failure with Promise.allSettled, and the result is a panel that renders empty
// and says nothing — indistinguishable from "there is nothing to show". The
// caller gets the truth and the UI says "couldn't reach the timesheet app"
// rather than "no service reports found".
export const signInToTimesheet = async (email, password) => {
  try {
    await timesheetAuth().signInWithEmailAndPassword(email, password);
    return { ok: true };
  } catch (err) {
    console.warn('Timesheet sign-in failed:', err);
    return { ok: false, error: err?.message || String(err) };
  }
};

export const isTimesheetSignedIn = () => !!timesheetAuth().currentUser;
