import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { graderRequest } from "./grader";
import { withRemoteTimeout } from "./remote";

/**
 * 成績審核（規格 8.8、計畫 3.5）：讀該場全部提交、異常事件與排行榜 entry，
 * 依人彙總並標記異常；作廢／恢復走 Worker /void。
 */

export interface ReviewSubmission {
  id: string;
  uid: string;
  username: string;
  displayName: string;
  schoolId: string;
  problemId: string;
  problemTitle: string;
  attempt: number;
  score: number;
  maxScore: number;
  passedCases: number;
  totalCases: number;
  status: string;
  isFullScore: boolean;
  codeHash: string;
  generatedCode: string;
  blocklyXml: string;
  elapsedMs: number;
  createdAt: string;
  voided: boolean;
  voidReason: string;
  voidedByName: string;
}

export interface ReviewEvent {
  id: string;
  username: string;
  uid: string;
  type: string;
  createdAt: string;
  detail: Record<string, unknown>;
}

export interface ReviewEntry {
  username: string;
  totalScore: number;
  solvedCount: number;
  submitCount: number;
  bestByProblem: Record<string, { score: number; maxScore: number; passRate: number; at: string }>;
}

export async function loadReviewSubmissions(contestId: string): Promise<ReviewSubmission[]> {
  if (!db || !contestId) return [];
  const snapshot = await withRemoteTimeout(
    getDocs(query(collection(db, "contestSubmissions"), where("contestId", "==", contestId))),
    "審核：提交紀錄",
    60000,
  );
  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        id: item.id,
        uid: String(data.uid ?? ""),
        username: String(data.username ?? ""),
        displayName: String(data.displayName ?? ""),
        schoolId: String(data.schoolId ?? ""),
        problemId: String(data.problemId ?? ""),
        problemTitle: String(data.problemTitle ?? ""),
        attempt: Number(data.attempt ?? 0),
        score: Number(data.score ?? 0),
        maxScore: Number(data.maxScore ?? 0),
        passedCases: Number(data.passedCases ?? 0),
        totalCases: Number(data.totalCases ?? 0),
        status: String(data.status ?? ""),
        isFullScore: data.isFullScore === true,
        codeHash: String(data.codeHash ?? ""),
        generatedCode: String(data.generatedCode ?? ""),
        blocklyXml: String(data.blocklyXml ?? ""),
        elapsedMs: Number(data.elapsedMs ?? 0),
        createdAt: String(data.createdAtIso ?? ""),
        voided: data.voided === true,
        voidReason: String(data.voidReason ?? ""),
        voidedByName: String(data.voidedByName ?? ""),
      } satisfies ReviewSubmission;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function loadReviewEvents(contestId: string): Promise<ReviewEvent[]> {
  if (!db || !contestId) return [];
  const snapshot = await withRemoteTimeout(
    getDocs(query(collection(db, "contestEvents"), where("contestId", "==", contestId))),
    "審核：異常事件",
    60000,
  );
  return snapshot.docs.map((item) => {
    const data = item.data();
    const createdAt = data.createdAt && typeof data.createdAt.toDate === "function" ? (data.createdAt.toDate() as Date).toISOString() : String(data.createdAtIso ?? "");
    return {
      id: item.id,
      username: String(data.username ?? ""),
      uid: String(data.uid ?? ""),
      type: String(data.type ?? ""),
      createdAt,
      detail: (data.detail && typeof data.detail === "object" ? data.detail : {}) as Record<string, unknown>,
    };
  });
}

export async function loadReviewEntries(contestId: string): Promise<ReviewEntry[]> {
  if (!db || !contestId) return [];
  const snapshot = await withRemoteTimeout(
    getDocs(query(collection(db, "contestLeaderboards"), where("contestId", "==", contestId))),
    "審核：排行榜",
  );
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      username: String(data.username ?? ""),
      totalScore: Number(data.totalScore ?? 0),
      solvedCount: Number(data.solvedCount ?? 0),
      submitCount: Number(data.submitCount ?? 0),
      bestByProblem: (data.bestByProblem ?? {}) as ReviewEntry["bestByProblem"],
    };
  });
}

export function voidSubmission(contestId: string, submissionId: string, reason: string) {
  return graderRequest<{ ok: true; voided: boolean }>(`/contests/${encodeURIComponent(contestId)}/void`, {
    body: { submissionId, reason },
    timeoutMs: 60000,
  });
}

export function restoreSubmission(contestId: string, submissionId: string) {
  return graderRequest<{ ok: true; voided: boolean }>(`/contests/${encodeURIComponent(contestId)}/void`, {
    body: { submissionId, restore: true },
    timeoutMs: 60000,
  });
}
