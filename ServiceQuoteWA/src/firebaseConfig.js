import { initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: "AIzaSyCnBuhq5hT62J3_O5kQRsTQucNDyYxMnsM",
  authDomain: "jobs-data-17ee4.firebaseapp.com",
  databaseURL: "https://jobs-data-17ee4.firebaseio.com",
  projectId: "jobs-data-17ee4",
  storageBucket: "jobs-data-17ee4.firebasestorage.app",
  messagingSenderId: "243005500287",
  appId: "1:243005500287:web:439852c7875e42cc14484a",
  measurementId: "G-3JJSP5QEFM"
};

export const app = initializeApp(firebaseConfig);
