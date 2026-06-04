export type ProblemVisibility = "public" | "hidden";
export type ProblemStatus = "published" | "draft" | "archived";
export type WorkspaceMode = "Blockly" | "Scratch";

export interface ExampleCase {
  title: string;
  input: string;
  output: string;
  description?: string;
}

export interface ProblemCase {
  groupTitle: string;
  caseTitle: string;
  input: string;
  output: string;
  score: number;
  visibility: ProblemVisibility;
}

export interface Problem {
  id: string;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  status: ProblemStatus;
  examples: ExampleCase[];
  cases: ProblemCase[];
  toolboxConfig?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface CaseResult {
  caseTitle: string;
  groupTitle: string;
  input: string;
  expected: string;
  actual: string;
  score: number;
  earnedScore: number;
  passed: boolean;
  error?: string;
}

export interface GradeResult {
  score: number;
  maxScore: number;
  passedCases: number;
  totalCases: number;
  passRate: number;
  status: "accepted" | "partial" | "failed" | "error";
  elapsedMs: number;
  cases: CaseResult[];
  createdAt: string;
}

export interface SubmissionRecord extends GradeResult {
  id: string;
  uid?: string;
  displayName: string;
  problemId: string;
  problemTitle: string;
  mode: WorkspaceMode;
  blocklyXml: string;
  generatedCode: string;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  score: number;
  maxScore: number;
  passRate: number;
  elapsedMs: number;
  submitCount: number;
  updatedAt: string;
}

export interface AppUser {
  uid: string;
  displayName: string;
  email?: string | null;
  photoURL?: string | null;
  isAnonymous?: boolean;
}
