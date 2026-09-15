/**
 * 每個請求共用的東西：服務帳號、Firestore 客戶端、平台狀態。
 */
import { FirestoreClient } from "./google/firestore";
import { loadServiceAccount, type ServiceAccount } from "./google/serviceAccount";

export type PlatformMode = "practice" | "contest" | "maintenance";

export interface PlatformState {
  mode: PlatformMode;
  activeContestIds: string[];
  announcement: string;
}

export interface ContestDoc {
  title: string;
  year: string;
  status: string;
  division?: string;
  startAt?: string;
  endAt?: string;
  maxSubmissionsPerProblem?: number;
}

export interface ContestAccountDoc {
  contestId: string;
  username: string;
  name: string;
  schoolId: string;
  schoolName: string;
  status: "active" | "disabled";
  uid: string;
  firstLoginAt?: string;
  lastLoginAt?: string;
  deviceFingerprint?: string;
}

export class RequestContext {
  readonly account: ServiceAccount;
  readonly db: FirestoreClient;
  readonly projectId: string;

  constructor(readonly env: Env) {
    this.account = loadServiceAccount(env);
    this.projectId = env.FIREBASE_PROJECT_ID;
    this.db = new FirestoreClient(this.account, this.projectId);
  }

  async getPlatform(): Promise<PlatformState> {
    const doc = await this.db.getDoc<Partial<PlatformState>>("settings/platform");
    const data = doc?.data ?? {};
    return {
      mode: data.mode === "contest" || data.mode === "maintenance" ? data.mode : "practice",
      activeContestIds: Array.isArray(data.activeContestIds) ? (data.activeContestIds as string[]) : [],
      announcement: typeof data.announcement === "string" ? data.announcement : "",
    };
  }

  async getContest(contestId: string) {
    return this.db.getDoc<ContestDoc>(`contests/${contestId}`);
  }
}

/** 帶 HTTP 狀態與錯誤碼的例外，router 會轉成 JSON 回應。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "bad_request", "請求內容不是有效的 JSON");
  }
}
