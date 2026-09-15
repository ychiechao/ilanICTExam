import { inferUserRoleFromEmail } from "../services/accountService";
import type { AdminProfile, ManagedUser, Problem, SchoolAccount, SubmissionRecord, UserRole } from "../types";
import { formatManagedTimestamp, formatProblemStatusSummary } from "./format";
import { getBetterSubmission, isFullScoreSubmission } from "./practice";

export function countSubmissionsByProblem(records: SubmissionRecord[]) {
  return records.reduce<Record<string, number>>((counts, record) => {
    counts[record.problemId] = (counts[record.problemId] || 0) + 1;
    return counts;
  }, {});
}

export function countSubmissionsByUser(records: SubmissionRecord[]) {
  return records.reduce<Record<string, number>>((counts, record) => {
    const uid = record.uid || "guest";
    counts[uid] = (counts[uid] || 0) + 1;
    return counts;
  }, {});
}

export function getManagedUserDirectoryRole(item: ManagedUser, profile?: AdminProfile): UserRole {
  if (profile?.role === "super") {
    return "super";
  }
  if (profile?.role === "teacher") {
    return "teacher";
  }
  if (item.role === "teacher" || item.role === "student") {
    return item.role;
  }
  return inferUserRoleFromEmail(item.email);
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

export function getManagedUserSchoolIds(
  item: ManagedUser,
  profile: AdminProfile | undefined,
  schoolAccountsByUid: Map<string, SchoolAccount[]>,
  schoolAccountsByEmail: Map<string, SchoolAccount[]>,
) {
  const schoolIds = new Set<string>();
  addSchoolId(schoolIds, item.schoolId);
  addSchoolId(schoolIds, profile?.schoolId);
  (profile?.schoolIds || []).forEach((schoolId) => addSchoolId(schoolIds, schoolId));
  (schoolAccountsByUid.get(item.uid) || []).forEach((account) => addSchoolId(schoolIds, account.schoolId));
  (schoolAccountsByEmail.get(normalizeEmailForLookup(item.email)) || []).forEach((account) =>
    addSchoolId(schoolIds, account.schoolId),
  );
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
  records: SubmissionRecord[],
  adminUids: Set<string>,
) {
  const usersById = new Map(users.map((item) => [item.uid, item]));
  for (const record of records) {
    if (!usersById.has(record.uid || "")) {
      usersById.set(record.uid || "guest", {
        uid: record.uid || "guest",
        displayName: record.displayName || "訪客",
      });
    }
  }

  return Array.from(usersById.values())
    .map((item) => {
      const userRecords = records.filter((record) => (record.uid || "guest") === item.uid);
      const bestByProblem = new Map<string, SubmissionRecord>();
      for (const record of userRecords) {
        bestByProblem.set(record.problemId, getBetterSubmission(bestByProblem.get(record.problemId), record));
      }

      const bestRecords = Array.from(bestByProblem.values());
      const completedProblems = problems.filter((problem) => {
        const best = bestByProblem.get(problem.id);
        return best && isFullScoreSubmission(best);
      });
      const attemptedProblems = problems.filter(
        (problem) => bestByProblem.has(problem.id) && !completedProblems.some((item) => item.id === problem.id),
      );
      const untouchedCount = Math.max(0, problems.length - completedProblems.length - attemptedProblems.length);
      const averagePassRate =
        problems.length === 0
          ? 0
          : bestRecords.reduce((sum, record) => sum + record.passRate, 0) / problems.length;
      const completedTitles = completedProblems.map((problem) => problem.title);
      const attemptedTitles = attemptedProblems.map((problem) => problem.title);

      return {
        uid: item.uid,
        displayName: item.displayName || item.email || "未命名使用者",
        role: adminUids.has(item.uid) ? "管理者" : "一般",
        lastLoginAt: formatManagedTimestamp(item.lastLoginAt),
        completedCount: completedProblems.length,
        averagePassRate,
        submitCount: userRecords.length,
        lastSubmittedAt: userRecords[0]?.createdAt,
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
