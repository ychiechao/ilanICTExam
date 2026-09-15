import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import type { ContestRosterEntry, School, SchoolAccount } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

const LOCAL_SCHOOLS_KEY = "yilan-contest-schools";
const LOCAL_ROSTER_KEY = "yilan-contest-roster";
const LOCAL_SCHOOL_ACCOUNTS_KEY = "yilan-school-accounts";

export interface RosterImportPreviewRow {
  rowNumber: number;
  email: string;
  normalizedEmail: string;
  name: string;
  domain: string;
  schoolId: string;
  schoolName: string;
  valid: boolean;
  errors: string[];
}

export interface RosterImportPreview {
  contestId: string;
  rows: RosterImportPreviewRow[];
  validRows: RosterImportPreviewRow[];
  invalidRows: RosterImportPreviewRow[];
  duplicateEmails: string[];
}

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

export function previewRosterImport(
  rawCsv: string,
  contestId: string,
  schools: School[],
): RosterImportPreview {
  const rows = parseRosterCsv(rawCsv);
  const emailCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const normalizedEmail = normalizeEmail(row.email);
    if (normalizedEmail) {
      counts[normalizedEmail] = (counts[normalizedEmail] || 0) + 1;
    }
    return counts;
  }, {});
  const duplicateEmails = Object.entries(emailCounts)
    .filter(([, count]) => count > 1)
    .map(([email]) => email);

  const previewRows = rows.map((row) => {
    const normalizedEmail = normalizeEmail(row.email);
    const domain = getEmailDomain(normalizedEmail);
    const matchedSchool = findSchoolByDomain(domain, schools);
    const errors: string[] = [];

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      errors.push("Email 格式不正確");
    }
    if (!row.name.trim()) {
      errors.push("姓名不可空白");
    }
    if (normalizedEmail && duplicateEmails.includes(normalizedEmail)) {
      errors.push("匯入資料內 Email 重複");
    }
    if (normalizedEmail && !matchedSchool) {
      errors.push("找不到對應 Email 網域的學校");
    }

    return {
      rowNumber: row.rowNumber,
      email: row.email.trim(),
      normalizedEmail,
      name: row.name.trim(),
      domain,
      schoolId: matchedSchool?.id || "",
      schoolName: matchedSchool?.name || "",
      valid: errors.length === 0,
      errors,
    };
  });

  return {
    contestId,
    rows: previewRows,
    validRows: previewRows.filter((row) => row.valid),
    invalidRows: previewRows.filter((row) => !row.valid),
    duplicateEmails,
  };
}

export async function saveRosterEntries(contestId: string, rows: RosterImportPreviewRow[]) {
  const now = new Date().toISOString();
  const entries = rows
    .filter((row) => row.valid)
    .map((row) => normalizeRosterEntry({
      id: getRosterEntryId(contestId, row.normalizedEmail),
      contestId,
      email: row.email,
      normalizedEmail: row.normalizedEmail,
      name: row.name,
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      domain: row.domain,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }));

  if (entries.length === 0) {
    return { importedCount: 0 };
  }

  if (db) {
    for (let index = 0; index < entries.length; index += 450) {
      const batch = writeBatch(db);
      for (const entry of entries.slice(index, index + 450)) {
        batch.set(doc(db, "contestRoster", entry.id), entry, { merge: true });
      }
      await withRemoteTimeout(batch.commit(), "Firestore 賽事名單匯入");
    }
    return { importedCount: entries.length };
  }

  const current = readJson<ContestRosterEntry[]>(LOCAL_ROSTER_KEY, []);
  const incomingIds = new Set(entries.map((entry) => entry.id));
  writeJson(
    LOCAL_ROSTER_KEY,
    sortRosterEntries([
      ...current.filter((entry) => !incomingIds.has(entry.id)),
      ...entries,
    ]),
  );
  return { importedCount: entries.length };
}

export async function loadRosterEntries(contestId: string): Promise<ContestRosterEntry[]> {
  if (db) {
    const snapshot = await withRemoteTimeout(
      getDocs(query(collection(db, "contestRoster"), where("contestId", "==", contestId))),
      "Firestore 賽事名單讀取",
    );
    return sortRosterEntries(snapshot.docs.map((item) => normalizeRosterEntry(item.data())));
  }

  return sortRosterEntries(
    readJson<ContestRosterEntry[]>(LOCAL_ROSTER_KEY, []).filter((entry) => entry.contestId === contestId),
  );
}

export async function loadSchoolAccounts(schoolIds?: string[]): Promise<SchoolAccount[]> {
  const targetIds = schoolIds
    ? Array.from(new Set(schoolIds.map((schoolId) => schoolId.trim()).filter(Boolean)))
    : undefined;

  if (targetIds && targetIds.length === 0) {
    return [];
  }

  if (db) {
    const collectionRef = collection(db, "schoolAccounts");
    if (!targetIds) {
      const snapshot = await withRemoteTimeout(getDocs(collectionRef), "Firestore 學校帳號讀取");
      return sortSchoolAccounts(snapshot.docs.map((item) => normalizeSchoolAccount(item.data())));
    }

    const accountSnapshots = [];
    for (let index = 0; index < targetIds.length; index += 10) {
      const chunk = targetIds.slice(index, index + 10);
      const chunkQuery =
        chunk.length === 1
          ? query(collectionRef, where("schoolId", "==", chunk[0]))
          : query(collectionRef, where("schoolId", "in", chunk));
      accountSnapshots.push(
        withRemoteTimeout(getDocs(chunkQuery), "Firestore 指派學校帳號讀取"),
      );
    }
    const snapshots = await Promise.all(accountSnapshots);
    return sortSchoolAccounts(
      snapshots.flatMap((snapshot) => snapshot.docs.map((item) => normalizeSchoolAccount(item.data()))),
    );
  }

  const accounts = readJson<SchoolAccount[]>(LOCAL_SCHOOL_ACCOUNTS_KEY, []);
  if (!targetIds) {
    return sortSchoolAccounts(accounts);
  }
  const targetSet = new Set(targetIds);
  return sortSchoolAccounts(accounts.filter((account) => targetSet.has(account.schoolId)));
}

export async function createSchoolAccount(
  school: School,
  email: string,
  name: string,
  actorUid?: string,
) {
  const now = new Date().toISOString();
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = name.trim();
  const domain = getEmailDomain(normalizedEmail);

  if (!school.id) {
    throw new Error("請先選擇學校。");
  }
  if (school.enabled === false) {
    throw new Error("這所學校目前已停用，不能新增帳號。");
  }
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new Error("請輸入正確的學生 Email。");
  }
  if (!normalizedName) {
    throw new Error("請輸入學生姓名。");
  }

  const account = normalizeSchoolAccount({
    id: getSchoolAccountId(school.id, normalizedEmail),
    schoolId: school.id,
    schoolName: school.name,
    email: email.trim(),
    normalizedEmail,
    name: normalizedName,
    domain,
    status: "active",
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid || "",
    updatedBy: actorUid || "",
  });

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "schoolAccounts", account.id), account, { merge: true }),
      "Firestore 學校帳號儲存",
    );
    return account;
  }

  const current = readJson<SchoolAccount[]>(LOCAL_SCHOOL_ACCOUNTS_KEY, []);
  writeJson(
    LOCAL_SCHOOL_ACCOUNTS_KEY,
    sortSchoolAccounts([
      ...current.filter((item) => item.id !== account.id),
      account,
    ]),
  );
  return account;
}

function parseRosterCsv(rawCsv: string) {
  const rows = parseCsvRows(rawCsv).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length === 0) {
    return [];
  }

  const firstRow = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = firstRow.includes("email") && firstRow.includes("name");
  const emailIndex = hasHeader ? firstRow.indexOf("email") : 0;
  const nameIndex = hasHeader ? firstRow.indexOf("name") : 1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const offset = hasHeader ? 2 : 1;

  return dataRows.map((row, index) => ({
    rowNumber: index + offset,
    email: row[emailIndex] || "",
    name: row[nameIndex] || "",
  }));
}

function parseCsvRows(rawCsv: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < rawCsv.length; index += 1) {
    const char = rawCsv[index];
    const next = rawCsv[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    current += char;
  }

  row.push(current);
  rows.push(row);
  return rows;
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

function normalizeRosterEntry(input: unknown): ContestRosterEntry {
  const record = isRecord(input) ? input : {};
  const normalizedEmail = normalizeEmail(record.normalizedEmail || record.email);
  return {
    id: readText(record.id, getRosterEntryId(readText(record.contestId), normalizedEmail)),
    contestId: readText(record.contestId),
    email: readText(record.email, normalizedEmail),
    normalizedEmail,
    name: readText(record.name),
    schoolId: readText(record.schoolId),
    schoolName: readText(record.schoolName),
    domain: readText(record.domain, getEmailDomain(normalizedEmail)),
    status: record.status === "disabled" ? "disabled" : "active",
    uid: readText(record.uid),
    createdAt: readText(record.createdAt),
    updatedAt: readText(record.updatedAt),
  };
}

function normalizeSchoolAccount(input: unknown): SchoolAccount {
  const record = isRecord(input) ? input : {};
  const normalizedEmail = normalizeEmail(record.normalizedEmail || record.email);
  const schoolId = readText(record.schoolId);
  return {
    id: readText(record.id, getSchoolAccountId(schoolId, normalizedEmail)),
    schoolId,
    schoolName: readText(record.schoolName),
    email: readText(record.email, normalizedEmail),
    normalizedEmail,
    name: readText(record.name),
    domain: readText(record.domain, getEmailDomain(normalizedEmail)),
    status: record.status === "disabled" ? "disabled" : "active",
    uid: readText(record.uid),
    createdAt: readText(record.createdAt),
    updatedAt: readText(record.updatedAt),
    createdBy: readText(record.createdBy),
    updatedBy: readText(record.updatedBy),
  };
}

function findSchoolByDomain(domain: string, schools: School[]) {
  return schools.find(
    (school) => school.enabled !== false && school.domains.some((item) => normalizeDomain(item) === domain),
  );
}

export function parseDomainText(value: string) {
  return value
    .split(/[\s,，；;]+/)
    .map((domain) => normalizeDomain(domain))
    .filter(Boolean);
}

function normalizeEmail(value: unknown) {
  return readText(value).toLowerCase();
}

function normalizeDomain(value: unknown) {
  return readText(value)
    .toLowerCase()
    .replace(/^@+/, "")
    .trim();
}

function getEmailDomain(email: string) {
  const atIndex = email.lastIndexOf("@");
  return atIndex >= 0 ? email.slice(atIndex + 1).toLowerCase() : "";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getRosterEntryId(contestId: string, normalizedEmail: string) {
  const safeEmail = getSafeEmailKey(normalizedEmail);
  return `${contestId}_${safeEmail}`;
}

function getSchoolAccountId(schoolId: string, normalizedEmail: string) {
  const safeEmail = getSafeEmailKey(normalizedEmail);
  return `${schoolId}_${safeEmail}`;
}

function getSafeEmailKey(normalizedEmail: string) {
  return normalizedEmail.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function sortSchools(items: School[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
}

function sortRosterEntries(items: ContestRosterEntry[]) {
  return [...items].sort((a, b) => {
    const schoolCompare = a.schoolName.localeCompare(b.schoolName, "zh-Hant", { numeric: true });
    if (schoolCompare !== 0) {
      return schoolCompare;
    }
    return a.name.localeCompare(b.name, "zh-Hant", { numeric: true });
  });
}

function sortSchoolAccounts(items: SchoolAccount[]) {
  return [...items].sort((a, b) => {
    const schoolCompare = a.schoolName.localeCompare(b.schoolName, "zh-Hant", { numeric: true });
    if (schoolCompare !== 0) {
      return schoolCompare;
    }
    return a.name.localeCompare(b.name, "zh-Hant", { numeric: true });
  });
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
