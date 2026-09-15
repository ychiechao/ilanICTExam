import type { PracticeStats, PracticeStatus } from "../app/constants";
import type { ProblemImportResult } from "../services/problemStore";
import type { Problem, SubmissionRecord, WorkspaceMode } from "../types";

export function getDefaultTestInput(problem: Problem | undefined) {
  return problem?.examples[0]?.input || problem?.cases.find((item) => item.visibility === "public")?.input || "";
}

export async function runInteractiveProgram(
  code: string,
  askInput: (message: string) => string,
): Promise<{ output: string; error?: string }> {
  const output: string[] = [];
  const maxOutputLength = 2000;
  const alertOutput = (value: unknown) => {
    const text = String(value);
    output.push(text);
    window.alert(text);
  };
  const consoleProxy = {
    log: (...values: unknown[]) => output.push(values.map(String).join(" ")),
  };
  const promptSync = (message = "") => askInput(String(message || "請輸入資料"));
  const windowProxy = {
    alert: alertOutput,
    prompt: promptSync,
  };

  try {
    const runner = new Function("window", "prompt", "alert", "console", code);
    runner(windowProxy, promptSync, alertOutput, consoleProxy);
    const joined = output.join(" ").trim();
    return {
      output:
        joined.length > maxOutputLength
          ? `${joined.slice(0, maxOutputLength)}...(輸出過長，已截斷)`
          : joined,
    };
  } catch (error) {
    return {
      output: output.join(" ").trim(),
      error: error instanceof Error ? error.message : "執行失敗",
    };
  }
}


export function getPracticeStatusLabel(status: PracticeStatus) {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "in-progress") {
    return "未完成";
  }
  return "未作答";
}

export function formatPracticeSubtitle(stats?: PracticeStats) {
  if (!stats || stats.status === "not-started") {
    return "尚未作答";
  }
  if (stats.submitCount === 0 && stats.hasDraft) {
    return "已保存作答草稿";
  }
  const scoreText = `最佳 ${stats.bestScore}/${stats.maxScore} 分`;
  const submitText = `${stats.submitCount} 次提交`;
  return stats.lastSubmittedAt
    ? `${scoreText}，${submitText}，${new Date(stats.lastSubmittedAt).toLocaleDateString("zh-TW")}`
    : `${scoreText}，${submitText}`;
}

export function buildPracticeStatsByProblem(
  problems: Problem[],
  records: SubmissionRecord[],
): Record<string, PracticeStats> {
  const recordsByProblem = new Map<string, SubmissionRecord[]>();
  for (const record of records) {
    const problemRecords = recordsByProblem.get(record.problemId) || [];
    problemRecords.push(record);
    recordsByProblem.set(record.problemId, problemRecords);
  }

  return Object.fromEntries(
    problems.map((problem) => {
      const problemRecords = (recordsByProblem.get(problem.id) || []).sort(compareSubmissionCreatedAt);
      const maxScore = getProblemMaxScore(problem);
      const bestRecord = problemRecords.reduce<SubmissionRecord | undefined>(
        (current, record) => getBetterSubmission(current, record),
        undefined,
      );
      const bestScore = bestRecord?.score || 0;
      const bestPassRate = bestRecord?.passRate || 0;
      const hasDraft = hasSavedWorkspace(problem.id);
      const status: PracticeStatus =
        bestRecord && isFullScoreSubmission(bestRecord)
          ? "completed"
          : problemRecords.length > 0 || hasDraft
            ? "in-progress"
            : "not-started";

      return [
        problem.id,
        {
          status,
          bestScore,
          maxScore,
          bestPassRate,
          submitCount: problemRecords.length,
          hasDraft,
          lastSubmittedAt: problemRecords[0]?.createdAt,
          lastMode: problemRecords[0]?.mode,
        },
      ];
    }),
  );
}

export function getBetterSubmission(current: SubmissionRecord | undefined, incoming: SubmissionRecord) {
  if (!current) {
    return incoming;
  }
  if (incoming.score !== current.score) {
    return incoming.score > current.score ? incoming : current;
  }
  if (incoming.passRate !== current.passRate) {
    return incoming.passRate > current.passRate ? incoming : current;
  }
  if (incoming.elapsedMs !== current.elapsedMs) {
    return incoming.elapsedMs < current.elapsedMs ? incoming : current;
  }
  return incoming.createdAt > current.createdAt ? incoming : current;
}

export function getProblemMaxScore(problem: Problem) {
  return problem.cases.reduce((sum, item) => sum + item.score, 0);
}

export function isFullScoreSubmission(record: SubmissionRecord) {
  return (
    record.maxScore > 0 &&
    record.status === "accepted" &&
    record.totalCases > 0 &&
    record.passedCases === record.totalCases &&
    record.score >= record.maxScore
  );
}

export function getProblemCaseSummary(problem: Problem) {
  const examples = problem.examples || [];
  const cases = problem.cases || [];
  const nonExampleCount = cases.filter(
    (testCase) =>
      !examples.some(
        (example) =>
          normalizeComparableText(example.input) === normalizeComparableText(testCase.input) &&
          normalizeComparableText(example.output) === normalizeComparableText(testCase.output),
      ),
  ).length;

  return {
    exampleCount: examples.length,
    caseCount: cases.length,
    hiddenCount: cases.filter((testCase) => testCase.visibility === "hidden").length,
    nonExampleCount,
  };
}

export function normalizeComparableText(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function mergeSubmissionRecord(current: SubmissionRecord[], record: SubmissionRecord) {
  return [record, ...current.filter((item) => item.id !== record.id)].sort(compareSubmissionCreatedAt);
}

export function compareSubmissionCreatedAt(a: SubmissionRecord, b: SubmissionRecord) {
  return b.createdAt.localeCompare(a.createdAt);
}

export function hasSavedWorkspace(problemId: string) {
  try {
    return [
      getSharedWorkspaceKey(problemId),
      getLegacyWorkspaceKey(problemId, "Scratch"),
      getLegacyWorkspaceKey(problemId, "Blockly"),
    ].some((key) => hasMeaningfulWorkspaceXml(localStorage.getItem(key)));
  } catch {
    return false;
  }
}

export function hasMeaningfulWorkspaceXml(xml: string | null) {
  return Boolean(xml && (xml.includes("<block") || xml.includes("<variables")));
}

export function ensureSolveStartedAt(problemId: string) {
  const key = getSolveStartKey(problemId);
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, new Date().toISOString());
  }
}

export function getSolveStartedAt(problemId: string) {
  return localStorage.getItem(getSolveStartKey(problemId)) || new Date().toISOString();
}

export function getSolveStartKey(problemId: string) {
  return `yilan-solve-started-at-${problemId}`;
}

export function getSharedWorkspaceKey(problemId: string) {
  return `yilan-workspace-${problemId}`;
}

export function getLegacyWorkspaceKey(problemId: string, mode: WorkspaceMode) {
  return `yilan-workspace-${problemId}-${mode}`;
}

export function slugFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "workspace";
}

export function formatImportStatus(source: string, result: ProblemImportResult) {
  const modeText = result.mode === "append" ? "新增" : "覆蓋";
  const skippedText = result.skipped.length > 0 ? `，跳過 ${result.skipped.length} 題重複 ID` : "";
  return `${source} ${modeText}匯入完成：${result.imported.length} 題${skippedText}。`;
}
