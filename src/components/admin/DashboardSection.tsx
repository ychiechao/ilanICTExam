import { useEffect, useMemo, useState } from "react";
import { writeAuditLog } from "../../services/auditStore";
import { saveContest } from "../../services/contestStore";
import { loadContestProblems, type ContestProblem } from "../../services/contestProblemStore";
import {
  subscribeDashboard,
  subscribePresence,
  subscribeRecentSubmissions,
  type ContestDashboard,
  type PresenceRecord,
  type RecentSubmission,
} from "../../services/dashboardStore";
import { GRADER_URL } from "../../services/grader";
import { PRESENCE_ONLINE_WINDOW_MS } from "../../services/presence";
import { useServerNow } from "../../services/serverClock";
import type { AppUser, ContestEvent, DashboardVisibility } from "../../types";
import { formatContestDateTime } from "../../utils/format";
import { Metric } from "../ui";

interface DashboardSectionProps {
  contests: ContestEvent[];
  currentUser: AppUser | null;
  busy: boolean;
  onStatus: (message: string) => void;
  onContestsChanged: () => void;
}

const VISIBILITY_LABEL: Record<DashboardVisibility, string> = {
  organizer: "只有主辦單位",
  participants: "開放給參賽者",
  public: "開放給所有登入者",
};

/** 主辦單位儀表板（規格 8.9）：線上人數、即時排行、各題／各校統計、最近提交、對外開關。 */
export function DashboardSection({ contests, currentUser, busy, onStatus, onContestsChanged }: DashboardSectionProps) {
  const candidates = contests.filter((contest) => contest.status !== "archived" && contest.status !== "draft");
  const [contestId, setContestId] = useState(candidates[0]?.id ?? "");
  const [dashboard, setDashboard] = useState<ContestDashboard | null>(null);
  const [presence, setPresence] = useState<PresenceRecord[]>([]);
  const [recent, setRecent] = useState<RecentSubmission[]>([]);
  const [problems, setProblems] = useState<ContestProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const now = useServerNow(5000);

  const contest = contests.find((item) => item.id === contestId);

  useEffect(() => {
    if (!contestId && candidates[0]) setContestId(candidates[0].id);
  }, [candidates, contestId]);

  useEffect(() => subscribeDashboard(contestId, setDashboard), [contestId]);
  useEffect(() => subscribePresence(contestId, setPresence), [contestId]);
  useEffect(() => subscribeRecentSubmissions(contestId, 20, setRecent), [contestId]);
  useEffect(() => {
    loadContestProblems(contestId).then(setProblems).catch(() => setProblems([]));
  }, [contestId]);

  const onlineCount = useMemo(
    () => presence.filter((item) => now - item.lastSeenMs < PRESENCE_ONLINE_WINDOW_MS).length,
    [now, presence],
  );
  const everOnline = presence.length;
  const showNames = contest?.dashboard?.showNames ?? false;
  const visibility = contest?.dashboard?.visibility ?? "organizer";
  const boardToken = (contest?.dashboard as { boardToken?: string } | undefined)?.boardToken ?? "";
  const boardUrl = boardToken && GRADER_URL ? `${GRADER_URL}/board/${encodeURIComponent(contestId)}?token=${boardToken}` : "";

  async function updateDashboardSettings(patch: Partial<NonNullable<ContestEvent["dashboard"]> & { boardToken?: string }>, summary: string) {
    if (!contest) return;
    setSaving(true);
    try {
      const nextDashboard = { visibility: "organizer" as DashboardVisibility, showNames: false, topN: 20, ...(contest.dashboard ?? {}), ...patch };
      await saveContest({ ...contest, dashboard: nextDashboard });
      await writeAuditLog({ action: "contest.dashboard", targetType: "contest", targetId: contest.id, summary }, currentUser);
      onStatus(summary);
      onContestsChanged();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "儀表板設定儲存失敗。");
    } finally {
      setSaving(false);
    }
  }

  if (candidates.length === 0) {
    return (
      <section className="admin-section">
        <h3>進度儀表板</h3>
        <p className="muted">還沒有進行中或已結束的賽事。</p>
      </section>
    );
  }

  const ranking = dashboard?.ranking ?? [];
  const displayName = (row: { name: string; username: string }) => (showNames ? row.name : row.username);

  return (
    <section className="admin-section">
      <div className="section-title-row">
        <div>
          <h3>進度儀表板</h3>
          <p>
            資料每次評分後更新（最多每 3 秒一次）。最後更新：
            {dashboard?.computedAtMs ? formatContestDateTime(new Date(dashboard.computedAtMs).toISOString()) : "尚無提交"}
          </p>
        </div>
        <div className="admin-file-actions">
          <label className="inline-admin-select">
            賽事
            <select value={contestId} onChange={(event) => setContestId(event.target.value)}>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="metric-row dashboard-metrics">
        <Metric label="帳號數" value={`${contest?.accountCount ?? dashboard?.accountCount ?? 0} 人`} />
        <Metric label="目前線上" value={`${onlineCount} 人`} />
        <Metric label="登入過" value={`${everOnline} 人`} />
        <Metric label="已提交" value={`${dashboard?.submittedCount ?? 0} 人`} />
        <Metric label="提交次數" value={`${dashboard?.submissionCount ?? 0} 次`} />
        <Metric label="平均總分" value={`${Math.round(dashboard?.averageScore ?? 0)} 分`} />
      </div>

      <div className="admin-subsection dashboard-visibility">
        <div className="section-title-row compact">
          <div>
            <h4>對外顯示</h4>
            <p className="muted">
              目前：<strong>{VISIBILITY_LABEL[visibility]}</strong>。開放後參賽者畫面會多一個「排行榜」分頁；切回「只有主辦單位」即時消失。
            </p>
          </div>
          <div className="admin-file-actions">
            {(Object.keys(VISIBILITY_LABEL) as DashboardVisibility[]).map((key) => (
              <button
                key={key}
                className={visibility === key ? "primary-button" : "ghost-button"}
                type="button"
                disabled={busy || saving || visibility === key}
                onClick={() => void updateDashboardSettings({ visibility: key }, `儀表板改為「${VISIBILITY_LABEL[key]}」（${contest?.title}）`)}
              >
                {VISIBILITY_LABEL[key]}
              </button>
            ))}
            <label className="inline-check">
              <input
                type="checkbox"
                checked={showNames}
                disabled={busy || saving}
                onChange={(event) =>
                  void updateDashboardSettings({ showNames: event.target.checked }, `儀表板${event.target.checked ? "顯示" : "隱藏"}姓名（${contest?.title}）`)
                }
              />
              對外顯示姓名
            </label>
          </div>
        </div>
        <div className="admin-file-actions">
          <button
            className="ghost-button"
            type="button"
            disabled={busy || saving}
            onClick={() =>
              void updateDashboardSettings(
                { boardToken: crypto.randomUUID().replace(/-/g, "").slice(0, 20) },
                `產生新的投影畫面連結（${contest?.title}）`,
              )
            }
          >
            {boardToken ? "重新產生投影連結（舊連結失效）" : "產生投影畫面連結"}
          </button>
          {boardUrl && (
            <a className="ghost-button" href={boardUrl} target="_blank" rel="noreferrer">
              開啟投影畫面
            </a>
          )}
          {boardUrl && <code className="board-url">{boardUrl}</code>}
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="admin-subsection">
          <h4>即時排行榜</h4>
          <div className="admin-table">
            <div className="admin-table-head dashboard-rank-row">
              <span>#</span>
              <span>參賽者</span>
              <span>學校</span>
              <span>總分</span>
              <span>完成</span>
              <span>提交</span>
            </div>
            {ranking.length === 0 && <p className="muted table-empty">尚無提交。</p>}
            {ranking.slice(0, contest?.dashboard?.topN ?? 20).map((row) => (
              <div className="dashboard-rank-row" key={row.username}>
                <span className={row.rank <= 3 ? "rank top" : "rank"}>{row.rank}</span>
                <span>{displayName(row)}</span>
                <span>{row.schoolName || "-"}</span>
                <strong>{row.totalScore}</strong>
                <span>{row.solvedCount} 題</span>
                <span>{row.submitCount} 次</span>
              </div>
            ))}
          </div>
        </div>

        <div className="admin-subsection">
          <h4>各題完成狀況</h4>
          <div className="admin-table">
            <div className="admin-table-head dashboard-problem-row">
              <span>題目</span>
              <span>滿分</span>
              <span>嘗試中</span>
              <span>完成率</span>
            </div>
            {problems.map((problem) => {
              const stat = dashboard?.problemStats[problem.problemId];
              const solved = stat?.solved ?? 0;
              const attempted = stat?.attempted ?? 0;
              const base = dashboard?.submittedCount || 0;
              return (
                <div className="dashboard-problem-row" key={problem.id}>
                  <span>
                    {problem.order}. {problem.title}
                  </span>
                  <span>{solved} 人</span>
                  <span>{attempted} 人</span>
                  <span>
                    <span className="bar">
                      <span className="bar-fill" style={{ width: `${base ? Math.round((solved / base) * 100) : 0}%` }} />
                    </span>
                    {base ? Math.round((solved / base) * 100) : 0}%
                  </span>
                </div>
              );
            })}
            {problems.length === 0 && <p className="muted table-empty">尚未匯入題庫。</p>}
          </div>

          <h4>各校統計</h4>
          <div className="admin-table">
            <div className="admin-table-head dashboard-school-row">
              <span>學校</span>
              <span>已提交</span>
              <span>完成題數</span>
              <span>平均總分</span>
            </div>
            {Object.values(dashboard?.schoolStats ?? {})
              .sort((a, b) => b.totalScore / Math.max(1, b.participants) - a.totalScore / Math.max(1, a.participants))
              .map((school) => (
                <div className="dashboard-school-row" key={school.schoolName}>
                  <span>{school.schoolName}</span>
                  <span>{school.participants} 人</span>
                  <span>{school.solved} 題</span>
                  <span>{Math.round(school.totalScore / Math.max(1, school.participants))} 分</span>
                </div>
              ))}
            {Object.keys(dashboard?.schoolStats ?? {}).length === 0 && <p className="muted table-empty">尚無提交。</p>}
          </div>
        </div>
      </div>

      <div className="admin-subsection">
        <h4>最近提交</h4>
        <div className="admin-table">
          <div className="admin-table-head dashboard-recent-row">
            <span>時間</span>
            <span>參賽者</span>
            <span>題目</span>
            <span>分數</span>
            <span>狀態</span>
          </div>
          {recent.length === 0 && <p className="muted table-empty">尚無提交。</p>}
          {recent.map((item) => (
            <div className="dashboard-recent-row" key={item.id}>
              <span>{formatContestDateTime(item.createdAt)}</span>
              <span>
                {item.username} {showNames ? item.displayName : ""}
              </span>
              <span>{item.problemTitle}</span>
              <span>
                {item.score}/{item.maxScore}
              </span>
              <span className={item.isFullScore ? "status-pill" : "status-pill warning"}>{item.isFullScore ? "全對" : item.status}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
