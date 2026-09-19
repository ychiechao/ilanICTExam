import { HttpError, RequestContext } from "./context";
import { AuthError } from "./auth/verifyIdToken";
import {
  handleImportContestAccounts,
  handleResetContestAccountPassword,
  handleSetContestAccountStatus,
} from "./routes/contestAccounts";
import { handleImportContestProblems } from "./routes/contestProblems";
import { handleArchiveContest, handleDeleteContest, handleReleaseContest, handleResetContest, handleUnarchiveContest } from "./routes/contestAdmin";
import { handleVoidSubmission } from "./routes/contestReview";
import { handleBoard } from "./routes/board";
import { handleGrade } from "./routes/grade";
import { handleLogin, handleRefresh } from "./routes/login";
import { handleTime } from "./routes/time";

/**
 * ilanictexam-grader
 *
 * 競賽模式的後端：競賽帳號登入、題庫與帳號匯入、伺服器端評分。
 * 所有回應都是 JSON：成功 { ok: true, ... }，失敗 { ok: false, code, message }。
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    let response: Response;
    try {
      response = await route(request, url, env);
    } catch (error) {
      response = errorResponse(error);
    }

    for (const [key, value] of Object.entries(cors)) {
      response.headers.set(key, value);
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, url: URL, env: Env): Promise<Response> {
  const { method } = request;
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "GET" && path === "/time") {
    return handleTime();
  }

  // 以下路由都需要 Firestore；RequestContext 建構時才解析服務帳號，/time 不需要 secret。
  const ctx = new RequestContext(env);

  // 投影用排行榜（不需登入，靠 token）
  const boardMatch = /^\/board\/([A-Za-z0-9_-]+)$/.exec(path);
  if (method === "GET" && boardMatch) {
    return handleBoard(request, ctx, boardMatch[1]);
  }

  if (method === "POST" && path === "/login") {
    return handleLogin(request, ctx);
  }
  if (method === "POST" && path === "/refresh") {
    return handleRefresh(request, ctx);
  }
  if (method === "POST" && path === "/grade") {
    return handleGrade(request, ctx);
  }

  // 超管：競賽帳號
  const accountsMatch = /^\/contest-accounts\/([A-Za-z0-9_-]+)(?:\/(reset-password|status))?$/.exec(path);
  if (method === "POST" && accountsMatch) {
    const [, contestId, action] = accountsMatch;
    if (!action) return handleImportContestAccounts(request, ctx, contestId);
    if (action === "reset-password") return handleResetContestAccountPassword(request, ctx, contestId);
    if (action === "status") return handleSetContestAccountStatus(request, ctx, contestId);
  }

  // 超管：競賽題庫
  const problemsMatch = /^\/contest-problems\/([A-Za-z0-9_-]+)$/.exec(path);
  if (method === "POST" && problemsMatch) {
    return handleImportContestProblems(request, ctx, problemsMatch[1]);
  }

  // 超管：重置／刪除／封存／解封存／釋出題庫、作廢提交
  const contestMatch = /^\/contests\/([A-Za-z0-9_-]+)(?:\/(reset|void|archive|unarchive|release))?$/.exec(path);
  if (contestMatch) {
    const [, contestId, action] = contestMatch;
    if (method === "POST" && action === "reset") return handleResetContest(request, ctx, contestId);
    if (method === "POST" && action === "void") return handleVoidSubmission(request, ctx, contestId);
    if (method === "POST" && action === "archive") return handleArchiveContest(request, ctx, contestId);
    if (method === "POST" && action === "unarchive") return handleUnarchiveContest(request, ctx, contestId);
    if (method === "POST" && action === "release") return handleReleaseContest(request, ctx, contestId);
    if (method === "DELETE" && !action) return handleDeleteContest(request, ctx, contestId);
  }

  throw new HttpError(404, "not_found", "找不到此路徑");
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  if (error instanceof AuthError) {
    return json({ ok: false, code: error.code, message: error.message }, 401);
  }
  console.error("unhandled", error);
  return json({ ok: false, code: "internal", message: "伺服器發生錯誤" }, 500);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  const allowList = allowed.split(",").map((item) => item.trim()).filter(Boolean);
  const allowOrigin = allowList.includes(origin) ? origin : allowList[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
