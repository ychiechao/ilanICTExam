import { DurableObject } from "cloudflare:workers";
import { SITE_PRESENCE_PROTOCOL, SITE_PRESENCE_TIMEOUT_MS } from "../../../shared/sitePresence";

interface Session {
  uid: string;
  connectedAt: number;
  expiresAt: number;
}

/** One coordination room per allowed website origin; never stores names or emails. */
export class SitePresence extends DurableObject<Env> {
  private lastCount: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // A hibernated room may have lost sessions while asleep; refresh all surviving clients.
    this.lastCount = -1;
  }

  async fetch(request: Request): Promise<Response> {
    const uid = request.headers.get("X-Presence-Uid") || "";
    const expiresAt = Number(request.headers.get("X-Presence-Expires"));
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }
    if (!uid || uid.length > 128 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (this.ctx.getWebSockets(uid).filter((socket) => socket.readyState === WebSocket.OPEN).length >= 10) {
      return new Response("Too many sessions", { status: 429 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [uid]);
    server.serializeAttachment({ uid, expiresAt, connectedAt: Date.now() } satisfies Session);
    this.broadcast(server);
    if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    }
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": SITE_PRESENCE_PROTOCOL },
    });
  }

  getOnlineCount(): number {
    return new Set(this.activeSockets().map((socket) => this.session(socket)!.uid)).size;
  }

  webSocketMessage(socket: WebSocket, _message: string | ArrayBuffer): void {
    // Only automatic ping/pong is allowed; clients cannot supply counts or identities.
    socket.close(1008, "Unsupported message");
    this.broadcast();
  }

  webSocketClose(socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    socket.close(1000, "Disconnected");
    this.broadcast();
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "Connection error");
    this.broadcast();
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN && !this.isActive(socket, now)) {
        socket.close(4001, "Session expired");
      }
    }
    this.broadcast();
    if (this.activeSockets().length > 0) {
      await this.ctx.storage.setAlarm(now + 30_000);
    }
  }

  private session(socket: WebSocket): Session | null {
    const data = socket.deserializeAttachment() as Partial<Session> | null;
    return data && typeof data.uid === "string" && typeof data.connectedAt === "number" &&
      typeof data.expiresAt === "number" ? data as Session : null;
  }

  private isActive(socket: WebSocket, now: number): boolean {
    const session = this.session(socket);
    if (socket.readyState !== WebSocket.OPEN || !session || session.expiresAt <= now) return false;
    const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? session.connectedAt;
    return now - lastPing < SITE_PRESENCE_TIMEOUT_MS;
  }

  private activeSockets(): WebSocket[] {
    const now = Date.now();
    return this.ctx.getWebSockets().filter((socket) => this.isActive(socket, now));
  }

  private broadcast(newSocket?: WebSocket): void {
    const count = this.getOnlineCount();
    const changed = count !== this.lastCount;
    this.lastCount = count;
    const message = JSON.stringify({ type: "online-count", count });
    for (const socket of this.activeSockets()) {
      if (!changed && socket !== newSocket) continue;
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "Unable to send");
      }
    }
  }
}
