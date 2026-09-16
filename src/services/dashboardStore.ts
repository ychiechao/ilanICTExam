import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { ContestDashboardSettings } from "../types";

export interface DashboardRanking {
  rank: number;
  username: string;
  name: string;
  schoolName: string;
  totalScore: number;
  solvedCount: number;
  submitCount: number;
  lastSubmittedAt?: string;
}

/** contestDashboards/{contestId}：Worker 每次評分後（最多每 3 秒）重算的快照。 */
export interface ContestDashboard {
  contestId: string;
  title: string;
  accountCount: number;
  submittedCount: number;
  submissionCount: number;
  averageScore: number;
  ranking: DashboardRanking[];
  problemStats: Record<string, { solved: number; attempted: number }>;
  schoolStats: Record<string, { schoolName: string; participants: number; solved: number; totalScore: number }>;
  computedAtMs: number;
}

export interface PresenceRecord {
  username: string;
  name: string;
  schoolId: string;
  lastSeenMs: number;
}

export interface RecentSubmission {
  id: string;
  username: string;
  displayName: string;
  problemTitle: string;
  score: number;
  maxScore: number;
  status: string;
  isFullScore: boolean;
  createdAt: string;
}

const EMPTY: ContestDashboard = {
  contestId: "",
  title: "",
  accountCount: 0,
  submittedCount: 0,
  submissionCount: 0,
  averageScore: 0,
  ranking: [],
  problemStats: {},
  schoolStats: {},
  computedAtMs: 0,
};

export function subscribeDashboard(contestId: string, callback: (dashboard: ContestDashboard | null) => void) {
  if (!db || !contestId) {
    callback(null);
    return () => undefined;
  }
  return onSnapshot(
    doc(db, "contestDashboards", contestId),
    (snapshot) => {
      const data = snapshot.data();
      callback(data ? { ...EMPTY, ...(data as Partial<ContestDashboard>), contestId } : { ...EMPTY, contestId });
    },
    (error) => {
      console.info("儀表板讀取失敗", error);
      callback(null);
    },
  );
}

export function subscribePresence(contestId: string, callback: (records: PresenceRecord[]) => void) {
  if (!db || !contestId) {
    callback([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db, "contestPresence"), where("contestId", "==", contestId)),
    (snapshot) => {
      callback(
        snapshot.docs.map((item) => {
          const data = item.data();
          return {
            username: String(data.username ?? ""),
            name: String(data.name ?? ""),
            schoolId: String(data.schoolId ?? ""),
            lastSeenMs: typeof data.lastSeenMs === "number" ? data.lastSeenMs : 0,
          };
        }),
      );
    },
    (error) => {
      console.info("線上狀態讀取失敗", error);
      callback([]);
    },
  );
}

/** 最近提交（需要 contestId + createdAt 的複合索引，見 firestore.indexes.json）。 */
export function subscribeRecentSubmissions(contestId: string, count: number, callback: (items: RecentSubmission[]) => void) {
  if (!db || !contestId) {
    callback([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db, "contestSubmissions"), where("contestId", "==", contestId), orderBy("createdAt", "desc"), limit(count)),
    (snapshot) => {
      callback(
        snapshot.docs.map((item) => {
          const data = item.data();
          return {
            id: item.id,
            username: String(data.username ?? ""),
            displayName: String(data.displayName ?? ""),
            problemTitle: String(data.problemTitle ?? ""),
            score: Number(data.score ?? 0),
            maxScore: Number(data.maxScore ?? 0),
            status: String(data.status ?? ""),
            isFullScore: data.isFullScore === true,
            createdAt: String(data.createdAtIso ?? ""),
          };
        }),
      );
    },
    (error) => {
      console.info("最近提交讀取失敗（索引可能還在建立）", error);
      callback([]);
    },
  );
}

export type { ContestDashboardSettings };
