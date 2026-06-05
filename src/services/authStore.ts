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
import { withRemoteTimeout } from "./remote";

const ADMIN_INITIALIZATION_TIMEOUT_MS = 25000;

export type AdminInitializationStatus =
  | "created"
  | "already-admin"
  | "bootstrap-exists"
  | "local-demo";

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

    if (await isUserDisabled(firebaseUser.uid)) {
      if (auth) {
        await signOut(auth);
      }
      callback(null);
      return;
    }

    const appUser = toAppUser(firebaseUser);
    await upsertUser(firebaseUser);
    await autoInitializeFirstAdmin(appUser);
    callback(appUser);
  });
}

export async function loginWithGoogle() {
  const credential = await signInWithGoogle();
  if (await isUserDisabled(credential.user.uid)) {
    if (auth) {
      await signOut(auth);
    }
    throw new Error("此帳號已停用，請聯絡管理者。");
  }
  await upsertUser(credential.user);
  const appUser = toAppUser(credential.user);
  await autoInitializeFirstAdmin(appUser);
  return appUser;
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
  try {
    const snapshot = await withRemoteTimeout(getDoc(doc(db, "admins", uid)), "Firestore 管理者讀取");
    return snapshot.exists();
  } catch (error) {
    console.warn("Firestore 管理者讀取失敗。", error);
    return false;
  }
}

async function isUserDisabled(uid: string) {
  if (!db || !uid) {
    return false;
  }

  try {
    const snapshot = await withRemoteTimeout(getDoc(doc(db, "users", uid)), "Firestore 使用者狀態讀取");
    return snapshot.exists() && snapshot.data().disabled === true;
  } catch (error) {
    console.warn("Firestore 使用者狀態讀取失敗", error);
    return false;
  }
}

export async function initializeFirstAdmin(user: AppUser): Promise<AdminInitializationStatus> {
  if (!db) {
    localStorage.setItem("yilan-demo-admin", "true");
    return "local-demo";
  }

  if (await isAdmin(user.uid)) {
    return "already-admin";
  }

  const bootstrapRef = doc(db, "settings", "adminBootstrap");
  const bootstrap = await withRemoteTimeout(
    getDoc(bootstrapRef),
    "Firestore 管理者初始化檢查",
    ADMIN_INITIALIZATION_TIMEOUT_MS,
  );
  if (bootstrap.exists()) {
    return "bootstrap-exists";
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
  await withRemoteTimeout(
    batch.commit(),
    "Firestore 管理者初始化",
    ADMIN_INITIALIZATION_TIMEOUT_MS,
  );
  return "created";
}

export function isDemoAdmin() {
  return localStorage.getItem("yilan-demo-admin") === "true";
}

async function autoInitializeFirstAdmin(user: AppUser) {
  try {
    await initializeFirstAdmin(user);
  } catch {
    console.info("管理者自動初始化未完成，將維持目前權限。");
  }
}

async function upsertUser(user: User) {
  if (!db) {
    return;
  }

  try {
    await withRemoteTimeout(
      setDoc(
        doc(db, "users", user.uid),
        {
          uid: user.uid,
          displayName: user.displayName || "未命名使用者",
          email: user.email,
          photoURL: user.photoURL,
          lastLoginAt: serverTimestamp(),
        },
        { merge: true },
      ),
      "Firestore 使用者資料更新",
    );
  } catch (error) {
    console.warn("Firestore 使用者資料更新失敗，略過遠端紀錄。", error);
  }
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
