import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, ContestEvent, PlatformMode, PlatformState } from "../types";
import { readJson, writeJson } from "./storage";
import { withRemoteTimeout } from "./remote";

const LOCAL_PLATFORM_KEY = "ilan-platform-state";
const PLATFORM_DOC = ["settings", "platform"] as const;

export const DEFAULT_PLATFORM_STATE: PlatformState = {
  mode: "practice",
  activeContestIds: [],
  announcement: "",
};

export const PLATFORM_MODE_LABELS: Record<PlatformMode, string> = {
  practice: "練習模式",
  contest: "競賽模式",
  maintenance: "維護模式",
};

/**
 * 訂閱全站模式。任何人（含未登入）可讀，超管切換後所有畫面即時跟隨。
 * 無 Firebase 設定時退回 localStorage，只在同一瀏覽器內生效。
 */
export function subscribePlatform(callback: (state: PlatformState) => void) {
  if (!db) {
    callback(readJson<PlatformState>(LOCAL_PLATFORM_KEY, DEFAULT_PLATFORM_STATE));
    const handler = (event: StorageEvent) => {
      if (event.key === LOCAL_PLATFORM_KEY) {
        callback(readJson<PlatformState>(LOCAL_PLATFORM_KEY, DEFAULT_PLATFORM_STATE));
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }

  return onSnapshot(
    doc(db, ...PLATFORM_DOC),
    (snapshot) => {
      callback(snapshot.exists() ? normalizePlatformState(snapshot.data()) : DEFAULT_PLATFORM_STATE);
    },
    (error) => {
      console.warn("平台模式訂閱失敗，暫以練習模式顯示。", error);
      callback(DEFAULT_PLATFORM_STATE);
    },
  );
}

export async function savePlatformState(next: PlatformState, actor: AppUser | null) {
  const payload = {
    mode: next.mode,
    activeContestIds: next.mode === "contest" ? next.activeContestIds : [],
    announcement: next.announcement.trim(),
    updatedBy: actor?.uid || "local",
  };

  if (!db) {
    writeJson(LOCAL_PLATFORM_KEY, { ...payload, updatedAt: new Date().toISOString() });
    return;
  }

  await withRemoteTimeout(
    setDoc(doc(db, ...PLATFORM_DOC), { ...payload, updatedAt: serverTimestamp() }),
    "平台模式儲存",
  );
}

/**
 * 切換到競賽模式前的檢查（規格 4.4）。回傳空陣列表示可以切換。
 */
export function validateContestActivation(contests: ContestEvent[], contestIds: string[]): string[] {
  const reasons: string[] = [];
  if (contestIds.length === 0) {
    return ["請至少勾選一場賽事。"];
  }
  const now = Date.now();
  for (const contestId of contestIds) {
    const contest = contests.find((item) => item.id === contestId);
    if (!contest) {
      reasons.push(`找不到賽事 ${contestId}。`);
      continue;
    }
    const label = `「${contest.title}」`;
    if (contest.status !== "waiting" && contest.status !== "active") {
      reasons.push(`${label}狀態必須是「等候開始」或「競賽中」。`);
    }
    if (!(contest.problemCount && contest.problemCount > 0)) {
      reasons.push(`${label}尚未匯入競賽題庫。`);
    }
    if (!(contest.accountCount && contest.accountCount > 0)) {
      reasons.push(`${label}尚未匯入競賽帳號。`);
    }
    if (!contest.startAt || !contest.endAt) {
      reasons.push(`${label}尚未設定競賽時段。`);
    } else if (Date.parse(contest.endAt) <= now) {
      reasons.push(`${label}的結束時間已經過了。`);
    }
  }
  return reasons;
}

function normalizePlatformState(data: Record<string, unknown>): PlatformState {
  const mode = data.mode;
  const updatedAt = data.updatedAt as { toDate?: () => Date } | string | undefined;
  return {
    mode: mode === "contest" || mode === "maintenance" ? mode : "practice",
    activeContestIds: Array.isArray(data.activeContestIds)
      ? data.activeContestIds.filter((item): item is string => typeof item === "string")
      : [],
    announcement: typeof data.announcement === "string" ? data.announcement : "",
    updatedAt:
      typeof updatedAt === "string"
        ? updatedAt
        : updatedAt && typeof updatedAt.toDate === "function"
          ? updatedAt.toDate().toISOString()
          : undefined,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
  };
}
