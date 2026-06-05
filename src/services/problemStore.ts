import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { sampleProblems } from "../data/sampleProblems";
import type { ExampleCase, Problem, ProblemCase, ProblemStatus } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

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

  return readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems);
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

function getProblemImportSource(parsed: unknown): { items: unknown[]; year?: string } {
  if (Array.isArray(parsed)) {
    return { items: parsed };
  }

  if (isRecord(parsed) && Array.isArray(parsed.problems)) {
    return {
      items: parsed.problems,
      year: readText(parsed.year),
    };
  }

  return { items: [parsed] };
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

function normalizeProblem(value: unknown, bundleYear = ""): Problem {
  if (!value || typeof value !== "object") {
    throw new Error("題目 JSON 必須是物件或物件陣列。");
  }

  if (isBDesignerProblem(value)) {
    return normalizeBDesignerProblem(value, bundleYear);
  }

  const input = value as Partial<Problem>;
  if (!input.title || !input.description) {
    throw new Error("題目缺少 title 或 description。");
  }

  const id = input.id || slugify(input.title);
  const categories = normalizeStringArray(input.categories);

  const problem: Problem = {
    id,
    ...(input.year ? { year: input.year } : {}),
    title: input.title,
    description: input.description,
    inputFormat: input.inputFormat || "請依題目說明輸入資料。",
    outputFormat: input.outputFormat || "請依題目說明輸出答案。",
    difficulty: readDifficulty(input.difficulty),
    category: input.category || categories[0] || "未分類",
    ...(categories.length > 0 ? { categories } : {}),
    status: readStatus(input.status),
    examples: normalizeExamples(input.examples),
    cases: normalizeImportedCases(input, "測資", normalizeExamples(input.examples)),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (input.source) {
    problem.source = input.source;
  }
  if (input.sourceId) {
    problem.sourceId = input.sourceId;
  }
  if (input.sourceUrls && Object.keys(input.sourceUrls).length > 0) {
    problem.sourceUrls = input.sourceUrls;
  }
  if (input.imageSources && input.imageSources.length > 0) {
    problem.imageSources = input.imageSources;
  }
  if (input.toolboxConfig !== undefined) {
    problem.toolboxConfig = input.toolboxConfig;
  }

  return problem;
}

function normalizeBDesignerProblem(value: Record<string, unknown>, bundleYear = ""): Problem {
  const title = readText(value.title, `題目 ${readText(value.id) || Date.now()}`);
  const year = readText(value.year, bundleYear);
  const categories = normalizeStringArray(value.categories);
  const sections = isRecord(value.sections) ? value.sections : {};
  const description = joinUniqueText([
    readText(value.problem_description, readText(sections["問題描述"])),
    readText(value.problem_statement, readText(sections["題目說明"])),
  ]);
  const statement = readText(value.problem_statement, description);
  const sourceId = readText(value.id, slugify(title));
  const sourceUrls = normalizeStringRecord(value.urls);
  const imageSources = normalizeStringArray(value.image_sources);

  const problem: Problem = {
    id: `bdesigner-${year || "unknown"}-${sourceId}`,
    year,
    title,
    description: description || title,
    inputFormat:
      readText(sections["輸入格式"]) ||
      extractLabeledSection(statement, "輸入格式", ["輸出格式", "範例"]) ||
      "請依題目說明輸入資料。",
    outputFormat:
      readText(sections["輸出格式"]) ||
      extractLabeledSection(statement, "輸出格式", ["範例", "說明"]) ||
      "請依題目說明輸出答案。",
    difficulty: "easy",
    category: categories[0] || "未分類",
    ...(categories.length > 0 ? { categories } : {}),
    status: "published",
    examples: normalizeExamples(value.examples),
    cases: normalizeImportedCases(value, "測資", normalizeExamples(value.examples)),
    source: "bDesigner",
    sourceId,
    ...(Object.keys(sourceUrls).length > 0 ? { sourceUrls } : {}),
    ...(imageSources.length > 0 ? { imageSources } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return problem;
}

function isBDesignerProblem(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    ("test_cases" in value || "problem_statement" in value || "problem_description" in value)
  );
}

function normalizeExamples(value: unknown): ExampleCase[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const example: ExampleCase = {
      title: readText(record.title, `範例 ${index + 1}`),
      input: readText(record.input),
      output: readText(record.output, readText(record.expected)),
    };
    const description = readText(record.description, readText(record.explanation));
    if (description) {
      example.description = description;
    }
    return example;
  });
}

function normalizeCases(value: unknown, groupTitle = "測資", defaultVisibility: ProblemCase["visibility"] = "public"): ProblemCase[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const score = Number(record.score);
    const caseTitle = readText(record.caseTitle, `C${readText(record.case, String(index + 1))}`);
    return {
      groupTitle: readText(record.groupTitle, groupTitle),
      caseTitle,
      input: readText(record.input, readText(record.input_text, readPrompts(record.prompts))),
      output: readText(record.output, readText(record.expected)),
      score: Number.isFinite(score) ? score : 10,
      visibility: readVisibility(record.visibility, defaultVisibility),
    };
  });
}

function normalizeImportedCases(value: unknown, groupTitle = "測資", examples: ExampleCase[] = []): ProblemCase[] {
  const record = isRecord(value) ? value : {};
  const explicitCases = normalizeCases(record.cases, groupTitle, "hidden");
  const aliasedCases = [
    ...normalizeCases(record.test_cases, groupTitle, "hidden"),
    ...normalizeCases(record.testCases, groupTitle, "hidden"),
    ...normalizeCases(record.testcases, groupTitle, "hidden"),
  ];

  const [primary, secondary] =
    explicitCases.length >= aliasedCases.length
      ? [explicitCases, aliasedCases]
      : [aliasedCases, explicitCases];
  const output: ProblemCase[] = [];
  const seen = new Set<string>();

  for (const testCase of [...primary, ...secondary]) {
    const key = [
      testCase.caseTitle,
      normalizeComparableText(testCase.input),
      normalizeComparableText(testCase.output),
    ].join("\u0000");
    if (!seen.has(key)) {
      seen.add(key);
      output.push(markExampleCasePublic(testCase, examples));
    }
  }

  return output;
}

function markExampleCasePublic(testCase: ProblemCase, examples: ExampleCase[]): ProblemCase {
  const matchesExample = examples.some(
    (example) =>
      normalizeComparableText(example.input) === normalizeComparableText(testCase.input) &&
      normalizeComparableText(example.output) === normalizeComparableText(testCase.output),
  );
  return matchesExample ? { ...testCase, visibility: "public" } : testCase;
}

function readVisibility(value: unknown, fallback: ProblemCase["visibility"]): ProblemCase["visibility"] {
  return value === "public" || value === "hidden" ? value : fallback;
}

function normalizeComparableText(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function readPrompts(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value.map((item) => readText(item)).filter(Boolean).join("\n");
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => readText(item)).filter(Boolean);
}

function normalizeStringRecord(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, readText(item)] as const)
      .filter(([, item]) => item),
  );
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return fallback;
}

function readDifficulty(value: unknown): Problem["difficulty"] {
  return value === "medium" || value === "hard" ? value : "easy";
}

function readStatus(value: unknown): ProblemStatus {
  return value === "draft" || value === "archived" ? value : "published";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function joinUniqueText(items: string[]) {
  const output: string[] = [];
  for (const item of items.map((part) => part.trim()).filter(Boolean)) {
    if (!output.includes(item)) {
      output.push(item);
    }
  }
  return output.join("\n\n");
}

function extractLabeledSection(text: string, label: string, nextLabels: string[]) {
  const startIndex = text.indexOf(label);
  if (startIndex < 0) {
    return "";
  }

  const start = startIndex + label.length;
  const rest = text.slice(start).replace(/^[:：\s]+/, "");
  const nextIndex = nextLabels
    .map((nextLabel) => rest.indexOf(nextLabel))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  return (nextIndex === undefined ? rest : rest.slice(0, nextIndex)).trim();
}

function compareProblems(a: Problem, b: Problem) {
  const yearCompare = (b.year || "").localeCompare(a.year || "", "zh-Hant", { numeric: true });
  if (yearCompare !== 0) {
    return yearCompare;
  }

  const categoryCompare = a.category.localeCompare(b.category, "zh-Hant", { numeric: true });
  if (categoryCompare !== 0) {
    return categoryCompare;
  }

  return a.title.localeCompare(b.title, "zh-Hant", { numeric: true });
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `problem-${Date.now()}`;
}
