import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, ManagedUser } from "../types";
import { withRemoteTimeout } from "./remote";

export async function loadManagedUsers(): Promise<ManagedUser[]> {
  if (!db) {
    return [];
  }

  const snapshot = await withRemoteTimeout(
    getDocs(collection(db, "users")),
    "Firestore 使用者讀取",
  );

  return snapshot.docs
    .map((item) => item.data() as ManagedUser)
    .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "zh-Hant", { numeric: true }));
}

export async function loadAdminUids(): Promise<Set<string>> {
  if (!db) {
    return new Set(localStorage.getItem("yilan-demo-admin") === "true" ? ["demo-admin"] : []);
  }

  const snapshot = await withRemoteTimeout(
    getDocs(collection(db, "admins")),
    "Firestore 管理者讀取",
  );

  return new Set(snapshot.docs.map((item) => item.id));
}

export async function setManagedUserAdmin(
  target: ManagedUser,
  makeAdmin: boolean,
  actor: AppUser | null,
) {
  if (!db) {
    if (makeAdmin) {
      localStorage.setItem("yilan-demo-admin", "true");
    }
    return;
  }

  const adminRef = doc(db, "admins", target.uid);
  if (makeAdmin) {
    await withRemoteTimeout(
      setDoc(adminRef, {
        uid: target.uid,
        displayName: target.displayName || target.email || "未命名使用者",
        email: target.email || "",
        updatedAt: serverTimestamp(),
        updatedBy: actor?.uid || "",
      }),
      "Firestore 管理者儲存",
    );
    return;
  }

  await withRemoteTimeout(deleteDoc(adminRef), "Firestore 管理者移除");
}

export async function setManagedUserDisabled(
  target: ManagedUser,
  disabled: boolean,
  actor: AppUser | null,
) {
  if (!db) {
    return;
  }

  await withRemoteTimeout(
    setDoc(
      doc(db, "users", target.uid),
      {
        uid: target.uid,
        displayName: target.displayName || target.email || "未命名使用者",
        email: target.email || "",
        photoURL: target.photoURL || "",
        disabled,
        disabledAt: disabled ? serverTimestamp() : null,
        disabledBy: disabled ? actor?.uid || "" : "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
    "Firestore 使用者停用狀態儲存",
  );
}

export async function deleteManagedUserProfile(target: ManagedUser) {
  if (!db) {
    return;
  }

  await withRemoteTimeout(
    Promise.all([
      deleteDoc(doc(db, "users", target.uid)),
      deleteDoc(doc(db, "admins", target.uid)),
    ]),
    "Firestore 使用者資料刪除",
  );
}
