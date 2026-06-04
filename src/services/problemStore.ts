import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { sampleProblems } from "../data/sampleProblems";
import type { Problem } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

const LOCAL_PROBLEMS_KEY = "yilan-contest-problems";

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
        .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));

      if (remoteProblems.length > 0) {
        return remoteProblems;
      }
    } catch (error) {
      console.warn("Firestore 題庫讀取失敗，改用本機題庫。", error);
    }
  }

  return readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems);
}

export async function importProblemsFromJson(rawJson: string): Promise<Problem[]> {
  const parsed = JSON.parse(rawJson) as unknown;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const problems = list.map(normalizeProblem);

  if (db) {
    const batch = writeBatch(db);
    for (const problem of problems) {
      batch.set(doc(collection(db, "problems"), problem.id), problem);
    }
    await withRemoteTimeout(batch.commit(), "Firestore 題目匯入");
  } else {
    const current = readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems);
    const merged = [...current.filter((item) => !problems.some((p) => p.id === item.id)), ...problems];
    writeJson(LOCAL_PROBLEMS_KEY, merged);
  }

  return problems;
}

export async function saveProblem(problem: Problem) {
  if (db) {
    await withRemoteTimeout(setDoc(doc(db, "problems", problem.id), problem), "Firestore 題目儲存");
    return;
  }

  const current = readJson<Problem[]>(LOCAL_PROBLEMS_KEY, sampleProblems);
  writeJson(
    LOCAL_PROBLEMS_KEY,
    current.map((item) => (item.id === problem.id ? problem : item)),
  );
}

function normalizeProblem(value: unknown): Problem {
  if (!value || typeof value !== "object") {
    throw new Error("題目 JSON 必須是物件或物件陣列。");
  }

  const input = value as Partial<Problem>;
  if (!input.title || !input.description) {
    throw new Error("題目缺少 title 或 description。");
  }

  const id = input.id || slugify(input.title);
  const cases = Array.isArray(input.cases) ? input.cases : [];
  const examples = Array.isArray(input.examples) ? input.examples : [];

  const problem: Problem = {
    id,
    title: input.title,
    description: input.description,
    inputFormat: input.inputFormat || "請依題目說明輸入資料。",
    outputFormat: input.outputFormat || "請依題目說明輸出答案。",
    difficulty: input.difficulty || "easy",
    category: input.category || "未分類",
    status: input.status || "published",
    examples,
    cases: cases.map((item, index) => ({
      groupTitle: item.groupTitle || "測資",
      caseTitle: item.caseTitle || `C${index + 1}`,
      input: item.input || "",
      output: item.output || "",
      score: Number(item.score || 0),
      visibility: item.visibility === "hidden" ? "hidden" : "public",
    })),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (input.toolboxConfig !== undefined) {
    problem.toolboxConfig = input.toolboxConfig;
  }

  return problem;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `problem-${Date.now()}`;
}
