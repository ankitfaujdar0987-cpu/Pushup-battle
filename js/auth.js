// Talks to Firebase: Google sign-in and the player's profile (username + photo).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
export const db = getFirestore(app);

export const USERNAME_RULE = /^[a-z0-9_]{3,16}$/;

export function watchUser(callback) {
  onAuthStateChanged(auth, callback);
}

export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function signOutUser() {
  return signOut(auth);
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Saves the username. Fails with "taken" if somebody already owns it.
export async function createProfile(user, wanted) {
  const username = wanted.trim().toLowerCase();
  if (!USERNAME_RULE.test(username)) throw new Error("bad-username");

  const nameRef = doc(db, "usernames", username);
  const userRef = doc(db, "users", user.uid);
  const photoURL = user.photoURL || null;

  await runTransaction(db, async (tx) => {
    const taken = await tx.get(nameRef);
    if (taken.exists()) throw new Error("taken");
    tx.set(nameRef, { uid: user.uid });
    tx.set(userRef, { username, photoURL, createdAt: serverTimestamp() });
  });

  return { username, photoURL };
}