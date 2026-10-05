import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/sitePresenceClient.ts", import.meta.url))],
  tsconfigRaw: {}, bundle: true, platform: "node", format: "esm", write: false,
});
const { connectSitePresence } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

class Socket extends EventTarget {
  readyState = 0;
  sent = [];
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  message(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  fail() { this.dispatchEvent(new Event("error")); }
}

function fixture(getToken = async () => "fixture-token") {
  let now = 0;
  let online = true;
  let sequence = 0;
  const timers = new Map();
  const sockets = [];
  const states = [];
  const events = new EventTarget();
  const platform = {
    events, isOnline: () => online, now: () => now,
    createSocket: (url, protocols) => { const socket = new Socket(); sockets.push({ socket, url, protocols }); return socket; },
    schedule: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
    cancel: (id) => timers.delete(id),
  };
  const stop = connectSitePresence("https://fixture.invalid", getToken, (state) => states.push(state), platform);
  return {
    sockets, states, timers, events, stop,
    setOnline(value) { online = value; events.dispatchEvent(new Event(value ? "online" : "offline")); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = target;
    },
  };
}

test("authenticated websocket keeps tokens out of URLs and accepts only valid aggregate counts", async () => {
  const f = fixture(); await flush();
  const { socket, url, protocols } = f.sockets[0];
  assert.equal(url, "wss://fixture.invalid/presence");
  assert.deepEqual(protocols, ["ilc-online-v1", "firebase.fixture-token"]);
  socket.open();
  for (const message of ['null', 'broken', '{"type":"other","count":5}', '{"type":"online-count","count":-1}', '{"type":"online-count","count":1.5}']) socket.message(message);
  assert.equal(f.states.at(-1).count, null);
  socket.message('{"type":"online-count","count":12}');
  assert.deepEqual(f.states.at(-1), { status: "online", count: 12 });
  assert.deepEqual(socket.sent, ["ping"]);
  f.stop(); assert.equal(f.timers.size, 0);
});

test("offline clears stale counts; restored connectivity creates a new socket", async () => {
  const f = fixture(); await flush();
  const old = f.sockets[0].socket; old.open(); old.message('{"type":"online-count","count":3}');
  f.setOnline(false);
  assert.equal(old.readyState, 3);
  assert.deepEqual(f.states.at(-1), { status: "offline", count: null });
  old.message('{"type":"online-count","count":99}');
  assert.equal(f.states.at(-1).count, null);
  f.setOnline(true); await flush(); assert.equal(f.sockets.length, 2);
  f.stop();
});

test("pagehide closes presence and BFCache pageshow reconnects without duplicate sessions", async () => {
  const f = fixture(); await flush(); f.sockets[0].socket.open();
  f.events.dispatchEvent(new Event("pagehide"));
  assert.equal(f.sockets[0].socket.readyState, 3);
  f.events.dispatchEvent(new Event("pageshow")); await flush();
  assert.equal(f.sockets.length, 2);
  f.stop();
});

test("logout while an ID token is loading never opens a stale account connection", async () => {
  let resolveToken;
  const f = fixture(() => new Promise((resolve) => { resolveToken = resolve; }));
  f.stop(); resolveToken("old-token"); await flush();
  assert.equal(f.sockets.length, 0); assert.equal(f.timers.size, 0);
  f.events.dispatchEvent(new Event("online")); await flush(); assert.equal(f.sockets.length, 0);
});

test("missing pong expires a connection and never shows stale online numbers", async () => {
  const f = fixture(); await flush();
  const socket = f.sockets[0].socket; socket.open(); socket.message('{"type":"online-count","count":2}');
  f.advance(90_000);
  assert.equal(socket.readyState, 3);
  assert.deepEqual(f.states.at(-1), { status: "unavailable", count: null });
  f.stop();
});

test("failed connections back off instead of continuously requesting the server", async () => {
  const f = fixture(); await flush(); f.sockets[0].socket.fail();
  f.advance(999); await flush(); assert.equal(f.sockets.length, 1);
  f.advance(1); await flush(); assert.equal(f.sockets.length, 2);
  f.sockets[1].socket.fail(); f.advance(1999); await flush(); assert.equal(f.sockets.length, 2);
  f.advance(1); await flush(); assert.equal(f.sockets.length, 3);
  f.stop();
});

test("pending authentication timeout ignores late tokens and leaves no timers after cleanup", async () => {
  let resolveToken;
  const f = fixture(() => new Promise((resolve) => { resolveToken = resolve; }));
  f.advance(20_000);
  assert.deepEqual(f.states.at(-1), { status: "unavailable", count: null });
  resolveToken("late-token"); await flush(); assert.equal(f.sockets.length, 0);
  f.stop(); assert.equal(f.timers.size, 0);
});
