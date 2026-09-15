/**
 * POST /login   競賽帳號登入 → Firebase 自訂 token（規格 5.2、8.3）
 * POST /refresh 以現有 ID token 換發新的自訂 token
 *
 * 只在競賽模式、帳號所屬賽事在 activeContestIds 時接受。
 */
import { contestUid, createCustomToken, type ContestClaims } from "../auth/customToken";
import { verifyPassword } from "../auth/password";
import { verifyRequestToken } from "../auth/verifyIdToken";
import { SERVER_TIMESTAMP } from "../google/firestore";
import { HttpError, readJsonBody, type ContestAccountDoc, type RequestContext } from "../context";
import { json } from "../index";

interface LoginBody {
  username?: string;
  password?: string;
  fingerprint?: string;
}

// 同一 isolate 內的簡易限速：每個帳號每分鐘最多 10 次嘗試。
// 免費方案 KV 每日只有 1000 次寫入，不適合拿來做限速，這裡先用記憶體，跨 isolate 不共享。
const attempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;

export async function handleLogin(request: Request, ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<LoginBody>(request);
  const username = normalizeUsername(body.username);
  const password = (body.password ?? "").trim();
  if (!username || !password) {
    throw new HttpError(400, "bad_request", "請輸入帳號與密碼");
  }
  checkRateLimit(username);

  const platform = await ctx.getPlatform();
  if (platform.mode !== "contest" || platform.activeContestIds.length === 0) {
    throw new HttpError(403, "not_contest_mode", "目前不是競賽時間，競賽帳號無法登入");
  }

  // 帳號名稱在同一場內唯一（E-001），跨場靠 contestId 區分；最多查兩場。
  let found: { id: string; data: ContestAccountDoc } | null = null;
  for (const contestId of platform.activeContestIds) {
    const doc = await ctx.db.getDoc<ContestAccountDoc>(`contestAccounts/${accountDocId(contestId, username)}`);
    if (doc) {
      found = { id: doc.id, data: doc.data };
      break;
    }
  }
  const stored = found ? await ctx.env.PASSWORDS.get(`pw:${found.id}`) : null;
  const valid = stored ? await verifyPassword(password, stored) : false;
  if (!found || !valid) {
    // 帳號不存在與密碼錯誤回同一個訊息，避免被拿來探測帳號。
    throw new HttpError(401, "invalid_credentials", "帳號或密碼錯誤");
  }
  if (found.data.status !== "active") {
    throw new HttpError(403, "account_disabled", "此帳號已停用，請洽主辦單位");
  }

  const contest = await ctx.getContest(found.data.contestId);
  if (!contest) {
    throw new HttpError(403, "contest_missing", "找不到對應的賽事");
  }

  const uid = contestUid(found.data.contestId, found.data.username);
  const claims: ContestClaims = {
    accountType: "contest",
    contestId: found.data.contestId,
    username: found.data.username,
    schoolId: found.data.schoolId ?? "",
    displayName: found.data.name,
  };
  const token = await createCustomToken(ctx.account, uid, claims);

  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint.slice(0, 128) : "";
  const fingerprintChanged = Boolean(found.data.deviceFingerprint && fingerprint && found.data.deviceFingerprint !== fingerprint);
  await ctx.db.setDoc(
    `contestAccounts/${found.id}`,
    {
      uid,
      lastLoginAt: SERVER_TIMESTAMP,
      ...(found.data.firstLoginAt ? {} : { firstLoginAt: SERVER_TIMESTAMP }),
      ...(fingerprint && !found.data.deviceFingerprint ? { deviceFingerprint: fingerprint } : {}),
    },
    { merge: true },
  );
  if (fingerprintChanged) {
    // 只記錄不阻擋（規格 8.3、D14）。
    await ctx.db.setDoc(`contestEvents/${crypto.randomUUID()}`, {
      contestId: found.data.contestId,
      uid,
      username: found.data.username,
      type: "fingerprint_changed",
      detail: { previous: found.data.deviceFingerprint, current: fingerprint },
      createdAt: SERVER_TIMESTAMP,
    });
  }

  attempts.delete(username);
  return json({
    ok: true,
    token,
    contest: { id: found.data.contestId, title: contest.data.title, startAt: contest.data.startAt, endAt: contest.data.endAt },
    account: { username: found.data.username, name: found.data.name, schoolName: found.data.schoolName },
  });
}

export async function handleRefresh(request: Request, ctx: RequestContext): Promise<Response> {
  const verified = await verifyRequestToken(request, ctx.projectId);
  if (!verified || verified.claims.accountType !== "contest") {
    throw new HttpError(401, "unauthorized", "請重新登入");
  }
  const contestId = String(verified.claims.contestId ?? "");
  const username = String(verified.claims.username ?? "");

  const platform = await ctx.getPlatform();
  if (platform.mode !== "contest" || !platform.activeContestIds.includes(contestId)) {
    throw new HttpError(403, "contest_closed", "賽事已結束，競賽帳號不再有效");
  }
  const account = await ctx.db.getDoc<ContestAccountDoc>(`contestAccounts/${accountDocId(contestId, username)}`);
  if (!account || account.data.status !== "active") {
    throw new HttpError(403, "account_disabled", "此帳號已停用");
  }

  const token = await createCustomToken(ctx.account, verified.uid, {
    accountType: "contest",
    contestId,
    username,
    schoolId: account.data.schoolId ?? "",
    displayName: account.data.name,
  });
  return json({ ok: true, token });
}

export function accountDocId(contestId: string, username: string) {
  return `${contestId}_${username}`;
}

export function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function checkRateLimit(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > LOGIN_LIMIT) {
    throw new HttpError(429, "too_many_attempts", "嘗試次數過多，請一分鐘後再試");
  }
}
