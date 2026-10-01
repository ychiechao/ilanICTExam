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

/**
 * 評分比對：
 * - 仍以空白切成一格一格，格數必須一致。
 * - 文字格維持完全比對。
 * - 若兩格都是一般十進位數字，忽略不影響數值的前導 0 與小數尾端 0。
 *
 * 例如：1.90 = 1.9 = 1.900，但 1.9045 不等於 1.90。
 */
export function outputMatches(actual: string, expected: string) {
  const actualTokens = getOutputTokens(actual);
  const expectedTokens = getOutputTokens(expected);
  if (actualTokens.length !== expectedTokens.length) return false;
  return expectedTokens.every((expectedToken, index) => outputTokenMatches(actualTokens[index], expectedToken));
}

function getOutputTokens(output: string) {
  return output
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function outputTokenMatches(actual: string, expected: string) {
  if (actual === expected) return true;

  const actualNumber = normalizeDecimalToken(actual);
  const expectedNumber = normalizeDecimalToken(expected);
  return actualNumber !== null && expectedNumber !== null && actualNumber === expectedNumber;
}

function normalizeDecimalToken(token: string) {
  const value = token.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;

  const sign = value.startsWith("-") ? "-" : "";
  const unsigned = value.replace(/^[+-]/, "");
  const [rawInteger, rawFraction = ""] = unsigned.split(".");
  const integer = (rawInteger || "0").replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  const normalized = fraction ? `${integer}.${fraction}` : integer;
  return normalized === "0" ? "0" : `${sign}${normalized}`;
}

export function scoreCase(testCase: GradeCase, run: RunResult): CaseOutcome {
  const passed = !run.error && outputMatches(run.output, testCase.output);
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
