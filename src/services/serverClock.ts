import { useEffect, useState } from "react";
import { graderRequest, hasGraderConfig } from "./grader";

/**
 * 伺服器時鐘：向 Worker /time 校正一次，之後以本機時鐘加偏移量計時。
 * 參賽者的電腦時間不可信，倒數一律以校正後的時間為準。
 */
let offsetMs = 0;
let synced = false;
let syncing: Promise<void> | null = null;

export function serverNow() {
  return Date.now() + offsetMs;
}

export function isClockSynced() {
  return synced;
}

export async function syncServerClock() {
  if (!hasGraderConfig()) {
    return;
  }
  if (!syncing) {
    syncing = (async () => {
      const started = Date.now();
      const response = await graderRequest<{ epochMs: number }>("/time", { withAuth: false, timeoutMs: 8000 });
      const roundTrip = Date.now() - started;
      // 假設來回對稱，取中點當作伺服器回應時刻。
      offsetMs = response.epochMs + roundTrip / 2 - Date.now();
      synced = true;
    })().finally(() => {
      syncing = null;
    });
  }
  await syncing;
}

/** 每秒觸發一次重繪並回傳校正後的現在時間（毫秒）。 */
export function useServerNow(tickMs = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    void syncServerClock().catch(() => undefined);
    const timer = window.setInterval(() => setNow(serverNow()), tickMs);
    return () => window.clearInterval(timer);
  }, [tickMs]);
  return now;
}

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days > 0) return `${days} 天 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
