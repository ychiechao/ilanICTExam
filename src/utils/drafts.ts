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
    waiting: "active",
    active: "ended",
    paused: "active",
    ended: "review",
    review: "published",
    published: "archived",
  };
  return transitions[status];
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
