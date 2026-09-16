import { auth } from "../firebase";

/**
 * 呼叫 Cloudflare Worker（ilanictexam-grader）。
 * 所有回應都是 { ok, ... } 或 { ok: false, code, message }；失敗時丟出帶 message 的 Error。
 */
export const GRADER_URL = (import.meta.env.VITE_GRADER_URL as string | undefined)?.replace(/\/+$/, "") || "";

export function hasGraderConfig() {
  return Boolean(GRADER_URL);
}

interface GraderRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** 帶目前登入者的 Firebase ID token（預設帶）。 */
  withAuth?: boolean;
  timeoutMs?: number;
}

export class GraderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function graderRequest<T>(path: string, options: GraderRequestOptions = {}): Promise<T> {
  if (!GRADER_URL) {
    throw new GraderError("not_configured", "尚未設定評分伺服器位址（VITE_GRADER_URL）。", 0);
  }
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.withAuth !== false && auth?.currentUser) {
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  let response: Response;
  try {
    response = await fetch(`${GRADER_URL}${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new GraderError(
      "network",
      error instanceof Error && error.name === "AbortError" ? "評分伺服器連線逾時。" : "無法連線到評分伺服器。",
      0,
    );
  } finally {
    window.clearTimeout(timer);
  }

  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; message?: string };
  if (!response.ok || data.ok === false) {
    throw new GraderError(data.code ?? "http_error", data.message ?? `評分伺服器回應 ${response.status}`, response.status);
  }
  return data as T;
}
