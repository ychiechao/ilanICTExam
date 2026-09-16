import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db, onAuthStateChanged, signInWithCustomToken, signInWithGoogle, signOut, type User } from "../firebase";
import { graderRequest } from "./grader";
import type { AppUser } from "../types";
import { getEmailDomain, inferUserRoleFromEmail } from "./accountService";
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

    // 競賽帳號：身分全在 token claims，不建 users 文件、不跑管理者初始化。
    const contestUser = await toContestAppUser(firebaseUser);
    if (contestUser) {
      callback(contestUser);
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
    await autoInitializeTeacherProfile(appUser);
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
  await autoInitializeTeacherProfile(appUser);
  return appUser;
}

/**
 * 競賽帳號登入：Worker 驗證帳號密碼後簽發自訂 token，再交給 Firebase。
 * 之後 onAuthStateChanged 會以 token claims 建立 AppUser。
 */
export async function loginWithContestAccount(username: string, password: string) {
  if (!auth) {
    throw new Error("尚未設定 Firebase，無法登入競賽帳號。");
  }
  const data = await graderRequest<{ token: string }>("/login", {
    method: "POST",
    body: { username, password, fingerprint: await deviceFingerprint() },
  });
  await signInWithCustomToken(auth, data.token);
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

export async function isSuperAdmin(uid?: string) {
  if (!db) {
    return isDemoAdmin();
  }
  if (!uid) {
    return false;
  }
  try {
    const snapshot = await withRemoteTimeout(getDoc(doc(db, "admins", uid)), "Firestore 超級管理者讀取");
    if (!snapshot.exists()) {
      return false;
    }
    const role = snapshot.data().role;
    return isSuperAdminRole(role);
  } catch (error) {
    console.warn("Firestore 超級管理者讀取失敗。", error);
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
    role: "super",
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
  return !db && typeof localStorage !== "undefined" && localStorage.getItem("yilan-demo-admin") === "true";
}

function isSuperAdminRole(role: unknown) {
  return role !== "teacher" && role !== "school" && role !== "student";
}

async function autoInitializeFirstAdmin(user: AppUser) {
  try {
    await initializeFirstAdmin(user);
  } catch {
    console.info("管理者自動初始化未完成，將維持目前權限。");
  }
}

async function autoInitializeTeacherProfile(user: AppUser) {
  if (!db || inferUserRoleFromEmail(user.email) !== "teacher") {
    return;
  }

  try {
    const adminRef = doc(db, "admins", user.uid);
    const snapshot = await withRemoteTimeout(getDoc(adminRef), "Firestore 教師身分讀取");
    if (snapshot.exists()) {
      return;
    }
    await withRemoteTimeout(
      setDoc(
        adminRef,
        {
          uid: user.uid,
          displayName: user.displayName || user.email || "未命名教師",
          email: user.email || "",
          role: "teacher",
          status: "active",
          schoolIds: [],
          schoolVerified: false,
          schoolSource: "self",
          createdAt: serverTimestamp(),
        },
        { merge: true },
      ),
      "Firestore 教師身分初始化",
    );
  } catch (error) {
    console.info("教師身分初始化未完成，將維持目前權限。", error);
  }
}

async function upsertUser(user: User) {
  if (!db) {
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const existingSnapshot = await withRemoteTimeout(getDoc(userRef), "Firestore 使用者資料讀取");
    const existing = existingSnapshot.exists() ? existingSnapshot.data() : {};
    const inferredRole = inferUserRoleFromEmail(user.email);
    const nextRole = existing.role || inferredRole;
    const nextStatus = existing.status || "active";
    await withRemoteTimeout(
      setDoc(
        userRef,
        {
          uid: user.uid,
          displayName: user.displayName || "未命名使用者",
          email: user.email,
          emailDomain: getEmailDomain(user.email),
          role: nextRole,
          status: nextStatus,
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

async function toContestAppUser(user: User): Promise<AppUser | null> {
  try {
    const result = await user.getIdTokenResult();
    if (result.claims.accountType !== "contest") {
      return null;
    }
    return {
      uid: user.uid,
      displayName: String(result.claims.displayName || result.claims.username || "參賽者"),
      email: null,
      photoURL: null,
      accountType: "contest",
      contestId: String(result.claims.contestId || ""),
      contestUsername: String(result.claims.username || ""),
      schoolId: String(result.claims.schoolId || ""),
    };
  } catch (error) {
    console.warn("讀取 token claims 失敗", error);
    return null;
  }
}

/** 粗略的裝置指紋：只用來在審核時看「換過裝置」，不做阻擋（規格 D14）。 */
async function deviceFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
