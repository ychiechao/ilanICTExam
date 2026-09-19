import { useEffect, useState } from "react";
import { loadLeaderboardScope } from "../../services/leaderboardService";
import type { AppUser, LeaderboardEntry, LeaderboardScope } from "../../types";
import { formatContestDateTime } from "../../utils/format";

interface LeaderboardPanelProps {
  user: AppUser | null;
  schoolId?: string;
  schoolName?: string;
  /** 學生已加入的班級、或教師開的班級。 */
  classOptions: Array<{ id: string; name: string }>;
  /** 提交後遞增，讓排行榜重新讀取。 */
  refreshKey: number;
}

type ScopeKind = LeaderboardScope["kind"];

/** 三層排行榜（計畫 4.2）：班級／學校／全縣，各自從 userStats 查詢。 */
export function LeaderboardPanel({ user, schoolId, schoolName, classOptions, refreshKey }: LeaderboardPanelProps) {
  const [kind, setKind] = useState<ScopeKind>("county");
  const [classId, setClassId] = useState(classOptions[0]?.id ?? "");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedUid, setExpandedUid] = useState("");

  useEffect(() => {
    if (!classOptions.some((item) => item.id === classId)) setClassId(classOptions[0]?.id ?? "");
  }, [classId, classOptions]);

  const scope: LeaderboardScope | null =
    kind === "county" ? { kind: "county" } : kind === "school" ? (schoolId ? { kind: "school", schoolId } : null) : classId ? { kind: "class", classId } : null;
  const scopeKey = scope ? JSON.stringify(scope) : "";

  useEffect(() => {
    if (!scopeKey) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    loadLeaderboardScope(JSON.parse(scopeKey) as LeaderboardScope)
      .then((items) => {
        if (!cancelled) setEntries(items);
      })
      .catch((reason) => {
        if (!cancelled) {
          setEntries([]);
          setError(reason instanceof Error ? reason.message : "排行榜讀取失敗。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey, refreshKey]);

  const myRank = user ? entries.findIndex((entry) => entry.uid === user.uid) + 1 : 0;
  const tabs: Array<{ key: ScopeKind; label: string; disabled?: boolean; hint?: string }> = [
    { key: "class", label: "班級", disabled: classOptions.length === 0, hint: "加入班級後才有班級排行" },
    { key: "school", label: schoolName ? `學校` : "學校", disabled: !schoolId, hint: "設定學校後才有學校排行" },
    { key: "county", label: "全縣" },
  ];
  const title = kind === "county" ? "全縣排行榜" : kind === "school" ? `${schoolName || "學校"}排行榜` : `${classOptions.find((item) => item.id === classId)?.name || "班級"}排行榜`;

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>依答題率排名 · 點選可展開</span>
      </div>
      <div className="leaderboard-scope">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={kind === tab.key ? "primary-button" : "ghost-button"}
            disabled={tab.disabled}
            title={tab.disabled ? tab.hint : undefined}
            onClick={() => setKind(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        {kind === "class" && classOptions.length > 1 && (
          <select value={classId} onChange={(event) => setClassId(event.target.value)}>
            {classOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        {myRank > 0 && <span className="muted leaderboard-my-rank">我的名次：第 {myRank} 名</span>}
      </div>
      {error && <p className="warning-text">{error}</p>}
      {loading && entries.length === 0 && <p className="muted">讀取中…</p>}
      {!loading && !error && entries.length === 0 && <p className="muted">{scope ? "尚無提交紀錄。" : "尚未加入班級或設定學校。"}</p>}
      {entries.map((entry, index) => {
        const expanded = expandedUid === entry.uid;
        const toggle = () => setExpandedUid(expanded ? "" : entry.uid);
        const isMe = user?.uid === entry.uid;
        return (
          <div className={[expanded ? "leader-item expanded" : "leader-item", isMe ? "me" : ""].join(" ").trim()} key={entry.uid}>
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
                  完成 {entry.completedCount || 0}/{entry.totalProblems || 0} 題，{entry.totalScore ?? entry.score}/{entry.totalMaxScore ?? entry.maxScore} 分，
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
