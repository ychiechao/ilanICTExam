import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, GradeResult, LeaderboardEntry, Problem } from "../types";
import { withRemoteTimeout } from "./remote";
import { readJson, writeJson } from "./storage";

const LOCAL_LEADERBOARD_KEY = "yilan-contest-leaderboards";

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
    } catch (error) {
      console.warn("Firestore 排行榜讀取失敗，改用本機排行榜。", error);
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

function betterEntry(current: LeaderboardEntry | undefined, incoming: LeaderboardEntry) {
  if (!current) {
    return incoming;
  }
  return compareEntries(incoming, current) < 0 ? incoming : current;
}

function sortEntries(entries: LeaderboardEntry[]) {
  return [...entries].sort(compareEntries);
}

function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry) {
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
