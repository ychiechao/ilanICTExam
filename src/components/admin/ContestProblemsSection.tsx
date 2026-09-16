import { useCallback, useEffect, useState } from "react";
import { getProblemImportSource, normalizeProblem, type Problem } from "../../../shared/problemImport";
import { importContestProblems, loadContestProblems, type ContestProblem } from "../../services/contestProblemStore";
import { GraderError, hasGraderConfig } from "../../services/grader";
import type { ContestEvent } from "../../types";
import { formatContestDateTime } from "../../utils/format";
import { Metric } from "../ui";

interface ContestProblemsSectionProps {
  contests: ContestEvent[];
  busy: boolean;
  onStatus: (message: string) => void;
  onContestsChanged: () => void;
  /** 從「賽事管理」點進來時預選的賽事。 */
  initialContestId?: string;
}

interface PreviewState {
  parsed: unknown;
  problems: Problem[];
  fileName: string;
}

/** 後台「競賽題庫」：每場賽事獨立匯入，測資只存 Worker KV（規格 8.6）。 */
export function ContestProblemsSection({ contests, busy, onStatus, onContestsChanged, initialContestId }: ContestProblemsSectionProps) {
  const candidateContests = contests.filter((contest) => contest.status !== "archived");
  const [contestId, setContestId] = useState(initialContestId || candidateContests[0]?.id || "");
  const [problems, setProblems] = useState<ContestProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  const contest = contests.find((item) => item.id === contestId);
  const locked = contest?.status === "active" || contest?.status === "paused";

  useEffect(() => {
    if (!contestId && candidateContests[0]) {
      setContestId(candidateContests[0].id);
    }
  }, [candidateContests, contestId]);

  const refresh = useCallback(async () => {
    if (!contestId) {
      setProblems([]);
      return;
    }
    setLoading(true);
    try {
      setProblems(await loadContestProblems(contestId));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "競賽題庫讀取失敗。");
    } finally {
      setLoading(false);
    }
  }, [contestId, onStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function parseText(text: string, fileName: string) {
    setPreviewError("");
    try {
      const parsed = JSON.parse(text);
      const source = getProblemImportSource(parsed);
      const normalized = source.items.map((item) => normalizeProblem(item, source.year));
      if (normalized.length === 0) {
        throw new Error("檔案裡沒有題目。");
      }
      setPreview({ parsed, problems: normalized, fileName });
    } catch (error) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : "JSON 格式錯誤。");
    }
  }

  async function handleImport() {
    if (!contest || !preview) return;
    const replacing = problems.length > 0 ? `這會取代目前的 ${problems.length} 題。` : "";
    if (!window.confirm(`確定為「${contest.title}」匯入 ${preview.problems.length} 題？${replacing}`)) return;
    setWorking(true);
    try {
      const result = await importContestProblems(contest.id, preview.parsed);
      setLastWarnings(result.warnings);
      setPreview(null);
      onStatus(
        `已匯入 ${result.problemCount} 題${result.replaced > 0 ? `（取代 ${result.replaced} 題）` : ""}${
          result.warnings.length > 0 ? `，${result.warnings.length} 題缺測資` : ""
        }。`,
      );
      await refresh();
      onContestsChanged();
    } catch (error) {
      onStatus(error instanceof GraderError || error instanceof Error ? error.message : "匯入失敗。");
    } finally {
      setWorking(false);
    }
  }

  const missingCases = preview?.problems.filter((problem) => problem.cases.length === 0) ?? [];
  const disabled = busy || working;

  return (
    <section className="admin-section">
      <div className="section-title-row">
        <div>
          <h3>競賽題庫</h3>
          <p>
            每場賽事獨立匯入，格式與練習題庫相同（bDesigner JSON）。題目說明與範例存在資料庫；評分測資只存在評分伺服器，
            參賽者拿不到答案。賽事進行中不能更換題庫。
          </p>
        </div>
        <div className="admin-file-actions">
          <label className="inline-admin-select">
            賽事
            <select value={contestId} onChange={(event) => setContestId(event.target.value)} disabled={disabled}>
              {candidateContests.length === 0 && <option value="">尚無賽事</option>}
              {candidateContests.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button" type="button" onClick={() => void refresh()} disabled={disabled || loading}>
            重新整理
          </button>
        </div>
      </div>

      {!hasGraderConfig() && <p className="warning-text">尚未設定評分伺服器位址（VITE_GRADER_URL），無法匯入。</p>}
      {!contest && <p className="muted">請先在「賽事管理」建立賽事。</p>}

      {contest && (
        <>
          <div className="metric-row">
            <Metric label="題數" value={`${problems.length} 題`} />
            <Metric label="總分" value={`${problems.reduce((sum, item) => sum + item.maxScore, 0)} 分`} />
            <Metric label="最後匯入" value={formatContestDateTime(contest.casesSyncedAt) || "尚未匯入"} />
            <Metric label="賽事狀態" value={locked ? "進行中（鎖定）" : "可匯入"} />
          </div>

          <div className="admin-subsection">
            <h4>匯入題庫</h4>
            <p className="muted">選擇 JSON 檔案後會先顯示預覽；確認後才會上傳到評分伺服器。</p>
            <div className="admin-file-actions">
              <label className="ghost-button file-button">
                選擇 JSON 檔案
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden-file-input"
                  disabled={disabled || locked}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) parseText(await file.text(), file.name);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleImport()}
                disabled={disabled || locked || !preview || !hasGraderConfig()}
              >
                {working ? "匯入中…" : preview ? `匯入 ${preview.problems.length} 題` : "匯入"}
              </button>
            </div>
            {previewError && <p className="warning-text">{previewError}</p>}
            {preview && (
              <div className="admin-subsection">
                <p>
                  <strong>{preview.fileName}</strong>：{preview.problems.length} 題，總分{" "}
                  {preview.problems.reduce((sum, item) => sum + item.cases.reduce((s, c) => s + c.score, 0), 0)} 分
                  {missingCases.length > 0 && (
                    <span className="warning-text">；{missingCases.length} 題沒有評分測資：{missingCases.map((item) => item.title).join("、")}</span>
                  )}
                </p>
                <div className="admin-table">
                  <div className="admin-table-head contest-problem-row">
                    <span>#</span>
                    <span>題目</span>
                    <span>分類</span>
                    <span>測資</span>
                    <span>公開</span>
                    <span>滿分</span>
                  </div>
                  {preview.problems.map((problem, index) => (
                    <div className={problem.cases.length === 0 ? "contest-problem-row invalid" : "contest-problem-row"} key={problem.id}>
                      <span>{index + 1}</span>
                      <span>{problem.title}</span>
                      <span>{problem.category}</span>
                      <span>{problem.cases.length} 筆</span>
                      <span>{problem.cases.filter((item) => item.visibility === "public").length} 筆</span>
                      <span>{problem.cases.reduce((sum, item) => sum + item.score, 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lastWarnings.length > 0 && (
              <ul className="platform-check-list">
                {lastWarnings.map((item) => (
                  <li key={item} className="warning-text">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-subsection">
            <div className="section-title-row compact">
              <div>
                <h4>目前題庫</h4>
                <p className="muted">參賽者看到的順序與內容。</p>
              </div>
            </div>
            <div className="admin-table">
              <div className="admin-table-head contest-problem-row">
                <span>#</span>
                <span>題目</span>
                <span>分類</span>
                <span>測資</span>
                <span>公開</span>
                <span>滿分</span>
              </div>
              {loading && <p className="muted table-empty">讀取中…</p>}
              {!loading && problems.length === 0 && <p className="muted table-empty">尚未匯入題庫。</p>}
              {problems.map((problem) => (
                <div className="contest-problem-row" key={problem.id}>
                  <span>{problem.order}</span>
                  <span>{problem.title}</span>
                  <span>{problem.category}</span>
                  <span>{problem.caseCount} 筆</span>
                  <span>{problem.publicCaseCount} 筆</span>
                  <span>{problem.maxScore}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
