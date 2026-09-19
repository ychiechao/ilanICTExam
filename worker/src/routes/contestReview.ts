/**
 * 成績審核（超管）
 *
 * POST /contests/{contestId}/void   body { submissionId, reason, restore? }
 *   作廢（或恢復）一筆提交：標記 voided／voidReason／voidedAt／voidedBy，
 *   重算該人的排行榜 entry 與儀表板快照，寫 auditLogs。
 *   提交本身不刪除，作廢後仍佔該題的提交次數。
 */
import { HttpError, readJsonBody, type RequestContext } from "../context";
import { SERVER_TIMESTAMP } from "../google/firestore";
import { json } from "../index";
import { recomputeLeaderboardEntry, refreshDashboard } from "./grade";

interface VoidBody {
  submissionId?: string;
  reason?: string;
  restore?: boolean;
}

interface SubmissionDoc {
  contestId: string;
  uid: string;
  username: string;
  problemId: string;
  problemTitle?: string;
  attempt?: number;
  score: number;
  voided?: boolean;
}

export async function handleVoidSubmission(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const body = await readJsonBody<VoidBody>(request);
  const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  const restore = body.restore === true;
  if (!submissionId) throw new HttpError(400, "bad_request", "缺少 submissionId");
  if (!restore && !reason) throw new HttpError(400, "reason_required", "請填寫作廢原因");

  const contest = await ctx.getContest(contestId);
  if (!contest) throw new HttpError(404, "contest_not_found", "找不到賽事");
  const submission = await ctx.db.getDoc<SubmissionDoc>(`contestSubmissions/${submissionId}`);
  if (!submission || submission.data.contestId !== contestId) {
    throw new HttpError(404, "submission_not_found", "找不到這筆提交");
  }
  if (!restore && submission.data.voided === true) {
    throw new HttpError(409, "already_voided", "這筆提交已經作廢");
  }
  if (restore && submission.data.voided !== true) {
    throw new HttpError(409, "not_voided", "這筆提交沒有作廢");
  }

  await ctx.db.setDoc(
    `contestSubmissions/${submissionId}`,
    restore
      ? { voided: false, voidReason: "", voidedAtIso: "", voidedBy: "", voidedByName: "", restoredAt: SERVER_TIMESTAMP, restoredBy: actor.uid }
      : { voided: true, voidReason: reason, voidedAt: SERVER_TIMESTAMP, voidedAtIso: new Date().toISOString(), voidedBy: actor.uid, voidedByName: actor.name },
    { merge: true },
  );
  const entry = await recomputeLeaderboardEntry(ctx, contestId, submission.data.uid, submission.data.username);
  await refreshDashboard(ctx, contestId, contest.data, { force: true });

  const label = `${submission.data.username}「${submission.data.problemTitle ?? submission.data.problemId}」第 ${submission.data.attempt ?? "?"} 次（${submission.data.score} 分）`;
  await ctx.writeAuditLog(actor, {
    action: "contest.void",
    targetType: "contestSubmission",
    targetId: submissionId,
    summary: restore ? `恢復 ${label}` : `作廢 ${label}：${reason}`,
  });

  return json({ ok: true, submissionId, voided: !restore, totals: entry ? { totalScore: entry.totalScore, solvedCount: entry.solvedCount } : null });
}
