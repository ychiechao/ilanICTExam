import { addDoc, collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, GradeResult, Problem, SubmissionRecord, WorkspaceMode } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";
import { updateLeaderboard } from "./leaderboardService";

const LOCAL_SUBMISSIONS_KEY = "yilan-contest-submissions";
const MAX_SUBMISSIONS_PER_PROBLEM = 10;

export async function loadSubmissions(uid: string | undefined, problemId: string) {
  if (db && uid) {
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
    return snapshot.docs.map((item) => item.data() as SubmissionRecord);
  }

  return readJson<SubmissionRecord[]>(LOCAL_SUBMISSIONS_KEY, []).filter(
    (item) => item.problemId === problemId && (!uid || item.uid === uid),
  );
}

export async function saveSubmission(
  user: AppUser | null,
  problem: Problem,
  result: GradeResult,
  mode: WorkspaceMode,
  blocklyXml: string,
  generatedCode: string,
) {
  const uid = user?.uid || "guest";
  const previous = await loadSubmissions(uid, problem.id);
  if (previous.length >= MAX_SUBMISSIONS_PER_PROBLEM) {
    throw new Error(`每題最多正式提交 ${MAX_SUBMISSIONS_PER_PROBLEM} 次。`);
  }

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
  };

  if (db && user) {
    const docRef = await withRemoteTimeout(
      addDoc(collection(db, "submissions"), record),
      "Firestore 提交紀錄寫入",
    );
    record.id = docRef.id;
    await withRemoteTimeout(
      setDoc(doc(db, "userProblemStats", `${user.uid}_${problem.id}`), {
        uid: user.uid,
        problemId: problem.id,
        bestScore: Math.max(result.score, ...previous.map((item) => item.score)),
        bestPassRate: Math.max(result.passRate, ...previous.map((item) => item.passRate)),
        submitCount: previous.length + 1,
        updatedAt: result.createdAt,
      }),
      "Firestore 個人紀錄更新",
    );
    await updateLeaderboard(user, problem, result);
  } else {
    const all = readJson<SubmissionRecord[]>(LOCAL_SUBMISSIONS_KEY, []);
    writeJson(LOCAL_SUBMISSIONS_KEY, [...all, record]);
  }

  return record;
}

export { MAX_SUBMISSIONS_PER_PROBLEM };
