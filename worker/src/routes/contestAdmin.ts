/**
 * 賽事重置與刪除（超管）
 *
 * POST   /contests/{contestId}/reset   清空該場所有資料（帳號、題庫、作答、排行榜、事件、儀表板快照、KV），
 *                                       保留賽事設定，狀態退回 draft。演練後或測試流程用。
 * DELETE /contests/{contestId}          只允許「空的草稿」：沒有帳號、題庫、作答紀錄；有成績的賽事走封存。
 *
 * 稽核紀錄 auditLogs 不清，兩個操作都會再寫一筆。
 */
import { HttpError, type RequestContext } from "../context";
import { json } from "../index";
import { casesKey } from "./contestProblems";

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
