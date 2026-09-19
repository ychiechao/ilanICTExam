/**
 * 賽事重置與刪除（超管）
 *
 * POST   /contests/{contestId}/reset   清空該場所有資料（帳號、題庫、作答、排行榜、事件、儀表板快照、KV），
 *                                       保留賽事設定，狀態退回 draft。演練後或測試流程用。
 * DELETE /contests/{contestId}          只允許「空的草稿」：沒有帳號、題庫、作答紀錄；有成績的賽事走封存。
 * POST   /contests/{contestId}/archive     封存：記住原階段、停用該場全部競賽帳號（disabledReason=archived）。
 * POST   /contests/{contestId}/unarchive   解封存：回到指定階段、把因封存停用的帳號恢復啟用。
 * POST   /contests/{contestId}/release     把競賽題庫（含 KV 測資）複製到練習題庫 problems（status=draft），已存在的略過。
 *
 * 稽核紀錄 auditLogs 不清，每個操作都會再寫一筆。
 */
import { HttpError, readJsonBody, type RequestContext } from "../context";
import { SERVER_TIMESTAMP } from "../google/firestore";
import { json } from "../index";
import { casesKey, type ContestProblemPublic } from "./contestProblems";
import type { GradeCase } from "../../../shared/grading";

/** 以 contestId 欄位關聯到賽事的集合；重置時整批刪除。 */
const CONTEST_SCOPED_COLLECTIONS = [
  "contestAccounts",
  "contestProblems",
  "contestSubmissions",
  "contestLeaderboards",
  "contestEvents",
  "contestPresence",
] as const;

type ScopedCollection = (typeof CONTEST_SCOPED_COLLECTIONS)[number];

export async function handleResetContest(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const contest = await ctx.getContest(contestId);
  if (!contest) {
    throw new HttpError(404, "contest_not_found", "找不到賽事");
  }
  if (contest.data.status === "active" || contest.data.status === "paused") {
    throw new HttpError(409, "contest_running", "賽事進行中，不能重置");
  }

  const deleted = await purgeContestData(ctx, contestId);

  await ctx.db.setDoc(
    `contests/${contestId}`,
    {
      status: "draft",
      accountCount: 0,
      problemCount: 0,
      casesSyncedAt: "",
      startAt: "",
      endAt: "",
      pausedAt: "",
      publishedAt: "",
      releasedToPractice: false,
      archivedFromStatus: "",
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  await ctx.writeAuditLog(actor, {
    action: "contest.reset",
    targetType: "contest",
    targetId: contestId,
    summary: `重置「${contest.data.title}」：刪除帳號 ${deleted.contestAccounts}、題目 ${deleted.contestProblems}、作答 ${deleted.contestSubmissions} 筆，狀態退回草稿`,
  });

  return json({ ok: true, contestId, deleted });
}

export async function handleDeleteContest(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const contest = await ctx.getContest(contestId);
  if (!contest) {
    throw new HttpError(404, "contest_not_found", "找不到賽事");
  }
  if (contest.data.status !== "draft") {
    throw new HttpError(409, "contest_not_draft", "只能刪除草稿狀態的賽事；已有進度的賽事請先重置或封存");
  }
  const where = [{ field: "contestId", op: "EQUAL", value: contestId }];
  const [accounts, problems, submissions] = await Promise.all([
    ctx.db.count("contestAccounts", where),
    ctx.db.count("contestProblems", where),
    ctx.db.count("contestSubmissions", where),
  ]);
  if (accounts > 0 || problems > 0 || submissions > 0) {
    throw new HttpError(
      409,
      "contest_not_empty",
      `賽事還有資料（帳號 ${accounts}、題目 ${problems}、作答 ${submissions}），請先重置再刪除`,
    );
  }

  // 草稿理論上是空的，但仍清一次殘留（例如事件、儀表板快照）。
  await purgeContestData(ctx, contestId);
  await ctx.db.deleteDoc(`contests/${contestId}`);
  await ctx.writeAuditLog(actor, {
    action: "contest.delete",
    targetType: "contest",
    targetId: contestId,
    summary: `刪除草稿賽事「${contest.data.title}」`,
  });

  return json({ ok: true, contestId });
}

/** 刪除該場在各集合與 KV 的所有資料，並從平台啟用清單移除，回傳各集合刪除筆數。 */
async function purgeContestData(ctx: RequestContext, contestId: string): Promise<Record<ScopedCollection, number>> {
  const platform = await ctx.getPlatform();
  if (platform.activeContestIds.includes(contestId)) {
    await ctx.db.setDoc(
      "settings/platform",
      { activeContestIds: platform.activeContestIds.filter((id) => id !== contestId) },
      { merge: true },
    );
  }

  const deleted = {} as Record<ScopedCollection, number>;
  for (const collection of CONTEST_SCOPED_COLLECTIONS) {
    const docs = await ctx.db.query<{ problemId?: string }>(collection, {
      where: [{ field: "contestId", op: "EQUAL", value: contestId }],
    });
    deleted[collection] = docs.length;
    if (docs.length === 0) continue;

    // KV 要先清：帳號的密碼雜湊、題目的完整測資。
    if (collection === "contestAccounts") {
      await Promise.all(docs.map((doc) => ctx.env.PASSWORDS.delete(`pw:${doc.id}`)));
    } else if (collection === "contestProblems") {
      await Promise.all(docs.map((doc) => ctx.env.CONTEST_CASES.delete(casesKey(contestId, doc.data.problemId ?? ""))));
    }
    await ctx.db.batchDelete(docs.map((doc) => `${collection}/${doc.id}`));
  }
  await ctx.db.deleteDoc(`contestDashboards/${contestId}`);
  return deleted;
}

const UNARCHIVE_TARGETS = new Set(["draft", "roster", "waiting", "ended", "review", "published"]);

export async function handleArchiveContest(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const contest = await ctx.getContest(contestId);
  if (!contest) throw new HttpError(404, "contest_not_found", "找不到賽事");
  const status = contest.data.status;
  if (status === "archived") throw new HttpError(409, "already_archived", "賽事已經封存");
  if (status === "active" || status === "paused") throw new HttpError(409, "contest_running", "賽事進行中，不能封存");

  // 停用所有仍啟用的帳號，記下原因，解封存時只恢復這些。
  const accounts = await ctx.db.query<{ status?: string }>("contestAccounts", {
    where: [{ field: "contestId", op: "EQUAL", value: contestId }],
  });
  const toDisable = accounts.filter((doc) => doc.data.status === "active");
  if (toDisable.length > 0) {
    await ctx.db.batchSet(
      toDisable.map((doc) => ({
        path: `contestAccounts/${doc.id}`,
        data: { status: "disabled", disabledReason: "archived", statusUpdatedAt: SERVER_TIMESTAMP, statusUpdatedBy: actor.uid },
        merge: true,
      })),
    );
  }
  await ctx.db.setDoc(
    `contests/${contestId}`,
    { status: "archived", archivedFromStatus: status, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { merge: true },
  );
  await ctx.writeAuditLog(actor, {
    action: "contest.status",
    targetType: "contest",
    targetId: contestId,
    summary: `封存「${contest.data.title}」（原階段 ${status}），停用 ${toDisable.length} 個競賽帳號`,
  });
  return json({ ok: true, contestId, disabledAccounts: toDisable.length });
}

export async function handleUnarchiveContest(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const body = await readJsonBody<{ status?: string }>(request);
  const contest = await ctx.getContest(contestId);
  if (!contest) throw new HttpError(404, "contest_not_found", "找不到賽事");
  if (contest.data.status !== "archived") throw new HttpError(409, "not_archived", "賽事沒有封存");
  const target = typeof body.status === "string" && UNARCHIVE_TARGETS.has(body.status) ? body.status : "published";

  const accounts = await ctx.db.query<{ status?: string; disabledReason?: string }>("contestAccounts", {
    where: [{ field: "contestId", op: "EQUAL", value: contestId }],
  });
  const toEnable = accounts.filter((doc) => doc.data.status === "disabled" && doc.data.disabledReason === "archived");
  if (toEnable.length > 0) {
    await ctx.db.batchSet(
      toEnable.map((doc) => ({
        path: `contestAccounts/${doc.id}`,
        data: { status: "active", disabledReason: "", statusUpdatedAt: SERVER_TIMESTAMP, statusUpdatedBy: actor.uid },
        merge: true,
      })),
    );
  }
  await ctx.db.setDoc(
    `contests/${contestId}`,
    { status: target, archivedFromStatus: "", archivedAt: "", updatedAt: new Date().toISOString() },
    { merge: true },
  );
  await ctx.writeAuditLog(actor, {
    action: "contest.status",
    targetType: "contest",
    targetId: contestId,
    summary: `解封存「${contest.data.title}」→ ${target}，恢復 ${toEnable.length} 個競賽帳號`,
  });
  return json({ ok: true, contestId, status: target, enabledAccounts: toEnable.length });
}

/** 練習題庫 problems 的文件（與前端 Problem 型別對齊，只放必要欄位）。 */
interface PracticeProblemDoc {
  id: string;
  year: string;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  difficulty: string;
  category: string;
  status: "draft";
  examples: ContestProblemPublic["examples"];
  cases: GradeCase[];
  source: string;
  sourceId: string;
  sourceContestId: string;
  createdAt: string;
  updatedAt: string;
}

export async function handleReleaseContest(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const contest = await ctx.getContest(contestId);
  if (!contest) throw new HttpError(404, "contest_not_found", "找不到賽事");
  if (contest.data.status === "active" || contest.data.status === "paused" || contest.data.status === "waiting") {
    throw new HttpError(409, "contest_running", "賽事還沒結束，不能釋出題庫");
  }
  const problems = await ctx.db.query<ContestProblemPublic>("contestProblems", {
    where: [{ field: "contestId", op: "EQUAL", value: contestId }],
  });
  if (problems.length === 0) throw new HttpError(409, "no_problems", "這場賽事沒有題庫");

  const now = new Date().toISOString();
  const writes: Array<{ path: string; data: PracticeProblemDoc & Record<string, unknown> }> = [];
  const skipped: string[] = [];
  const missingCases: string[] = [];
  for (const doc of problems.sort((a, b) => a.data.order - b.data.order)) {
    const problem = doc.data;
    const existing = await ctx.db.getDoc(`problems/${problem.problemId}`);
    if (existing) {
      skipped.push(problem.title);
      continue;
    }
    const casesText = await ctx.env.CONTEST_CASES.get(casesKey(contestId, problem.problemId));
    const cases = casesText ? (JSON.parse(casesText) as GradeCase[]) : [];
    if (cases.length === 0) missingCases.push(problem.title);
    writes.push({
      path: `problems/${problem.problemId}`,
      data: {
        id: problem.problemId,
        year: contest.data.year ?? "",
        title: problem.title,
        description: problem.description,
        inputFormat: problem.inputFormat,
        outputFormat: problem.outputFormat,
        difficulty: problem.difficulty || "medium",
        category: problem.category || contest.data.title,
        status: "draft",
        examples: problem.examples ?? [],
        cases,
        source: "contest",
        sourceId: contestId,
        sourceContestId: contestId,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  if (writes.length > 0) await ctx.db.batchSet(writes);
  await ctx.db.setDoc(`contests/${contestId}`, { releasedToPractice: true, releasedAt: now, updatedAt: now }, { merge: true });
  await ctx.writeAuditLog(actor, {
    action: "contest.release",
    targetType: "contest",
    targetId: contestId,
    summary: `釋出「${contest.data.title}」題庫到練習題庫：新增 ${writes.length} 題（草稿）${skipped.length > 0 ? `，略過已存在 ${skipped.length} 題` : ""}`,
  });
  return json({ ok: true, contestId, created: writes.length, skipped, missingCases });
}
