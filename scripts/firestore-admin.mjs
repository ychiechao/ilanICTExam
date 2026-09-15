// 開發用：以服務帳號直接讀寫 Firestore（REST），供本機測試種資料與還原。
// 用法：
//   node scripts/firestore-admin.mjs set settings/platform '{"mode":"practice","activeContestIds":[],"announcement":""}'
//   node scripts/firestore-admin.mjs get settings/platform
//   node scripts/firestore-admin.mjs delete contests/test-e
//   node scripts/firestore-admin.mjs hash <password>        # 產生競賽帳號密碼雜湊（PBKDF2）
// 服務帳號路徑由 SA_PATH 環境變數指定，預設 ~/.secrets/fileupload-d96f5-sa.json
import { createSign, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const saPath = process.env.SA_PATH || join(homedir(), ".secrets", "fileupload-d96f5-sa.json");
const [command, path, payload] = process.argv.slice(2);

if (command === "hash") {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(path, salt, 100_000, 32, "sha256");
  console.log(`pbkdf2$100000$${salt.toString("base64")}$${hash.toString("base64")}`);
  process.exit(0);
}

const sa = JSON.parse(readFileSync(saPath, "utf8"));
const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const token = await getAccessToken(sa);

if (command === "get") {
  const res = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  console.log(res.status, JSON.stringify(decode(await res.json()), null, 2));
} else if (command === "set") {
  const data = JSON.parse(payload);
  const res = await fetch(`${base}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  console.log(res.status, res.ok ? "ok" : await res.text());
} else if (command === "delete") {
  const res = await fetch(`${base}/${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  console.log(res.status, res.ok ? "deleted" : await res.text());
} else {
  console.error("unknown command");
  process.exit(1);
}

async function getAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      sub: account.client_email,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/datastore",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(account.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

function b64url(text) {
  return Buffer.from(text).toString("base64url");
}

function encodeFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encode(v)]));
}
function encode(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}
function decode(doc) {
  if (!doc.fields) return doc;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) out[k] = decodeValue(v);
  return out;
}
function decodeValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decode(v.mapValue);
  return null;
}
