import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { ContestAccount } from "../types";
import { graderRequest } from "./grader";
import { withRemoteTimeout } from "./remote";

export interface ContestAccountImportRow {
  name: string;
  schoolId: string;
  schoolName: string;
  note: string;
}

export interface IssuedContestAccount {
  username: string;
  password: string;
  name: string;
  schoolName: string;
  schoolSeq?: number;
  note: string;
}

export interface ContestAccountImportResult {
  batchId: string;
  accountCount: number;
  accounts: IssuedContestAccount[];
}

/** 該場賽事的所有競賽帳號（超管直接讀 Firestore；密碼雜湊不在裡面）。 */
export async function loadContestAccounts(contestId: string): Promise<ContestAccount[]> {
  if (!db || !contestId) {
    return [];
  }
  const snapshot = await withRemoteTimeout(
    getDocs(query(collection(db, "contestAccounts"), where("contestId", "==", contestId))),
    "Firestore 競賽帳號讀取",
  );
  return snapshot.docs
    .map((item) => normalizeAccount(item.id, item.data()))
    .sort((a, b) => a.username.localeCompare(b.username, "en", { numeric: true }));
}

/** 匯入由 Worker 執行：產生帳號、密碼雜湊進 KV、寫 Firestore，回傳一次性明碼清單。 */
export function importContestAccounts(contestId: string, rows: ContestAccountImportRow[]) {
  return graderRequest<ContestAccountImportResult>(`/contest-accounts/${encodeURIComponent(contestId)}`, {
    body: { rows },
    timeoutMs: 120000,
  });
}

export function resetContestAccountPassword(contestId: string, username: string) {
  return graderRequest<{ username: string; password: string }>(
    `/contest-accounts/${encodeURIComponent(contestId)}/reset-password`,
    { body: { username } },
  );
}

export function setContestAccountStatus(contestId: string, username: string, status: ContestAccount["status"]) {
  return graderRequest<{ username: string; status: ContestAccount["status"] }>(
    `/contest-accounts/${encodeURIComponent(contestId)}/status`,
    { body: { username, status } },
  );
}

function normalizeAccount(id: string, data: Record<string, unknown>): ContestAccount {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const time = (value: unknown) => {
    if (typeof value === "string") return value;
    const maybe = value as { toDate?: () => Date } | undefined;
    return maybe && typeof maybe.toDate === "function" ? maybe.toDate().toISOString() : undefined;
  };
  return {
    id,
    contestId: text(data.contestId),
    username: text(data.username),
    name: text(data.name),
    schoolId: text(data.schoolId),
    schoolName: text(data.schoolName),
    schoolSeq: typeof data.schoolSeq === "number" ? data.schoolSeq : undefined,
    note: text(data.note),
    status: data.status === "disabled" ? "disabled" : "active",
    uid: text(data.uid),
    firstLoginAt: time(data.firstLoginAt),
    lastLoginAt: time(data.lastLoginAt),
    deviceFingerprint: text(data.deviceFingerprint),
    batchId: text(data.batchId),
    createdAt: time(data.createdAt),
    createdBy: text(data.createdBy),
  };
}
