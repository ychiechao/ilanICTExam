import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, ClassMember, ClassSubmissionView, LearningClass, School, SubmissionRecord } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

const LOCAL_CLASSES_KEY = "yilan-learning-classes";
const LOCAL_CLASS_MEMBERS_KEY = "yilan-learning-class-members";

export async function loadTeacherClasses(teacherUid?: string): Promise<LearningClass[]> {
  if (!teacherUid) {
    return [];
  }

  if (db) {
    const snapshot = await withRemoteTimeout(
      getDocs(query(collection(db, "classes"), where("teacherUid", "==", teacherUid))),
      "Firestore 教師班級讀取",
    );
    return sortClasses(snapshot.docs.map((item) => normalizeClass(item.data())));
  }

  return sortClasses(
    readJson<LearningClass[]>(LOCAL_CLASSES_KEY, []).filter(
      (item) => item.teacherUid === teacherUid && item.archived !== true,
    ),
  );
}

export async function loadClassMembers(classIds: string[]): Promise<ClassMember[]> {
  const targetIds = Array.from(new Set(classIds.map((classId) => classId.trim()).filter(Boolean)));
  if (targetIds.length === 0) {
    return [];
  }

  if (db) {
    const snapshots = [];
    const collectionRef = collection(db, "classMembers");
    for (let index = 0; index < targetIds.length; index += 10) {
      const chunk = targetIds.slice(index, index + 10);
      snapshots.push(
        withRemoteTimeout(
          getDocs(query(collectionRef, where("classId", "in", chunk))),
          "Firestore 班級成員讀取",
        ),
      );
    }
    const loadedSnapshots = await Promise.all(snapshots);
    return sortClassMembers(
      loadedSnapshots.flatMap((snapshot) => snapshot.docs.map((item) => normalizeClassMember(item.data()))),
    );
  }

  const targetSet = new Set(targetIds);
  return sortClassMembers(
    readJson<ClassMember[]>(LOCAL_CLASS_MEMBERS_KEY, []).filter((item) => targetSet.has(item.classId)),
  );
}

/** 超管回填排行榜用：全部班級成員。 */
export async function loadAllClassMembers(): Promise<ClassMember[]> {
  if (!db) {
    return readJson<ClassMember[]>(LOCAL_CLASS_MEMBERS_KEY, []);
  }
  const snapshot = await withRemoteTimeout(getDocs(collection(db, "classMembers")), "Firestore 班級成員讀取", 60000);
  return snapshot.docs.map((item) => normalizeClassMember(item.data()));
}

export async function loadStudentClassMembers(studentUid?: string): Promise<ClassMember[]> {
  if (!studentUid) {
    return [];
  }

  if (db) {
    const snapshot = await withRemoteTimeout(
      getDocs(query(collection(db, "classMembers"), where("studentUid", "==", studentUid))),
      "Firestore 學生班級讀取",
    );
    return sortClassMembers(snapshot.docs.map((item) => normalizeClassMember(item.data())));
  }

  return sortClassMembers(
    readJson<ClassMember[]>(LOCAL_CLASS_MEMBERS_KEY, []).filter((item) => item.studentUid === studentUid),
  );
}

export async function loadClassSubmissionViews(classIds: string[]): Promise<ClassSubmissionView[]> {
  const targetIds = Array.from(new Set(classIds.map((classId) => classId.trim()).filter(Boolean)));
  if (targetIds.length === 0) {
    return [];
  }

  if (db) {
    const snapshots = [];
    const collectionRef = collection(db, "classSubmissionViews");
    for (let index = 0; index < targetIds.length; index += 10) {
      const chunk = targetIds.slice(index, index + 10);
      snapshots.push(
        withRemoteTimeout(
          getDocs(query(collectionRef, where("classId", "in", chunk))),
          "Firestore 班級答題紀錄讀取",
        ),
      );
    }
    const loadedSnapshots = await Promise.all(snapshots);
    return sortClassSubmissionViews(
      loadedSnapshots.flatMap((snapshot) =>
        snapshot.docs.map((item) => normalizeClassSubmissionView({ ...item.data(), id: item.id })),
      ),
    );
  }

  return [];
}

export async function saveClassSubmissionViewsForSubmission(
  user: AppUser,
  submission: SubmissionRecord,
) {
  if (!db || !user.uid || !submission.id) {
    return;
  }

  const memberships = (await loadStudentClassMembers(user.uid)).filter((member) => member.status !== "removed");
  if (memberships.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  for (let index = 0; index < memberships.length; index += 450) {
    const batch = writeBatch(db);
    for (const member of memberships.slice(index, index + 450)) {
      const view = normalizeClassSubmissionView({
        id: getClassSubmissionViewId(member.classId, submission.id),
        classId: member.classId,
        className: member.className,
        classMemberId: member.id,
        teacherUid: member.teacherUid,
        studentUid: user.uid,
        studentName: user.displayName || user.email || member.studentName,
        studentEmail: user.email || member.studentEmail || "",
        submissionId: submission.id,
        problemId: submission.problemId,
        problemTitle: submission.problemTitle,
        mode: submission.mode,
        score: submission.score,
        maxScore: submission.maxScore,
        passRate: submission.passRate,
        status: submission.status,
        isFullScore: submission.isFullScore === true,
        createdAt: submission.createdAt,
        updatedAt: now,
      });
      batch.set(doc(db, "classSubmissionViews", view.id), view, { merge: true });
    }
    await withRemoteTimeout(batch.commit(), "Firestore 班級答題紀錄同步");
  }
}

export async function createLearningClass({
  name,
  teacher,
  school,
}: {
  name: string;
  teacher: AppUser;
  school: School;
}) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("請輸入班級名稱。");
  }
  if (!school.id) {
    throw new Error("請先在「我的帳號」設定任教學校。");
  }

  const now = new Date().toISOString();
  const learningClass = normalizeClass({
    id: `class-${Date.now()}`,
    name: normalizedName,
    schoolId: school.id,
    schoolName: school.name,
    teacherUid: teacher.uid,
    teacherName: teacher.displayName || teacher.email || "未命名教師",
    joinCode: createJoinCode(),
    joinEnabled: true,
    archived: false,
    memberCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "classes", learningClass.id), learningClass),
      "Firestore 班級建立",
    );
    return learningClass;
  }

  const current = readJson<LearningClass[]>(LOCAL_CLASSES_KEY, []);
  writeJson(LOCAL_CLASSES_KEY, sortClasses([...current, learningClass]));
  return learningClass;
}

export async function setClassJoinEnabled(learningClass: LearningClass, joinEnabled: boolean) {
  const updatedClass = normalizeClass({
    ...learningClass,
    joinEnabled,
    updatedAt: new Date().toISOString(),
  });

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "classes", updatedClass.id), updatedClass, { merge: true }),
      "Firestore 班級加入狀態更新",
    );
    return updatedClass;
  }

  const current = readJson<LearningClass[]>(LOCAL_CLASSES_KEY, []);
  writeJson(
    LOCAL_CLASSES_KEY,
    sortClasses([...current.filter((item) => item.id !== updatedClass.id), updatedClass]),
  );
  return updatedClass;
}

export async function setClassMemberStatus(member: ClassMember, status: ClassMember["status"]) {
  const updatedMember = normalizeClassMember({
    ...member,
    status,
    updatedAt: new Date().toISOString(),
  });

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "classMembers", updatedMember.id), updatedMember, { merge: true }),
      "Firestore 班級學生狀態更新",
    );
    return updatedMember;
  }

  const currentMembers = readJson<ClassMember[]>(LOCAL_CLASS_MEMBERS_KEY, []);
  writeJson(
    LOCAL_CLASS_MEMBERS_KEY,
    sortClassMembers([...currentMembers.filter((item) => item.id !== updatedMember.id), updatedMember]),
  );
  return updatedMember;
}

export async function joinClassByCode(rawJoinCode: string, student: AppUser) {
  const joinCode = normalizeJoinCode(rawJoinCode);
  if (!joinCode) {
    throw new Error("請輸入班級代碼。");
  }

  const learningClass = await findClassByJoinCode(joinCode);
  if (!learningClass) {
    throw new Error("找不到這個班級代碼。");
  }
  if (learningClass.joinEnabled === false || learningClass.archived === true) {
    throw new Error("這個班級目前未開放加入。");
  }

  const now = new Date().toISOString();
  const member = normalizeClassMember({
    id: getClassMemberId(learningClass.id, student.uid),
    classId: learningClass.id,
    className: learningClass.name,
    schoolId: learningClass.schoolId,
    schoolName: learningClass.schoolName,
    teacherUid: learningClass.teacherUid,
    teacherName: learningClass.teacherName,
    studentUid: student.uid,
    studentName: student.displayName || student.email || "未命名學生",
    studentEmail: student.email || "",
    status: "active",
    joinedAt: now,
    updatedAt: now,
  });

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "classMembers", member.id), member, { merge: true }),
      "Firestore 加入班級",
    );
    // 加入班級即帶入開課教師的學校（規格 7.3）；學生不必再自己選。
    if (learningClass.schoolId) {
      await withRemoteTimeout(
        setDoc(
          doc(db, "users", student.uid),
          {
            uid: student.uid,
            schoolId: learningClass.schoolId,
            schoolName: learningClass.schoolName,
            schoolSource: "class",
            schoolVerified: true,
            updatedAt: serverTimestamp(),
            updatedBy: student.uid,
          },
          { merge: true },
        ),
        "Firestore 學生學校更新",
      );
    }
    return member;
  }

  const currentMembers = readJson<ClassMember[]>(LOCAL_CLASS_MEMBERS_KEY, []);
  writeJson(
    LOCAL_CLASS_MEMBERS_KEY,
    sortClassMembers([...currentMembers.filter((item) => item.id !== member.id), member]),
  );
  return member;
}

async function findClassByJoinCode(joinCode: string) {
  if (db) {
    const snapshot = await withRemoteTimeout(
      getDocs(query(collection(db, "classes"), where("joinCode", "==", joinCode), where("joinEnabled", "==", true))),
      "Firestore 班級代碼查詢",
    );
    const firstClass = snapshot.docs[0];
    return firstClass ? normalizeClass(firstClass.data()) : null;
  }

  return readJson<LearningClass[]>(LOCAL_CLASSES_KEY, []).find((item) => item.joinCode === joinCode) || null;
}

function createJoinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "ILC-";
  for (let index = 0; index < 5; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function normalizeJoinCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function getClassMemberId(classId: string, studentUid: string) {
  return `${classId}_${studentUid}`;
}

function getClassSubmissionViewId(classId: string, submissionId: string) {
  return `${classId}_${submissionId}`;
}

function normalizeClass(input: unknown): LearningClass {
  const record = isRecord(input) ? input : {};
  return {
    id: readText(record.id),
    name: readText(record.name, "未命名班級"),
    schoolId: readText(record.schoolId),
    schoolName: readText(record.schoolName),
    teacherUid: readText(record.teacherUid),
    teacherName: readText(record.teacherName, "未命名教師"),
    joinCode: normalizeJoinCode(readText(record.joinCode)),
    joinEnabled: record.joinEnabled !== false,
    archived: record.archived === true,
    memberCount: readNumber(record.memberCount),
    createdAt: readText(record.createdAt),
    updatedAt: readText(record.updatedAt),
  };
}

function normalizeClassMember(input: unknown): ClassMember {
  const record = isRecord(input) ? input : {};
  return {
    id: readText(record.id),
    classId: readText(record.classId),
    className: readText(record.className),
    schoolId: readText(record.schoolId),
    schoolName: readText(record.schoolName),
    teacherUid: readText(record.teacherUid),
    teacherName: readText(record.teacherName),
    studentUid: readText(record.studentUid),
    studentName: readText(record.studentName, readText(record.studentEmail, "未命名學生")),
    studentEmail: readText(record.studentEmail),
    status: record.status === "removed" ? "removed" : "active",
    joinedAt: readText(record.joinedAt),
    updatedAt: readText(record.updatedAt),
  };
}

function normalizeClassSubmissionView(input: unknown): ClassSubmissionView {
  const record = isRecord(input) ? input : {};
  return {
    id: readText(record.id),
    classId: readText(record.classId),
    className: readText(record.className),
    classMemberId: readText(record.classMemberId),
    teacherUid: readText(record.teacherUid),
    studentUid: readText(record.studentUid),
    studentName: readText(record.studentName, readText(record.studentEmail, "未命名學生")),
    studentEmail: readText(record.studentEmail),
    submissionId: readText(record.submissionId),
    problemId: readText(record.problemId),
    problemTitle: readText(record.problemTitle, "未命名題目"),
    mode: record.mode === "Scratch" ? "Scratch" : "Blockly",
    score: readNumber(record.score),
    maxScore: readNumber(record.maxScore),
    passRate: readNumber(record.passRate),
    status:
      record.status === "accepted" ||
      record.status === "partial" ||
      record.status === "failed" ||
      record.status === "error"
        ? record.status
        : "error",
    isFullScore: record.isFullScore === true,
    createdAt: readText(record.createdAt),
    updatedAt: readText(record.updatedAt),
  };
}

function sortClasses(items: LearningClass[]) {
  return [...items].sort((a, b) => {
    if ((b.createdAt || "") !== (a.createdAt || "")) {
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    }
    return a.name.localeCompare(b.name, "zh-Hant", { numeric: true });
  });
}

function sortClassMembers(items: ClassMember[]) {
  return [...items].sort((a, b) => {
    const classCompare = a.className.localeCompare(b.className, "zh-Hant", { numeric: true });
    if (classCompare !== 0) {
      return classCompare;
    }
    return a.studentName.localeCompare(b.studentName, "zh-Hant", { numeric: true });
  });
}

function sortClassSubmissionViews(items: ClassSubmissionView[]) {
  return [...items].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
