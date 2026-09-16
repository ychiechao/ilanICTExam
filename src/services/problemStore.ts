import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { sampleProblems } from "../data/sampleProblems";
import type { Problem } from "../types";
import { compareProblems, getProblemImportSource, normalizeProblem } from "../../shared/problemImport";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";
import { getProblemSubmissionCount } from "./submissionService";

const LOCAL_PROBLEMS_KEY = "yilan-contest-problems";

export type ProblemImportMode = "append" | "overwrite";

export interface ProblemImportResult {
  imported: Problem[];
  skipped: Problem[];
  mode: ProblemImportMode;
}

export async function loadProblems(): Promise<Problem[]> {
  if (db) {
    try {
      const snapshot = await withRemoteTimeout(
        getDocs(collection(db, "problems")),
        "Firestore 題庫讀取",
      );
      const remoteProblems = snapshot.docs
        .map((item) => item.data() as Problem)
        .filter((problem) => problem.status === "published")
        .sort(compareProblems);

      if (remoteProblems.length > 0) {
        return remoteProblems;
      }
    } catch {
      console.info("Firestore 題庫暫時無法讀取，已改用本機題庫。");
    }
  }

  return readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems)
    .filter((problem) => problem.status === "published")
    .sort(compareProblems);
}

export async function loadAllProblemsForAdmin(): Promise<Problem[]> {
  if (db) {
    try {
      const snapshot = await withRemoteTimeout(
        getDocs(collection(db, "problems")),
        "Firestore 題目管理讀取",
      );
      const remoteProblems = snapshot.docs
        .map((item) => item.data() as Problem)
        .sort(compareProblems);

      if (remoteProblems.length > 0) {
        return remoteProblems;
      }
    } catch {
      console.info("Firestore 題目管理讀取失敗，改用本機題庫。");
    }
  }

  return readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems).sort(compareProblems);
}

export async function importProblemsFromJson(
  rawJson: string,
  mode: ProblemImportMode = "overwrite",
): Promise<ProblemImportResult> {
  const parsed = JSON.parse(rawJson) as unknown;
  const source = getProblemImportSource(parsed);
  const problems = source.items.map((item) => normalizeProblem(item, source.year));
  return importProblems(problems, mode);
}

export async function importProblemsFromCsv(
  rawCsv: string,
  mode: ProblemImportMode = "overwrite",
): Promise<ProblemImportResult> {
  const rows = parseCsv(rawCsv).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 2) {
    throw new Error("CSV 至少需要標題列與一筆題目資料。");
  }

  const headers = rows[0].map((header, index) => (index === 0 ? stripBom(header) : header).trim());
  const problems = rows.slice(1).map((row) => normalizeProblem(csvRowToProblem(headers, row)));
  return importProblems(problems, mode);
}

export function exportProblemsToCsv(problems: Problem[]) {
  const headers = [
    "id",
    "year",
    "category",
    "title",
    "difficulty",
    "description",
    "inputFormat",
    "outputFormat",
    "examplesJson",
    "casesJson",
    "status",
  ];

  const csv = [
    encodeCsvRow(headers),
    ...problems.map((problem) =>
      encodeCsvRow([
        problem.id,
        problem.year || "",
        problem.category,
        problem.title,
        problem.difficulty,
        problem.description,
        problem.inputFormat,
        problem.outputFormat,
        JSON.stringify(problem.examples),
        JSON.stringify(problem.cases),
        problem.status,
      ]),
    ),
  ].join("\r\n");

  return `\uFEFF${csv}`;
}

export function getProblemCsvTemplate() {
  return exportProblemsToCsv([
    {
      id: "sample-sum",
      year: "114",
      title: "兩數相加",
      description: "請讀入兩個整數，輸出兩數總和。",
      inputFormat: "一行包含兩個整數 a b。",
      outputFormat: "輸出 a+b 的結果。",
      difficulty: "easy",
      category: "範例",
      status: "published",
      examples: [{ title: "範例 1", input: "3 5", output: "8" }],
      cases: [
        {
          groupTitle: "公開測資",
          caseTitle: "C1",
          input: "3 5",
          output: "8",
          score: 10,
          visibility: "public",
        },
        {
          groupTitle: "公開測資",
          caseTitle: "C2",
          input: "10 11",
          output: "21",
          score: 10,
          visibility: "public",
        },
      ],
    },
  ]);
}

async function importProblems(
  problems: Problem[],
  mode: ProblemImportMode,
): Promise<ProblemImportResult> {
  if (problems.length === 0) {
    return { imported: [], skipped: [], mode };
  }

  const existingIds = mode === "append" ? await loadAllProblemIds() : new Set<string>();
  const incomingIds = new Set<string>();
  const imported: Problem[] = [];
  const skipped: Problem[] = [];

  for (const problem of problems) {
    if (mode === "append" && (existingIds.has(problem.id) || incomingIds.has(problem.id))) {
      skipped.push(problem);
      continue;
    }

    incomingIds.add(problem.id);
    imported.push(problem);
  }

  if (imported.length > 0) {
    await saveProblems(imported);
  }

  return { imported, skipped, mode };
}

async function loadAllProblemIds() {
  if (db) {
    const snapshot = await withRemoteTimeout(
      getDocs(collection(db, "problems")),
      "Firestore 題庫 ID 讀取",
    );
    return new Set(snapshot.docs.map((item) => item.id));
  }

  return new Set(readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems).map((problem) => problem.id));
}

async function saveProblems(problems: Problem[]) {
  if (db) {
    for (let index = 0; index < problems.length; index += 450) {
      const batch = writeBatch(db);
      for (const problem of problems.slice(index, index + 450)) {
        batch.set(doc(collection(db, "problems"), problem.id), problem);
      }
      await withRemoteTimeout(batch.commit(), "Firestore 題目匯入");
    }
  } else {
    const current = readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems);
    const merged = [...current.filter((item) => !problems.some((p) => p.id === item.id)), ...problems];
    writeJson(LOCAL_PROBLEMS_KEY, merged.sort(compareProblems));
  }
}

export async function saveProblem(problem: Problem) {
  if (db) {
    await withRemoteTimeout(setDoc(doc(db, "problems", problem.id), problem), "Firestore 題目儲存");
    return;
  }

  const current = readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems);
  const exists = current.some((item) => item.id === problem.id);
  writeJson(
    LOCAL_PROBLEMS_KEY,
    (exists
      ? current.map((item) => (item.id === problem.id ? problem : item))
      : [...current, problem]
    ).sort(compareProblems),
  );
}

export async function deleteProblemIfUnused(problemId: string) {
  const submissionCount = await getProblemSubmissionCount(problemId);
  if (submissionCount > 0) {
    throw new Error("已有解題紀錄，不能刪除，請改為草稿或封存。");
  }

  if (db) {
    await withRemoteTimeout(deleteDoc(doc(db, "problems", problemId)), "Firestore 題目刪除");
    return { deleted: true, submissionCount };
  }

  const current = readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems);
  writeJson(
    LOCAL_PROBLEMS_KEY,
    current.filter((item) => item.id !== problemId).sort(compareProblems),
  );
  return { deleted: true, submissionCount };
}

function csvRowToProblem(headers: string[], row: string[]) {
  const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
  return {
    id: record.id || undefined,
    year: record.year || undefined,
    category: record.category || undefined,
    title: record.title,
    difficulty: record.difficulty,
    description: record.description,
    inputFormat: record.inputFormat,
    outputFormat: record.outputFormat,
    examples: parseJsonCell(record.examplesJson, []),
    cases: parseJsonCell(record.casesJson, []),
    status: record.status || "published",
  };
}

function parseJsonCell(value: string, fallback: unknown) {
  if (!value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`CSV 欄位包含無法解析的 JSON：${value.slice(0, 32)}...`);
  }
}

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function encodeCsvRow(values: string[]) {
  return values
    .map((value) => {
      const normalized = value ?? "";
      return /[",\r\n]/.test(normalized)
        ? `"${normalized.replace(/"/g, "\"\"")}"`
        : normalized;
    })
    .join(",");
}

