import type { CaseResult, GradeResult, Problem, ProblemCase } from "../types";

interface WorkerResponse {
  output: string;
  error?: string;
}

export async function runCustomTest(code: string, input: string) {
  return runWorker(code, input, 2500);
}

export async function gradeProblem(problem: Problem, code: string): Promise<GradeResult> {
  const started = performance.now();
  const cases = problem.cases;
  const results: CaseResult[] = [];

  for (const testCase of cases) {
    const result = await gradeCase(code, testCase);
    results.push(result);
  }

  const maxScore = cases.reduce((sum, testCase) => sum + testCase.score, 0);
  const score = results.reduce((sum, item) => sum + item.earnedScore, 0);
  const passedCases = results.filter((item) => item.passed).length;
  const status =
    cases.length === 0
      ? "accepted"
      : passedCases === cases.length
        ? "accepted"
        : passedCases > 0
          ? "partial"
          : "failed";

  return {
    score,
    maxScore,
    passedCases,
    totalCases: cases.length,
    passRate: cases.length ? passedCases / cases.length : 1,
    status,
    elapsedMs: Math.round(performance.now() - started),
    cases: results,
    createdAt: new Date().toISOString(),
  };
}

async function gradeCase(code: string, testCase: ProblemCase): Promise<CaseResult> {
  try {
    const response = await runWorker(code, testCase.input, 3000);
    const passed = normalizeOutput(response.output) === normalizeOutput(testCase.output);
    const result: CaseResult = {
      caseTitle: testCase.caseTitle,
      groupTitle: testCase.groupTitle,
      visibility: testCase.visibility,
      input: testCase.input,
      expected: testCase.output,
      actual: response.output,
      score: testCase.score,
      earnedScore: passed ? testCase.score : 0,
      passed,
    };
    if (response.error) {
      result.error = response.error;
    }
    return result;
  } catch (error) {
    return {
      caseTitle: testCase.caseTitle,
      groupTitle: testCase.groupTitle,
      visibility: testCase.visibility,
      input: testCase.input,
      expected: testCase.output,
      actual: "",
      score: testCase.score,
      earnedScore: 0,
      passed: false,
      error: error instanceof Error ? error.message : "執行失敗",
    };
  }
}

function runWorker(code: string, input: string, timeoutMs: number): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/gradingWorker.ts", import.meta.url), {
      type: "module",
    });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("執行超時，可能發生無限迴圈。"));
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      window.clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    };

    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error("程式執行發生錯誤。"));
    };

    worker.postMessage({
      code,
      inputs: splitInputs(input),
      maxOutputLength: 1000,
    });
  });
}

function splitInputs(input: string) {
  return input
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOutput(output: string) {
  return output
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}
