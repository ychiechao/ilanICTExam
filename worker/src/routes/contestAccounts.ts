/**
 * 競賽帳號（規格 8.2）
 *
 * POST /contest-accounts/{contestId}                 批次匯入，回傳一次性的帳號密碼清單
 * POST /contest-accounts/{contestId}/reset-password  重設單一帳號密碼，回傳新密碼
 * POST /contest-accounts/{contestId}/status          停用／啟用單一帳號
 *
 * 密碼只在產生當下回傳明碼；Firestore 只存非敏感欄位，雜湊在 KV `pw:{docId}`。
 */
import { generatePassword, hashPassword } from "../auth/password";
import { HttpError, readJsonBody, type ContestAccountDoc, type RequestContext } from "../context";
import { SERVER_TIMESTAMP } from "../google/firestore";
import { json } from "../index";
import { accountDocId, normalizeUsername } from "./login";

interface ImportRow {
  name?: string;
  schoolId?: string;
  schoolName?: string;
  note?: string;
}

interface ImportBody {
  rows?: ImportRow[];
}

const MAX_ROWS_PER_IMPORT = 500;

export async function handleImportContestAccounts(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const body = await readJsonBody<ImportBody>(request);
  const rows = (body.rows ?? []).map(cleanRow).filter((row) => row.name);
  if (rows.length === 0) {
    throw new HttpError(400, "bad_request", "沒有可匯入的資料（每列至少要有姓名）");
  }
  if (rows.length > MAX_ROWS_PER_IMPORT) {
    throw new HttpError(400, "too_many_rows", `一次最多匯入 ${MAX_ROWS_PER_IMPORT} 筆`);
  }

  const contest = await ctx.getContest(contestId);
  if (!contest) {
    throw new HttpError(404, "contest_not_found", "找不到賽事");
  }
  const division = (contest.data.division || "E").toUpperCase();

  // 流水號接續：讀該場既有帳號，找最大序號。
  const existing = await ctx.db.query<ContestAccountDoc>("contestAccounts", {
    where: [{ field: "contestId", op: "EQUAL", value: contestId }],
  });
  let sequence = existing.reduce((max, doc) => Math.max(max, parseSequence(doc.data.username)), 0);
  // 學校序號：同一場、同一所學校內從 1 起算，分批匯入時接續。
  const schoolCounters = new Map<string, number>();
  for (const doc of existing) {
    const key = schoolKey(doc.data.schoolId, doc.data.schoolName);
    schoolCounters.set(key, Math.max(schoolCounters.get(key) ?? 0, Number(doc.data.schoolSeq ?? 0)));
  }

  const batchId = `batch-${Date.now()}`;
  const created: Array<{ username: string; password: string; name: string; schoolName: string; schoolSeq: number; note: string }> = [];
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const passwordWrites: Array<Promise<void>> = [];

  for (const row of rows) {
    sequence += 1;
    const username = `${division}-${String(sequence).padStart(3, "0")}`;
    const docId = accountDocId(contestId, username);
    const key = schoolKey(row.schoolId, row.schoolName);
    const schoolSeq = (schoolCounters.get(key) ?? 0) + 1;
    schoolCounters.set(key, schoolSeq);
    const password = generatePassword(8);
    passwordWrites.push(hashPassword(password).then((hash) => ctx.env.PASSWORDS.put(`pw:${docId}`, hash)));
    writes.push({
      path: `contestAccounts/${docId}`,
      data: {
        contestId,
        username,
        name: row.name,
        schoolId: row.schoolId,
        schoolName: row.schoolName,
        schoolSeq,
        note: row.note,
        status: "active",
        uid: `contest_${contestId}_${username}`,
        batchId,
        createdAt: SERVER_TIMESTAMP,
        createdBy: actor.uid,
      },
    });
    created.push({ username, password, name: row.name, schoolName: row.schoolName, schoolSeq, note: row.note });
  }

  await Promise.all(passwordWrites);
  await ctx.db.batchSet(writes);
  const accountCount = existing.length + created.length;
  await ctx.db.setDoc(`contests/${contestId}`, { accountCount, updatedAt: new Date().toISOString() }, { merge: true });
  await ctx.writeAuditLog(actor, {
    action: "contest.accounts.import",
    targetType: "contest",
    targetId: contestId,
    summary: `匯入 ${created.length} 個競賽帳號（${created[0]?.username} ～ ${created[created.length - 1]?.username}），批次 ${batchId}`,
  });

  return json({ ok: true, batchId, accountCount, accounts: created });
}

export async function handleResetContestAccountPassword(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const body = await readJsonBody<{ username?: string }>(request);
  const username = normalizeUsername(body.username);
  const docId = accountDocId(contestId, username);
  const account = await ctx.db.getDoc<ContestAccountDoc>(`contestAccounts/${docId}`);
  if (!username || !account) {
    throw new HttpError(404, "account_not_found", "找不到這個競賽帳號");
  }

  const password = generatePassword(8);
  await ctx.env.PASSWORDS.put(`pw:${docId}`, await hashPassword(password));
  await ctx.db.setDoc(`contestAccounts/${docId}`, { passwordResetAt: SERVER_TIMESTAMP, passwordResetBy: actor.uid }, { merge: true });
  await ctx.writeAuditLog(actor, {
    action: "contest.accounts.reset",
    targetType: "contestAccount",
    targetId: docId,
    summary: `重設 ${username}（${account.data.name}）的密碼`,
  });
  return json({ ok: true, username, password });
}

export async function handleSetContestAccountStatus(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const actor = await ctx.requireSuperAdmin(request);
  const body = await readJsonBody<{ username?: string; status?: string }>(request);
  const username = normalizeUsername(body.username);
  const status = body.status === "disabled" ? "disabled" : body.status === "active" ? "active" : null;
  const docId = accountDocId(contestId, username);
  const account = await ctx.db.getDoc<ContestAccountDoc>(`contestAccounts/${docId}`);
  if (!username || !account) {
    throw new HttpError(404, "account_not_found", "找不到這個競賽帳號");
  }
  if (!status) {
    throw new HttpError(400, "bad_request", "status 必須是 active 或 disabled");
  }

  await ctx.db.setDoc(`contestAccounts/${docId}`, { status, statusUpdatedAt: SERVER_TIMESTAMP, statusUpdatedBy: actor.uid }, { merge: true });
  await ctx.writeAuditLog(actor, {
    action: "contest.accounts.status",
    targetType: "contestAccount",
    targetId: docId,
    summary: `${status === "disabled" ? "停用" : "啟用"} ${username}（${account.data.name}）`,
  });
  return json({ ok: true, username, status });
}

function cleanRow(row: ImportRow) {
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  return {
    name: text(row.name, 50),
    schoolId: text(row.schoolId, 100),
    schoolName: text(row.schoolName, 100),
    note: text(row.note, 200),
  };
}

function schoolKey(schoolId: string | undefined, schoolName: string | undefined) {
  return schoolId || schoolName || "";
}

function parseSequence(username: string) {
  const match = /-(\d+)$/.exec(username || "");
  return match ? Number(match[1]) : 0;
}
