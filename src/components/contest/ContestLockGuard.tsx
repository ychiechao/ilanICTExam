import { Maximize2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { logContestEvent, updatePresenceLockState } from "../../services/contestEvents";
import type { AppUser } from "../../types";

interface ContestLockGuardProps {
  user: AppUser;
  /** 比賽進行中才啟用；等待／暫停／結束不擋。 */
  active: boolean;
}

/**
 * 全螢幕「軟鎖」：
 * - 進行中要求先按「進入考試」進全螢幕；離開全螢幕就蓋上遮罩，回到全螢幕才能繼續作答。
 * - 切分頁、切視窗、貼上都寫 contestEvents，並把「是否在考試畫面」與離開次數同步到線上心跳。
 * 網頁無法真正阻止使用者切出去，這裡的目的是記錄與嚇阻；現場建議搭配 Chrome Kiosk 模式。
 */
export function ContestLockGuard({ user, active }: ContestLockGuardProps) {
  const fullscreenSupported = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const [inFullscreen, setInFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [leaveCount, setLeaveCount] = useState(0);
  const [started, setStarted] = useState(false);
  const hiddenSinceRef = useRef<number | null>(null);
  const leaveCountRef = useRef(0);

  const bumpLeave = useCallback(
    (type: "fullscreen_exit" | "tab_hidden", detail: Record<string, unknown> = {}) => {
      leaveCountRef.current += 1;
      setLeaveCount(leaveCountRef.current);
      void logContestEvent(user, type, { ...detail, leaveCount: leaveCountRef.current });
      void updatePresenceLockState(user, { inFullscreen: Boolean(document.fullscreenElement), leaveCount: leaveCountRef.current });
    },
    [user],
  );

  const enterFullscreen = useCallback(async () => {
    setStarted(true);
    if (!fullscreenSupported) {
      void logContestEvent(user, "fullscreen_enter", { supported: false });
      void updatePresenceLockState(user, { inFullscreen: true, leaveCount: leaveCountRef.current });
      return;
    }
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
      void logContestEvent(user, "fullscreen_enter", { supported: true });
    } catch (error) {
      console.info("requestFullscreen 失敗", error);
    }
  }, [fullscreenSupported, user]);

  // 全螢幕狀態
  useEffect(() => {
    if (!active) return;
    const onChange = () => {
      const now = Boolean(document.fullscreenElement);
      setInFullscreen(now);
      if (!now && started) {
        bumpLeave("fullscreen_exit");
      } else if (now) {
        void updatePresenceLockState(user, { inFullscreen: true, leaveCount: leaveCountRef.current });
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [active, bumpLeave, started, user]);

  // 切分頁／最小化
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
        bumpLeave("tab_hidden");
      } else {
        const hiddenMs = hiddenSinceRef.current ? Date.now() - hiddenSinceRef.current : 0;
        hiddenSinceRef.current = null;
        void logContestEvent(user, "tab_visible", { hiddenMs });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, bumpLeave, user]);

  // 切到別的程式（視窗失焦）：只記錄、不計入離開次數——部分瀏覽器在 prompt/alert 對話框出現時也會觸發 blur，
  // 「執行程式」會用到對話框，計次會誤判。分頁已隱藏時 visibilitychange 會先記，這裡略過避免重複。
  useEffect(() => {
    if (!active) return;
    const onBlur = () => {
      if (document.visibilityState === "hidden") return;
      void logContestEvent(user, "window_blur", { inFullscreen: Boolean(document.fullscreenElement) });
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [active, user]);

  // 積木區以外的貼上（例如測試輸入框）：只記錄。
  useEffect(() => {
    if (!active) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".blocklyWorkspace, .injectionDiv")) return;
      const text = event.clipboardData?.getData("text") ?? "";
      void logContestEvent(user, "paste", { target: target?.tagName ?? "", length: text.length });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [active, user]);

  if (!active) return null;

  const needsFullscreen = fullscreenSupported && !inFullscreen;
  if (!started || needsFullscreen) {
    return (
      <div className="contest-lock-overlay" role="dialog" aria-modal="true">
        <div className="contest-lock-card">
          {started ? <ShieldAlert size={40} className="warning-text" /> : <Maximize2 size={40} />}
          <h2>{started ? "你已離開考試畫面" : "準備開始作答"}</h2>
          {started ? (
            <>
              <p>比賽期間請維持全螢幕，離開的次數與時間都會記錄並提供主辦單位審核。</p>
              <p className="warning-text">已記錄第 {leaveCount} 次離開</p>
            </>
          ) : (
            <p>
              按下按鈕後會進入全螢幕作答。比賽期間請勿切換分頁、視窗或離開全螢幕，
              {fullscreenSupported ? "系統會記錄每一次離開。" : "此瀏覽器不支援全螢幕，仍會記錄切換分頁與視窗。"}
            </p>
          )}
          <button className="primary-button wide" type="button" onClick={() => void enterFullscreen()}>
            <Maximize2 size={18} />
            {started ? "回到全螢幕繼續作答" : "進入考試（全螢幕）"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
