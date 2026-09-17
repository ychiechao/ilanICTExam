import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser } from "../types";

/**
 * 參賽者端異常事件（規格 8.3、計畫 3.7）：只記錄不阻擋，審核頁依人彙總。
 * Worker 在 /login 另外寫 login / fingerprint_changed。
 */
export type ContestEventType =
  | "fullscreen_enter" // 進入全螢幕（開始作答）
  | "fullscreen_exit" // 離開全螢幕（Esc 或切換視窗）
  | "tab_hidden" // 切到別的分頁或最小化
  | "tab_visible" // 回到分頁（detail.hiddenMs 為離開多久）
  | "window_blur" // 視窗失去焦點（切到別的程式）
  | "paste"; // 在積木區以外貼上（例如測試輸入框）

export async function logContestEvent(user: AppUser, type: ContestEventType, detail: Record<string, unknown> = {}) {
  if (!db || user.accountType !== "contest" || !user.contestId) return;
  try {
    await addDoc(collection(db, "contestEvents"), {
      contestId: user.contestId,
      uid: user.uid,
      username: user.contestUsername ?? "",
      type,
      detail,
      createdAt: serverTimestamp(),
      createdAtIso: new Date().toISOString(),
    });
  } catch (error) {
    console.info("contestEvents 寫入失敗", error);
  }
}

/** 把「是否在考試畫面」與離開次數同步到自己的線上心跳，儀表板即時顯示。 */
export async function updatePresenceLockState(user: AppUser, state: { inFullscreen: boolean; leaveCount: number }) {
  if (!db || user.accountType !== "contest" || !user.contestId || !user.contestUsername) return;
  try {
    await setDoc(
      doc(db, "contestPresence", `${user.contestId}_${user.contestUsername}`),
      {
        contestId: user.contestId,
        uid: user.uid,
        username: user.contestUsername,
        inFullscreen: state.inFullscreen,
        leaveCount: state.leaveCount,
        lastSeenAt: serverTimestamp(),
        lastSeenMs: Date.now(),
      },
      { merge: true },
    );
  } catch (error) {
    console.info("presence 鎖定狀態寫入失敗", error);
  }
}
