import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { ContestEvent } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

const LOCAL_CONTESTS_KEY = "yilan-contest-events";

export async function loadContests(): Promise<ContestEvent[]> {
  if (db) {
    try {
      const snapshot = await withRemoteTimeout(
        getDocs(collection(db, "contests")),
        "Firestore 賽事資料讀取",
      );
      return sortContests(snapshot.docs.map((item) => normalizeContest(item.data())));
    } catch {
      console.info("Firestore 賽事資料暫時無法讀取，已改用本機賽事資料。");
    }
  }

  return sortContests(readJson<ContestEvent[]>(LOCAL_CONTESTS_KEY, []));
}

export async function saveContest(contest: ContestEvent) {
  const normalized = normalizeContest({
    ...contest,
    updatedAt: new Date().toISOString(),
    createdAt: contest.createdAt || new Date().toISOString(),
  });

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "contests", normalized.id), normalized),
      "Firestore 賽事資料儲存",
    );
    return normalized;
  }

  const current = readJson<ContestEvent[]>(LOCAL_CONTESTS_KEY, []);
  writeJson(
    LOCAL_CONTESTS_KEY,
    sortContests([
      ...current.filter((item) => item.id !== normalized.id),
      normalized,
    ]),
  );
  return normalized;
}

/**
 * 主辦單位按「開始」：以伺服器時間當起點，endAt = 開始 + durationMinutes。
 * 若已經有 endAt 且在未來（預先排程），維持不變。
 */
export function startContestTiming(contest: ContestEvent, nowMs: number): ContestEvent {
  const startAt = new Date(nowMs).toISOString();
  const duration = (contest.durationMinutes || 120) * 60_000;
  const keepEnd = contest.endAt && Date.parse(contest.endAt) > nowMs + 60_000 && contest.status === "waiting" && contest.startAt && Date.parse(contest.startAt) <= nowMs;
  return {
    ...contest,
    status: "active",
    startAt: keepEnd ? contest.startAt : startAt,
    endAt: keepEnd ? contest.endAt : new Date(nowMs + duration).toISOString(),
    pausedAt: "",
  };
}

export function pauseContestTiming(contest: ContestEvent, nowMs: number): ContestEvent {
  return { ...contest, status: "paused", pausedAt: new Date(nowMs).toISOString() };
}

/** 繼續：暫停了多久，結束時間就往後推多久。 */
export function resumeContestTiming(contest: ContestEvent, nowMs: number): ContestEvent {
  const pausedFor = contest.pausedAt ? Math.max(0, nowMs - Date.parse(contest.pausedAt)) : 0;
  const endAt = contest.endAt ? new Date(Date.parse(contest.endAt) + pausedFor).toISOString() : contest.endAt;
  return { ...contest, status: "active", endAt, pausedAt: "" };
}

export function endContestTiming(contest: ContestEvent, nowMs: number): ContestEvent {
  const endAt = contest.endAt && Date.parse(contest.endAt) < nowMs ? contest.endAt : new Date(nowMs).toISOString();
  return { ...contest, status: "ended", endAt, pausedAt: "" };
}

/** 依伺服器時間判斷參賽者現在能不能作答。 */
export function getContestPhase(contest: Pick<ContestEvent, "status" | "startAt" | "endAt">, nowMs: number) {
  if (contest.status === "paused") return "paused" as const;
  if (contest.status === "ended" || contest.status === "review" || contest.status === "published" || contest.status === "archived") return "ended" as const;
  if (contest.status !== "active") return "waiting" as const;
  if (contest.startAt && Date.parse(contest.startAt) > nowMs) return "waiting" as const;
  if (contest.endAt && Date.parse(contest.endAt) <= nowMs) return "ended" as const;
  return "running" as const;
}

export function createContestDraft(previous?: ContestEvent): ContestEvent {
  const now = new Date();
  const nextYear = previous?.year ? getNextYear(previous.year) : String(now.getFullYear());
  const title = previous
    ? `${nextYear} 宜蘭縣資訊科技創意實作競賽`
    : `${nextYear} 宜蘭縣資訊科技創意實作競賽`;

  return {
    id: `contest-${slug(nextYear)}-${Date.now()}`,
    title,
    year: nextYear,
    status: "draft",
    mode: previous?.mode || "contest",
    description: previous?.description || "年度賽事草稿，可設定競賽時間、題目、名單與公布流程。",
    startAt: "",
    endAt: "",
    registrationStartAt: "",
    registrationEndAt: "",
    problemIds: previous?.problemIds || [],
    participantCount: 0,
    schoolCount: 0,
    rosterNote: "",
    resultNote: "",
    division: "E",
    maxSubmissionsPerProblem: 10,
    durationMinutes: 120,
    accountCount: 0,
    problemCount: 0,
    dashboard: { visibility: "organizer", showNames: false, topN: 20 },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function normalizeContest(input: unknown): ContestEvent {
  const record = isRecord(input) ? input : {};
  const now = new Date().toISOString();
  const year = readText(record.year, String(new Date().getFullYear()));
  return {
    id: readText(record.id, `contest-${slug(year)}-${Date.now()}`),
    title: readText(record.title, `${year} 宜蘭縣資訊科技創意實作競賽`),
    year,
    status: normalizeStatus(record.status),
    mode: normalizeMode(record.mode),
    description: readText(record.description),
    startAt: readText(record.startAt),
    endAt: readText(record.endAt),
    registrationStartAt: readText(record.registrationStartAt),
    registrationEndAt: readText(record.registrationEndAt),
    problemIds: normalizeProblemIds(record.problemIds),
    participantCount: readNonNegativeNumber(record.participantCount),
    schoolCount: readNonNegativeNumber(record.schoolCount),
    rosterNote: readText(record.rosterNote),
    resultNote: readText(record.resultNote),
    division: readText(record.division, "E"),
    maxSubmissionsPerProblem: Math.max(1, Math.round(readNonNegativeNumber(record.maxSubmissionsPerProblem) || 10)),
    durationMinutes: Math.max(5, Math.round(readNonNegativeNumber(record.durationMinutes) || 120)),
    pausedAt: readText(record.pausedAt),
    // 以下由 Worker 寫入；saveContest 是整份覆寫，這裡一定要帶著，否則會被清掉。
    accountCount: readNonNegativeNumber(record.accountCount),
    problemCount: readNonNegativeNumber(record.problemCount),
    casesSyncedAt: readText(record.casesSyncedAt),
    dashboard: normalizeDashboard(record.dashboard),
    publishedAt: readText(record.publishedAt),
    releasedToPractice: record.releasedToPractice === true,
    ...(typeof record.archivedFromStatus === "string" ? { archivedFromStatus: normalizeStatus(record.archivedFromStatus) } : {}),
    createdAt: readText(record.createdAt, now),
    updatedAt: readText(record.updatedAt, now),
  };
}

function normalizeDashboard(value: unknown): ContestEvent["dashboard"] {
  const record = isRecord(value) ? value : {};
  const visibility = record.visibility;
  return {
    visibility: visibility === "participants" || visibility === "public" ? visibility : "organizer",
    showNames: record.showNames === true,
    topN: Math.max(1, Math.round(readNonNegativeNumber(record.topN) || 20)),
    ...(readText(record.boardToken) ? { boardToken: readText(record.boardToken) } : {}),
  };
}

function sortContests(items: ContestEvent[]) {
  return [...items].sort((a, b) => {
    const yearCompare = b.year.localeCompare(a.year, "zh-Hant", { numeric: true });
    if (yearCompare !== 0) {
      return yearCompare;
    }
    const aTime = a.startAt || a.updatedAt || "";
    const bTime = b.startAt || b.updatedAt || "";
    if (aTime !== bTime) {
      return bTime.localeCompare(aTime);
    }
    return a.title.localeCompare(b.title, "zh-Hant", { numeric: true });
  });
}

function normalizeProblemIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => readText(item))
        .filter(Boolean),
    ),
  );
}

function normalizeStatus(value: unknown): ContestEvent["status"] {
  return [
    "draft",
    "roster",
    "waiting",
    "active",
    "paused",
    "ended",
    "review",
    "published",
    "archived",
  ].includes(String(value))
    ? (value as ContestEvent["status"])
    : "draft";
}

function normalizeMode(value: unknown): ContestEvent["mode"] {
  return ["practice", "contest", "hybrid"].includes(String(value))
    ? (value as ContestEvent["mode"])
    : "contest";
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function readNonNegativeNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue)) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getNextYear(year: string) {
  const parsed = Number(year);
  return Number.isFinite(parsed) ? String(parsed + 1) : String(new Date().getFullYear());
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "annual";
}
