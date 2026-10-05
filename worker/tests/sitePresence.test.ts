import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { base64UrlEncode } from "../src/google/serviceAccount";

let privateKey: CryptoKey;
const clients: WebSocket[] = [];
const messages: Array<Record<string, unknown>> = [];
const issuer = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`;
const origin = "https://presence-tests.invalid";
const testEnv = { ...env, FIREBASE_SERVICE_ACCOUNT_B64: "" };
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

beforeAll(async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  privateKey = keys.privateKey;
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com") {
      throw new Error("Runtime tests must not access external services");
    }
    return Response.json({ keys: [{ ...publicKey, alg: "RS256", kid: "local-presence-test-key" }] }, { headers: { "Cache-Control": "max-age=3600" } });
  });
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close(1000);
  const stub = env.SITE_PRESENCE.getByName(origin);
  await expect.poll(() => stub.getOnlineCount()).toBe(0);
  messages.length = 0;
});

async function token(uid: string, claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "local-presence-test-key" })));
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ sub: uid, aud: env.FIREBASE_PROJECT_ID, iss: issuer, iat: now, exp: now + 3600, ...claims })));
  const data = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function request(source: string, idToken = "") {
  return new IncomingRequest("https://worker.invalid/presence", { headers: {
    Origin: source, Upgrade: "websocket",
    "Sec-WebSocket-Protocol": idToken ? `ilc-online-v1, firebase.${idToken}` : "ilc-online-v1",
  } });
}

async function connect(uid: string, source = origin) {
  const response = await worker.fetch(request(source, await token(uid)), testEnv);
  expect(response.status).toBe(101);
  expect(response.headers.get("Sec-WebSocket-Protocol")).toBe("ilc-online-v1");
  const client = response.webSocket!;
  client.addEventListener("message", (event) => { if (event.data !== "pong") messages.push(JSON.parse(String(event.data))); });
  client.accept(); clients.push(client);
  return client;
}

describe("authenticated, private online-account presence", () => {
  it("rejects missing login and unauthorized origins without needing a Firestore service account", async () => {
    expect((await worker.fetch(request(origin), testEnv)).status).toBe(401);
    expect((await worker.fetch(request("https://unknown.invalid"), testEnv)).status).toBe(403);
    expect((await worker.fetch(new IncomingRequest("https://worker.invalid/presence", { headers: { Origin: origin } }), testEnv)).status).toBe(426);
  });

  it("validates token signature, project and expiration instead of trusting client identities", async () => {
    const valid = await token("student-a");
    expect((await worker.fetch(request(origin, `${valid.slice(0, -6)}AAAAAA`), testEnv)).status).toBe(401);
    expect((await worker.fetch(request(origin, await token("student-a", { aud: "other-project" })), testEnv)).status).toBe(401);
    expect((await worker.fetch(request(origin, await token("student-a", { exp: 1 })), testEnv)).status).toBe(401);
  });

  it("deduplicates multiple tabs, broadcasts only totals and removes the last closed tab", async () => {
    const first = await connect("student-a");
    const second = await connect("student-a");
    const other = await connect("teacher-b");
    const stub = env.SITE_PRESENCE.getByName(origin);
    expect(await stub.getOnlineCount()).toBe(2);
    await expect.poll(() => messages.some((message) => message.count === 2)).toBe(true);
    for (const message of messages) expect(Object.keys(message).sort()).toEqual(["count", "type"]);
    first.close(1000); expect(await stub.getOnlineCount()).toBe(2);
    second.close(1000); await expect.poll(() => stub.getOnlineCount()).toBe(1);
    other.close(1000); await expect.poll(() => stub.getOnlineCount()).toBe(0);
  });

  it("keeps production and preview sites separate", async () => {
    await connect("student-a");
    const preview = await connect("student-b", "https://other-tests.invalid");
    expect(await env.SITE_PRESENCE.getByName(origin).getOnlineCount()).toBe(1);
    const previewStub = env.SITE_PRESENCE.getByName("https://other-tests.invalid");
    expect(await previewStub.getOnlineCount()).toBe(1);
    preview.close(1000); await expect.poll(() => previewStub.getOnlineCount()).toBe(0);
  });

  it("survives hibernation and still counts one account with two tabs", async () => {
    const client = await connect("student-a");
    const stub = env.SITE_PRESENCE.getByName(origin);
    await evictDurableObject(stub);
    expect(await stub.getOnlineCount()).toBe(1);
    const pong = new Promise((resolve) => client.addEventListener("message", (event) => { if (event.data === "pong") resolve(true); }));
    client.send("ping"); expect(await pong).toBe(true);
    await connect("student-a"); expect(await stub.getOnlineCount()).toBe(1);
  });

  it("expires disconnected or expired-token sessions using the server alarm", async () => {
    await connect("student-a"); await connect("student-b");
    const stub = env.SITE_PRESENCE.getByName(origin);
    await runInDurableObject(stub, (_instance, state) => {
      for (const socket of state.getWebSockets()) {
        const session = socket.deserializeAttachment();
        if (session.uid === "student-a") session.connectedAt = Date.now() - 120_000;
        else session.expiresAt = Date.now() - 1000;
        socket.serializeAttachment(session);
      }
    });
    await evictDurableObject(stub);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.getOnlineCount()).toBe(0);
    expect(await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm())).toBe(null);
  });

  it("rejects forged counter messages from an authenticated browser", async () => {
    const client = await connect("student-a");
    client.send(JSON.stringify({ type: "online-count", count: 999, uid: "fake-user" }));
    await expect.poll(() => env.SITE_PRESENCE.getByName(origin).getOnlineCount()).toBe(0);
    expect(messages.some((message) => message.count === 999)).toBe(false);
  });
});
