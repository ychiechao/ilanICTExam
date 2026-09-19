export type ProblemVisibility = "public" | "hidden";
export type ProblemStatus = "published" | "draft" | "archived";
export type WorkspaceMode = "Blockly" | "Scratch";
export type ContestStatus =
  | "draft"
  | "roster"
  | "waiting"
  | "active"
  | "paused"
  | "ended"
  | "review"
  | "published"
  | "archived";
export type ContestMode = "practice" | "contest" | "hybrid";
export type UserRole = "super" | "teacher" | "student";
export type AdminRole = "super" | "teacher";
export type AccountStatus = "pending" | "active" | "disabled";
export type SchoolSource = "self" | "admin" | "class";
export type ClassMemberStatus = "active" | "removed";

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
  year?: string;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  categories?: string[];
  status: ProblemStatus;
  examples: ExampleCase[];
  cases: ProblemCase[];
  source?: string;
  sourceId?: string;
  sourceUrls?: Record<string, string>;
  imageSources?: string[];
  toolboxConfig?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface CaseResult {
  caseTitle: string;
  groupTitle: string;
  visibility: ProblemVisibility;
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
  message?: string;
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
  solveStartedAt?: string;
  solveCompletedAt?: string;
  solveDurationMs?: number;
  isFullScore?: boolean;
}

/** userProblemStats/{uid}_{problemId}：每位使用者每題的彙總，後台統計用，不含程式碼。 */
export interface UserProblemStat {
  uid: string;
  problemId: string;
  displayName?: string;
  bestScore: number;
  bestPassRate: number;
  submitCount: number;
  isCompleted: boolean;
  completedAt?: string;
  bestSolveDurationMs?: number;
  updatedAt?: string;
}

/** 排行榜範圍：全縣、學校、班級（計畫 4.2）。 */
export type LeaderboardScope = { kind: "county" } | { kind: "school"; schoolId: string } | { kind: "class"; classId: string };

/** userStats/{uid}：每位使用者的練習彙總，也是排行榜的一列。 */
export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  schoolId?: string;
  schoolName?: string;
  /** 已加入的班級（array-contains 查班級排行）。 */
  classIds?: string[];
  score: number;
  maxScore: number;
  passRate: number;
  elapsedMs: number;
  submitCount: number;
  updatedAt: string;
  completedCount?: number;
  totalProblems?: number;
  totalScore?: number;
  totalMaxScore?: number;
  completedAt?: string;
  lastSubmittedAt?: string;
}

export interface AppUser {
  uid: string;
  displayName: string;
  email?: string | null;
  photoURL?: string | null;
  isAnonymous?: boolean;
  disabled?: boolean;
  /** 競賽帳號由 Worker 簽發的自訂 token 登入，claims 帶在 ID token 內。 */
  accountType?: "google" | "contest";
  contestId?: string;
  contestUsername?: string;
  schoolId?: string;
}

export interface ManagedUser {
  uid: string;
  displayName: string;
  email?: string | null;
  photoURL?: string | null;
  role?: UserRole;
  status?: AccountStatus;
  emailDomain?: string;
  schoolId?: string;
  schoolName?: string;
  schoolVerified?: boolean;
  schoolSource?: SchoolSource;
  lastLoginAt?: unknown;
  disabled?: boolean;
  disabledAt?: unknown;
  disabledBy?: string;
}

export interface AdminProfile {
  uid: string;
  displayName: string;
  email?: string | null;
  role: AdminRole;
  status?: AccountStatus;
  schoolId?: string;
  schoolName?: string;
  schoolIds?: string[];
  schoolVerified?: boolean;
  schoolSource?: SchoolSource;
  updatedAt?: unknown;
  updatedBy?: string;
}

export interface ContestEvent {
  id: string;
  title: string;
  year: string;
  status: ContestStatus;
  mode: ContestMode;
  description?: string;
  startAt?: string;
  endAt?: string;
  registrationStartAt?: string;
  registrationEndAt?: string;
  problemIds: string[];
  participantCount?: number;
  schoolCount?: number;
  rosterNote?: string;
  resultNote?: string;
  /** 組別代碼：E 國小、J 國中；競賽帳號前綴用。 */
  division?: string;
  /** 每題提交上限，預設 10。 */
  maxSubmissionsPerProblem?: number;
  /** 比賽長度（分鐘）；主辦單位按「開始」時用它算出 endAt。 */
  durationMinutes?: number;
  /** 暫停中的時間點；繼續時把暫停的長度加回 endAt。 */
  pausedAt?: string;
  /** 已匯入的競賽帳號數與題數；由 Worker 匯入時寫入，切換競賽模式前檢查用。 */
  accountCount?: number;
  problemCount?: number;
  casesSyncedAt?: string;
  dashboard?: ContestDashboardSettings;
  publishedAt?: string;
  releasedToPractice?: boolean;
  /** 封存前的階段；解封存時回到這裡（沒有就回正式公布）。 */
  archivedFromStatus?: ContestStatus;
  createdAt?: string;
  updatedAt?: string;
}

export type DashboardVisibility = "organizer" | "participants" | "public";

export interface ContestDashboardSettings {
  visibility: DashboardVisibility;
  showNames: boolean;
  topN: number;
  /** 投影用畫面的 token；重新產生即讓舊連結失效。 */
  boardToken?: string;
}

export type ContestAccountStatus = "active" | "disabled";

/** contestAccounts：主辦單位匯入的競賽帳號（密碼雜湊存 KV，不在這裡）。 */
export interface ContestAccount {
  id: string;
  contestId: string;
  username: string;
  name: string;
  schoolId: string;
  schoolName: string;
  /** 同場、同校內的序號，從 1 起算。 */
  schoolSeq?: number;
  note?: string;
  status: ContestAccountStatus;
  uid: string;
  firstLoginAt?: string;
  lastLoginAt?: string;
  deviceFingerprint?: string;
  batchId?: string;
  createdAt?: string;
  createdBy?: string;
}

export interface School {
  id: string;
  name: string;
  domains: string[];
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LearningClass {
  id: string;
  name: string;
  schoolId: string;
  schoolName: string;
  teacherUid: string;
  teacherName: string;
  joinCode: string;
  joinEnabled: boolean;
  archived?: boolean;
  memberCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClassMember {
  id: string;
  classId: string;
  className: string;
  schoolId: string;
  schoolName: string;
  teacherUid: string;
  teacherName: string;
  studentUid: string;
  studentName: string;
  studentEmail?: string | null;
  status: ClassMemberStatus;
  joinedAt?: string;
  updatedAt?: string;
}

export interface ClassSubmissionView {
  id: string;
  classId: string;
  className: string;
  classMemberId: string;
  teacherUid: string;
  studentUid: string;
  studentName: string;
  studentEmail?: string | null;
  submissionId: string;
  problemId: string;
  problemTitle: string;
  mode: WorkspaceMode;
  score: number;
  maxScore: number;
  passRate: number;
  status: GradeResult["status"];
  isFullScore?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export type PlatformMode = "practice" | "contest" | "maintenance";

/** settings/platform：全站模式的唯一真相來源（規格 4.2）。 */
export interface PlatformState {
  mode: PlatformMode;
  activeContestIds: string[];
  announcement: string;
  updatedAt?: string;
  updatedBy?: string;
}

export type AuditAction =
  | "platform.mode"
  | "contest.status"
  | "contest.save"
  | "contest.accounts.import"
  | "contest.problems.import"
  | "contest.dashboard"
  | "contest.void"
  | "contest.release"
  | "maintenance.backfill";

/** auditLogs：超管操作紀錄，只能新增不能改刪（規格 8.10）。 */
export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  summary: string;
  actorUid: string;
  actorName: string;
  createdAt?: string;
}
