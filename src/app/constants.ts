import { CheckCircle2, FileJson, History, Play, Trophy, Upload, UserCircle, Users } from "lucide-react";
import type { ContestStatus, WorkspaceMode } from "../types";

export const APP_TITLE = "宜蘭縣資訊科技創意實作競賽";

export type TabKey = "statement" | "test" | "score" | "history" | "leaderboard" | "account" | "classes" | "admin";
export type PracticeStatus = "completed" | "in-progress" | "not-started";
export type AdminSectionKey = "platform" | "dashboard" | "contests" | "contestAccounts" | "contestProblems" | "schools" | "problems" | "users" | "progress";
export type UserDirectoryRoleFilter = "all" | "teacher" | "student";

export interface PracticeStats {
  status: PracticeStatus;
  bestScore: number;
  maxScore: number;
  bestPassRate: number;
  submitCount: number;
  hasDraft: boolean;
  lastSubmittedAt?: string;
  lastMode?: WorkspaceMode;
}

export const contestStatusFlow: Array<{ key: ContestStatus; label: string; tone: "idle" | "ready" | "active" | "warning" | "done" }> = [
  { key: "draft", label: "草稿", tone: "idle" },
  { key: "roster", label: "報名／名單匯入", tone: "ready" },
  { key: "waiting", label: "等候開始", tone: "ready" },
  { key: "active", label: "競賽中", tone: "active" },
  { key: "paused", label: "暫停", tone: "warning" },
  { key: "ended", label: "結束", tone: "warning" },
  { key: "review", label: "成績審核", tone: "ready" },
  { key: "published", label: "正式公布", tone: "done" },
  { key: "archived", label: "封存", tone: "idle" },
];

export const tabs: Array<{ key: TabKey; label: string; icon: typeof Play }> = [
  { key: "statement", label: "題目說明", icon: FileJson },
  { key: "test", label: "自行測試", icon: Play },
  { key: "score", label: "評分", icon: CheckCircle2 },
  { key: "history", label: "評分紀錄", icon: History },
  { key: "leaderboard", label: "排行榜", icon: Trophy },
  { key: "account", label: "我的帳號", icon: UserCircle },
  { key: "classes", label: "我的班級", icon: Users },
  { key: "admin", label: "管理", icon: Upload },
];

export const defaultImportJson = JSON.stringify(
  {
    title: "範例題目",
    description: "請輸入兩個數字並輸出總和。",
    inputFormat: "兩個整數。",
    outputFormat: "兩數總和。",
    difficulty: "easy",
    category: "運算",
    examples: [{ title: "範例一", input: "3 5", output: "8" }],
    cases: [
      {
        groupTitle: "公開測資",
        caseTitle: "C1",
        input: "3 5",
        output: "8",
        score: 10,
        visibility: "public",
      },
      {
        groupTitle: "練習測資",
        caseTitle: "C2",
        input: "10 11",
        output: "21",
        score: 10,
        visibility: "hidden",
      },
    ],
  },
  null,
  2,
);

