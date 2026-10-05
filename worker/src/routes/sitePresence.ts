import { SITE_PRESENCE_AUTH_PREFIX, SITE_PRESENCE_PROTOCOL } from "../../../shared/sitePresence";
import { verifyIdToken } from "../auth/verifyIdToken";
import { HttpError } from "../context";

export async function handleSitePresence(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((item) => item.trim());
  if (!origin || !allowed.includes(origin)) {
    throw new HttpError(403, "origin_not_allowed", "不允許此網站的線上統計連線。");
  }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "websocket_required", "線上統計需要即時連線。");
  }
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") || "").split(",").map((item) => item.trim());
  const credentials = protocols.filter((item) => item.startsWith(SITE_PRESENCE_AUTH_PREFIX));
  if (!protocols.includes(SITE_PRESENCE_PROTOCOL) || credentials.length !== 1 || credentials[0].length > 16_000) {
    throw new HttpError(401, "unauthorized", "請先登入後再連線。");
  }
  // The token is never placed in a URL, forwarded to the DO, stored, or returned.
  const token = await verifyIdToken(credentials[0].slice(SITE_PRESENCE_AUTH_PREFIX.length), env.FIREBASE_PROJECT_ID);
  const headers = new Headers({
    Upgrade: "websocket",
    "X-Presence-Uid": token.uid,
    "X-Presence-Expires": String(Number(token.claims.exp) * 1000),
  });
  return env.SITE_PRESENCE.getByName(origin).fetch(new Request("https://presence.internal/", { headers }));
}
