import type { PracticeStats } from "../../app/constants";
import type { Problem, SubmissionRecord } from "../../types";
import { formatDateTime, formatDuration } from "../../utils/format";
import { formatPracticeSubtitle } from "../../utils/practice";
import { Metric, PracticeStatusBadge } from "../ui";

export function HistoryPanel({
  problems,
  selectedProblemId,
  statsByProblemId,
  submissions,
  onLoad,
  onSelectProblem,
}: {
  problems: Problem[];
  selectedProblemId: string;
  statsByProblemId: Record<string, PracticeStats>;
  submissions: SubmissionRecord[];
  onLoad: (xml: string) => void;
  onSelectProblem: (problemId: string) => void;
}) {
  const completedCount = problems.filter((problem) => statsByProblemId[problem.id]?.status === "completed").length;
  const inProgressCount = problems.filter((problem) => statsByProblemId[problem.id]?.status === "in-progress").length;
  const unfinishedCount = problems.length - completedCount;

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>個人練習紀錄</h2>
        <span>{completedCount}/{problems.length} 題完成</span>
      </div>
      <div className="practice-summary-grid">
        <Metric label="已完成" value={`${completedCount} 題`} />
        <Metric label="未完成" value={`${unfinishedCount} 題`} />
        <Metric label="練習中" value={`${inProgressCount} 題`} />
      </div>
      <div className="practice-list">
        {problems.map((problem) => {
          const stats = statsByProblemId[problem.id];
          return (
            <button
              key={problem.id}
              className={problem.id === selectedProblemId ? "practice-row active" : "practice-row"}
              onClick={() => onSelectProblem(problem.id)}
            >
              <span>
                <strong>{problem.title}</strong>
                <small>{problem.year ? `${problem.year} 年度 / ${problem.category}` : problem.category}</small>
              </span>
              <span className="practice-row-meta">
                <PracticeStatusBadge stats={stats} compact />
                <small>{formatPracticeSubtitle(stats)}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="panel-heading compact-heading">
        <h2>本題評分紀錄</h2>
        <span>{submissions.length} 筆</span>
      </div>
      {submissions.length === 0 && <p className="muted">尚無紀錄。</p>}
      {submissions.map((item) => (
        <div className="history-row" key={item.id}>
          <div>
            <strong>
              {item.score} / {item.maxScore}
            </strong>
            <span>
              {formatDateTime(item.createdAt)}
              {item.isFullScore && typeof item.solveDurationMs === "number"
                ? `，解題時間 ${formatDuration(item.solveDurationMs)}`
                : ""}
            </span>
          </div>
          <button className="ghost-button" onClick={() => onLoad(item.blocklyXml)}>
            載入
          </button>
        </div>
      ))}
    </div>
  );
}
