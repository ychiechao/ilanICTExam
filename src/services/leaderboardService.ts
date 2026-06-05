import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, GradeResult, LeaderboardEntry, Problem, SubmissionRecord } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

const LOCAL_LEADERBOARD_KEY = "yilan-contest-leaderboards";
const GLOBAL_LEADERBOARD_ID = "global";

type LeaderboardMap = Record<string, LeaderboardEntry[]>;

export async function loadLeaderboard(problemId: string): Promise<LeaderboardEntry[]> {
  if (db) {
    try {
      const snapshot = await withRemoteTimeout(
        getDoc(doc(db, "leaderboards", problemId)),
        "Firestore 排行榜讀取",
      );
      if (snapshot.exists()) {
        return sortEntries((snapshot.data().entries || []) as LeaderboardEntry[]);
      }
    } catch {
      console.info("Firestore 排行榜暫時無法讀取，已改用本機排行榜。");
    }
  }

  const all = readJson<LeaderboardMap>(LOCAL_LEADERBOARD_KEY, {});
  return sortEntries(all[problemId] || []);
}

export async function updateLeaderboard(
  user: AppUser,
  problem: Problem,
  result: GradeResult,
) {
  const current = await loadLeaderboard(problem.id);
  const existing = current.find((entry) => entry.uid === user.uid);
  const nextEntry: LeaderboardEntry = {
    uid: user.uid,
    displayName: user.displayName,
    score: result.score,
    maxScore: result.maxScore,
    passRate: result.passRate,
    elapsedMs: result.elapsedMs,
    submitCount: (existing?.submitCount || 0) + 1,
    updatedAt: result.createdAt,
  };

  const merged = sortEntries([
    ...current.filter((entry) => entry.uid !== user.uid),
    betterEntry(existing, nextEntry),
  ]).slice(0, 50);

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "leaderboards", problem.id), {
        problemId: problem.id,
        problemTitle: problem.title,
        entries: merged,
        updatedAt: result.createdAt,
      }),
      "Firestore 排行榜更新",
    );
  } else {
    const all = readJson<LeaderboardMap>(LOCAL_LEADERBOARD_KEY, {});
    writeJson(LOCAL_LEADERBOARD_KEY, { ...all, [problem.id]: merged });
  }

  return merged;
}

export async function loadGlobalLeaderboard(): Promise<LeaderboardEntry[]> {
  if (db) {
    try {
      const snapshot = await withRemoteTimeout(
        getDoc(doc(db, "leaderboards", GLOBAL_LEADERBOARD_ID)),
        "Firestore 全站排行榜讀取",
      );
      if (snapshot.exists()) {
        return sortGlobalEntries((snapshot.data().entries || []) as LeaderboardEntry[]);
      }
    } catch {
      console.info("Firestore 全站排行榜暫時無法讀取，已改用本機排行榜。");
    }
  }

  const all = readJson<LeaderboardMap>(LOCAL_LEADERBOARD_KEY, {});
  return sortGlobalEntries(all[GLOBAL_LEADERBOARD_ID] || []);
}

export async function updateGlobalLeaderboard(
  user: AppUser,
  problems: Problem[],
  submissions: SubmissionRecord[],
) {
  const publishedProblems = problems.filter((problem) => problem.status === "published");
  const current = await loadGlobalLeaderboard();
  const userSubmissions = submissions.filter((record) => (record.uid || "guest") === user.uid);
  const bestByProblem = new Map<string, SubmissionRecord>();

  for (const record of userSubmissions) {
    bestByProblem.set(record.problemId, betterSubmission(bestByProblem.get(record.problemId), record));
  }

  const bestRecords = publishedProblems
    .map((problem) => bestByProblem.get(problem.id))
    .filter((record): record is SubmissionRecord => Boolean(record));
  const totalMaxScore = publishedProblems.reduce((sum, problem) => sum + getProblemMaxScore(problem), 0);
  const totalScore = bestRecords.reduce((sum, record) => sum + record.score, 0);
  const completedRecords = bestRecords.filter(isFullScoreSubmission);
  const completedAt = completedRecords
    .map((record) => record.solveCompletedAt || record.createdAt)
    .sort()[0];
  const submittedTimes = userSubmissions
    .map((record) => record.createdAt)
    .sort();
  const lastSubmittedAt = submittedTimes[submittedTimes.length - 1];
  const passRate =
    publishedProblems.length === 0
      ? 0
      : publishedProblems.reduce((sum, problem) => sum + (bestByProblem.get(problem.id)?.passRate || 0), 0) /
        publishedProblems.length;

  const nextEntry: LeaderboardEntry = {
    uid: user.uid,
    displayName: user.displayName,
    score: totalScore,
    maxScore: totalMaxScore,
    passRate,
    elapsedMs: completedRecords.reduce((sum, record) => sum + (record.solveDurationMs || record.elapsedMs || 0), 0),
    submitCount: userSubmissions.length,
    updatedAt: lastSubmittedAt || new Date().toISOString(),
    completedCount: completedRecords.length,
    totalProblems: publishedProblems.length,
    totalScore,
    totalMaxScore,
    ...(completedAt ? { completedAt } : {}),
    ...(lastSubmittedAt ? { lastSubmittedAt } : {}),
  };

  const merged = sortGlobalEntries([
    ...current.filter((entry) => entry.uid !== user.uid),
    nextEntry,
  ]).slice(0, 100);

  if (db) {
    await withRemoteTimeout(
      setDoc(doc(db, "leaderboards", GLOBAL_LEADERBOARD_ID), {
        problemId: GLOBAL_LEADERBOARD_ID,
        problemTitle: "全站總排行",
        entries: merged,
        updatedAt: nextEntry.updatedAt,
      }),
      "Firestore 全站排行榜更新",
    );
  } else {
    const all = readJson<LeaderboardMap>(LOCAL_LEADERBOARD_KEY, {});
    writeJson(LOCAL_LEADERBOARD_KEY, { ...all, [GLOBAL_LEADERBOARD_ID]: merged });
  }

  return merged;
}

export async function removeUserFromLeaderboards(uid: string) {
  if (db) {
    const snapshot = await withRemoteTimeout(
      getDocs(collection(db, "leaderboards")),
      "Firestore 排行榜清理",
    );
    const updatedAt = new Date().toISOString();
    await Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data();
        const entries = ((data.entries || []) as LeaderboardEntry[]).filter(
          (entry) => entry.uid !== uid,
        );
        return withRemoteTimeout(
          setDoc(item.ref, { ...data, entries, updatedAt }, { merge: true }),
          "Firestore 排行榜更新",
        );
      }),
    );
    return;
  }

  const all = readJson<LeaderboardMap>(LOCAL_LEADERBOARD_KEY, {});
  writeJson(
    LOCAL_LEADERBOARD_KEY,
    Object.fromEntries(
      Object.entries(all).map(([key, entries]) => [
        key,
        entries.filter((entry) => entry.uid !== uid),
      ]),
    ),
  );
}

function betterEntry(current: LeaderboardEntry | undefined, incoming: LeaderboardEntry) {
  if (!current) {
    return incoming;
  }
  return compareEntries(incoming, current) < 0 ? incoming : current;
}

function sortEntries(entries: LeaderboardEntry[]) {
  return [...entries].sort(compareEntries);
}

function sortGlobalEntries(entries: LeaderboardEntry[]) {
  return [...entries].sort(compareGlobalEntries);
}

function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry) {
  if (b.passRate !== a.passRate) {
    return b.passRate - a.passRate;
  }
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.elapsedMs !== b.elapsedMs) {
    return a.elapsedMs - b.elapsedMs;
  }
  if (a.submitCount !== b.submitCount) {
    return a.submitCount - b.submitCount;
  }
  return a.updatedAt.localeCompare(b.updatedAt);
}

function compareGlobalEntries(a: LeaderboardEntry, b: LeaderboardEntry) {
  if (b.passRate !== a.passRate) {
    return b.passRate - a.passRate;
  }
  if ((b.completedCount || 0) !== (a.completedCount || 0)) {
    return (b.completedCount || 0) - (a.completedCount || 0);
  }
  if ((b.totalScore || b.score) !== (a.totalScore || a.score)) {
    return (b.totalScore || b.score) - (a.totalScore || a.score);
  }

  const aCompletedAt = a.completedAt || "9999-12-31T23:59:59.999Z";
  const bCompletedAt = b.completedAt || "9999-12-31T23:59:59.999Z";
  if (aCompletedAt !== bCompletedAt) {
    return aCompletedAt.localeCompare(bCompletedAt);
  }
  if (a.submitCount !== b.submitCount) {
    return a.submitCount - b.submitCount;
  }
  return a.displayName.localeCompare(b.displayName, "zh-Hant", { numeric: true });
}

function betterSubmission(current: SubmissionRecord | undefined, incoming: SubmissionRecord) {
  if (!current) {
    return incoming;
  }
  if (incoming.passRate !== current.passRate) {
    return incoming.passRate > current.passRate ? incoming : current;
  }
  if (incoming.score !== current.score) {
    return incoming.score > current.score ? incoming : current;
  }
  if (incoming.elapsedMs !== current.elapsedMs) {
    return incoming.elapsedMs < current.elapsedMs ? incoming : current;
  }
  return incoming.createdAt < current.createdAt ? incoming : current;
}

function getProblemMaxScore(problem: Problem) {
  return problem.cases.reduce((sum, item) => sum + item.score, 0);
}

function isFullScoreSubmission(record: SubmissionRecord) {
  return (
    record.maxScore > 0 &&
    record.status === "accepted" &&
    record.totalCases > 0 &&
    record.passedCases === record.totalCases &&
    record.score >= record.maxScore
  );
}
