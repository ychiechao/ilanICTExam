import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db, onAuthStateChanged, signInWithGoogle, signOut, type User } from "../firebase";
import type { AppUser } from "../types";

export function subscribeToAuth(callback: (user: AppUser | null) => void) {
  if (!auth) {
    callback(null);
    return () => undefined;
  }

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }

    await upsertUser(firebaseUser);
    callback(toAppUser(firebaseUser));
  });
}

export async function loginWithGoogle() {
  const credential = await signInWithGoogle();
  await upsertUser(credential.user);
  return toAppUser(credential.user);
}

export async function logout() {
  if (auth) {
    await signOut(auth);
  }
}

export async function isAdmin(uid?: string) {
  if (!db || !uid) {
    return false;
  }
  const snapshot = await getDoc(doc(db, "admins", uid));
  return snapshot.exists();
}

export async function initializeFirstAdmin(user: AppUser) {
  if (!db) {
    localStorage.setItem("yilan-demo-admin", "true");
    return true;
  }

  const bootstrapRef = doc(db, "settings", "adminBootstrap");
  const bootstrap = await getDoc(bootstrapRef);
  if (bootstrap.exists()) {
    return false;
  }

  const batch = writeBatch(db);
  batch.set(doc(collection(db, "admins"), user.uid), {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email || "",
    createdAt: serverTimestamp(),
  });
  batch.set(bootstrapRef, {
    uid: user.uid,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return true;
}

export function isDemoAdmin() {
  return localStorage.getItem("yilan-demo-admin") === "true";
}

async function upsertUser(user: User) {
  if (!db) {
    return;
  }

  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      displayName: user.displayName || "未命名使用者",
      email: user.email,
      photoURL: user.photoURL,
      lastLoginAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function toAppUser(user: User): AppUser {
  return {
    uid: user.uid,
    displayName: user.displayName || user.email || "參賽者",
    email: user.email,
    photoURL: user.photoURL,
    isAnonymous: user.isAnonymous,
  };
}
