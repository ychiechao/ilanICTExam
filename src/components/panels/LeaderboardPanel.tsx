import type { LeaderboardEntry } from "../../types";

export function LeaderboardPanel({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>全站排行榜</h2>
        <span>依答題率排名</span>
      </div>
      {leaderboard.length === 0 && <p className="muted">尚無登入使用者提交紀錄。</p>}
      {leaderboard.map((entry, index) => (
        <div className="leader-row" key={entry.uid}>
          <span className="rank">{index + 1}</span>
          <div>
            <strong>{entry.displayName}</strong>
            <small>
              完成 {entry.completedCount || 0}/{entry.totalProblems || 0} 題，
              {entry.totalScore ?? entry.score}/{entry.totalMaxScore ?? entry.maxScore} 分，
              {entry.submitCount} 次
            </small>
          </div>
          <strong>{Math.round(entry.passRate * 100)}%</strong>
        </div>
      ))}
    </div>
  );
}
