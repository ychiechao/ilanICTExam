import { useState } from "react";
import type { LeaderboardEntry } from "../../types";
import { formatContestDateTime } from "../../utils/format";

export function LeaderboardPanel({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  const [expandedUid, setExpandedUid] = useState("");

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>全站排行榜</h2>
        <span>依答題率排名 · 點選可展開</span>
      </div>
      {leaderboard.length === 0 && <p className="muted">尚無登入使用者提交紀錄。</p>}
      {leaderboard.map((entry, index) => {
        const expanded = expandedUid === entry.uid;
        const toggle = () => setExpandedUid(expanded ? "" : entry.uid);
        return (
          <div className={expanded ? "leader-item expanded" : "leader-item"} key={entry.uid}>
            <div
              className="leader-row clickable"
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={toggle}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle();
                }
              }}
            >
              <span className="rank">{index + 1}</span>
              <div>
                <strong>{entry.displayName}</strong>
                <small>
                  {entry.schoolName ? entry.schoolName + " · " : ""}
                  完成 {entry.completedCount || 0}/{entry.totalProblems || 0} 題，
                  {entry.totalScore ?? entry.score}/{entry.totalMaxScore ?? entry.maxScore} 分，
                  {entry.submitCount} 次
                </small>
              </div>
              <strong>{Math.round(entry.passRate * 100)}%</strong>
            </div>
            {expanded && (
              <dl className="leader-detail">
                <div>
                  <dt>學校</dt>
                  <dd>{entry.schoolName || "未設定"}</dd>
                </div>
                <div>
                  <dt>姓名</dt>
                  <dd>{entry.displayName}</dd>
                </div>
                <div>
                  <dt>完成題數</dt>
                  <dd>
                    {entry.completedCount || 0}/{entry.totalProblems || 0}
                  </dd>
                </div>
                <div>
                  <dt>總分</dt>
                  <dd>
                    {entry.totalScore ?? entry.score}/{entry.totalMaxScore ?? entry.maxScore}
                  </dd>
                </div>
                <div>
                  <dt>答題率</dt>
                  <dd>{Math.round(entry.passRate * 100)}%</dd>
                </div>
                <div>
                  <dt>提交次數</dt>
                  <dd>{entry.submitCount} 次</dd>
                </div>
                <div>
                  <dt>最後提交</dt>
                  <dd>{formatContestDateTime(entry.lastSubmittedAt || entry.updatedAt) || "-"}</dd>
                </div>
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}
