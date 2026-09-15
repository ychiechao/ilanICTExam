

export function getLoginErrorMessage(error: unknown) {
  const code = getErrorCode(error);

  if (code === "auth/cancelled-popup-request") {
    return "登入視窗已被新的登入要求取消，請稍等一下再按一次。";
  }
  if (code === "auth/popup-closed-by-user") {
    return "你已關閉登入視窗，若要登入請再按一次 Gmail 登入。";
  }
  if (code === "auth/popup-blocked") {
    return "瀏覽器封鎖了登入視窗，請允許彈出視窗後再試一次。";
  }

  return error instanceof Error ? error.message : "登入失敗。";
}

export function getFirebaseAdminErrorMessage(error: unknown) {
  const code = getErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("permission-denied") || combined.includes("insufficient permissions")) {
    return "Firestore Rules 尚未發布或權限不足。請到 Firebase Console 的 Firestore Rules 貼上 firestore.rules 並發布。";
  }
  if (
    combined.includes("連線逾時") ||
    combined.includes("deadline-exceeded") ||
    combined.includes("unavailable")
  ) {
    return "Firestore 連線逾時，請確認 Firestore Database 已建立，並稍後再試。";
  }
  if (combined.includes("failed-precondition") || combined.includes("not-found")) {
    return "Firestore Database 可能尚未建立，請先到 Firebase Console 建立 Firestore Database。";
  }

  return message || "初始化管理者失敗，請確認 Firebase Firestore 已建立且 Rules 已發布。";
}

export async function loadAdminDataset<T>(label: string, loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw new Error(`後台資料讀取失敗：${label}：${getBackendReadErrorMessage(error)}`);
  }
}

export async function runAdminMutationStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new Error(`${label}失敗：${getBackendWriteErrorMessage(error)}`);
  }
}

export function getBackendReadErrorMessage(error: unknown) {
  const code = getErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("permission-denied") || combined.includes("insufficient permissions")) {
    return "權限不足。系統目前尚未把此登入帳號辨識為正式超級管理者。";
  }

  return message || "讀取失敗。";
}

export function getBackendWriteErrorMessage(error: unknown) {
  const code = getErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("permission-denied") || combined.includes("insufficient permissions")) {
    return "權限不足。請確認目前登入帳號仍是正式超級管理者；若剛調整過權限，請重新整理後再試。";
  }

  return message || "寫入失敗。";
}

export function getSchoolWriteErrorMessage(error: unknown, fallback: string) {
  const code = getErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("permission-denied") || combined.includes("insufficient permissions")) {
    return "新增/儲存學校需要正式登入的超級管理者權限。請先登出再用超級管理者帳號登入；若仍失敗，請確認此帳號在後台管理者清單中為「超級管理者」。";
  }

  return message || fallback;
}

export function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
}
