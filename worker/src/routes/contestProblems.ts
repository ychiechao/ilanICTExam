/**
 * 競賽題庫（規格 8.6）
 *
 * POST /contest-problems/{contestId}   匯入整份題庫（取代該場既有題目）
 *
 * 題目拆成兩部分：
 *   - 公開部分（題號、標題、說明、範例、測資筆數、滿分）→ Firestore contestProblems
 *   - 完整測資（含隱藏）→ KV cases:{contestId}:{problemId}
 * Firestore 裡從頭到尾沒有隱藏測資的輸入與答案。
 */
import { getProblemImportSource, normalizeProblem, type Problem } from "../../../shared/problemImport";
import { HttpError, readJsonBody, type RequestContext } from "../context";
import { SERVER_TIMESTAMP } from "../google/firestore";
import { json } from "../index";

interface ImportBody {
  /** 題庫檔案解析後的物件（與練習題庫匯入相同格式）。 */
  json?: unknown;
}

export interface ContestProblemPublic {
  contestId: string;
  problemId: string;
  order: number;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  difficulty: string;
  category: string;
  examples: Problem["examples"];
  caseCount: number;
  publicCaseCount: number;
  maxScore: number;
}

export function contestProblemDocId(contestId: string, problemId: string) {
  return `${contestId}_${problemId}`;
}

export function casesKey(contestId: string, problemId: string) {
  return `cases:${contestId}:${problemId}`;
}

export async function handleImportContestProblems(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const body = await readJsonBody<ImportBody>(request);
  if (body.json === undefined || body.json === null) {
    throw new HttpError(400, "bad_request", "缺少題庫內容");
  }

  const contest = await ctx.getContest(contestId);
  if (!contest) {
    throw new HttpError(404, "contest_not_found", "找不到賽事");
  }
  if (contest.data.status === "active" || contest.data.status === "paused") {
    throw new HttpError(409, "contest_running", "賽事進行中，不能更換題庫");
  }

  let problems: Problem[];
  try {
    const source = getProblemImportSource(body.json);
    problems = source.items.map((item) => normalizeProblem(item, source.year));
  } catch (error) {
    throw new HttpError(400, "invalid_problems", error instanceof Error ? error.message : "題庫格式錯誤");
  }
  if (problems.length === 0) {
    throw new HttpError(400, "empty", "題庫裡沒有題目");
  }

  // 同一場的舊題目全部清掉再寫入，避免殘留。
  const existing = await ctx.db.query<{ problemId: string }>("contestProblems", {
    where: [{ field: "contestId", op: "EQUAL", value: contestId }],
  });
  if (existing.length > 0) {
    await ctx.db.batchDelete(existing.map((doc) => `contestProblems/${doc.id}`));
    await Promise.all(existing.map((doc) => ctx.env.CONTEST_CASES.delete(casesKey(contestId, doc.data.problemId))));
  }

  const warnings: string[] = [];
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const kvWrites: Array<Promise<void>> = [];
  problems.forEach((problem, index) => {
    if (problem.cases.length === 0) {
      warnings.push(`「${problem.title}」沒有評分測資，參賽者提交會得 0 分`);
    }
    const publicDoc: ContestProblemPublic = {
      contestId,
      problemId: problem.id,
      order: index + 1,
      title: problem.title,
      description: problem.description,
      inputFormat: problem.inputFormat,
      outputFormat: problem.outputFormat,
      difficulty: problem.difficulty,
      category: problem.category,
      examples: problem.examples,
      caseCount: problem.cases.length,
      publicCaseCount: problem.cases.filter((item) => item.visibility === "public").length,
      maxScore: problem.cases.reduce((sum, item) => sum + item.score, 0),
    };
    writes.push({
      path: `contestProblems/${contestProblemDocId(contestId, problem.id)}`,
      data: { ...publicDoc, importedAt: SERVER_TIMESTAMP, importedBy: actor.uid },
    });
    kvWrites.push(ctx.env.CONTEST_CASES.put(casesKey(contestId, problem.id), JSON.stringify(problem.cases)));
  });

  await Promise.all(kvWrites);
  await ctx.db.batchSet(writes);
  await ctx.db.setDoc(
    `contests/${contestId}`,
    { problemCount: problems.length, casesSyncedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { merge: true },
  );
  await ctx.writeAuditLog(actor, {
    action: "contest.problems.import",
    targetType: "contest",
    targetId: contestId,
    summary: `匯入 ${problems.length} 題競賽題庫${existing.length > 0 ? `（取代原有 ${existing.length} 題）` : ""}${warnings.length > 0 ? `，${warnings.length} 題缺測資` : ""}`,
  });

  return json({
    ok: true,
    problemCount: problems.length,
    replaced: existing.length,
    warnings,
    problems: problems.map((problem, index) => ({
      order: index + 1,
      problemId: problem.id,
      title: problem.title,
      caseCount: problem.cases.length,
      maxScore: problem.cases.reduce((sum, item) => sum + item.score, 0),
    })),
  });
}
