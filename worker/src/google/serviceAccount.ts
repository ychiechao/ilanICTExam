/**
 * Firebase 服務帳號：從 secret 解析金鑰、簽 JWT、換取 Google OAuth access token。
 * Worker 以這個身分寫 Firestore、簽發自訂 token；client 端永遠拿不到它。
 */

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedKey: { pem: string; key: CryptoKey } | null = null;
let cachedAccessToken: CachedToken | null = null;

export function loadServiceAccount(env: Env): ServiceAccount {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!raw) {
    throw new Error("缺少 FIREBASE_SERVICE_ACCOUNT_B64 secret");
  }
  const parsed = JSON.parse(atob(raw)) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("服務帳號 JSON 缺少 project_id / client_email / private_key");
  }
  return parsed as ServiceAccount;
}

export async function getSigningKey(account: ServiceAccount): Promise<CryptoKey> {
  if (cachedKey && cachedKey.pem === account.private_key) {
    return cachedKey.key;
  }
  const pem = account.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cachedKey = { pem: account.private_key, key };
  return key;
}

/** 簽一個 RS256 JWT。payload 由呼叫端負責放 iat/exp。 */
export async function signJwt(account: ServiceAccount, payload: Record<string, unknown>): Promise<string> {
  const key = await getSigningKey(account);
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** 取得可呼叫 Firestore REST 的 access token；同一個 isolate 內快取到過期前 5 分鐘。 */
export async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt - 300 > now) {
    return cachedAccessToken.token;
  }
  const assertion = await signJwt(account, {
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore",
    iat: now,
    exp: now + 3600,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`取得 Google access token 失敗：${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { token: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return base64ToBytes(padded);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
