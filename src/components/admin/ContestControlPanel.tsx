import { useState } from "react";
import {
  endContestTiming,
  getContestPhase,
  pauseContestTiming,
  resumeContestTiming,
  saveContest,
  startContestTiming,
} from "../../services/contestStore";
import { writeAuditLog } from "../../services/auditStore";
import { formatCountdown, isClockSynced, serverNow, syncServerClock, useServerNow } from "../../services/serverClock";
import type { AppUser, ContestEvent } from "../../types";
import { formatContestDateTime } from "../../utils/format";

interface ContestControlPanelProps {
  contests: ContestEvent[];
  currentUser: AppUser | null;
  busy: boolean;
  onStatus: (message: string) => void;
  onChanged: () => void;
}

const PHASE_LABEL = {
  waiting: "等待開始",
  running: "進行中",
  paused: "暫停中",
  ended: "已結束",
} as const;

/**
 * 競賽模式下每一場的即時控制：開始、暫停、繼續、結束。
 * 時間以 Worker 校正後的伺服器時間為準，參賽者畫面會同步倒數。
 */
export function ContestControlPanel({ contests, currentUser, busy, onStatus, onChanged }: ContestControlPanelProps) {
  const now = useServerNow();
  const [working, setWorking] = useState("");

  async function apply(
    contest: ContestEvent,
    label: string,
    transform: (item: ContestEvent, nowMs: number) => ContestEvent,
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setWorking(contest.id);
    try {
      await syncServerClock().catch(() => undefined);
      const next = transform(contest, serverNow());
      await saveContest(next);
      await writeAuditLog(
        {
          action: "contest.status",
          targetType: "contest",
          targetId: contest.id,
          summary: `${label}「${contest.title}」${next.endAt ? `，結束時間 ${formatContestDateTime(next.endAt)}` : ""}`,
        },
        currentUser,
      );
      onStatus(`已${label}「${contest.title}」。`);
      onChanged();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : `${label}失敗。`);
    } finally {
      setWorking("");
    }
  }

  if (contests.length === 0) {
    return null;
  }

  return (
    <div className="admin-subsection contest-control">
      <div className="section-title-row compact">
        <div>
          <h4>比賽控制</h4>
          <p className="muted">
            按「開始」後參賽者畫面立即出現倒數；「暫停」不計時，「繼續」會把暫停的時間補回去。
            {!isClockSynced() && " （尚未與伺服器校時，按下按鈕時會先校時）"}
          </p>
        </div>
      </div>
      {contests.map((contest) => {
        const phase = getContestPhase(contest, now);
        const remaining = contest.endAt ? Date.parse(contest.endAt) - now : 0;
        const isWorking = working === contest.id || busy;
        return (
          <div className="contest-control-row" key={contest.id}>
            <div className="contest-control-info">
              <strong>{contest.title}</strong>
              <span className={`status-pill ${phase === "running" ? "" : phase === "paused" ? "warning" : "disabled"}`}>
                {PHASE_LABEL[phase]}
              </span>
              {phase === "running" && <span className="contest-control-clock">剩餘 {formatCountdown(remaining)}</span>}
              {phase === "waiting" && <span className="muted">長度 {contest.durationMinutes ?? 120} 分鐘</span>}
              {(phase === "paused" || phase === "ended") && contest.endAt && (
                <span className="muted">結束時間 {formatContestDateTime(contest.endAt)}</span>
              )}
            </div>
            <div className="contest-control-actions">
              {phase === "waiting" && (
                <button
                  className="primary-button"
                  type="button"
                  disabled={isWorking}
                  onClick={() =>
                    void apply(
                      contest,
                      "開始",
                      startContestTiming,
                      `確定開始「${contest.title}」？倒數 ${contest.durationMinutes ?? 120} 分鐘，參賽者畫面會立即開始計時。`,
                    )
                  }
                >
                  開始比賽
                </button>
              )}
              {phase === "running" && (
                <>
                  <button className="ghost-button" type="button" disabled={isWorking} onClick={() => void apply(contest, "暫停", pauseContestTiming)}>
                    暫停
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={isWorking}
                    onClick={() => void apply(contest, "結束", endContestTiming, `確定提前結束「${contest.title}」？參賽者將無法再提交。`)}
                  >
                    結束
                  </button>
                </>
              )}
              {phase === "paused" && (
                <>
                  <button className="primary-button" type="button" disabled={isWorking} onClick={() => void apply(contest, "繼續", resumeContestTiming)}>
                    繼續
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={isWorking}
                    onClick={() => void apply(contest, "結束", endContestTiming, `確定結束「${contest.title}」？`)}
                  >
                    結束
                  </button>
                </>
              )}
              {phase === "ended" && contest.status !== "ended" && contest.status !== "review" && contest.status !== "published" && contest.status !== "archived" && (
                <button className="ghost-button" type="button" disabled={isWorking} onClick={() => void apply(contest, "結束", endContestTiming)}>
                  標記為已結束
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
