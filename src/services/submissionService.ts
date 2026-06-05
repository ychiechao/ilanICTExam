import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, GradeResult, Problem, SubmissionRecord, WorkspaceMode } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";
import { updateLeaderboard } from "./leaderboardService";

const LOCAL_SUBMISSIONS_KEY = "yilan-contest-submissions";
const MAX_SUBMISSIONS_PER_PROBLEM = 10;

export async function loadSubmissions(uid: string | undefined, problemId: string) {
  const resolvedUid = uid || "guest";

  if (db && uid && uid !== "guest") {
    const snapshot = await withRemoteTimeout(
      getDocs(
        query(
          collection(db, "submissions"),
          where("uid", "==", uid),
          where("problemId", "==", problemId),
        ),
      ),
      "Firestore 提交紀錄讀取",
    );
    return sortSubmissions(snapshot.docs.map((item) => item.data() as SubmissionRecord));
  }

  return readJson<SubmissionRecord[]>(LOCAL_SUBMISSIONS_KEY, [])
    .filter((item) => item.problemId === problemId && (item.uid || "guest") === resolvedUid)
    .sort(compareSubmissionTime);
}

export async function loadUserSubmissions(uid: string | undefined) {
  const resolvedUid = uid || "guest";

  if (db && uid && uid !== "guest") {
    const snapshot = await withRemoteTimeout(
      getDocs(query(collection(db, "submissions"), where("uid", "==", uid))),
      "Firestore 使用者提交紀錄讀取",
    );
    return sortSubmissions(snapshot.docs.map((item) => item.data() as SubmissionRecord));
  }

  return readJson<SubmissionRecord[]>(LOCAL_SUBMISSIONS_KEY, [])
    .filter((item) => (item.uid || "guest") === resolvedUid)
    .sort(compareSubmissionTime);
}

export async function loadAllSubmissions() {
  if (db) {
    const snapshot = await withRemoteTimeout(
      getDocs(collection(db, "submissions")),
      "Firestore 全站提交紀錄讀取",
    );
    return sortSubmissions(snapshot.docs.map((item) => item.data() as SubmissionRecord));
  }

  return readJson<SubmissionRecord[]>(LOCAL_SUBMISSIONS_KEY, []).sort(compareSubmissionTime);
}

export async function getProblemSubmissionCount(problemId: string) {
  if (db) {
    const snapshot = await withRemoteTimeout(
      getDocs(query(collection(db, "submissions"), where("problemId", "==", problemId))),
      "Firestore 題目提交數讀取",
    );
    return snapshot.size;
  }

  return readJson<SubmissionRecord[]>(LOCAL_SUBMISSIONS_KEY, []).filter(
    (item) => item.problemId === problemId,
  ).length;
}

export async function deleteSubmissionsForUser(uid: string) {
  if (db) {
    const [submissionSnapshot, statSnapshot] = await Promise.all([
      withRemoteTimeout(
        getDocs(query(collection(db, "submissions"), where("uid", "==", uid))),
        "Firestore 使用者提交紀錄查詢",
      ),
      withRemoteTimeout(
        getDocs(query(collection(db, "userProblemStats"), where("uid", "==", uid))),
        "Firestore 使用者題目統計查詢",
      ),
    ]);

    const refs = [
      ...submissionSnapshot.docs.map((item) => item.ref),
      ...statSnapshot.docs.map((item) => item.ref),
    ];

    for (let index = 0; index < refs.length; index += 450) {
      const batch = writeBatch(db);
      refs.slice(index, index + 450).forEach((ref) => batch.delete(ref));
      await withRemoteTimeout(batch.commit(), "Firestore 使用者答題資料刪除");
    }

    return {
      submissionsDeleted: submissionSnapshot.size,
      statsDeleted: statSnapshot.size,
    };
  }

  const all = readJson<SubmissionRecord[]>(LOCAL_SUBMISSIONS_KEY, []);
  const remaining = all.filter((item) => (item.uid || "guest") !== uid);
  writeJson(LOCAL_SUBMISSIONS_KEY, remaining);
  return {
    submissionsDeleted: all.length - remaining.length,
    statsDeleted: 0,
  };
}

function sortSubmissions(items: SubmissionRecord[]) {
  return [...items].sort(compareSubmissionTime);
}

function compareSubmissionTime(a: SubmissionRecord, b: SubmissionRecord) {
  return b.createdAt.localeCompare(a.createdAt);
}

function mergeLocalSubmission(record: SubmissionRecord) {
  const all = readJson<SubmissionRecord[]>(LOCAL_SUBMISSIONS_KEY, []);
  writeJson(
    LOCAL_SUBMISSIONS_KEY,
    [record, ...all.filter((item) => item.id !== record.id)].sort(compareSubmissionTime),
  );
}

function removeUndefinedFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedFields(item)) as T;
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefinedFields(item)]),
    ) as T;
  }

  return value;
}

export async function saveSubmission(
  user: AppUser | null,
  problem: Problem,
  result: GradeResult,
  mode: WorkspaceMode,
  blocklyXml: string,
  generatedCode: string,
  solveStartedAt?: string,
) {
  const uid = user?.uid || "guest";
  const previous = await loadSubmissions(uid, problem.id);
  if (previous.length >= MAX_SUBMISSIONS_PER_PROBLEM) {
    throw new Error(`每題最多提交 ${MAX_SUBMISSIONS_PER_PROBLEM} 次。`);
  }

  const startedAt = solveStartedAt || result.createdAt;
  const isFullScore =
    result.maxScore > 0 &&
    result.status === "accepted" &&
    result.totalCases > 0 &&
    result.passedCases === result.totalCases &&
    result.score >= result.maxScore;
  const rawSolveDurationMs = Date.parse(result.createdAt) - Date.parse(startedAt);
  const solveDurationMs = isFullScore
    ? Math.max(0, Number.isFinite(rawSolveDurationMs) ? rawSolveDurationMs : 0)
    : undefined;

  const record: SubmissionRecord = {
    ...result,
    id: `${problem.id}-${Date.now()}`,
    uid,
    displayName: user?.displayName || "訪客",
    problemId: problem.id,
    problemTitle: problem.title,
    mode,
    blocklyXml,
    generatedCode,
    solveStartedAt: startedAt,
    ...(isFullScore ? { solveCompletedAt: result.createdAt, solveDurationMs } : {}),
    isFullScore,
  };

  if (db && user) {
    const docRef = await withRemoteTimeout(
      addDoc(collection(db, "submissions"), removeUndefinedFields(record)),
      "Firestore 提交紀錄儲存",
    );
    record.id = docRef.id;
    await withRemoteTimeout(
      setDoc(
        doc(db, "userProblemStats", `${user.uid}_${problem.id}`),
        removeUndefinedFields({
          uid: user.uid,
          problemId: problem.id,
          bestScore: Math.max(result.score, ...previous.map((item) => item.score)),
          bestPassRate: Math.max(result.passRate, ...previous.map((item) => item.passRate)),
          submitCount: previous.length + 1,
          isCompleted: isFullScore || previous.some(isFullScoreSubmission),
          ...(isFullScore
            ? {
                completedAt: result.createdAt,
                bestSolveDurationMs: Math.min(
                  solveDurationMs ?? 0,
                  ...previous
                    .filter((item) => item.isFullScore && typeof item.solveDurationMs === "number")
                    .map((item) => item.solveDurationMs as number),
                ),
              }
            : {}),
          updatedAt: result.createdAt,
        }),
      ),
      "Firestore 使用者題目統計儲存",
    );
    await updateLeaderboard(user, problem, result);
  } else {
    mergeLocalSubmission(record);
  }

  return record;
}

export { MAX_SUBMISSIONS_PER_PROBLEM };

function isFullScoreSubmission(record: SubmissionRecord) {
  return (
    record.maxScore > 0 &&
    record.status === "accepted" &&
    record.totalCases > 0 &&
    record.passedCases === record.totalCases &&
    record.score >= record.maxScore
  );
}
