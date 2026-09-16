import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { School } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

const LOCAL_SCHOOLS_KEY = "yilan-contest-schools";

export async function loadSchools(): Promise<School[]> {
  if (db) {
    try {
      const snapshot = await withRemoteTimeout(
        getDocs(collection(db, "schools")),
        "Firestore 學校資料讀取",
      );
      return sortSchools(snapshot.docs.map((item) => normalizeSchool(item.data())));
    } catch {
      console.info("Firestore 學校資料讀取失敗，改用本機暫存。");
    }
  }

  return sortSchools(readJson<School[]>(LOCAL_SCHOOLS_KEY, []));
}

export async function loadSchoolsByIds(schoolIds: string[]): Promise<School[]> {
  const targetIds = Array.from(new Set(schoolIds.map((schoolId) => schoolId.trim()).filter(Boolean)));
  if (targetIds.length === 0) {
    return [];
  }

  const firestore = db;
  if (firestore) {
    const snapshots = await Promise.all(
      targetIds.map((schoolId) =>
        withRemoteTimeout(getDoc(doc(firestore, "schools", schoolId)), "Firestore 指派學校資料讀取"),
      ),
    );
    return sortSchools(
      snapshots
        .filter((snapshot) => snapshot.exists())
        .map((snapshot) => normalizeSchool(snapshot.data())),
    );
  }

  const targetSet = new Set(targetIds);
  return sortSchools(readJson<School[]>(LOCAL_SCHOOLS_KEY, []).filter((school) => targetSet.has(school.id)));
}

export async function saveSchool(school: School) {
  const normalized = normalizeSchool({
    ...school,
    updatedAt: new Date().toISOString(),
    createdAt: school.createdAt || new Date().toISOString(),
  });

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "schools", normalized.id), normalized),
      "Firestore 學校資料儲存",
    );
    return normalized;
  }

  const current = readJson<School[]>(LOCAL_SCHOOLS_KEY, []);
  writeJson(
    LOCAL_SCHOOLS_KEY,
    sortSchools([
      ...current.filter((item) => item.id !== normalized.id),
      normalized,
    ]),
  );
  return normalized;
}

export function createSchoolDraft(): School {
  const now = new Date().toISOString();
  return {
    id: `school-${Date.now()}`,
    name: "未命名學校",
    domains: [],
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeSchool(input: unknown): School {
  const record = isRecord(input) ? input : {};
  const now = new Date().toISOString();
  const domains = Array.isArray(record.domains)
    ? record.domains.map((domain) => normalizeDomain(domain)).filter(Boolean)
    : parseDomainText(readText(record.domains));
  return {
    id: readText(record.id, `school-${Date.now()}`),
    name: readText(record.name, "未命名學校"),
    domains: Array.from(new Set(domains)),
    enabled: record.enabled !== false,
    createdAt: readText(record.createdAt, now),
    updatedAt: readText(record.updatedAt, now),
  };
}

export function parseDomainText(value: string) {
  return value
    .split(/[\s,，；;]+/)
    .map((domain) => normalizeDomain(domain))
    .filter(Boolean);
}

function normalizeDomain(value: unknown) {
  return readText(value)
    .toLowerCase()
    .replace(/^@+/, "")
    .trim();
}

function sortSchools(items: School[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
