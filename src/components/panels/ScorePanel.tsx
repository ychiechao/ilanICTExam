import { Save } from "lucide-react";
import { MAX_SUBMISSIONS_PER_PROBLEM } from "../../services/submissionService";
import type { AppUser, GradeResult, SubmissionRecord } from "../../types";

export function ScorePanel({
  result,
  busy,
  user,
  submissions,
  onGrade,
}: {
  result: GradeResult | null;
  busy: boolean;
  user: AppUser | null;
  submissions: SubmissionRecord[];
  onGrade: () => void;
}) {
  const publicCaseResults = result?.cases.filter((item) => item.visibility !== "hidden") || [];
  const hiddenCaseResults = result?.cases.filter((item) => item.visibility === "hidden") || [];

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>正式評分</h2>
        <span>{submissions.length}/{MAX_SUBMISSIONS_PER_PROBLEM} 次</span>
      </div>
      {!user && <p className="warning-text">訪客可計分，但只保存於本機；登入後才會寫入排行榜。</p>}
      <button className="primary-button wide" onClick={onGrade} disabled={busy}>
        <Save size={17} />
        正式計分
      </button>
      {result && (
        <>
          {result.message && <p className="warning-text">{result.message}</p>}
          <div className="score-card">
            <strong>
              {result.score} / {result.maxScore}
            </strong>
            <span>
              通過 {result.passedCases} / {result.totalCases}，答題率 {Math.round(result.passRate * 100)}%
            </span>
            <span>
              公開測資 {publicCaseResults.length} 筆，隱藏測資 {hiddenCaseResults.length} 筆
            </span>
          </div>
          {hiddenCaseResults.length > 0 && (
            <p className="muted">隱藏測資已納入正式分數，題目頁不顯示輸入與輸出內容。</p>
          )}
          <div className="case-list">
            {publicCaseResults.map((item) => (
              <div className={item.passed ? "case-row passed" : "case-row"} key={item.caseTitle}>
                <span>{item.caseTitle}</span>
                <strong>{item.passed ? "通過" : "未通過"}</strong>
                <small>{item.error || item.actual || "沒有輸出"}</small>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
