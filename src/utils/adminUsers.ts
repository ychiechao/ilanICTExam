import type { AdminProfile, ManagedUser, Problem, UserProblemStat, UserRole } from "../types";
import { formatManagedTimestamp, formatProblemStatusSummary } from "./format";

export function countSubmissionsByProblem(stats: UserProblemStat[]) {
  return stats.reduce<Record<string, number>>((counts, stat) => {
    counts[stat.problemId] = (counts[stat.problemId] || 0) + stat.submitCount;
    return counts;
  }, {});
}

export function countSubmissionsByUser(stats: UserProblemStat[]) {
  return stats.reduce<Record<string, number>>((counts, stat) => {
    counts[stat.uid] = (counts[stat.uid] || 0) + stat.submitCount;
    return counts;
  }, {});
}

export function countTotalSubmissions(stats: UserProblemStat[]) {
  return stats.reduce((sum, stat) => sum + stat.submitCount, 0);
}

export function getManagedUserDirectoryRole(item: ManagedUser, profile?: AdminProfile): UserRole {
  if (profile?.role === "super") {
    return "super";
  }
  if (profile?.role === "teacher") {
    return "teacher";
  }
  void item;
  return "student";
}

export function getManagedUserDirectoryRoleLabel(role: UserRole) {
  if (role === "super") {
    return "超級管理者";
  }
  if (role === "teacher") {
    return "教師";
  }
  return "學生";
}

export function getManagedUserSchoolIds(item: ManagedUser, profile: AdminProfile | undefined) {
  const schoolIds = new Set<string>();
  addSchoolId(schoolIds, item.schoolId);
  addSchoolId(schoolIds, profile?.schoolId);
  (profile?.schoolIds || []).forEach((schoolId) => addSchoolId(schoolIds, schoolId));
  return Array.from(schoolIds);
}

export function addSchoolId(target: Set<string>, schoolId?: string) {
  const normalized = (schoolId || "").trim();
  if (normalized) {
    target.add(normalized);
  }
}

export function normalizeEmailForLookup(email?: string | null) {
  return (email || "").trim().toLowerCase();
}

export function buildUserProgressRows(
  users: ManagedUser[],
  problems: Problem[],
  stats: UserProblemStat[],
  adminUids: Set<string>,
) {
  const usersById = new Map(users.map((item) => [item.uid, item]));
  for (const stat of stats) {
    if (!usersById.has(stat.uid)) {
      usersById.set(stat.uid, {
        uid: stat.uid,
        displayName: stat.displayName || (stat.uid === "guest" ? "訪客" : stat.uid),
      });
    }
  }

  return Array.from(usersById.values())
    .map((item) => {
      const userStats = stats.filter((stat) => stat.uid === item.uid);
      const statByProblem = new Map(userStats.map((stat) => [stat.problemId, stat]));
      const completedProblems = problems.filter((problem) => statByProblem.get(problem.id)?.isCompleted);
      const attemptedProblems = problems.filter(
        (problem) => statByProblem.has(problem.id) && !statByProblem.get(problem.id)?.isCompleted,
      );
      const untouchedCount = Math.max(0, problems.length - completedProblems.length - attemptedProblems.length);
      const averagePassRate =
        problems.length === 0
          ? 0
          : problems.reduce((sum, problem) => sum + (statByProblem.get(problem.id)?.bestPassRate ?? 0), 0) / problems.length;
      const completedTitles = completedProblems.map((problem) => problem.title);
      const attemptedTitles = attemptedProblems.map((problem) => problem.title);
      const lastSubmittedAt = userStats
        .map((stat) => stat.updatedAt ?? "")
        .filter(Boolean)
        .sort()
        .pop();

      return {
        uid: item.uid,
        displayName: item.displayName || item.email || "未命名使用者",
        role: adminUids.has(item.uid) ? "管理者" : "一般",
        lastLoginAt: formatManagedTimestamp(item.lastLoginAt),
        completedCount: completedProblems.length,
        averagePassRate,
        submitCount: userStats.reduce((sum, stat) => sum + stat.submitCount, 0),
        lastSubmittedAt,
        problemStatusText: formatProblemStatusSummary(completedTitles, attemptedTitles, untouchedCount),
      };
    })
    .sort((a, b) => {
      if (b.averagePassRate !== a.averagePassRate) {
        return b.averagePassRate - a.averagePassRate;
      }
      if (b.completedCount !== a.completedCount) {
        return b.completedCount - a.completedCount;
      }
      return a.displayName.localeCompare(b.displayName, "zh-Hant", { numeric: true });
    });
}
