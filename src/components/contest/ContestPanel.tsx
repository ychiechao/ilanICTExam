import { CheckCircle2, FileJson, History, Play, Send, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { subscribeDashboard, type ContestDashboard } from "../../services/dashboardStore";
import { runCustomTest } from "../../services/gradingEngine";
import { GraderError, graderRequest } from "../../services/grader";
import type { ContestProblem } from "../../services/contestProblemStore";
import type { AppUser, WorkspaceMode } from "../../types";
import { formatContestDateTime } from "../../utils/format";
import { runInteractiveProgram } from "../../utils/practice";
import BlocklyWorkspace from "../BlocklyWorkspace";
import { Metric } from "../ui";

interface ContestPanelProps {
  user: AppUser;
  maxSubmissions: number;
  dashboardVisibility: "organizer" | "participants" | "public";
}

interface CaseResultView {
  caseTitle: string;
  groupTitle: string;
  visibility: "public" | "hidden";
  passed: boolean;
  earnedScore: number;
  score: number;
  error?: string;
  input?: string;
  expected?: string;
  actual?: string;
}

interface ContestSubmissionView {
  id: string;
  problemId: string;
  attempt: number;
  score: number;
  maxScore: number;
  passedCases: number;
  totalCases: number;
  status: string;
  isFullScore: boolean;
  createdAt: string;
  caseResults: CaseResultView[];
  blocklyXml: string;
}

type SideTab = "statement" | "test" | "submit" | "history" | "board";

/**
 * 參賽者作答區：左側題目清單、中央積木、右側題目說明／自行測試／評分／評分紀錄（／排行榜）。
 * 與練習模式同樣有「執行程式」（互動輸入）。提交送 Worker /grade；
 * 評分結果與紀錄都來自 onSnapshot 訂閱自己的 contestSubmissions，換題、重新整理都會保留。
 */
export function ContestPanel({ user, maxSubmissions, dashboardVisibility }: ContestPanelProps) {
  const contestId = user.contestId ?? "";
  const [problems, setProblems] = useState<ContestProblem[]>([]);
  const [submissions, setSubmissions] = useState<ContestSubmissionView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<WorkspaceMode>("Scratch");
  const [tab, setTab] = useState<SideTab>("statement");
  const [generatedCode, setGeneratedCode] = useState("");
  const [blocklyXml, setBlocklyXml] = useState("");
  /** 從評分紀錄「載入」時塞回工作區的 XML；換題時清空。 */
  const [recordXml, setRecordXml] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastResult, setLastResult] = useState<ContestSubmissionView | null>(null);
  const [dashboard, setDashboard] = useState<ContestDashboard | null>(null);
  const boardOpen = dashboardVisibility !== "organizer";

  // 主辦單位開放排行榜時才訂閱（Rules 也只在開放時允許讀）。
  useEffect(() => {
    if (!boardOpen) {
      setDashboard(null);
      return;
    }
    return subscribeDashboard(contestId, setDashboard);
  }, [boardOpen, contestId]);
  useEffect(() => {
    if (!boardOpen && tab === "board") setTab("statement");
  }, [boardOpen, tab]);

  // 題目：該場的公開部分（Rules 只允許該場競賽帳號讀）。
  useEffect(() => {
    if (!db || !contestId) return;
    return onSnapshot(query(collection(db, "contestProblems"), where("contestId", "==", contestId)), (snapshot) => {
      const list = snapshot.docs
        .map((item) => ({ id: item.id, ...(item.data() as Omit<ContestProblem, "id">) }))
        .sort((a, b) => a.order - b.order);
      setProblems(list);
      setSelectedId((current) => current || list[0]?.problemId || "");
    });
  }, [contestId]);

  // 自己的提交紀錄。
  useEffect(() => {
    if (!db || !contestId) return;
    return onSnapshot(
      query(collection(db, "contestSubmissions"), where("contestId", "==", contestId), where("uid", "==", user.uid)),
      (snapshot) => {
        const list = snapshot.docs.map((item) => {
          const data = item.data();
          return {
            id: item.id,
            problemId: String(data.problemId ?? ""),
            attempt: Number(data.attempt ?? 0),
            score: Number(data.score ?? 0),
            maxScore: Number(data.maxScore ?? 0),
            passedCases: Number(data.passedCases ?? 0),
            totalCases: Number(data.totalCases ?? 0),
            status: String(data.status ?? ""),
            isFullScore: data.isFullScore === true,
            createdAt: String(data.createdAtIso ?? ""),
            caseResults: Array.isArray(data.caseResults) ? (data.caseResults as CaseResultView[]) : [],
            blocklyXml: typeof data.blocklyXml === "string" ? data.blocklyXml : "",
          } satisfies ContestSubmissionView;
        });
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setSubmissions(list);
      },
    );
  }, [contestId, user.uid]);

  const selected = problems.find((item) => item.problemId === selectedId);
  const submissionsByProblem = useMemo(() => {
    const grouped = new Map<string, ContestSubmissionView[]>();
    for (const item of submissions) {
      grouped.set(item.problemId, [...(grouped.get(item.problemId) ?? []), item]);
    }
    return grouped;
  }, [submissions]);
  const currentSubmissions = selected ? (submissionsByProblem.get(selected.problemId) ?? []) : [];
  // 成績以最後一次提交為準（submissions 已依時間新到舊排序）。
  const bestOf = (problemId: string) => submissionsByProblem.get(problemId)?.[0] ?? null;
  const remaining = selected ? Math.max(0, maxSubmissions - currentSubmissions.length) : 0;
  // 顯示在「評分」頁的結果：剛提交的那一次，否則是這一題最近一次（換題、重新整理後仍看得到）。
  const shownResult = lastResult && lastResult.problemId === selected?.problemId ? lastResult : (currentSubmissions[0] ?? null);
  const solvedCount = problems.filter((problem) => bestOf(problem.problemId)?.isFullScore).length;
  const attemptedCount = problems.filter((problem) => (submissionsByProblem.get(problem.problemId)?.length ?? 0) > 0).length;

  useEffect(() => {
    if (selected) {
      setTestInput(selected.examples[0]?.input ?? "");
      setTestOutput("");
      setLastResult(null);
      setRecordXml("");
      setMessage("");
    }
  }, [selected?.problemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWorkspaceChange = useCallback((payload: { code: string; xml: string }) => {
    setGeneratedCode(payload.code);
    setBlocklyXml(payload.xml);
  }, []);

  /** 與練習模式相同的「執行程式」：每個輸入積木跳出對話框讓參賽者輸入。 */
  async function handleInteractiveRun() {
    if (!generatedCode.trim()) {
      setTab("test");
      setTestOutput("目前沒有可執行的積木，請確認工作區已有程式積木。");
      return;
    }
    setBusy(true);
    setTab("test");
    setTestOutput("執行中…");
    try {
      const result = await runInteractiveProgram(generatedCode, (prompt) => {
        const value = window.prompt(prompt.trim() || "請輸入資料");
        if (value === null) throw new Error("執行已取消。");
        return value;
      });
      setTestOutput(result.error ? `${result.output}\n[錯誤] ${result.error}`.trim() : result.output || "(沒有輸出)");
    } catch (error) {
      setTestOutput(error instanceof Error ? error.message : "執行失敗。");
    } finally {
      setBusy(false);
    }
  }

  function handleLoadRecord(item: ContestSubmissionView) {
    if (!item.blocklyXml) {
      setMessage("這筆紀錄沒有保存積木內容。");
      return;
    }
    if (!window.confirm(`載入第 ${item.attempt} 次提交的積木？目前工作區的內容會被取代。`)) return;
    setRecordXml("");
    window.setTimeout(() => setRecordXml(item.blocklyXml), 0);
  }

  async function handleTest() {
    if (!generatedCode.trim()) {
      setTestOutput("目前沒有可執行的積木，請確認工作區已有程式積木。");
      return;
    }
    setBusy(true);
    try {
      const result = await runCustomTest(generatedCode, testInput);
      setTestOutput(result.error ? `${result.output}\n[錯誤] ${result.error}` : result.output || "(沒有輸出)");
    } catch (error) {
      setTestOutput(error instanceof Error ? error.message : "執行失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!selected) return;
    if (!generatedCode.trim()) {
      setMessage("目前沒有可執行的積木，請確認工作區已有程式積木。");
      return;
    }
    if (!window.confirm(`確定提交「${selected.title}」？這一題還剩 ${remaining} 次機會。
成績以最後一次提交為準，若這次分數比之前低，會以這次的分數計算。`)) return;
    setBusy(true);
    setMessage("評分中…");
    try {
      const result = await graderRequest<{ submission: ContestSubmissionView }>("/grade", {
        body: { problemId: selected.problemId, generatedCode, blocklyXml, mode },
        timeoutMs: 60000,
      });
      setLastResult(result.submission);
      setMessage(
        result.submission.isFullScore
          ? `全部通過！${result.submission.score}/${result.submission.maxScore} 分。`
          : `通過 ${result.submission.passedCases}/${result.submission.totalCases} 筆測資，${result.submission.score}/${result.submission.maxScore} 分。`,
      );
      setTab("submit");
    } catch (error) {
      setMessage(error instanceof GraderError || error instanceof Error ? error.message : "提交失敗。");
    } finally {
      setBusy(false);
    }
  }

  if (problems.length === 0) {
    return (
      <main className="announcement-main">
        <section className="announcement-card contest-stage">
          <span className="status-pill">比賽進行中</span>
          <h2>題目準備中</h2>
          <p className="muted">主辦單位尚未開放題目，請留在此畫面等待。</p>
        </section>
      </main>
    );
  }

  const tabs: Array<{ key: SideTab; label: string; icon: typeof Play }> = [
    { key: "statement", label: "題目說明", icon: FileJson },
    { key: "test", label: "自行測試", icon: Play },
    { key: "submit", label: "評分", icon: Send },
    { key: "history", label: "評分紀錄", icon: History },
    ...(boardOpen ? [{ key: "board" as SideTab, label: "排行榜", icon: Trophy }] : []),
  ];

  return (
    <main className="workspace-layout">
      <aside className="problem-rail">
        <button className="rail-title">題目列表</button>
        <div className="rail-filters">
          <span>{problems.length} 題 · 每題最多提交 {maxSubmissions} 次 · 成績以最後一次提交為準</span>
        </div>
        {problems.map((problem) => {
          const best = bestOf(problem.problemId);
          const used = submissionsByProblem.get(problem.problemId)?.length ?? 0;
          return (
            <button
              key={problem.id}
              className={problem.problemId === selectedId ? "problem-item active" : "problem-item"}
              onClick={() => setSelectedId(problem.problemId)}
            >
              <span className="problem-item-title">
                {problem.order}. {problem.title}
                {best?.isFullScore && <CheckCircle2 size={14} className="ok-text" />}
              </span>
              <small>
                {best ? `最近 ${best.score}/${problem.maxScore} 分` : "尚未提交"} · 已提交 {used}/{maxSubmissions}
              </small>
            </button>
          );
        })}
      </aside>

      {selected && (
        <>
          <section className="editor-panel">
            <div className="editor-toolbar">
              <div>
                <strong>
                  {selected.order}. {selected.title}
                </strong>
                <span>
                  {selected.caseCount} 筆測資（{selected.publicCaseCount} 筆公開）/ {selected.maxScore} 分 · 剩餘 {remaining} 次
                </span>
              </div>
              <div className="segmented">
                <button className={mode === "Scratch" ? "selected" : ""} onClick={() => setMode("Scratch")}>
                  Scratch
                </button>
                <button className={mode === "Blockly" ? "selected" : ""} onClick={() => setMode("Blockly")}>
                  Blockly
                </button>
              </div>
              <div className="toolbar-actions">
                <button className="primary-button" onClick={() => void handleInteractiveRun()} disabled={busy}>
                  <Play size={16} />
                  執行程式
                </button>
                <button className="danger-button" onClick={() => void handleSubmit()} disabled={busy || remaining === 0}>
                  <Send size={16} />
                  提交評分
                </button>
              </div>
            </div>
            <BlocklyWorkspace
              mode={mode}
              storageKey={`contest-workspace-${contestId}-${selected.problemId}`}
              recordXml={recordXml}
              onChange={handleWorkspaceChange}
            />
          </section>

          <section className="side-panel">
            <div className="vertical-tabs">
              {tabs.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="tab-content">
              {tab === "statement" && (
                <div className="panel-stack">
                  <div className="panel-heading">
                    <h2>{selected.title}</h2>
                    <span>{selected.category}</span>
                  </div>
                  <p className="statement-text">{selected.description}</p>
                  <div className="info-block">
                    <strong>輸入格式</strong>
                    <p>{selected.inputFormat}</p>
                  </div>
                  <div className="info-block">
                    <strong>輸出格式</strong>
                    <p>{selected.outputFormat}</p>
                  </div>
                  <p className="muted input-model-hint">
                    每個「要求輸入」積木會依序取得一個數值，空白與換行都算分隔。要讀多個數值請用迴圈，不需要自己切割字串。
                  </p>
                  {selected.examples.map((example, index) => (
                    <div className="example-box" key={index}>
                      <strong>{example.title || `範例 ${index + 1}`}</strong>
                      <div>
                        <span>輸入</span>
                        <pre>{example.input}</pre>
                      </div>
                      <div>
                        <span>輸出</span>
                        <pre>{example.output}</pre>
                      </div>
                      {example.description && <p className="muted">{example.description}</p>}
                    </div>
                  ))}
                </div>
              )}

              {tab === "test" && (
                <div className="panel-stack">
                  <div className="panel-heading">
                    <h2>自行測試</h2>
                    <span>在你的電腦執行，不計分</span>
                  </div>
                  <textarea
                    className="code-input"
                    value={testInput}
                    onChange={(event) => setTestInput(event.target.value)}
                    placeholder="輸入測試資料，空白或換行都會依序餵給輸入積木。"
                  />
                  <div className="test-action-grid">
                    <button className="primary-button wide" onClick={() => void handleInteractiveRun()} disabled={busy}>
                      <Play size={17} />
                      執行程式
                    </button>
                    <button className="ghost-button wide" onClick={() => void handleTest()} disabled={busy}>
                      <Play size={17} />
                      用測試資料執行
                    </button>
                  </div>
                  <div className="output-box">
                    <span>輸出結果</span>
                    <pre>{testOutput || "尚未執行"}</pre>
                  </div>
                </div>
              )}

              {tab === "board" && (
                <div className="panel-stack">
                  <div className="panel-heading">
                    <h2>排行榜</h2>
                    <span>{dashboard?.submittedCount ?? 0} 人已提交</span>
                  </div>
                  {(dashboard?.ranking ?? []).length === 0 && <p className="muted">尚無提交。</p>}
                  {(dashboard?.ranking ?? []).map((row) => (
                    <div className={row.username === user.contestUsername ? "leader-row me" : "leader-row"} key={row.username}>
                      <span className="rank">{row.rank}</span>
                      <div>
                        <strong>{row.name || row.username}</strong>
                        <small>
                          {row.schoolName ? row.schoolName + " · " : ""}完成 {row.solvedCount} 題 · {row.submitCount} 次
                        </small>
                      </div>
                      <strong>{row.totalScore}</strong>
                    </div>
                  ))}
                </div>
              )}

              {tab === "submit" && (
                <div className="panel-stack">
                  <div className="panel-heading">
                    <h2>正式評分</h2>
                    <span>
                      {currentSubmissions.length}/{maxSubmissions} 次
                    </span>
                  </div>
                  <button className="danger-button wide" onClick={() => void handleSubmit()} disabled={busy || remaining === 0}>
                    <Send size={17} />
                    {busy ? "評分中…" : remaining === 0 ? "已用完提交次數" : "提交這一題"}
                  </button>
                  {message && <p className={lastResult?.isFullScore ? "ok-text" : "warning-text"}>{message}</p>}
                  {shownResult ? (
                    <>
                      <p className="muted">
                        第 {shownResult.attempt} 次提交 · {formatContestDateTime(shownResult.createdAt)}
                      </p>
                      <SubmissionResult submission={shownResult} />
                    </>
                  ) : (
                    <p className="muted">這一題還沒有提交。提交後這裡會顯示評分結果，換題或重新整理也會保留。</p>
                  )}
                </div>
              )}

              {tab === "history" && (
                <div className="panel-stack">
                  <div className="panel-heading">
                    <h2>評分紀錄</h2>
                    <span>
                      {solvedCount}/{problems.length} 題全對
                    </span>
                  </div>
                  <div className="practice-summary-grid">
                    <Metric label="全對" value={`${solvedCount} 題`} />
                    <Metric label="已提交" value={`${attemptedCount} 題`} />
                    <Metric label="未提交" value={`${problems.length - attemptedCount} 題`} />
                  </div>
                  <div className="practice-list">
                    {problems.map((problem) => {
                      const best = bestOf(problem.problemId);
                      const used = submissionsByProblem.get(problem.problemId)?.length ?? 0;
                      return (
                        <button
                          key={problem.problemId}
                          className={problem.problemId === selectedId ? "practice-row active" : "practice-row"}
                          onClick={() => setSelectedId(problem.problemId)}
                        >
                          <span>
                            <strong>
                              {problem.order}. {problem.title}
                            </strong>
                            <small>{problem.maxScore} 分</small>
                          </span>
                          <span className="practice-row-meta">
                            <span className={best?.isFullScore ? "status-pill" : used > 0 ? "status-pill warning" : "status-pill disabled"}>
                              {best?.isFullScore ? "全對" : used > 0 ? `最近 ${best?.score ?? 0} 分` : "未提交"}
                            </span>
                            <small>
                              {used}/{maxSubmissions} 次
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="panel-heading compact-heading">
                    <h2>本題提交紀錄</h2>
                    <span>{currentSubmissions.length} 次</span>
                  </div>
                  {currentSubmissions.length === 0 && <p className="muted">這一題還沒有提交。</p>}
                  {currentSubmissions.map((item) => (
                    <div className="history-row" key={item.id}>
                      <div>
                        <strong>
                          第 {item.attempt} 次 · {item.score}/{item.maxScore} 分
                        </strong>
                        <span>
                          {formatContestDateTime(item.createdAt)} · 通過 {item.passedCases}/{item.totalCases}
                          {" · "}
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => {
                              setLastResult(item);
                              setMessage("");
                              setTab("submit");
                            }}
                          >
                            看結果
                          </button>
                        </span>
                      </div>
                      <button className="ghost-button" type="button" onClick={() => handleLoadRecord(item)}>
                        載入
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function SubmissionResult({ submission }: { submission: ContestSubmissionView }) {
  return (
    <>
      <div className="score-card">
        <strong>
          {submission.score} / {submission.maxScore}
        </strong>
        <span>
          通過 {submission.passedCases} / {submission.totalCases} 筆測資
        </span>
      </div>
      <div className="case-list">
        {submission.caseResults.map((item) => (
          <div className={item.passed ? "case-row contest-case passed" : "case-row contest-case"} key={item.caseTitle}>
            <span>
              {item.caseTitle}
              {item.visibility === "hidden" ? "（隱藏）" : ""}
            </span>
            <strong>{item.passed ? `通過 +${item.earnedScore}` : "未通過"}</strong>
            <small>
              {item.passed
                ? ""
                : item.error
                  ? item.error
                  : item.visibility === "public" && item.expected !== undefined
                    ? `預期 ${item.expected} ／ 實際 ${item.actual || "(無輸出)"}`
                    : "隱藏測資不顯示內容"}
            </small>
          </div>
        ))}
      </div>
    </>
  );
}
