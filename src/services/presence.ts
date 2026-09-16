import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser } from "../types";

/**
 * 參賽者線上狀態：每 5 分鐘寫一次心跳到 contestPresence/{contestId}_{username}。
 * 儀表板以「6 分鐘內有心跳」計為線上。
 * 間隔取 5 分鐘是為了留在 Firestore 免費寫入額度內（400 人 × 3 小時 ≈ 1.4 萬次）。
 */
export const PRESENCE_INTERVAL_MS = 5 * 60_000;
export const PRESENCE_ONLINE_WINDOW_MS = 6 * 60_000;

export function startPresenceHeartbeat(user: AppUser) {
  if (!db || user.accountType !== "contest" || !user.contestId || !user.contestUsername) {
    return () => undefined;
  }
  const ref = doc(db, "contestPresence", `${user.contestId}_${user.contestUsername}`);
  const beat = () => {
    setDoc(
      ref,
      {
        contestId: user.contestId,
        uid: user.uid,
        username: user.contestUsername,
        name: user.displayName,
        schoolId: user.schoolId ?? "",
        lastSeenAt: serverTimestamp(),
        lastSeenMs: Date.now(),
        userAgent: navigator.userAgent.slice(0, 120),
      },
      { merge: true },
    ).catch((error) => console.info("presence 寫入失敗", error));
  };
  beat();
  const timer = window.setInterval(beat, PRESENCE_INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") beat();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
