/**
 * 每個請求共用的東西：服務帳號、Firestore 客戶端、平台狀態。
 */
import { verifyRequestToken } from "./auth/verifyIdToken";
import { FirestoreClient, SERVER_TIMESTAMP } from "./google/firestore";
import { loadServiceAccount, type ServiceAccount } from "./google/serviceAccount";

export type PlatformMode = "practice" | "contest" | "maintenance";

export interface PlatformState {
  mode: PlatformMode;
  activeContestIds: string[];
  /** 演練賽：練習模式下也開放這些賽事的競賽帳號登入作答。 */
  rehearsalContestIds: string[];
  announcement: string;
}

/** 目前對競賽帳號開放的賽事：競賽模式的啟用賽事，加上任何模式下的演練賽事。 */
export function openContestIds(platform: PlatformState): string[] {
  const ids = platform.mode === "contest" ? [...platform.activeContestIds] : [];
  for (const id of platform.rehearsalContestIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface ContestDoc {
  title: string;
  year: string;
  status: string;
  division?: string;
  startAt?: string;
  endAt?: string;
  maxSubmissionsPerProblem?: number;
  accountCount?: number;
  problemCount?: number;
}

export interface ContestAccountDoc {
  contestId: string;
  username: string;
  name: string;
  schoolId: string;
  schoolName: string;
  schoolSeq?: number;
  note?: string;
  status: "active" | "disabled";
  uid: string;
  batchId?: string;
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
      rehearsalContestIds: Array.isArray(data.rehearsalContestIds) ? (data.rehearsalContestIds as string[]) : [],
      announcement: typeof data.announcement === "string" ? data.announcement : "",
    };
  }

  async getContest(contestId: string) {
    return this.db.getDoc<ContestDoc>(`contests/${contestId}`);
  }

  /** 超管專用路由：驗 ID token，再確認 admins/{uid}.role == super 且未停用。 */
  async requireSuperAdmin(request: Request): Promise<{ uid: string; name: string }> {
    const verified = await verifyRequestToken(request, this.projectId);
    if (!verified) {
      throw new HttpError(401, "unauthorized", "請先以超級管理者登入");
    }
    if (verified.claims.accountType === "contest") {
      throw new HttpError(403, "forbidden", "競賽帳號不能執行此操作");
    }
    const admin = await this.db.getDoc<{ role?: string; status?: string; displayName?: string }>(`admins/${verified.uid}`);
    const role = admin?.data.role;
    const isSuper = admin && (!role || role === "super") && admin.data.status !== "disabled";
    if (!isSuper) {
      throw new HttpError(403, "forbidden", "只有超級管理者可以執行此操作");
    }
    return { uid: verified.uid, name: String(admin.data.displayName || verified.claims.name || verified.uid) };
  }

  async writeAuditLog(actor: { uid: string; name: string }, entry: { action: string; targetType: string; targetId: string; summary: string }) {
    await this.db.setDoc(`auditLogs/${crypto.randomUUID()}`, {
      ...entry,
      actorUid: actor.uid,
      actorName: actor.name,
      via: "worker",
      createdAt: SERVER_TIMESTAMP,
    });
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
