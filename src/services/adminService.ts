import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import type { AdminProfile, AdminRole, AppUser, ManagedUser } from "../types";
import { getEmailDomain, inferUserRoleFromEmail, saveAccountSchoolSelection } from "./accountService";
import { withRemoteTimeout } from "./remote";

export async function loadManagedUsers(): Promise<ManagedUser[]> {
  if (!db) {
    return [];
  }

  const snapshot = await withRemoteTimeout(
    getDocs(collection(db, "users")),
    "Firestore 使用者資料讀取",
  );

  return snapshot.docs
    .map((item) => ({ ...(item.data() as ManagedUser), uid: item.id }))
    .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "zh-Hant", { numeric: true }));
}

export async function loadAdminProfiles(): Promise<AdminProfile[]> {
  if (!db) {
    return localStorage.getItem("yilan-demo-admin") === "true"
      ? [
          {
            uid: "demo-admin",
            displayName: "Demo Admin",
            role: "super",
            schoolIds: [],
          },
        ]
      : [];
  }

  const snapshot = await withRemoteTimeout(
    getDocs(collection(db, "admins")),
    "Firestore 管理者資料讀取",
  );

  return snapshot.docs
    .map((item) => normalizeAdminProfile(item.id, item.data()))
    .filter((profile): profile is AdminProfile => Boolean(profile))
    .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "zh-Hant", { numeric: true }));
}

export async function loadAdminProfile(uid?: string): Promise<AdminProfile | null> {
  if (!uid) {
    return null;
  }
  if (!db) {
    return localStorage.getItem("yilan-demo-admin") === "true"
      ? {
          uid,
          displayName: "Demo Admin",
          role: "super",
          schoolIds: [],
        }
      : null;
  }

  const snapshot = await withRemoteTimeout(
    getDoc(doc(db, "admins", uid)),
    "Firestore 管理者身分讀取",
  );
  return snapshot.exists() ? normalizeAdminProfile(uid, snapshot.data()) : null;
}

export async function loadAdminUids(): Promise<Set<string>> {
  const profiles = await loadAdminProfiles();
  return new Set(profiles.map((item) => item.uid));
}

export async function setManagedUserAdmin(
  target: ManagedUser,
  makeAdmin: boolean,
  actor: AppUser | null,
) {
  await setManagedUserAdminRole(target, makeAdmin ? "super" : null, actor);
}

export async function setManagedUserSchoolAdmin(
  target: ManagedUser,
  schoolIds: string[],
  actor: AppUser | null,
) {
  const normalizedSchoolIds = Array.from(new Set(schoolIds.map((schoolId) => schoolId.trim()).filter(Boolean)));
  if (normalizedSchoolIds.length === 0) {
    throw new Error("請先選擇要指派的學校。");
  }
  await setManagedUserAdminRole(target, "teacher", actor, normalizedSchoolIds);
}

export async function setManagedUserTeacherSchool(
  target: ManagedUser,
  school: { id: string; name: string; enabled?: boolean },
  actor: AppUser | null,
) {
  await setManagedUserAdminRole(target, "teacher", actor, [school.id]);
  await saveAccountSchoolSelection({
    user: target,
    school: {
      id: school.id,
      name: school.name,
      domains: [],
      enabled: school.enabled,
    },
    role: "teacher",
    actorUid: actor?.uid || "",
    source: "admin",
    verified: true,
  });
}

export async function setManagedUserAdminRole(
  target: ManagedUser,
  role: AdminRole | null,
  actor: AppUser | null,
  schoolIds: string[] = [],
) {
  if (!db) {
    if (role === "super") {
      localStorage.setItem("yilan-demo-admin", "true");
    }
    if (!role) {
      localStorage.removeItem("yilan-demo-admin");
    }
    return;
  }

  const adminRef = doc(db, "admins", target.uid);
  if (!role) {
    await withRemoteTimeout(deleteDoc(adminRef), "Firestore 管理者權限移除");
    return;
  }

  await withRemoteTimeout(
    setDoc(
      adminRef,
      {
        uid: target.uid,
        displayName: target.displayName || target.email || "未命名使用者",
        email: target.email || "",
        role,
        schoolIds: role === "teacher" ? schoolIds : [],
        updatedAt: serverTimestamp(),
        updatedBy: actor?.uid || "",
      },
      { merge: true },
    ),
    "Firestore 管理者權限儲存",
  );
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
        role: inferUserRoleFromEmail(target.email),
        emailDomain: getEmailDomain(target.email),
        photoURL: target.photoURL || "",
        disabled,
        status: disabled ? "disabled" : "active",
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
  const firestore = db;
  if (!firestore) {
    return;
  }
  if (!target.uid) {
    throw new Error("使用者 UID 不完整，無法刪除。請重新整理後再試。");
  }

  await cleanupManagedUserReferences(firestore, target);

  await withRemoteTimeout(
    Promise.all([
      deleteDoc(doc(firestore, "users", target.uid)),
      deleteDoc(doc(firestore, "admins", target.uid)),
    ]),
    "Firestore 使用者資料刪除",
  );
}

async function cleanupManagedUserReferences(firestore: NonNullable<typeof db>, target: ManagedUser) {
  const now = new Date().toISOString();
  const [schoolAccountSnapshot, rosterSnapshot, classMemberSnapshot, classSnapshot] = await Promise.all([
    withRemoteTimeout(
      getDocs(query(collection(firestore, "schoolAccounts"), where("uid", "==", target.uid))),
      "Firestore 使用者學校帳號關聯讀取",
    ),
    withRemoteTimeout(
      getDocs(query(collection(firestore, "contestRoster"), where("uid", "==", target.uid))),
      "Firestore 使用者賽事名單關聯讀取",
    ),
    withRemoteTimeout(
      getDocs(query(collection(firestore, "classMembers"), where("studentUid", "==", target.uid))),
      "Firestore 使用者班級成員關聯讀取",
    ),
    withRemoteTimeout(
      getDocs(query(collection(firestore, "classes"), where("teacherUid", "==", target.uid))),
      "Firestore 使用者授課班級關聯讀取",
    ),
  ]);

  const mutations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [
    ...schoolAccountSnapshot.docs.map((item) => (batch: ReturnType<typeof writeBatch>) => {
      batch.set(item.ref, { uid: "", updatedAt: now }, { merge: true });
    }),
    ...rosterSnapshot.docs.map((item) => (batch: ReturnType<typeof writeBatch>) => {
      batch.set(item.ref, { uid: "", updatedAt: now }, { merge: true });
    }),
    ...classMemberSnapshot.docs.map((item) => (batch: ReturnType<typeof writeBatch>) => {
      batch.set(item.ref, { status: "removed", updatedAt: now }, { merge: true });
    }),
    ...classSnapshot.docs.map((item) => (batch: ReturnType<typeof writeBatch>) => {
      batch.set(item.ref, { archived: true, joinEnabled: false, updatedAt: now }, { merge: true });
    }),
  ];

  await commitBatchMutations(firestore, mutations, "Firestore 使用者關聯資料清理");
}

async function commitBatchMutations(
  firestore: NonNullable<typeof db>,
  mutations: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  label: string,
) {
  for (let index = 0; index < mutations.length; index += 450) {
    const batch = writeBatch(firestore);
    mutations.slice(index, index + 450).forEach((mutate) => mutate(batch));
    await withRemoteTimeout(batch.commit(), label);
  }
}

function normalizeAdminProfile(uid: string, input: unknown): AdminProfile | null {
  const record = isRecord(input) ? input : {};
  if (record.role === "student") {
    return null;
  }
  const role = record.role === "teacher" || record.role === "school" ? "teacher" : "super";
  const schoolIds = Array.isArray(record.schoolIds)
    ? record.schoolIds.map((item) => readText(item)).filter(Boolean)
    : [];

  return {
    uid: readText(record.uid, uid),
    displayName: readText(record.displayName, readText(record.email, "未命名管理者")),
    email: readText(record.email),
    role,
    status: record.status === "pending" || record.status === "disabled" ? record.status : "active",
    schoolId: readText(record.schoolId, schoolIds[0] || ""),
    schoolName: readText(record.schoolName),
    schoolIds,
    schoolVerified: record.schoolVerified === true,
    schoolSource: record.schoolSource === "admin" ? "admin" : record.schoolSource === "self" ? "self" : undefined,
    updatedAt: record.updatedAt,
    updatedBy: readText(record.updatedBy),
  };
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
