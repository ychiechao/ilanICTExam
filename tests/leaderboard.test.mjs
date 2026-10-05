import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadModule(path) {
  const { outputFiles } = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    entryPoints: [fileURLToPath(new URL(`../${path}`, import.meta.url))],
    tsconfigRaw: {},
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "local-fixtures-only",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/firebase$/ }, () => ({ path: "firebase-test", namespace: "fixture" }));
        builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore-test", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "firebase-test"
          ? "export const db = null;"
          : "export const collection = unexpectedRemoteCall, deleteDoc = unexpectedRemoteCall, doc = unexpectedRemoteCall, documentId = unexpectedRemoteCall, getDoc = unexpectedRemoteCall, getDocs = unexpectedRemoteCall, limit = unexpectedRemoteCall, orderBy = unexpectedRemoteCall, query = unexpectedRemoteCall, setDoc = unexpectedRemoteCall, startAfter = unexpectedRemoteCall, where = unexpectedRemoteCall, writeBatch = unexpectedRemoteCall; function unexpectedRemoteCall() { throw new Error('Tests must not access Firestore'); }",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

const rules = await loadModule("src/utils/leaderboard.ts");
const service = await loadModule("src/services/leaderboardService.ts");
const schoolStore = await loadModule("src/services/schoolStore.ts");
const schools = [
  { id: "elementary", name: "大福國小", domains: [] },
  { id: "junior", name: "宜蘭國民中學", domains: [] },
  { id: "special", name: "實驗學校", division: "J", domains: [] },
  { id: "other", name: "其他國中", division: "unclassified", domains: [] },
];
const schoolMap = new Map(schools.map((school) => [school.id, school]));

function entry(uid, overrides = {}) {
  return {
    uid, displayName: uid, role: "student", schoolId: "junior", schoolName: "宜蘭國民中學", classIds: ["class-1"],
    score: 100, maxScore: 100, totalScore: 100, passRate: 1, completedCount: 1, submitCount: 1,
    elapsedMs: 0, updatedAt: "2026-10-05T00:00:00.000Z", ...overrides,
  };
}

function localFixture(entries = []) {
  const data = new Map([["yilan-practice-user-stats", JSON.stringify(Object.fromEntries(entries.map((item) => [item.uid, item])))]]);
  globalThis.localStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("only students participate, including legacy roles and pending teacher accounts", () => {
  assert.equal(rules.isRankedRole("student"), true);
  assert.equal(rules.isRankedRole(undefined), true);
  for (const role of ["teacher", "super", "school"]) assert.equal(rules.isRankedRole(role), false);
  assert.equal(rules.isRankedAccount({ email: "student@smail.ilc.edu.tw" }, "student"), true);
  assert.equal(rules.isRankedAccount({ email: " Teacher@TMAIL.ILC.EDU.TW " }, "student"), false);
  assert.equal(rules.isRankedAccount({ email: "student@smail.ilc.edu.tw" }, "super"), false);
});

test("school division supports existing names, overrides, and unclassified schools", () => {
  for (const name of ["大福國小", "宜蘭縣大福國民小學"]) assert.equal(rules.inferSchoolDivision(name), "E");
  for (const name of ["宜蘭國中", "宜蘭國民中學"]) assert.equal(rules.inferSchoolDivision(name), "J");
  for (const name of ["實驗學校", "國民中小學", "國中暨國小"]) assert.equal(rules.inferSchoolDivision(name), undefined);
  assert.equal(rules.getSchoolDivision(schools[2]), "J");
  assert.equal(rules.getSchoolDivision(schools[3]), undefined);
  assert.equal(rules.getSchoolDivision({ ...schools[0], division: "J" }), "J");
});

test("county, school, and class scopes all respect divisions and excluded roles", () => {
  const junior = entry("student");
  const unknown = entry("unknown", { schoolId: "missing", schoolName: "未分類學校" });
  assert.equal(rules.matchesLeaderboardEntry(junior, { kind: "county" }, "J", schoolMap), true);
  assert.equal(rules.matchesLeaderboardEntry(junior, { kind: "county" }, "E", schoolMap), false);
  assert.equal(rules.matchesLeaderboardEntry(junior, { kind: "school", schoolId: "junior" }, "J", schoolMap), true);
  assert.equal(rules.matchesLeaderboardEntry(junior, { kind: "school", schoolId: "elementary" }, "all", schoolMap), false);
  assert.equal(rules.matchesLeaderboardEntry(junior, { kind: "class", classId: "class-1" }, "J", schoolMap), true);
  assert.equal(rules.matchesLeaderboardEntry(junior, { kind: "class", classId: "class-2" }, "all", schoolMap), false);
  assert.equal(rules.matchesLeaderboardEntry(unknown, { kind: "county" }, "all", schoolMap), true);
  assert.equal(rules.matchesLeaderboardEntry(unknown, { kind: "county" }, "J", schoolMap), false);
  for (const role of ["teacher", "super", "school"]) {
    assert.equal(rules.matchesLeaderboardEntry(entry(role, { role }), { kind: "county" }, "all", schoolMap), false);
  }
});

test("group filtering happens before the top-100 limit, even beyond the first page", async () => {
  const rows = Array.from({ length: 400 }, (_, i) => entry(`user-${i}`, {
    role: i < 50 ? "teacher" : "student",
    schoolId: i < 150 ? "elementary" : "junior",
    passRate: (500 - i) / 500,
  }));
  let reads = 0;
  const ranked = await rules.collectLeaderboardPages(async (cursor = 0) => {
    reads++;
    return { entries: rows.slice(cursor, cursor + 100), nextCursor: cursor + 100 < rows.length ? cursor + 100 : undefined };
  }, (row) => rules.matchesLeaderboardEntry(row, { kind: "county" }, "J", schoolMap), 100);
  assert.equal(ranked.length, 100);
  assert.equal(ranked[0].uid, "user-150");
  assert.equal(ranked[99].uid, "user-249");
  assert.equal(reads, 3);
});

test("ties across pages use the completion-time tie breaker before applying the limit", async () => {
  const rows = Array.from({ length: 200 }, (_, i) => entry(`user-${i}`, { completedAt: new Date(Date.UTC(2026, 9, 5, 0, 0, 200 - i)).toISOString() }));
  const ranked = await rules.collectLeaderboardPages(async (cursor = 0) => ({
    entries: rows.slice(cursor, cursor + 100), nextCursor: cursor + 100 < rows.length ? cursor + 100 : undefined,
  }), () => true, 100);
  assert.equal(ranked[0].uid, "user-199");
  assert.equal(ranked[99].uid, "user-100");
});

test("local leaderboard excludes staff, computes group ranks, and uses current school settings", async () => {
  localFixture([
    entry("teacher", { role: "teacher" }), entry("super", { role: "super" }),
    entry("junior", { passRate: 0.9 }), entry("elementary", { schoolId: "elementary", schoolName: "大福國小", passRate: 0.8 }),
    entry("unknown", { schoolId: "missing", schoolName: "未分類學校", passRate: 0.7 }),
  ]);
  assert.deepEqual((await service.loadLeaderboardScope({ kind: "county" }, "all", schools)).map((item) => item.uid), ["junior", "elementary", "unknown"]);
  assert.deepEqual((await service.loadLeaderboardScope({ kind: "county" }, "J", schools)).map((item) => item.uid), ["junior"]);
  assert.deepEqual((await service.loadLeaderboardScope({ kind: "county" }, "E", schools)).map((item) => item.uid), ["elementary"]);
  assert.deepEqual((await service.loadLeaderboardScope({ kind: "county" }, "J", [{ ...schools[0], division: "J" }, ...schools.slice(1)])).map((item) => item.uid), ["junior", "elementary"]);
  await service.syncUserStatsMembership("junior", { schoolId: "elementary", schoolName: "大福國小" });
  const transferred = await service.loadLeaderboardScope({ kind: "class", classId: "class-1" }, "E", schools);
  assert.deepEqual(transferred.map((item) => item.uid), ["junior", "elementary"]);
});

test("teacher submissions keep personal scores but remove existing ranking summaries", async () => {
  localFixture([entry("teacher")]);
  const stats = service.computeUserStats({ uid: "teacher", displayName: "教師", email: "teacher@tmail.ilc.edu.tw" }, [], [], { classIds: [] }, "student");
  assert.equal(stats.role, "teacher");
  await service.saveUserStats(stats);
  assert.equal((await service.loadLeaderboardScope({ kind: "county" })).length, 0);
});

test("legacy cleanup identifies staff using authoritative profiles even when ranking role says student", async () => {
  localFixture([entry("student"), entry("pending"), entry("disabled-teacher"), entry("super")]);
  const users = [{ uid: "student", displayName: "學生", role: "student" }, { uid: "pending", displayName: "待確認教師", role: "student", email: "pending@tmail.ilc.edu.tw" }];
  const admins = [{ uid: "disabled-teacher", displayName: "停用教師", role: "teacher", status: "disabled" }, { uid: "super", displayName: "超管", role: "super" }];
  assert.deepEqual([...(rules.getUnrankedUserIds(users, admins))].sort(), ["disabled-teacher", "pending", "super"]);
  assert.deepEqual(await service.pruneUnrankedUserStats(users, admins), { removed: 3 });
  assert.deepEqual((await service.loadLeaderboardScope({ kind: "county" })).map((item) => item.uid), ["student"]);
  assert.deepEqual(await service.pruneUnrankedUserStats(users, admins), { removed: 0 });
});

test("school persistence preserves explicit division and allows returning to automatic classification", async () => {
  localFixture();
  await schoolStore.saveSchool(schools[2]);
  assert.equal((await schoolStore.loadSchools())[0].division, "J");
  await schoolStore.saveSchool({ ...schools[2], division: undefined });
  assert.equal((await schoolStore.loadSchools())[0].division, undefined);
});
