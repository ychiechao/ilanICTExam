import { handleTime } from "./routes/time";

/**
 * ilanictexam-grader
 *
 * 競賽模式的後端：競賽帳號登入、題庫與帳號匯入、伺服器端評分。
 * 路由在階段 1、2 逐一加入；階段 0 只有 /time 供前端校正倒數。
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
      console.error("unhandled", error);
      response = json({ ok: false, code: "internal", message: "伺服器發生錯誤" }, 500);
    }

    for (const [key, value] of Object.entries(cors)) {
      response.headers.set(key, value);
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, url: URL, _env: Env): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/time") {
    return handleTime();
  }
  return json({ ok: false, code: "not_found", message: "找不到此路徑" }, 404);
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
