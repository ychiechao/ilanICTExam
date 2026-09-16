/**
 * 評分共用邏輯：輸入切分、輸出正規化、逐筆測資計分。
 * 前端（練習模式 Web Worker）與 Worker（競賽模式 JS-Interpreter）共用；執行器由呼叫端提供。
 */
export interface GradeCase {
  groupTitle: string;
  caseTitle: string;
  input: string;
  output: string;
  score: number;
  visibility: "public" | "hidden";
}

export interface RunResult {
  output: string;
  error?: string;
}

export interface CaseOutcome {
  caseTitle: string;
  groupTitle: string;
  visibility: "public" | "hidden";
  input: string;
  expected: string;
  actual: string;
  score: number;
  earnedScore: number;
  passed: boolean;
  error?: string;
}

/** 輸入以空白或逗號切成一筆一筆，每次 prompt 取一筆。 */
export function splitInputs(input: string) {
  return input
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 比對時忽略前後空白與多餘空白。 */
export function normalizeOutput(output: string) {
  return output
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function scoreCase(testCase: GradeCase, run: RunResult): CaseOutcome {
  const passed = !run.error && normalizeOutput(run.output) === normalizeOutput(testCase.output);
  return {
    caseTitle: testCase.caseTitle,
    groupTitle: testCase.groupTitle,
    visibility: testCase.visibility,
    input: testCase.input,
    expected: testCase.output,
    actual: run.output,
    score: testCase.score,
    earnedScore: passed ? testCase.score : 0,
    passed,
    ...(run.error ? { error: run.error } : {}),
  };
}

export function summarizeOutcomes(cases: GradeCase[], outcomes: CaseOutcome[]) {
  const maxScore = cases.reduce((sum, item) => sum + item.score, 0);
  const score = outcomes.reduce((sum, item) => sum + item.earnedScore, 0);
  const passedCases = outcomes.filter((item) => item.passed).length;
  const status: "accepted" | "partial" | "failed" =
    cases.length > 0 && passedCases === cases.length ? "accepted" : passedCases > 0 ? "partial" : "failed";
  return {
    score,
    maxScore,
    passedCases,
    totalCases: cases.length,
    passRate: cases.length ? passedCases / cases.length : 0,
    status,
  };
}
