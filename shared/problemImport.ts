/**
 * 題目匯入的純轉換邏輯：bDesigner JSON / 一般 JSON → 平台題目結構。
 * 前端（練習題庫匯入）與 Worker（競賽題庫匯入）共用，不可依賴瀏覽器或 Firebase。
 */
export type ProblemVisibility = "public" | "hidden";
export type ProblemStatus = "published" | "draft" | "archived";

export interface ExampleCase {
  title: string;
  input: string;
  output: string;
  description?: string;
}

export interface ProblemCase {
  groupTitle: string;
  caseTitle: string;
  input: string;
  output: string;
  score: number;
  visibility: ProblemVisibility;
}

export interface Problem {
  id: string;
  year?: string;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  categories?: string[];
  status: ProblemStatus;
  examples: ExampleCase[];
  cases: ProblemCase[];
  source?: string;
  sourceId?: string;
  sourceUrls?: Record<string, string>;
  imageSources?: string[];
  toolboxConfig?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export function getProblemImportSource(parsed: unknown): { items: unknown[]; year?: string } {
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


export function normalizeProblem(value: unknown, bundleYear = ""): Problem {
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

export function normalizeExamples(value: unknown): ExampleCase[] {
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

export function normalizeCases(value: unknown, groupTitle = "測資", defaultVisibility: ProblemCase["visibility"] = "public"): ProblemCase[] {
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

export function readText(value: unknown, fallback = "") {
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

export function readStatus(value: unknown): ProblemStatus {
  return value === "draft" || value === "archived" ? value : "published";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function compareProblems(a: Problem, b: Problem) {
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
