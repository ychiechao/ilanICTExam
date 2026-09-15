/**
 * 驗證 Firebase ID token（client 端 getIdToken() 送來的）。
 * 依 Firebase 文件：RS256、kid 對應 Google 公鑰、aud = projectId、
 * iss = https://securetoken.google.com/{projectId}、exp 未過、sub 非空。
 */
import { base64UrlDecode } from "../google/serviceAccount";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

interface Jwk {
  kid: string;
  n: string;
  e: string;
  alg: string;
  kty: string;
}

export interface VerifiedToken {
  uid: string;
  claims: Record<string, unknown>;
}

let jwksCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;

export async function verifyIdToken(idToken: string, projectId: string): Promise<VerifiedToken> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new AuthError("token 格式錯誤");
  }
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  let signature: Uint8Array;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    signature = base64UrlDecode(parts[2]);
  } catch {
    throw new AuthError("token 無法解析");
  }
  if (header.alg !== "RS256" || !header.kid) {
    throw new AuthError("token 演算法不支援");
  }

  const key = await getPublicKey(header.kid);
  if (!key) {
    throw new AuthError("找不到對應的簽章金鑰");
  }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) {
    throw new AuthError("token 簽章無效");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    throw new AuthError("token 已過期");
  }
  if (typeof payload.iat !== "number" || payload.iat > now + 300) {
    throw new AuthError("token 簽發時間異常");
  }
  if (payload.aud !== projectId) {
    throw new AuthError("token 不屬於本專案");
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new AuthError("token 簽發者錯誤");
  }
  const uid = typeof payload.sub === "string" ? payload.sub : "";
  if (!uid) {
    throw new AuthError("token 缺少 uid");
  }
  return { uid, claims: payload };
}

/** 從 Authorization: Bearer 取出並驗證；回傳 null 表示沒帶 token。 */
export async function verifyRequestToken(request: Request, projectId: string): Promise<VerifiedToken | null> {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return verifyIdToken(header.slice(7).trim(), projectId);
}

async function getPublicKey(kid: string): Promise<CryptoKey | null> {
  const now = Date.now();
  if (!jwksCache || jwksCache.expiresAt < now || !jwksCache.keys.has(kid)) {
    const response = await fetch(JWKS_URL);
    if (!response.ok) {
      throw new Error(`取得 Google 公鑰失敗：${response.status}`);
    }
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "")?.[1] ?? 3600);
    const body = (await response.json()) as { keys: Jwk[] };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys) {
      keys.set(
        jwk.kid,
        await crypto.subtle.importKey(
          "jwk",
          { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      );
    }
    jwksCache = { keys, expiresAt: now + maxAge * 1000 };
  }
  return jwksCache.keys.get(kid) ?? null;
}

export class AuthError extends Error {
  readonly code = "unauthorized";
}
