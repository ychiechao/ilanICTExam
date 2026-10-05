export const SITE_PRESENCE_PROTOCOL = "ilc-online-v1";
export const SITE_PRESENCE_AUTH_PREFIX = "firebase.";
export const SITE_PRESENCE_HEARTBEAT_MS = 30_000;
export const SITE_PRESENCE_TIMEOUT_MS = 90_000;

export interface OnlinePresenceState {
  status: "connecting" | "online" | "offline" | "unavailable";
  count: number | null;
}

export function parseOnlineCount(message: string): number | null {
  try {
    const data = JSON.parse(message) as { type?: unknown; count?: unknown };
    return data?.type === "online-count" && typeof data.count === "number" &&
      Number.isSafeInteger(data.count) && data.count >= 0 ? data.count : null;
  } catch {
    return null;
  }
}
