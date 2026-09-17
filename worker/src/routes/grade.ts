/**
 * POST /grade   競賽提交評分（規格 8.5、9.2）
 *
 * 1. 驗 ID token，身分（contestId、帳號）以 claims 為準
 * 2. 平台必須是競賽模式、該場啟用、該場進行中（伺服器時間）
 * 3. 提交次數未超過上限、5 秒內只接受一次
 * 4. 從 KV 取完整測資，用 JS-Interpreter 逐筆執行
 * 5. 寫 contestSubmissions（伺服器時間戳）、更新該人排行榜 entry、重算儀表板快照
 *
 * 回傳只含每筆測資通過與否；隱藏測資的輸入、預期、實際輸出不回傳。
 */
import { scoreCase, splitInputs, summarizeOutcomes, type CaseOutcome, type GradeCase } from "../../../shared/grading";
import { verifyRequestToken } from "../auth/verifyIdToken";
import { HttpError, readJsonBody, type ContestDoc, type RequestContext } from "../context";
import { SERVER_TIMESTAMP } from "../google/firestore";
import { json } from "../index";
import { runProgram } from "../grading/runner";
import { casesKey, contestProblemDocId, type ContestProblemPublic } from "./contestProblems";

interface GradeBody {
  problemId?: string;
  generatedCode?: string;
  blocklyXml?: string;
  mode?: string;
}

interface LeaderboardEntryDoc {
  contestId: string;
  uid: string;
  username: string;
  name: string;
  schoolId: string;
  schoolName: string;
  totalScore: number;
  solvedCount: number;
  submitCount: number;
  bestByProblem: Record<string, { score: number; maxScore: number; passRate: number; at: string }>;
  lastSubmittedAt: string;
  completedAt?: string;
}

const MAX_CODE_LENGTH = 200_000;
const MAX_XML_LENGTH = 400_000;
const MAX_STEPS_PER_CASE = 20_000;
const MAX_STEPS_TOTAL = 60_000;
const MAX_OUTPUT_LENGTH = 1000;
const RATE_LIMIT_MS = 5_000;
const DASHBOARD_THROTTLE_MS = 3_000;

// 同一 isolate 內的限速；跨 isolate 由提交次數上限兜底。
const lastSubmitAt = new Map<string, number>();

export async function handleGrade(request: Request, ctx: RequestContext): Promise<Response> {
  const verified = await verifyRequestToken(request, ctx.projectId);
  if (!verified || verified.claims.accountType !== "contest") {
    throw new HttpError(401, "unauthorized", "請以競賽帳號登入後再提交");
  }
  const contestId = String(verified.claims.contestId ?? "");
  const username = String(verified.claims.username ?? "");
  const uid = verified.uid;

  const body = await readJsonBody<GradeBody>(request);
  const problemId = typeof body.problemId === "string" ? body.problemId.trim() : "";
  const code = typeof body.generatedCode === "string" ? body.generatedCode : "";
  const blocklyXml = typeof body.blocklyXml === "string" ? body.blocklyXml : "";
  if (!problemId) throw new HttpError(400, "bad_request", "缺少 problemId");
  if (!code.trim()) throw new HttpError(400, "empty_code", "目前沒有可執行的積木");
  if (code.length > MAX_CODE_LENGTH || blocklyXml.length > MAX_XML_LENGTH) {
    throw new HttpError(413, "too_large", "程式過大");
  }

  // 限速：同一帳號 5 秒內一次。
  const now = Date.now();
  const last = lastSubmitAt.get(uid) ?? 0;
  if (now - last < RATE_LIMIT_MS) {
    throw new HttpError(429, "too_fast", "提交太頻繁，請稍候幾秒再試");
  }
  lastSubmitAt.set(uid, now);

  const [platform, contestDoc] = await Promise.all([ctx.getPlatform(), ctx.getContest(contestId)]);
  if (platform.mode !== "contest" || !platform.activeContestIds.includes(contestId)) {
    throw new HttpError(403, "contest_closed", "目前不是競賽時間");
  }
  if (!contestDoc) throw new HttpError(404, "contest_not_found", "找不到賽事");
  const contest = contestDoc.data;
  const phase = contestPhase(contest, now);
  if (phase !== "running") {
    throw new HttpError(403, phase === "paused" ? "contest_paused" : phase === "ended" ? "contest_ended" : "contest_not_started",
      phase === "paused" ? "比賽暫停中" : phase === "ended" ? "作答時間已結束" : "比賽尚未開始");
  }

  const [problemDoc, casesText] = await Promise.all([
    ctx.db.getDoc<ContestProblemPublic>(`contestProblems/${contestProblemDocId(contestId, problemId)}`),
    ctx.env.CONTEST_CASES.get(casesKey(contestId, problemId)),
  ]);
  if (!problemDoc || !casesText) throw new HttpError(404, "problem_not_found", "找不到這一題");
  const cases = JSON.parse(casesText) as GradeCase[];

  const maxSubmissions = contest.maxSubmissionsPerProblem && contest.maxSubmissionsPerProblem > 0 ? contest.maxSubmissionsPerProblem : 10;
  const submitCount = await ctx.db.count("contestSubmissions", [
    { field: "contestId", op: "EQUAL", value: contestId },
    { field: "uid", op: "EQUAL", value: uid },
    { field: "problemId", op: "EQUAL", value: problemId },
  ]);
  if (submitCount >= maxSubmissions) {
    throw new HttpError(429, "submission_limit", `這一題最多提交 ${maxSubmissions} 次`);
  }

  // 逐筆執行；總步數超過預算時，剩下的測資直接判為超時。
  const started = Date.now();
  const outcomes: CaseOutcome[] = [];
  let stepsUsed = 0;
  let totalSteps = 0;
  for (const testCase of cases) {
    if (stepsUsed >= MAX_STEPS_TOTAL) {
      outcomes.push(scoreCase(testCase, { output: "", error: "執行超時（本次提交的總執行量已用完）。" }));
      continue;
    }
    const run = runProgram(code, {
      inputs: splitInputs(testCase.input),
      maxSteps: Math.min(MAX_STEPS_PER_CASE, MAX_STEPS_TOTAL - stepsUsed),
      maxOutputLength: MAX_OUTPUT_LENGTH,
    });
    stepsUsed += run.steps;
    totalSteps += run.steps;
    outcomes.push(scoreCase(testCase, run));
  }
  const summary = summarizeOutcomes(cases, outcomes);
  const elapsedMs = Date.now() - started;
  const isFullScore = summary.status === "accepted" && summary.maxScore > 0;
  const codeHash = await sha256(code);
  const createdAtIso = new Date().toISOString();

  const submissionId = `${contestId}_${username}_${problemId}_${now}`;
  const storedCases = outcomes.map((item) => ({
    caseTitle: item.caseTitle,
    groupTitle: item.groupTitle,
    visibility: item.visibility,
    passed: item.passed,
    earnedScore: item.earnedScore,
    score: item.score,
    ...(item.error ? { error: item.error } : {}),
    // 公開測資保留內容供審核與參賽者對照；隱藏測資只留結果。
    ...(item.visibility === "public" ? { input: item.input, expected: item.expected, actual: item.actual } : {}),
  }));
  await ctx.db.setDoc(`contestSubmissions/${submissionId}`, {
    contestId,
    problemId,
    problemTitle: problemDoc.data.title,
    uid,
    username,
    displayName: String(verified.claims.displayName ?? verified.claims.name ?? username),
    schoolId: String(verified.claims.schoolId ?? ""),
    score: summary.score,
    maxScore: summary.maxScore,
    passedCases: summary.passedCases,
    totalCases: summary.totalCases,
    passRate: summary.passRate,
    status: summary.status,
    isFullScore,
    caseResults: storedCases,
    blocklyXml,
    generatedCode: code,
    codeHash,
    elapsedMs,
    steps: totalSteps,
    attempt: submitCount + 1,
    voided: false,
    createdAt: SERVER_TIMESTAMP,
    createdAtIso,
  });

  const entry = await updateLeaderboardEntry(ctx, contestId, uid, username, verified.claims, problemId, {
    score: summary.score,
    maxScore: summary.maxScore,
    passRate: summary.passRate,
    at: createdAtIso,
    isFullScore,
  });
  await refreshDashboard(ctx, contestId, contest);

  return json({
    ok: true,
    submission: {
      id: submissionId,
      attempt: submitCount + 1,
      remaining: Math.max(0, maxSubmissions - submitCount - 1),
      score: summary.score,
      maxScore: summary.maxScore,
      passedCases: summary.passedCases,
      totalCases: summary.totalCases,
      passRate: summary.passRate,
      status: summary.status,
      isFullScore,
      elapsedMs,
      createdAt: createdAtIso,
      caseResults: storedCases,
    },
    totals: { totalScore: entry.totalScore, solvedCount: entry.solvedCount },
  });
}

function contestPhase(contest: ContestDoc, nowMs: number) {
  if (contest.status === "paused") return "paused";
  if (contest.status !== "active") return contest.status === "waiting" || contest.status === "draft" || contest.status === "roster" ? "waiting" : "ended";
  if (contest.startAt && Date.parse(contest.startAt) > nowMs) return "waiting";
  if (contest.endAt && Date.parse(contest.endAt) <= nowMs) return "ended";
  return "running";
}

async function updateLeaderboardEntry(
  ctx: RequestContext,
  contestId: string,
  uid: string,
  username: string,
  claims: Record<string, unknown>,
  problemId: string,
  result: { score: number; maxScore: number; passRate: number; at: string; isFullScore: boolean },
): Promise<LeaderboardEntryDoc> {
  const path = `contestLeaderboards/${contestId}_${username}`;
  const existing = await ctx.db.getDoc<LeaderboardEntryDoc>(path);
  // 成績以「最後一次提交」為準：每次提交直接覆蓋該題成績（欄位名沿用 bestByProblem，儀表板與投影畫面共用）。
  const bestByProblem = { ...(existing?.data.bestByProblem ?? {}) };
  bestByProblem[problemId] = { score: result.score, maxScore: result.maxScore, passRate: result.passRate, at: result.at };
  const bests = Object.values(bestByProblem);
  const totalScore = bests.reduce((sum, item) => sum + item.score, 0);
  const solvedCount = bests.filter((item) => item.maxScore > 0 && item.score >= item.maxScore).length;
  const completedAt = bests
    .filter((item) => item.maxScore > 0 && item.score >= item.maxScore)
    .map((item) => item.at)
    .sort()
    .pop();
  const entry: LeaderboardEntryDoc = {
    contestId,
    uid,
    username,
    name: String(claims.displayName ?? username),
    schoolId: String(claims.schoolId ?? ""),
    schoolName: existing?.data.schoolName ?? "",
    totalScore,
    solvedCount,
    submitCount: (existing?.data.submitCount ?? 0) + 1,
    bestByProblem,
    lastSubmittedAt: result.at,
    ...(completedAt ? { completedAt } : {}),
  };
  if (!entry.schoolName) {
    const account = await ctx.db.getDoc<{ schoolName?: string }>(`contestAccounts/${contestId}_${username}`);
    entry.schoolName = account?.data.schoolName ?? "";
  }
  await ctx.db.setDoc(path, { ...entry, updatedAt: SERVER_TIMESTAMP });
  return entry;
}

/** 儀表板快照：每 3 秒最多重算一次，避免同時大量提交時寫入爆量。 */
async function refreshDashboard(ctx: RequestContext, contestId: string, contest: ContestDoc) {
  const path = `contestDashboards/${contestId}`;
  const current = await ctx.db.getDoc<{ computedAtMs?: number }>(path);
  const nowMs = Date.now();
  if (current && typeof current.data.computedAtMs === "number" && nowMs - current.data.computedAtMs < DASHBOARD_THROTTLE_MS) {
    return;
  }
  const [entries, accountCount] = await Promise.all([
    ctx.db.query<LeaderboardEntryDoc>("contestLeaderboards", { where: [{ field: "contestId", op: "EQUAL", value: contestId }] }),
    ctx.db.count("contestAccounts", [{ field: "contestId", op: "EQUAL", value: contestId }]),
  ]);
  const rows = entries.map((doc) => doc.data);
  rows.sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      b.solvedCount - a.solvedCount ||
      (a.completedAt ?? "9").localeCompare(b.completedAt ?? "9") ||
      a.submitCount - b.submitCount,
  );

  const problemStats: Record<string, { solved: number; attempted: number }> = {};
  const schoolStats: Record<string, { schoolName: string; participants: number; solved: number; totalScore: number }> = {};
  for (const row of rows) {
    for (const [problemId, best] of Object.entries(row.bestByProblem)) {
      const stat = (problemStats[problemId] ??= { solved: 0, attempted: 0 });
      if (best.maxScore > 0 && best.score >= best.maxScore) stat.solved += 1;
      else stat.attempted += 1;
    }
    const school = (schoolStats[row.schoolId || row.schoolName || "-"] ??= {
      schoolName: row.schoolName || "未設定",
      participants: 0,
      solved: 0,
      totalScore: 0,
    });
    school.participants += 1;
    school.solved += row.solvedCount;
    school.totalScore += row.totalScore;
  }

  await ctx.db.setDoc(path, {
    contestId,
    title: contest.title,
    accountCount,
    submittedCount: rows.length,
    submissionCount: rows.reduce((sum, row) => sum + row.submitCount, 0),
    averageScore: rows.length ? rows.reduce((sum, row) => sum + row.totalScore, 0) / rows.length : 0,
    ranking: rows.slice(0, 100).map((row, index) => ({
      rank: index + 1,
      username: row.username,
      name: row.name,
      schoolName: row.schoolName,
      totalScore: row.totalScore,
      solvedCount: row.solvedCount,
      submitCount: row.submitCount,
      lastSubmittedAt: row.lastSubmittedAt,
    })),
    problemStats,
    schoolStats,
    computedAtMs: nowMs,
    updatedAt: SERVER_TIMESTAMP,
  });
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
