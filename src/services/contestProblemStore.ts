import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { ExampleCase } from "../types";
import { graderRequest } from "./grader";
import { withRemoteTimeout } from "./remote";

/** contestProblems 的公開部分；測資只在 Worker 的 KV。 */
export interface ContestProblem {
  id: string;
  contestId: string;
  problemId: string;
  order: number;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  difficulty: string;
  category: string;
  examples: ExampleCase[];
  caseCount: number;
  publicCaseCount: number;
  maxScore: number;
  importedAt?: string;
}

export interface ContestProblemImportResult {
  problemCount: number;
  replaced: number;
  warnings: string[];
  problems: Array<{ order: number; problemId: string; title: string; caseCount: number; maxScore: number }>;
}

export async function loadContestProblems(contestId: string): Promise<ContestProblem[]> {
  if (!db || !contestId) {
    return [];
  }
  const snapshot = await withRemoteTimeout(
    getDocs(query(collection(db, "contestProblems"), where("contestId", "==", contestId))),
    "Firestore 競賽題庫讀取",
  );
  return snapshot.docs
    .map((item) => normalize(item.id, item.data()))
    .sort((a, b) => a.order - b.order);
}

/** 匯入由 Worker 執行：公開部分進 Firestore、測資進 KV。整份取代該場既有題庫。 */
export function importContestProblems(contestId: string, parsedJson: unknown) {
  return graderRequest<ContestProblemImportResult>(`/contest-problems/${encodeURIComponent(contestId)}`, {
    body: { json: parsedJson },
    timeoutMs: 180000,
  });
}

function normalize(id: string, data: Record<string, unknown>): ContestProblem {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  const importedAt = data.importedAt as { toDate?: () => Date } | string | undefined;
  return {
    id,
    contestId: text(data.contestId),
    problemId: text(data.problemId),
    order: num(data.order),
    title: text(data.title),
    description: text(data.description),
    inputFormat: text(data.inputFormat),
    outputFormat: text(data.outputFormat),
    difficulty: text(data.difficulty) || "easy",
    category: text(data.category),
    examples: Array.isArray(data.examples) ? (data.examples as ExampleCase[]) : [],
    caseCount: num(data.caseCount),
    publicCaseCount: num(data.publicCaseCount),
    maxScore: num(data.maxScore),
    importedAt:
      typeof importedAt === "string"
        ? importedAt
        : importedAt && typeof importedAt.toDate === "function"
          ? importedAt.toDate().toISOString()
          : undefined,
  };
}
