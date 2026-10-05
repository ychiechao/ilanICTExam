import type { AdminProfile, LeaderboardDivision, LeaderboardDivisionFilter, LeaderboardEntry, LeaderboardScope, ManagedUser, School, UserRole } from "../types";

export function isRankedRole(role?: string) {
  return role === undefined || role === "student";
}

/** 未啟用的教師帳號也不列入學生排行。 */
export function isRankedAccount(user: { email?: string | null; role?: UserRole }, role = user.role) {
  return isRankedRole(role) && !(user.email || "").trim().toLowerCase().endsWith("@tmail.ilc.edu.tw");
}

export function getUnrankedUserIds(users: ManagedUser[], admins: AdminProfile[]) {
  return new Set([...admins.map((admin) => admin.uid), ...users.filter((user) => !isRankedAccount(user)).map((user) => user.uid)]);
}

export function inferSchoolDivision(name: string): LeaderboardDivision | undefined {
  const elementary = /國小|國民小學/.test(name);
  const junior = /國中|國民中學/.test(name);
  if (elementary === junior) return undefined;
  return elementary ? "E" : "J";
}

export function getSchoolDivision(school?: School, fallbackName = ""): LeaderboardDivision | undefined {
  if (school?.division === "unclassified") return undefined;
  if (school?.division === "E" || school?.division === "J") return school.division;
  return inferSchoolDivision(school?.name || fallbackName);
}

export function getDivisionLabel(division?: LeaderboardDivision) {
  return division === "E" ? "國小組" : division === "J" ? "國中組" : "未分類";
}

export function matchesLeaderboardEntry(
  entry: LeaderboardEntry,
  scope: LeaderboardScope,
  division: LeaderboardDivisionFilter,
  schools: ReadonlyMap<string, School>,
) {
  if (!isRankedRole(entry.role)) return false;
  if (scope.kind === "school" && entry.schoolId !== scope.schoolId) return false;
  if (scope.kind === "class" && !(entry.classIds ?? []).includes(scope.classId)) return false;
  return division === "all" || getSchoolDivision(schools.get(entry.schoolId ?? ""), entry.schoolName) === division;
}

/** 與 Firestore 的三個排序欄位一致；同分再依完成時間、提交次數、姓名排序。 */
export function compareLeaderboardScores(a: LeaderboardEntry, b: LeaderboardEntry) {
  if (b.passRate !== a.passRate) return b.passRate - a.passRate;
  if ((b.completedCount || 0) !== (a.completedCount || 0)) return (b.completedCount || 0) - (a.completedCount || 0);
  return (b.totalScore ?? b.score) - (a.totalScore ?? a.score);
}

export function sortEntries(entries: LeaderboardEntry[]) {
  return [...entries].sort((a, b) => {
    const scoreOrder = compareLeaderboardScores(a, b);
    if (scoreOrder) return scoreOrder;
    const aCompletedAt = a.completedAt || "9999-12-31T23:59:59.999Z";
    const bCompletedAt = b.completedAt || "9999-12-31T23:59:59.999Z";
    if (aCompletedAt !== bCompletedAt) return aCompletedAt.localeCompare(bCompletedAt);
    if (a.submitCount !== b.submitCount) return a.submitCount - b.submitCount;
    return a.displayName.localeCompare(b.displayName, "zh-Hant", { numeric: true });
  });
}

/** 先排除身分／篩選組別，再取前 N 名；跨頁同分資料也要讀完才能正確排序。 */
export async function collectLeaderboardPages<Cursor>(
  readPage: (cursor?: Cursor) => Promise<{ entries: LeaderboardEntry[]; nextCursor?: Cursor }>,
  matches: (entry: LeaderboardEntry) => boolean,
  count: number,
) {
  const entries: LeaderboardEntry[] = [];
  let cursor: Cursor | undefined;
  while (true) {
    const page = await readPage(cursor);
    entries.push(...page.entries.filter(matches));
    const ranked = sortEntries(entries);
    if (page.nextCursor === undefined || page.entries.length === 0) return ranked.slice(0, count);
    const last = page.entries[page.entries.length - 1];
    if (ranked.length >= count && compareLeaderboardScores(last, ranked[count - 1]) > 0) return ranked.slice(0, count);
    cursor = page.nextCursor;
  }
}
