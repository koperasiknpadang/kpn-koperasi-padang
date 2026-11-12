import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase Web config bukan password. Proteksi data dilakukan oleh Authentication dan Firestore Rules.
const firebaseConfig = {
  apiKey: "AIzaSyAh64y6zGoZyIiVBYP0pr77GJO96BDC184",
  authDomain: "koperasi-kn-padang.firebaseapp.com",
  projectId: "koperasi-kn-padang",
  storageBucket: "koperasi-kn-padang.firebasestorage.app",
  messagingSenderId: "818280942900",
  appId: "1:818280942900:web:83a9c230825fdb5a006961"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);