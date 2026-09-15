/**
 * 簽發 Firebase 自訂 token，client 用 signInWithCustomToken() 登入。
 * 格式依 Firebase Admin SDK：iss/sub 為服務帳號、aud 固定為 Identity Toolkit、
 * 有效期最多 1 小時，claims 放在 "claims" 欄位，之後在 Rules 以 request.auth.token.* 讀取。
 */
import { signJwt, type ServiceAccount } from "../google/serviceAccount";

const CUSTOM_TOKEN_AUD = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

export interface ContestClaims {
  accountType: "contest";
  contestId: string;
  username: string;
  schoolId: string;
  displayName: string;
}

export async function createCustomToken(account: ServiceAccount, uid: string, claims: ContestClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(account, {
    iss: account.client_email,
    sub: account.client_email,
    aud: CUSTOM_TOKEN_AUD,
    iat: now,
    exp: now + 3600,
    uid,
    claims,
  });
}

/** 競賽帳號的 Firebase uid 固定由賽事與帳號組成，重新登入不會產生新使用者。 */
export function contestUid(contestId: string, username: string) {
  return `contest_${contestId}_${username}`;
}
