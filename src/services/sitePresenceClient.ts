import { parseOnlineCount, SITE_PRESENCE_AUTH_PREFIX, SITE_PRESENCE_HEARTBEAT_MS, SITE_PRESENCE_PROTOCOL, SITE_PRESENCE_TIMEOUT_MS, type OnlinePresenceState } from "../../shared/sitePresence";

export interface PresencePlatform {
  events: EventTarget;
  isOnline: () => boolean;
  now: () => number;
  createSocket: (url: string, protocols: string[]) => WebSocket;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
}

/** Pure connection controller so reconnection, account changes and cleanup can be tested. */
export function connectSitePresence(
  baseUrl: string,
  getToken: () => Promise<string>,
  onState: (state: OnlinePresenceState) => void,
  platform: PresencePlatform = {
    events: window,
    isOnline: () => navigator.onLine,
    now: Date.now,
    createSocket: (url, protocols) => new WebSocket(url, protocols),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (timer) => window.clearTimeout(timer),
  },
): () => void {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/presence`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  let stopped = false;
  let suspended = false;
  let connecting = false;
  let generation = 0;
  let retries = 0;
  let socket: WebSocket | null = null;
  let heartbeat: number | undefined;
  let retry: number | undefined;
  let connectionTimeout: number | undefined;
  let lastMessageAt = 0;

  function clearTimers() {
    for (const timer of [heartbeat, retry, connectionTimeout]) {
      if (timer !== undefined) platform.cancel(timer);
    }
    heartbeat = retry = connectionTimeout = undefined;
  }

  function disconnect() {
    generation += 1;
    connecting = false;
    clearTimers();
    const previous = socket;
    socket = null;
    previous?.close(1000, "Presence disconnected");
  }

  function reconnectLater() {
    if (stopped || suspended || !platform.isOnline()) return;
    const delay = Math.min(1000 * 2 ** Math.min(retries++, 9), 300_000);
    retry = platform.schedule(() => { retry = undefined; void connect(); }, delay);
  }

  function lostConnection() {
    if (stopped) return;
    disconnect();
    onState({ status: platform.isOnline() ? "unavailable" : "offline", count: null });
    reconnectLater();
  }

  function sendHeartbeat(current: WebSocket) {
    if (stopped || socket !== current) return;
    if (platform.now() - lastMessageAt >= SITE_PRESENCE_TIMEOUT_MS) {
      lostConnection();
      return;
    }
    try {
      current.send("ping");
      heartbeat = platform.schedule(() => sendHeartbeat(current), SITE_PRESENCE_HEARTBEAT_MS);
    } catch {
      lostConnection();
    }
  }

  async function connect() {
    if (stopped || suspended || socket || connecting) return;
    if (!platform.isOnline()) {
      onState({ status: "offline", count: null });
      return;
    }
    connecting = true;
    const attempt = ++generation;
    onState({ status: "connecting", count: null });
    connectionTimeout = platform.schedule(lostConnection, 20_000);
    try {
      const token = await getToken();
      if (stopped || suspended || attempt !== generation) return;
      if (!token) throw new Error("Missing identity");
      const current = platform.createSocket(url.toString(), [SITE_PRESENCE_PROTOCOL, `${SITE_PRESENCE_AUTH_PREFIX}${token}`]);
      socket = current;
      connecting = false;
      current.addEventListener("open", () => {
        if (socket !== current || stopped) return;
        lastMessageAt = platform.now();
        sendHeartbeat(current);
      });
      current.addEventListener("message", (event) => {
        if (socket !== current || stopped || typeof event.data !== "string") return;
        if (event.data === "pong") {
          lastMessageAt = platform.now();
          return;
        }
        const count = parseOnlineCount(event.data);
        if (count === null) return;
        lastMessageAt = platform.now();
        retries = 0;
        if (connectionTimeout !== undefined) platform.cancel(connectionTimeout);
        connectionTimeout = undefined;
        onState({ status: "online", count });
      });
      current.addEventListener("close", () => { if (socket === current) lostConnection(); });
      current.addEventListener("error", () => { if (socket === current) lostConnection(); });
    } catch {
      if (!stopped && attempt === generation) lostConnection();
    }
  }

  const offline = () => {
    disconnect();
    if (!stopped) onState({ status: "offline", count: null });
  };
  const online = () => {
    if (retry !== undefined) platform.cancel(retry);
    retry = undefined;
    retries = 0;
    void connect();
  };
  const pagehide = () => { suspended = true; offline(); };
  const pageshow = () => { suspended = false; online(); };
  platform.events.addEventListener("offline", offline);
  platform.events.addEventListener("online", online);
  platform.events.addEventListener("pagehide", pagehide);
  platform.events.addEventListener("pageshow", pageshow);
  void connect();

  return () => {
    stopped = true;
    disconnect();
    platform.events.removeEventListener("offline", offline);
    platform.events.removeEventListener("online", online);
    platform.events.removeEventListener("pagehide", pagehide);
    platform.events.removeEventListener("pageshow", pageshow);
  };
}
