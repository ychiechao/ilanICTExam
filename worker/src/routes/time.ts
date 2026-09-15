import { json } from "../index";

/** 伺服器時間，前端用來校正競賽倒數；客戶端時鐘不可信。 */
export function handleTime(): Response {
  const now = new Date();
  return json({ ok: true, now: now.toISOString(), epochMs: now.getTime() });
}
