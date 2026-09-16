import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { APP_TITLE } from "../../app/constants";
import { db } from "../../firebase";
import { getContestPhase } from "../../services/contestStore";
import { formatCountdown, useServerNow } from "../../services/serverClock";
import type { AppUser, PlatformState } from "../../types";
import { formatContestDateTime } from "../../utils/format";
import { GuishanIslandIcon } from "../ui";

interface ContestShellProps {
  platform: PlatformState;
  user: AppUser;
  onLogout: () => void;
}

interface LiveContest {
  title: string;
  status: string;
  startAt?: string;
  endAt?: string;
  pausedAt?: string;
}

/**
 * 競賽帳號登入後的外框：頂欄顯示賽事、參賽者、公告與登出，
 * 中央依賽事狀態顯示「等待開始 / 倒數 / 暫停 / 結束」。
 * 作答區（題目、積木、提交）在題庫匯入完成後放進來。
 */
export function ContestShell({ platform, user, onLogout }: ContestShellProps) {
  const [contest, setContest] = useState<LiveContest | null>(null);
  const now = useServerNow();

  // 即時訂閱自己那一場：主辦單位按開始／暫停，畫面同步更新。
  useEffect(() => {
    if (!db || !user.contestId) return;
    return onSnapshot(doc(db, "contests", user.contestId), (snapshot) => {
      const data = snapshot.data();
      setContest(
        data
          ? {
              title: String(data.title ?? ""),
              status: String(data.status ?? "draft"),
              startAt: typeof data.startAt === "string" ? data.startAt : undefined,
              endAt: typeof data.endAt === "string" ? data.endAt : undefined,
              pausedAt: typeof data.pausedAt === "string" ? data.pausedAt : undefined,
            }
          : null,
      );
    });
  }, [user.contestId]);

  const phase = contest ? getContestPhase({ status: contest.status as never, startAt: contest.startAt, endAt: contest.endAt }, now) : "waiting";
  const remainingMs = contest?.endAt ? Date.parse(contest.endAt) - now : 0;
  const untilStartMs = contest?.startAt ? Date.parse(contest.startAt) - now : 0;

  return (
    <div className="app-shell contest-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <GuishanIslandIcon />
          <div className="brand-text">
            <h1>{APP_TITLE}</h1>
            <span>{contest?.title || "競賽模式"}</span>
          </div>
        </div>
        <div className="header-actions">
          {phase === "running" && (
            <div className={remainingMs < 5 * 60_000 ? "contest-clock urgent" : "contest-clock"} aria-live="polite">
              <span>剩餘</span>
              <strong>{formatCountdown(remainingMs)}</strong>
            </div>
          )}
          <div className="user-chip">
            <span>
              {user.contestUsername} {user.displayName}
            </span>
            <button className="icon-button" onClick={onLogout} title="登出">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>

      {platform.announcement && <div className="platform-banner">{platform.announcement}</div>}

      <main className="announcement-main">
        {phase === "waiting" && (
          <section className="announcement-card contest-stage">
            <span className="status-pill">等待開始</span>
            <h2>{user.displayName}，請稍候</h2>
            <p className="muted">主辦單位按下開始後，倒數計時會自動出現在這個畫面，請不要關閉視窗。</p>
            {contest?.startAt && untilStartMs > 0 && (
              <p>
                預定開始：{formatContestDateTime(contest.startAt)}（還有 {formatCountdown(untilStartMs)}）
              </p>
            )}
          </section>
        )}

        {phase === "running" && (
          <section className="announcement-card contest-stage">
            <span className="status-pill">比賽進行中</span>
            <div className="contest-countdown" aria-live="off">
              {formatCountdown(remainingMs)}
            </div>
            <p className="muted">結束時間 {formatContestDateTime(contest?.endAt)}。作答區將在題庫開放後顯示於此。</p>
          </section>
        )}

        {phase === "paused" && (
          <section className="announcement-card contest-stage">
            <span className="status-pill warning">比賽暫停</span>
            <h2>主辦單位暫停了比賽</h2>
            <p className="muted">暫停期間不計時，恢復後會延長相同的時間。請留在此畫面等待。</p>
          </section>
        )}

        {phase === "ended" && (
          <section className="announcement-card contest-stage">
            <span className="status-pill disabled">比賽結束</span>
            <h2>作答時間已結束</h2>
            <p className="muted">感謝參與。成績由主辦單位審核後公布。</p>
          </section>
        )}
      </main>
    </div>
  );
}
