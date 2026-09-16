import { contestStatusFlow } from "../app/constants";
import type { ContestEvent, ContestStatus, Problem, School } from "../types";

export function cloneProblem(problem: Problem): Problem {
  return JSON.parse(JSON.stringify(problem)) as Problem;
}

export function cloneContest(contest: ContestEvent): ContestEvent {
  return JSON.parse(JSON.stringify(contest)) as ContestEvent;
}

export function cloneSchool(school: School): School {
  return JSON.parse(JSON.stringify(school)) as School;
}

export function sanitizeSchoolDraft(school: School): School {
  const now = new Date().toISOString();
  return {
    ...school,
    name: school.name.trim() || "未命名學校",
    domains: Array.from(new Set(school.domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))),
    enabled: school.enabled !== false,
    updatedAt: now,
    createdAt: school.createdAt || now,
  };
}

export function sanitizeContestDraft(contest: ContestEvent): ContestEvent {
  const now = new Date().toISOString();
  return {
    ...contest,
    title: contest.title.trim() || "未命名賽事",
    year: contest.year.trim() || String(new Date().getFullYear()),
    description: contest.description?.trim() || "",
    startAt: contest.startAt || "",
    endAt: contest.endAt || "",
    registrationStartAt: contest.registrationStartAt || "",
    registrationEndAt: contest.registrationEndAt || "",
    problemIds: parseProblemIdText(contest.problemIds.join("\n")),
    participantCount: Math.max(0, Math.round(contest.participantCount || 0)),
    schoolCount: Math.max(0, Math.round(contest.schoolCount || 0)),
    rosterNote: contest.rosterNote?.trim() || "",
    resultNote: contest.resultNote?.trim() || "",
    updatedAt: now,
    createdAt: contest.createdAt || now,
  };
}

export function getContestStatusLabel(status: ContestStatus) {
  return contestStatusFlow.find((item) => item.key === status)?.label || status;
}

export function getContestModeLabel(mode: ContestEvent["mode"]) {
  if (mode === "practice") {
    return "練習活動";
  }
  if (mode === "hybrid") {
    return "競賽＋練習";
  }
  return "正式競賽";
}

export function getNextContestStatus(status: ContestStatus): ContestStatus | undefined {
  const transitions: Partial<Record<ContestStatus, ContestStatus>> = {
    draft: "roster",
    roster: "waiting",
    ended: "review",
    review: "published",
    published: "archived",
  };
  return transitions[status];
}

/** 退回上一階段：比賽開始前可自由退回；賽後審核／公布／封存也可退回一步。 */
export function getPreviousContestStatus(status: ContestStatus): ContestStatus | undefined {
  const transitions: Partial<Record<ContestStatus, ContestStatus>> = {
    roster: "draft",
    waiting: "roster",
    review: "ended",
    published: "review",
    archived: "published",
  };
  return transitions[status];
}

export interface ContestTransition {
  status: ContestStatus;
  label: string;
  /** 有值表示不能執行，內容是原因。 */
  blocked?: string;
  confirm?: string;
  /** 按鈕文字；沒有就用「← label」或「label →」。 */
  buttonLabel?: string;
}

/**
 * 列表上可用的階段按鈕。競賽中／暫停／結束由「平台狀態 → 比賽控制」操作，這裡不提供。
 * 前進要滿足前置條件；退回一步永遠允許（除了進行中）。
 */
export interface ContestTransitions {
  next?: ContestTransition;
  previous?: ContestTransition;
  /** 還沒匯入任何資料的草稿／報名階段可以直接封存（建錯的賽事收起來）。 */
  archive?: ContestTransition;
}

export function getContestTransitions(contest: ContestEvent): ContestTransitions {
  const next = getNextContestStatus(contest.status);
  // 解封存回到封存前的階段（進行中的階段除外），沒有紀錄就回正式公布。
  const restoreStatus =
    contest.archivedFromStatus && contest.archivedFromStatus !== "archived" && contest.archivedFromStatus !== "active" && contest.archivedFromStatus !== "paused"
      ? contest.archivedFromStatus
      : undefined;
  // 舊資料沒有紀錄：從沒匯入過帳號或題庫的賽事回草稿，其他回正式公布。
  const hasData = (contest.accountCount ?? 0) > 0 || (contest.problemCount ?? 0) > 0;
  const previous =
    contest.status === "archived" ? (restoreStatus ?? (hasData ? getPreviousContestStatus("archived") : "draft")) : getPreviousContestStatus(contest.status);
  const result: ContestTransitions = {};

  if (next) {
    const missing: string[] = [];
    if (next === "waiting") {
      if (!(contest.accountCount && contest.accountCount > 0)) missing.push("尚未匯入競賽帳號");
      if (!(contest.problemCount && contest.problemCount > 0)) missing.push("尚未匯入競賽題庫");
      if (!(contest.durationMinutes && contest.durationMinutes > 0)) missing.push("尚未設定比賽長度");
    }
    result.next = {
      status: next,
      label: getContestStatusLabel(next),
      ...(missing.length > 0 ? { blocked: missing.join("、") } : {}),
      ...(next === "archived" ? { confirm: "封存後賽事會從各處的選單消失，之後仍可由超管解封存。確定封存？" } : {}),
      ...(next === "published" ? { confirm: "正式公布後，該場參賽者可以看到最終排行榜。確定公布？" } : {}),
    };
  }
  if (previous) {
    result.previous = {
      status: previous,
      label: getContestStatusLabel(previous),
      ...(contest.status === "published" ? { confirm: "退回審核會讓參賽者暫時看不到最終排行榜。確定？" } : {}),
      ...(contest.status === "archived"
        ? { buttonLabel: "解封存", confirm: `解封存後賽事會回到「${getContestStatusLabel(previous)}」，重新出現在各處的選單。確定？` }
        : {}),
    };
  }
  if ((contest.status === "draft" || contest.status === "roster") && !hasData) {
    result.archive = {
      status: "archived",
      label: getContestStatusLabel("archived"),
      buttonLabel: "封存",
      confirm: "這場賽事還沒匯入任何資料，封存後會從各處的選單消失；之後可再解封存回到目前階段。確定封存？",
    };
  }
  return result;
}

export function parseProblemIdText(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}


export function sanitizeProblemDraft(problem: Problem): Problem {
  const now = new Date().toISOString();
  const output: Problem = {
    id: problem.id,
    title: problem.title.trim() || "未命名題目",
    description: problem.description.trim(),
    inputFormat: problem.inputFormat.trim(),
    outputFormat: problem.outputFormat.trim(),
    difficulty: problem.difficulty,
    category: problem.category.trim() || "未分類",
    status: problem.status,
    examples: (problem.examples || []).map((example, index) => ({
      title: example.title.trim() || `範例 ${index + 1}`,
      input: example.input,
      output: example.output,
      ...(example.description?.trim() ? { description: example.description.trim() } : {}),
    })),
    cases: (problem.cases || []).map((testCase, index) => ({
      groupTitle: testCase.groupTitle.trim() || "測資",
      caseTitle: testCase.caseTitle.trim() || `C${index + 1}`,
      input: testCase.input,
      output: testCase.output,
      score: Math.max(0, Number(testCase.score) || 0),
      visibility: testCase.visibility === "public" ? "public" : "hidden",
    })),
    createdAt: problem.createdAt || now,
    updatedAt: now,
  };

  if (problem.year?.trim()) {
    output.year = problem.year.trim();
  }
  if (problem.categories?.length) {
    output.categories = problem.categories.map((item) => item.trim()).filter(Boolean);
  }
  if (problem.source) {
    output.source = problem.source;
  }
  if (problem.sourceId) {
    output.sourceId = problem.sourceId;
  }
  if (problem.sourceUrls && Object.keys(problem.sourceUrls).length > 0) {
    output.sourceUrls = problem.sourceUrls;
  }
  if (problem.imageSources && problem.imageSources.length > 0) {
    output.imageSources = problem.imageSources;
  }
  if (problem.toolboxConfig !== undefined) {
    output.toolboxConfig = problem.toolboxConfig;
  }
  return output;
}
