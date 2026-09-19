import { useCallback, useEffect, useMemo, useState } from "react";
import { loadContestAccounts } from "../../services/contestAccountStore";
import { loadContestProblems, type ContestProblem } from "../../services/contestProblemStore";
import {
  loadReviewEntries,
  loadReviewEvents,
  loadReviewSubmissions,
  restoreSubmission,
  voidSubmission,
  type ReviewEntry,
  type ReviewEvent,
  type ReviewSubmission,
} from "../../services/contestReviewStore";
import { GraderError, hasGraderConfig } from "../../services/grader";
import type { ContestAccount, ContestEvent } from "../../types";
import { csvDateStamp, downloadCsv } from "../../utils/csv";
import { formatContestDateTime } from "../../utils/format";
import { Metric } from "../ui";

interface ReviewSectionProps {
  contests: ContestEvent[];
  busy: boolean;
  onStatus: (message: string) => void;
}

/** 結束前幾秒內的提交要標記（規格 8.8）。 */
const LATE_WINDOW_MS = 60_000;
/** 離開考試畫面達幾次要標記。 */
const LEAVE_FLAG_COUNT = 3;

interface ParticipantRow {
  username: string;
  name: string;
  schoolName: string;
  schoolSeq?: number;
  totalScore: number;
  solvedCount: number;
  submitCount: number;
  voidedCount: number;
  leaveCount: number;
  pasteCount: number;
  fingerprintChanged: boolean;
  flags: string[];
  submissions: ReviewSubmission[];
  bestByProblem: ReviewEntry["bestByProblem"];
}

/**
 * 後台「成績審核」：該場全部提交依人彙總、異常標記（相同程式碼、結束前提交、離開次數、貼上、裝置變更）、
 * 單筆作廢／恢復（Worker /void 會重算排行）、匯出成績總表與提交明細。
 */
export function ReviewSection({ contests, busy, onStatus }: ReviewSectionProps) {
  const candidates = contests.filter((contest) => contest.status !== "draft" && contest.status !== "roster");
  const [contestId, setContestId] = useState(candidates[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState("");
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([]);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [entries, setEntries] = useState<ReviewEntry[]>([]);
  const [accounts, setAccounts] = useState<ContestAccount[]>([]);
  const [problems, setProblems] = useState<ContestProblem[]>([]);
  const [filter, setFilter] = useState<"all" | "flagged" | "voided">("all");
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState("");
  const [codeView, setCodeView] = useState<ReviewSubmission | null>(null);
  const [working, setWorking] = useState(false);

  const contest = contests.find((item) => item.id === contestId);

  useEffect(() => {
    if (!contestId && candidates[0]) setContestId(candidates[0].id);
  }, [candidates, contestId]);

  const reload = useCallback(async () => {
    if (!contestId) return;
    setLoading(true);
    try {
      const [subs, evts, ents, accs, probs] = await Promise.all([
        loadReviewSubmissions(contestId),
        loadReviewEvents(contestId),
        loadReviewEntries(contestId),
        loadContestAccounts(contestId),
        loadContestProblems(contestId),
      ]);
      setSubmissions(subs);
      setEvents(evts);
      setEntries(ents);
      setAccounts(accs);
      setProblems(probs);
      setLoadedAt(new Date().toISOString());
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "審核資料讀取失敗。");
    } finally {
      setLoading(false);
    }
  }, [contestId, onStatus]);

  // 換賽事就清掉舊資料；要按「載入」才讀，避免切換頁籤時就抓整場提交。
  useEffect(() => {
    setSubmissions([]);
    setEvents([]);
    setEntries([]);
    setAccounts([]);
    setProblems([]);
    setLoadedAt("");
    setExpanded("");
    setCodeView(null);
  }, [contestId]);

  // 相同程式碼：同一題、相同 codeHash、不同人。
  const duplicateOwners = useMemo(() => {
    const byKey = new Map<string, Set<string>>();
    for (const item of submissions) {
      if (!item.codeHash || item.voided) continue;
      const key = `${item.problemId}:${item.codeHash}`;
      const set = byKey.get(key) ?? new Set<string>();
      set.add(item.username);
      byKey.set(key, set);
    }
    const result = new Map<string, string[]>();
    for (const [key, owners] of byKey) {
      if (owners.size > 1) result.set(key, [...owners].sort());
    }
    return result;
  }, [submissions]);

  const endAtMs = contest?.endAt ? Date.parse(contest.endAt) : NaN;
  function isLate(item: ReviewSubmission) {
    if (!Number.isFinite(endAtMs) || !item.createdAt) return false;
    const at = Date.parse(item.createdAt);
    return at >= endAtMs - LATE_WINDOW_MS;
  }
  function duplicatesOf(item: ReviewSubmission) {
    const owners = duplicateOwners.get(`${item.problemId}:${item.codeHash}`) ?? [];
    return owners.filter((username) => username !== item.username);
  }

  const rows = useMemo<ParticipantRow[]>(() => {
    const byUsername = new Map<string, ReviewSubmission[]>();
    for (const item of submissions) {
      const list = byUsername.get(item.username) ?? [];
      list.push(item);
      byUsername.set(item.username, list);
    }
    const entryByUsername = new Map(entries.map((entry) => [entry.username, entry]));
    const accountByUsername = new Map(accounts.map((account) => [account.username, account]));
    const eventsByUsername = new Map<string, ReviewEvent[]>();
    for (const event of events) {
      const list = eventsByUsername.get(event.username) ?? [];
      list.push(event);
      eventsByUsername.set(event.username, list);
    }
    const usernames = new Set<string>([...byUsername.keys(), ...accounts.map((account) => account.username)]);
    const result: ParticipantRow[] = [];
    for (const username of usernames) {
      const list = (byUsername.get(username) ?? []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const entry = entryByUsername.get(username);
      const account = accountByUsername.get(username);
      const userEvents = eventsByUsername.get(username) ?? [];
      const leaveCount = userEvents.filter((event) => event.type === "fullscreen_exit" || event.type === "tab_hidden").length;
      const pasteCount = userEvents.filter((event) => event.type === "paste").length;
      const fingerprintChanged = userEvents.some((event) => event.type === "fingerprint_changed");
      const flags: string[] = [];
      const dupProblems = new Set(list.filter((item) => !item.voided && duplicatesOf(item).length > 0).map((item) => item.problemTitle));
      if (dupProblems.size > 0) flags.push(`程式碼與他人相同（${[...dupProblems].join("、")}）`);
      const lateCount = list.filter((item) => !item.voided && isLate(item)).length;
      if (lateCount > 0) flags.push(`結束前 60 秒提交 ${lateCount} 次`);
      if (leaveCount >= LEAVE_FLAG_COUNT) flags.push(`離開考試畫面 ${leaveCount} 次`);
      if (pasteCount > 0) flags.push(`貼上 ${pasteCount} 次`);
      if (fingerprintChanged) flags.push("登入裝置變更");
      result.push({
        username,
        name: account?.name || list[0]?.displayName || username,
        schoolName: account?.schoolName ?? "",
        schoolSeq: account?.schoolSeq,
        totalScore: entry?.totalScore ?? 0,
        solvedCount: entry?.solvedCount ?? 0,
        submitCount: list.filter((item) => !item.voided).length,
        voidedCount: list.filter((item) => item.voided).length,
        leaveCount,
        pasteCount,
        fingerprintChanged,
        flags,
        submissions: list,
        bestByProblem: entry?.bestByProblem ?? {},
      });
    }
    result.sort((a, b) => b.totalScore - a.totalScore || b.solvedCount - a.solvedCount || a.username.localeCompare(b.username));
    return result;
  }, [submissions, entries, accounts, events, duplicateOwners, endAtMs]);

  const visibleRows = rows.filter((row) => {
    if (filter === "flagged" && row.flags.length === 0) return false;
    if (filter === "voided" && row.voidedCount === 0) return false;
    if (keyword.trim()) {
      const text = keyword.trim().toLowerCase();
      return row.username.toLowerCase().includes(text) || row.name.includes(text) || row.schoolName.includes(text);
    }
    return true;
  });
  const flaggedCount = rows.filter((row) => row.flags.length > 0).length;
  const voidedCount = submissions.filter((item) => item.voided).length;
  const sortedProblems = problems.slice().sort((a, b) => a.order - b.order);

  async function handleVoid(item: ReviewSubmission) {
    if (!contest) return;
    const reason = window.prompt(`作廢 ${item.username}「${item.problemTitle}」第 ${item.attempt} 次（${item.score} 分）。\n請填寫作廢原因（會寫入操作紀錄）：`, "");
    if (reason === null) return;
    if (!reason.trim()) {
      onStatus("作廢需要填寫原因。");
      return;
    }
    setWorking(true);
    try {
      await voidSubmission(contest.id, item.id, reason.trim());
      onStatus(`已作廢 ${item.username}「${item.problemTitle}」第 ${item.attempt} 次，排行榜已重算。`);
      await reload();
    } catch (error) {
      onStatus(error instanceof GraderError || error instanceof Error ? error.message : "作廢失敗。");
    } finally {
      setWorking(false);
    }
  }

  async function handleRestore(item: ReviewSubmission) {
    if (!contest) return;
    if (!window.confirm(`恢復 ${item.username}「${item.problemTitle}」第 ${item.attempt} 次（${item.score} 分）？`)) return;
    setWorking(true);
    try {
      await restoreSubmission(contest.id, item.id);
      onStatus(`已恢復 ${item.username}「${item.problemTitle}」第 ${item.attempt} 次，排行榜已重算。`);
      await reload();
    } catch (error) {
      onStatus(error instanceof GraderError || error instanceof Error ? error.message : "恢復失敗。");
    } finally {
      setWorking(false);
    }
  }

  function downloadScoreCsv() {
    const header = ["名次", "學校序號", "學校", "姓名", "帳號", "總分", "完成題數", "有效提交", "作廢提交", "離開次數", "異常標記", ...sortedProblems.map((problem) => `${problem.order}. ${problem.title}`)];
    const body = rows.map((row, index) => [
      row.totalScore > 0 || row.submitCount > 0 ? index + 1 : "",
      row.schoolSeq ?? "",
      row.schoolName,
      row.name,
      row.username,
      row.totalScore,
      row.solvedCount,
      row.submitCount,
      row.voidedCount,
      row.leaveCount,
      row.flags.join("；"),
      ...sortedProblems.map((problem) => row.bestByProblem[problem.problemId]?.score ?? ""),
    ]);
    downloadCsv(`成績總表-${contest?.title ?? contestId}-${csvDateStamp()}.csv`, header, body);
  }

  function downloadSubmissionCsv() {
    const accountByUsername = new Map(accounts.map((account) => [account.username, account]));
    const header = ["學校", "姓名", "帳號", "題目", "第幾次", "時間", "分數", "滿分", "通過測資", "狀態", "程式碼雜湊", "相同程式碼者", "結束前60秒", "作廢", "作廢原因"];
    const body = submissions.map((item) => [
      accountByUsername.get(item.username)?.schoolName ?? "",
      accountByUsername.get(item.username)?.name ?? item.displayName,
      item.username,
      item.problemTitle,
      item.attempt,
      formatContestDateTime(item.createdAt),
      item.score,
      item.maxScore,
      `${item.passedCases}/${item.totalCases}`,
      item.status,
      item.codeHash.slice(0, 12),
      duplicatesOf(item).join(" "),
      isLate(item) ? "是" : "",
      item.voided ? "是" : "",
      item.voidReason,
    ]);
    downloadCsv(`提交明細-${contest?.title ?? contestId}-${csvDateStamp()}.csv`, header, body);
  }

  if (candidates.length === 0) {
    return (
      <section className="admin-section">
        <h3>成績審核</h3>
        <p className="muted">還沒有進行中或已結束的賽事。</p>
      </section>
    );
  }

  const disabled = busy || loading || working;

  return (
    <section className="admin-section">
      <div className="section-title-row">
        <div>
          <h3>成績審核</h3>
          <p>
            依參賽者彙總全部提交並標記異常；作廢單筆提交會立即重算該人的排行榜與儀表板。
            {loadedAt ? `資料載入時間：${formatContestDateTime(loadedAt)}` : "請先按「載入提交」。"}
          </p>
        </div>
        <div className="admin-file-actions">
          <label className="inline-admin-select">
            賽事
            <select value={contestId} onChange={(event) => setContestId(event.target.value)} disabled={disabled}>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="button" onClick={() => void reload()} disabled={disabled || !contestId}>
            {loading ? "載入中…" : loadedAt ? "重新載入" : "載入提交"}
          </button>
          <button className="ghost-button" type="button" onClick={downloadScoreCsv} disabled={rows.length === 0}>
            匯出成績總表
          </button>
          <button className="ghost-button" type="button" onClick={downloadSubmissionCsv} disabled={submissions.length === 0}>
            匯出提交明細
          </button>
        </div>
      </div>

      {!hasGraderConfig() && <p className="warning-text">尚未設定評分伺服器位址（VITE_GRADER_URL），無法作廢。</p>}

      {loadedAt && (
        <>
          <div className="metric-row dashboard-metrics">
            <Metric label="參賽者" value={`${rows.length} 人`} />
            <Metric label="有提交" value={`${rows.filter((row) => row.submitCount > 0 || row.voidedCount > 0).length} 人`} />
            <Metric label="提交總數" value={`${submissions.length} 筆`} />
            <Metric label="有異常標記" value={`${flaggedCount} 人`} />
            <Metric label="已作廢" value={`${voidedCount} 筆`} />
            <Metric label="相同程式碼組" value={`${duplicateOwners.size} 組`} />
          </div>

          <div className="admin-file-actions review-filters">
            {(["all", "flagged", "voided"] as const).map((key) => (
              <button
                key={key}
                className={filter === key ? "primary-button" : "ghost-button"}
                type="button"
                onClick={() => setFilter(key)}
              >
                {key === "all" ? "全部" : key === "flagged" ? "只看有異常" : "只看有作廢"}
              </button>
            ))}
            <input
              className="review-search"
              value={keyword}
              placeholder="搜尋帳號、姓名、學校"
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>

          <div className="admin-table">
            <div className="admin-table-head review-row">
              <span>#</span>
              <span>帳號</span>
              <span>姓名／學校</span>
              <span>總分</span>
              <span>完成</span>
              <span>提交</span>
              <span>離開</span>
              <span>異常標記</span>
            </div>
            {visibleRows.length === 0 && <p className="muted table-empty">沒有符合條件的參賽者。</p>}
            {visibleRows.map((row) => {
              const rank = rows.indexOf(row) + 1;
              const open = expanded === row.username;
              return (
                <div key={row.username}>
                  <button
                    type="button"
                    className={open ? "review-row review-row-button open" : "review-row review-row-button"}
                    onClick={() => setExpanded(open ? "" : row.username)}
                  >
                    <span>{rank}</span>
                    <span className="mono">{row.username}</span>
                    <span>
                      <strong>{row.name}</strong>
                      <small>{row.schoolName}</small>
                    </span>
                    <span>{row.totalScore}</span>
                    <span>{row.solvedCount}</span>
                    <span>
                      {row.submitCount}
                      {row.voidedCount > 0 && <small className="warning-text">（作廢 {row.voidedCount}）</small>}
                    </span>
                    <span className={row.leaveCount >= LEAVE_FLAG_COUNT ? "warning-text" : ""}>{row.leaveCount}</span>
                    <span className={row.flags.length > 0 ? "warning-text" : "muted"}>{row.flags.length > 0 ? row.flags.join("；") : "-"}</span>
                  </button>
                  {open && (
                    <div className="review-detail">
                      {row.submissions.length === 0 && <p className="muted">沒有提交。</p>}
                      {row.submissions.length > 0 && (
                        <div className="admin-table">
                          <div className="admin-table-head review-submission-row">
                            <span>題目</span>
                            <span>次</span>
                            <span>時間</span>
                            <span>分數</span>
                            <span>測資</span>
                            <span>標記</span>
                            <span>操作</span>
                          </div>
                          {row.submissions.map((item) => {
                            const dups = duplicatesOf(item);
                            const late = isLate(item);
                            const isCurrent = !item.voided && row.bestByProblem[item.problemId]?.at === item.createdAt;
                            return (
                              <div className={item.voided ? "review-submission-row voided" : "review-submission-row"} key={item.id}>
                                <span>
                                  {item.problemTitle}
                                  {isCurrent && <small className="ok-text">（計分）</small>}
                                </span>
                                <span>{item.attempt}</span>
                                <span>{formatContestDateTime(item.createdAt)}</span>
                                <span>
                                  {item.score} / {item.maxScore}
                                </span>
                                <span>
                                  {item.passedCases}/{item.totalCases}
                                </span>
                                <span className={dups.length > 0 || late ? "warning-text" : "muted"}>
                                  {item.voided
                                    ? `已作廢：${item.voidReason || "-"}${item.voidedByName ? `（${item.voidedByName}）` : ""}`
                                    : [dups.length > 0 ? `與 ${dups.join("、")} 相同` : "", late ? "結束前 60 秒" : ""].filter(Boolean).join("；") || "-"}
                                </span>
                                <span className="review-actions">
                                  <button className="ghost-button" type="button" onClick={() => setCodeView(item)}>
                                    程式碼
                                  </button>
                                  {item.voided ? (
                                    <button className="ghost-button" type="button" disabled={disabled} onClick={() => void handleRestore(item)}>
                                      恢復
                                    </button>
                                  ) : (
                                    <button className="danger-button" type="button" disabled={disabled} onClick={() => void handleVoid(item)}>
                                      作廢
                                    </button>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {codeView && (
        <div className="review-code-overlay" role="dialog" aria-modal="true" onClick={() => setCodeView(null)}>
          <div className="review-code-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row compact">
              <div>
                <h4>
                  {codeView.username}「{codeView.problemTitle}」第 {codeView.attempt} 次
                </h4>
                <p className="muted">
                  {formatContestDateTime(codeView.createdAt)} · {codeView.score} / {codeView.maxScore} 分 · 雜湊 {codeView.codeHash.slice(0, 12)}
                </p>
              </div>
              <button className="ghost-button" type="button" onClick={() => setCodeView(null)}>
                關閉
              </button>
            </div>
            <pre className="review-code">{codeView.generatedCode || "（沒有程式碼）"}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
