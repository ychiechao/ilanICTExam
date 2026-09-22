import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import type { AdminProfile, AppUser, LeaderboardEntry, LeaderboardScope, ManagedUser, Problem, SubmissionRecord, UserProblemStat, UserRole } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

/**
 * 練習模式排行榜（計畫 4.1–4.4）
 *
 * 每位使用者一份 `userStats/{uid}` 彙總（總分、完成題數、答題率、學校、班級），
 * 提交後由本人更新；排行榜依範圍查詢：全縣（全部）、學校（schoolId ==）、班級（classIds array-contains），
 * 三種都用 Firestore 排序 passRate → completedCount → totalScore（索引見 firestore.indexes.json）。
 * 舊的 leaderboards/global 單一文件不再寫入。
 *
 * 只有學生列入排行榜（規格 7.3：校排行／縣排行都是「所有學生」）。教師與超管解題時
 * 仍會保留個人紀錄與每題統計，但不寫 userStats；已存在的彙總會在下次提交時刪除。
 */

const LOCAL_STATS_KEY = "yilan-practice-user-stats";
const SCOPE_LIMIT = 100;

interface MembershipInfo {
  schoolId?: string;
  schoolName?: string;
  classIds: string[];
}

/** 教師與超管不列入排行榜；沒有 role 的舊資料視為學生。 */
export function isRankedRole(role?: UserRole) {
  return role !== "teacher" && role !== "super";
}

export function computeUserStats(
  user: { uid: string; displayName: string },
  problems: Problem[],
  submissions: SubmissionRecord[],
  membership: MembershipInfo,
  role: UserRole = "student",
): LeaderboardEntry {
  const publishedProblems = problems.filter((problem) => problem.status === "published");
  const userSubmissions = submissions.filter((record) => (record.uid || "guest") === user.uid);
  const bestByProblem = new Map<string, SubmissionRecord>();
  for (const record of userSubmissions) {
    bestByProblem.set(record.problemId, betterSubmission(bestByProblem.get(record.problemId), record));
  }
  const bestRecords = publishedProblems
    .map((problem) => bestByProblem.get(problem.id))
    .filter((record): record is SubmissionRecord => Boolean(record));
  const completedRecords = bestRecords.filter(isFullScoreSubmission);
  const submittedTimes = userSubmissions.map((record) => record.createdAt).sort();
  return buildEntry(user, membership, role, {
    totalScore: bestRecords.reduce((sum, record) => sum + record.score, 0),
    totalMaxScore: publishedProblems.reduce((sum, problem) => sum + getProblemMaxScore(problem), 0),
    completedCount: completedRecords.length,
    totalProblems: publishedProblems.length,
    passRate:
      publishedProblems.length === 0
        ? 0
        : publishedProblems.reduce((sum, problem) => sum + (bestByProblem.get(problem.id)?.passRate || 0), 0) / publishedProblems.length,
    elapsedMs: completedRecords.reduce((sum, record) => sum + (record.solveDurationMs || record.elapsedMs || 0), 0),
    submitCount: userSubmissions.length,
    completedAt: completedRecords.map((record) => record.solveCompletedAt || record.createdAt).sort()[0],
    lastSubmittedAt: submittedTimes[submittedTimes.length - 1],
  });
}

/**
 * 提交後更新自己的彙總；回傳寫入的 entry。
 * 教師／超管不列入排行榜：不寫入，並把先前可能留下的彙總刪掉。
 */
export async function saveUserStats(entry: LeaderboardEntry) {
  if (!isRankedRole(entry.role)) {
    await removeOwnUserStats(entry.uid);
    return entry;
  }
  if (db) {
    await withRemoteTimeout(setDoc(doc(db, "userStats", entry.uid), stripUndefined(entry)), "Firestore 排行榜彙總更新");
  } else {
    const all = readJson<Record<string, LeaderboardEntry>>(LOCAL_STATS_KEY, {});
    writeJson(LOCAL_STATS_KEY, { ...all, [entry.uid]: entry });
  }
  return entry;
}

/** 身分不該列入排行榜時，刪掉自己的彙總（Rules 允許本人刪自己的）。 */
export async function removeOwnUserStats(uid: string) {
  if (!db) {
    const all = readJson<Record<string, LeaderboardEntry>>(LOCAL_STATS_KEY, {});
    if (!(uid in all)) return;
    delete all[uid];
    writeJson(LOCAL_STATS_KEY, all);
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, "userStats", uid));
    if (!snapshot.exists()) return;
    await withRemoteTimeout(deleteDoc(doc(db, "userStats", uid)), "Firestore 排行榜彙總刪除");
  } catch (error) {
    console.info("排行榜彙總刪除失敗", error);
  }
}

/** 加入班級／改學校後同步到彙總（沒有彙總就不建，等下次提交）。 */
export async function syncUserStatsMembership(uid: string, membership: MembershipInfo) {
  if (!db) return;
  try {
    const snapshot = await getDoc(doc(db, "userStats", uid));
    if (!snapshot.exists()) return;
    await setDoc(
      doc(db, "userStats", uid),
      stripUndefined({ schoolId: membership.schoolId ?? "", schoolName: membership.schoolName ?? "", classIds: membership.classIds }),
      { merge: true },
    );
  } catch (error) {
    console.info("排行榜彙總同步失敗", error);
  }
}

export async function loadLeaderboardScope(scope: LeaderboardScope): Promise<LeaderboardEntry[]> {
  if (db) {
    const base = collection(db, "userStats");
    const order = [orderBy("passRate", "desc"), orderBy("completedCount", "desc"), orderBy("totalScore", "desc"), limit(SCOPE_LIMIT)];
    const built =
      scope.kind === "county"
        ? query(base, ...order)
        : scope.kind === "school"
          ? query(base, where("schoolId", "==", scope.schoolId), ...order)
          : query(base, where("classIds", "array-contains", scope.classId), ...order);
    try {
      const snapshot = await withRemoteTimeout(getDocs(built), "Firestore 排行榜讀取");
      // 保險：即使有殘留的教師／超管彙總也不顯示（沒有 role 的舊資料視為學生）。
      return sortEntries(snapshot.docs.map((item) => item.data() as LeaderboardEntry).filter((entry) => isRankedRole(entry.role)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/requires an index|index is currently building/i.test(message)) {
        throw new Error("排行榜索引建立中，請幾分鐘後再試。");
      }
      if (/permission/i.test(message)) {
        throw new Error("目前沒有權限讀取排行榜（請先登入）。");
      }
      throw error;
    }
  }
  const all = Object.values(readJson<Record<string, LeaderboardEntry>>(LOCAL_STATS_KEY, {}));
  return sortEntries(
    all.filter(
      (entry) =>
        isRankedRole(entry.role) &&
        (scope.kind === "county" ? true : scope.kind === "school" ? entry.schoolId === scope.schoolId : (entry.classIds ?? []).includes(scope.classId)),
    ),
  ).slice(0, SCOPE_LIMIT);
}

/** 刪除使用者時一併移除彙總與舊版 leaderboards 文件中的紀錄。 */
export async function removeUserFromLeaderboards(uid: string) {
  if (db) {
    await withRemoteTimeout(deleteDoc(doc(db, "userStats", uid)), "Firestore 排行榜彙總刪除").catch(() => undefined);
    const snapshot = await withRemoteTimeout(getDocs(collection(db, "leaderboards")), "Firestore 排行榜清理");
    const updatedAt = new Date().toISOString();
    await Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data();
        const entries = ((data.entries || []) as LeaderboardEntry[]).filter((entry) => entry.uid !== uid);
        if (entries.length === ((data.entries || []) as LeaderboardEntry[]).length) return Promise.resolve();
        return withRemoteTimeout(setDoc(item.ref, { ...data, entries, updatedAt }, { merge: true }), "Firestore 排行榜更新");
      }),
    );
    return;
  }
  const all = readJson<Record<string, LeaderboardEntry>>(LOCAL_STATS_KEY, {});
  delete all[uid];
  writeJson(LOCAL_STATS_KEY, all);
}

/**
 * 超管回填（計畫 4.9）：用 userProblemStats + users + classMembers 重建所有人的 userStats。
 * 已存在的整份覆寫；沒有任何題目統計的使用者不建。
 * 教師與超管（admins 文件）不建，且會刪掉他們先前殘留的彙總。
 */
export async function backfillUserStats(input: {
  users: ManagedUser[];
  admins: AdminProfile[];
  stats: UserProblemStat[];
  problems: Problem[];
  classMembers: Array<{ studentUid: string; classId: string; status: string; schoolId?: string; schoolName?: string }>;
}) {
  if (!db) throw new Error("目前未連接 Firestore。");
  const publishedProblems = input.problems.filter((problem) => problem.status === "published");
  const publishedIds = new Set(publishedProblems.map((problem) => problem.id));
  const maxByProblem = new Map(publishedProblems.map((problem) => [problem.id, getProblemMaxScore(problem)]));
  const statsByUid = new Map<string, UserProblemStat[]>();
  for (const stat of input.stats) {
    if (!publishedIds.has(stat.problemId)) continue;
    const list = statsByUid.get(stat.uid) ?? [];
    list.push(stat);
    statsByUid.set(stat.uid, list);
  }
  const classIdsByUid = new Map<string, string[]>();
  // 使用者資料沒有學校時，用班級的學校（加入班級即視同該校學生）。
  const classSchoolByUid = new Map<string, { schoolId: string; schoolName: string }>();
  for (const member of input.classMembers) {
    if (member.status === "removed") continue;
    const list = classIdsByUid.get(member.studentUid) ?? [];
    if (!list.includes(member.classId)) list.push(member.classId);
    classIdsByUid.set(member.studentUid, list);
    if (member.schoolId && !classSchoolByUid.has(member.studentUid)) {
      classSchoolByUid.set(member.studentUid, { schoolId: member.schoolId, schoolName: member.schoolName ?? "" });
    }
  }
  const userByUid = new Map(input.users.map((user) => [user.uid, user]));
  // 教師身分只看 admins 文件（與 getEffectiveRole 一致）：有學校的啟用教師、以及超管都不列入排行榜。
  const unrankedUids = new Set(
    input.admins
      .filter(
        (admin) =>
          admin.role === "super" ||
          (admin.role === "teacher" && admin.status !== "disabled" && (Boolean(admin.schoolId) || (admin.schoolIds?.length ?? 0) > 0)),
      )
      .map((admin) => admin.uid),
  );

  const entries: LeaderboardEntry[] = [];
  for (const [uid, stats] of statsByUid) {
    const profile = userByUid.get(uid);
    if (profile?.disabled) continue;
    if (unrankedUids.has(uid)) continue;
    const completed = stats.filter((stat) => stat.isCompleted);
    const updatedTimes = stats.map((stat) => stat.updatedAt ?? "").filter(Boolean).sort();
    entries.push(
      buildEntry(
        { uid, displayName: profile?.displayName || stats[0]?.displayName || "使用者" },
        {
          schoolId: profile?.schoolId || classSchoolByUid.get(uid)?.schoolId,
          schoolName: profile?.schoolName || classSchoolByUid.get(uid)?.schoolName,
          classIds: classIdsByUid.get(uid) ?? [],
        },
        "student",
        {
          totalScore: stats.reduce((sum, stat) => sum + stat.bestScore, 0),
          totalMaxScore: [...maxByProblem.values()].reduce((sum, value) => sum + value, 0),
          completedCount: completed.length,
          totalProblems: publishedProblems.length,
          passRate: publishedProblems.length === 0 ? 0 : stats.reduce((sum, stat) => sum + stat.bestPassRate, 0) / publishedProblems.length,
          elapsedMs: completed.reduce((sum, stat) => sum + (stat.bestSolveDurationMs ?? 0), 0),
          submitCount: stats.reduce((sum, stat) => sum + stat.submitCount, 0),
          completedAt: completed.map((stat) => stat.completedAt ?? "").filter(Boolean).sort()[0],
          lastSubmittedAt: updatedTimes[updatedTimes.length - 1],
        },
      ),
    );
  }

  for (let index = 0; index < entries.length; index += 400) {
    const batch = writeBatch(db);
    for (const entry of entries.slice(index, index + 400)) {
      batch.set(doc(db, "userStats", entry.uid), stripUndefined(entry));
    }
    await withRemoteTimeout(batch.commit(), "Firestore 排行榜彙總回填", 60000);
  }

  // 清掉教師／超管先前留下的彙總（規格 7.3：排行榜只有學生）。
  const existing = await withRemoteTimeout(getDocs(collection(db, "userStats")), "Firestore 排行榜彙總讀取", 60000);
  const staleUids = existing.docs.map((item) => item.id).filter((uid) => unrankedUids.has(uid));
  for (let index = 0; index < staleUids.length; index += 400) {
    const batch = writeBatch(db);
    for (const uid of staleUids.slice(index, index + 400)) {
      batch.delete(doc(db, "userStats", uid));
    }
    await withRemoteTimeout(batch.commit(), "Firestore 排行榜彙總清理", 60000);
  }
  return { written: entries.length, removed: staleUids.length };
}

function buildEntry(
  user: { uid: string; displayName: string },
  membership: MembershipInfo,
  role: UserRole,
  totals: {
    totalScore: number;
    totalMaxScore: number;
    completedCount: number;
    totalProblems: number;
    passRate: number;
    elapsedMs: number;
    submitCount: number;
    completedAt?: string;
    lastSubmittedAt?: string;
  },
): LeaderboardEntry {
  const updatedAt = totals.lastSubmittedAt || new Date().toISOString();
  return {
    uid: user.uid,
    displayName: user.displayName,
    role,
    schoolId: membership.schoolId ?? "",
    schoolName: membership.schoolName ?? "",
    classIds: membership.classIds,
    score: totals.totalScore,
    maxScore: totals.totalMaxScore,
    passRate: totals.passRate,
    elapsedMs: totals.elapsedMs,
    submitCount: totals.submitCount,
    updatedAt,
    completedCount: totals.completedCount,
    totalProblems: totals.totalProblems,
    totalScore: totals.totalScore,
    totalMaxScore: totals.totalMaxScore,
    ...(totals.completedAt ? { completedAt: totals.completedAt } : {}),
    ...(totals.lastSubmittedAt ? { lastSubmittedAt: totals.lastSubmittedAt } : {}),
  };
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function sortEntries(entries: LeaderboardEntry[]) {
  return [...entries].sort(compareEntries);
}

function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry) {
  if (b.passRate !== a.passRate) return b.passRate - a.passRate;
  if ((b.completedCount || 0) !== (a.completedCount || 0)) return (b.completedCount || 0) - (a.completedCount || 0);
  if ((b.totalScore ?? b.score) !== (a.totalScore ?? a.score)) return (b.totalScore ?? b.score) - (a.totalScore ?? a.score);
  const aCompletedAt = a.completedAt || "9999-12-31T23:59:59.999Z";
  const bCompletedAt = b.completedAt || "9999-12-31T23:59:59.999Z";
  if (aCompletedAt !== bCompletedAt) return aCompletedAt.localeCompare(bCompletedAt);
  if (a.submitCount !== b.submitCount) return a.submitCount - b.submitCount;
  return a.displayName.localeCompare(b.displayName, "zh-Hant", { numeric: true });
}

function betterSubmission(current: SubmissionRecord | undefined, incoming: SubmissionRecord) {
  if (!current) return incoming;
  if (incoming.passRate !== current.passRate) return incoming.passRate > current.passRate ? incoming : current;
  if (incoming.score !== current.score) return incoming.score > current.score ? incoming : current;
  if (incoming.elapsedMs !== current.elapsedMs) return incoming.elapsedMs < current.elapsedMs ? incoming : current;
  return incoming.createdAt < current.createdAt ? incoming : current;
}

function getProblemMaxScore(problem: Problem) {
  return problem.cases.reduce((sum, item) => sum + item.score, 0);
}

function isFullScoreSubmission(record: SubmissionRecord) {
  return record.maxScore > 0 && record.status === "accepted" && record.totalCases > 0 && record.passedCases === record.totalCases && record.score >= record.maxScore;
}
