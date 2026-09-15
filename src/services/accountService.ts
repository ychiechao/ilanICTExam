import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import type { AdminProfile, AppUser, ManagedUser, School, UserRole } from "../types";
import { withRemoteTimeout } from "./remote";

export const TEACHER_EMAIL_DOMAIN = "tmail.ilc.edu.tw";
export const STUDENT_EMAIL_DOMAIN = "smail.ilc.edu.tw";

export function getEmailDomain(email?: string | null) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const atIndex = normalizedEmail.lastIndexOf("@");
  return atIndex >= 0 ? normalizedEmail.slice(atIndex + 1) : "";
}

export function inferUserRoleFromEmail(email?: string | null): UserRole {
  const domain = getEmailDomain(email);
  if (domain === TEACHER_EMAIL_DOMAIN) {
    return "teacher";
  }
  return "student";
}

export function getRoleLabel(role?: UserRole) {
  if (role === "super") {
    return "超級管理者";
  }
  if (role === "teacher") {
    return "教師";
  }
  return "學生";
}

export function getAccountStatusLabel(status?: string, disabled?: boolean) {
  if (disabled || status === "disabled") {
    return "停用";
  }
  if (status === "pending") {
    return "待確認";
  }
  return "啟用";
}

export async function loadUserProfile(uid?: string): Promise<ManagedUser | null> {
  if (!db || !uid) {
    return null;
  }

  const snapshot = await withRemoteTimeout(
    getDoc(doc(db, "users", uid)),
    "Firestore 個人帳號資料讀取",
  );
  return snapshot.exists() ? normalizeManagedUser(snapshot.data()) : null;
}

export async function saveAccountSchoolSelection({
  user,
  school,
  role,
  actorUid,
  source,
  verified,
}: {
  user: AppUser | ManagedUser;
  school: School;
  role: UserRole;
  actorUid?: string;
  source: "self" | "admin";
  verified: boolean;
}) {
  if (!db) {
    return;
  }

  const schoolPatch = {
    schoolId: school.id,
    schoolName: school.name,
    schoolSource: source,
    schoolVerified: verified,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid || user.uid,
  };

  await withRemoteTimeout(
    setDoc(
      doc(db, "users", user.uid),
      {
        uid: user.uid,
        displayName: user.displayName || user.email || "未命名使用者",
        email: user.email || "",
        role,
        status: "active",
        ...schoolPatch,
      },
      { merge: true },
    ),
    "Firestore 個人學校資料儲存",
  );

  if (role === "teacher") {
    await withRemoteTimeout(
      setDoc(
        doc(db, "admins", user.uid),
        {
          uid: user.uid,
          displayName: user.displayName || user.email || "未命名教師",
          email: user.email || "",
          role: "teacher",
          status: "active",
          schoolIds: [school.id],
          ...schoolPatch,
        },
        { merge: true },
      ),
      "Firestore 教師學校資料儲存",
    );
  }
}

export function getEffectiveRole(
  user: AppUser | null,
  userProfile: ManagedUser | null,
  adminProfile: AdminProfile | null,
): UserRole {
  if (adminProfile?.role === "super") {
    return "super";
  }
  if (adminProfile?.role === "teacher") {
    return "teacher";
  }
  if (userProfile?.role && userProfile.role !== "super") {
    return userProfile.role;
  }
  return inferUserRoleFromEmail(user?.email);
}

function normalizeManagedUser(input: unknown): ManagedUser {
  const record = isRecord(input) ? input : {};
  const email = readText(record.email);
  const role = normalizeUserRole(record.role, email);
  return {
    uid: readText(record.uid),
    displayName: readText(record.displayName, email || "未命名使用者"),
    email,
    photoURL: readText(record.photoURL),
    role,
    status: record.status === "pending" || record.status === "disabled" ? record.status : "active",
    emailDomain: readText(record.emailDomain, getEmailDomain(email)),
    schoolId: readText(record.schoolId),
    schoolName: readText(record.schoolName),
    schoolVerified: record.schoolVerified === true,
    schoolSource: record.schoolSource === "admin" ? "admin" : record.schoolSource === "self" ? "self" : undefined,
    lastLoginAt: record.lastLoginAt,
    disabled: record.disabled === true,
    disabledAt: record.disabledAt,
    disabledBy: readText(record.disabledBy),
  };
}

function normalizeUserRole(value: unknown, email: string): UserRole {
  if (value === "super") {
    return "super";
  }
  if (value === "teacher" || value === "school") {
    return "teacher";
  }
  return inferUserRoleFromEmail(email);
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
