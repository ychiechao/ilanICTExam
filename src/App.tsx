import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  FileJson,
  History,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  Save,
  Trophy,
  Upload,
} from "lucide-react";
import BlocklyWorkspace from "./components/BlocklyWorkspace";
import { hasFirebaseConfig } from "./firebase";
import { isAdmin, isDemoAdmin, initializeFirstAdmin, loginWithGoogle, logout, subscribeToAuth } from "./services/authStore";
import { gradeProblem, runCustomTest } from "./services/gradingEngine";
import { loadLeaderboard } from "./services/leaderboardService";
import { importProblemsFromJson, loadProblems } from "./services/problemStore";
import { loadSubmissions, saveSubmission, MAX_SUBMISSIONS_PER_PROBLEM } from "./services/submissionService";
import type {
  AppUser,
  GradeResult,
  LeaderboardEntry,
  Problem,
  SubmissionRecord,
  WorkspaceMode,
} from "./types";

const APP_TITLE = "宜蘭縣資訊科技創意實作競賽";

type TabKey = "statement" | "test" | "score" | "history" | "leaderboard" | "admin";

const tabs: Array<{ key: TabKey; label: string; icon: typeof Play }> = [
  { key: "statement", label: "題目說明", icon: FileJson },
  { key: "test", label: "自行測試", icon: Play },
  { key: "score", label: "評分", icon: CheckCircle2 },
  { key: "history", label: "評分紀錄", icon: History },
  { key: "leaderboard", label: "排行榜", icon: Trophy },
  { key: "admin", label: "管理", icon: Upload },
];

export default function App() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selectedProblemId, setSelectedProblemId] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("statement");
  const [mode, setMode] = useState<WorkspaceMode>("Scratch");
  const [generatedCode, setGeneratedCode] = useState("");
  const [blocklyXml, setBlocklyXml] = useState("");
  const [recordXml, setRecordXml] = useState("");
  const [user, setUser] = useState<AppUser | null>(null);
  const [admin, setAdmin] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [customOutput, setCustomOutput] = useState("");
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [importJson, setImportJson] = useState(defaultImportJson);
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);

  const selectedProblem = useMemo(
    () => problems.find((problem) => problem.id === selectedProblemId) || problems[0],
    [problems, selectedProblemId],
  );

  const workspaceStorageKey = selectedProblem
    ? `yilan-workspace-${selectedProblem.id}-${mode}`
    : "yilan-workspace";

  useEffect(() => {
    document.title = APP_TITLE;
    loadProblems().then((loaded) => {
      setProblems(loaded);
      setSelectedProblemId((current) => current || loaded[0]?.id || "");
      setCustomInput(loaded[0]?.examples[0]?.input || loaded[0]?.cases[0]?.input || "");
    });
  }, []);

  useEffect(() => {
    return subscribeToAuth(async (nextUser) => {
      setUser(nextUser);
      setAdmin(nextUser ? await isAdmin(nextUser.uid) : isDemoAdmin());
    });
  }, []);

  useEffect(() => {
    if (!selectedProblem) {
      return;
    }
    setCustomInput(selectedProblem.examples[0]?.input || selectedProblem.cases[0]?.input || "");
    setCustomOutput("");
    setGradeResult(null);
    setRecordXml("");
    loadSubmissions(user?.uid || "guest", selectedProblem.id).then(setSubmissions);
    loadLeaderboard(selectedProblem.id).then(setLeaderboard);
  }, [selectedProblem, user?.uid]);

  const handleWorkspaceChange = useCallback((payload: { code: string; xml: string }) => {
    setGeneratedCode(payload.code);
    setBlocklyXml(payload.xml);
  }, []);

  async function handleLogin() {
    if (loginBusy) {
      return;
    }
    setLoginBusy(true);
    try {
      setStatusMessage("");
      await loginWithGoogle();
    } catch (error) {
      setStatusMessage(getLoginErrorMessage(error));
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleInitializeAdmin() {
    if (!user && hasFirebaseConfig) {
      setStatusMessage("請先登入 Gmail 再初始化管理者。");
      return;
    }
    setAdminBusy(true);
    setStatusMessage("");
    const demoUser = user || {
      uid: "demo-admin",
      displayName: "本機管理者",
      email: "",
    };
    try {
      const status = await initializeFirstAdmin(demoUser);
      if (status === "created" || status === "already-admin" || status === "local-demo") {
        setAdmin(true);
      }
      if (status === "created") {
        setStatusMessage("已啟用管理模式，你現在是第一位管理者。");
      } else if (status === "already-admin") {
        setStatusMessage("你已經是管理者。");
      } else if (status === "bootstrap-exists") {
        setAdmin(false);
        setStatusMessage("管理者已存在，請使用已授權的管理者帳號登入。");
      } else {
        setStatusMessage("已啟用本機管理模式。");
      }
    } catch (error) {
      setAdmin(isDemoAdmin());
      setStatusMessage(getFirebaseAdminErrorMessage(error));
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleCustomTest() {
    setBusy(true);
    setStatusMessage("");
    try {
      const result = await runCustomTest(generatedCode, customInput);
      setCustomOutput(result.error ? `錯誤：${result.error}` : result.output || "沒有輸出");
    } catch (error) {
      setCustomOutput(error instanceof Error ? error.message : "執行失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleGrade() {
    if (!selectedProblem) {
      return;
    }
    setBusy(true);
    setStatusMessage("");
    try {
      const result = await gradeProblem(selectedProblem, generatedCode);
      setGradeResult(result);
      const record = await saveSubmission(user, selectedProblem, result, mode, blocklyXml, generatedCode);
      setSubmissions((current) => [record, ...current]);
      if (user) {
        setLeaderboard(await loadLeaderboard(selectedProblem.id));
      }
      setStatusMessage(
        user ? "已完成前端計分並寫入紀錄。" : "訪客評分已保存於本機，登入後可寫入排行榜。",
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "評分失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportProblems() {
    setBusy(true);
    setStatusMessage("");
    try {
      const imported = await importProblemsFromJson(importJson);
      const loaded = await loadProblems();
      setProblems(loaded);
      setSelectedProblemId(imported[0]?.id || loaded[0]?.id || "");
      setStatusMessage(`已匯入 ${imported.length} 題。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "題目匯入失敗。");
    } finally {
      setBusy(false);
    }
  }

  function resetWorkspace() {
    localStorage.removeItem(workspaceStorageKey);
    window.location.reload();
  }

  if (!selectedProblem) {
    return (
      <main className="loading-screen">
        <RefreshCw className="spin" />
        <span>載入平台中...</span>
      </main>
    );
  }

  const totalScore = selectedProblem.cases.reduce((sum, item) => sum + item.score, 0);
  const publicCases = selectedProblem.cases.filter((item) => item.visibility === "public").length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="county-label">前端計分練習版</p>
          <h1>{APP_TITLE}</h1>
        </div>
        <div className="header-actions">
          <span className="plan-badge">Cloudflare Pages + Firebase Spark</span>
          {user ? (
            <div className="user-chip">
              {user.photoURL && <img src={user.photoURL} alt="" />}
              <span>{user.displayName}</span>
              <button className="icon-button" onClick={() => logout()} title="登出">
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <button className="primary-button" onClick={handleLogin} disabled={loginBusy}>
              <LogIn size={17} />
              {loginBusy ? "登入中" : "Gmail 登入"}
            </button>
          )}
        </div>
      </header>

      <section className="notice-row">
        <AlertTriangle size={17} />
        本平台為純前端計分 MVP，hidden 測資只做介面隱藏，不具正式競賽防作弊能力。
      </section>

      <main className="workspace-layout">
        <aside className="problem-rail">
          <button className="rail-title">題目列表</button>
          {problems.map((problem) => (
            <button
              key={problem.id}
              className={problem.id === selectedProblem.id ? "problem-item active" : "problem-item"}
              onClick={() => setSelectedProblemId(problem.id)}
            >
              <span>{problem.title}</span>
              <small>{problem.category}</small>
            </button>
          ))}
        </aside>

        <section className="editor-panel">
          <div className="editor-toolbar">
            <div>
              <strong>{selectedProblem.title}</strong>
              <span>
                {selectedProblem.cases.length} 筆測資 / {totalScore} 分
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
            <button className="ghost-button" onClick={resetWorkspace}>
              <RefreshCw size={16} />
              重設
            </button>
          </div>
          <BlocklyWorkspace
            mode={mode}
            storageKey={workspaceStorageKey}
            recordXml={recordXml}
            onChange={handleWorkspaceChange}
          />
        </section>

        <section className="side-panel">
          <div className="vertical-tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  className={activeTab === tab.key ? "active" : ""}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="tab-content">
            {activeTab === "statement" && (
              <StatementPanel problem={selectedProblem} publicCases={publicCases} totalScore={totalScore} />
            )}
            {activeTab === "test" && (
              <TestPanel
                input={customInput}
                output={customOutput}
                busy={busy}
                onInputChange={setCustomInput}
                onRun={handleCustomTest}
              />
            )}
            {activeTab === "score" && (
              <ScorePanel
                result={gradeResult}
                busy={busy}
                user={user}
                onGrade={handleGrade}
                submissions={submissions}
              />
            )}
            {activeTab === "history" && (
              <HistoryPanel submissions={submissions} onLoad={(xml) => setRecordXml(xml)} />
            )}
            {activeTab === "leaderboard" && <LeaderboardPanel leaderboard={leaderboard} />}
            {activeTab === "admin" && (
              <AdminPanel
                admin={admin}
                importJson={importJson}
                onImportJsonChange={setImportJson}
                onInitializeAdmin={handleInitializeAdmin}
                onImport={handleImportProblems}
                firebaseReady={hasFirebaseConfig}
                busy={busy}
                adminBusy={adminBusy}
              />
            )}
          </div>
        </section>
      </main>

      {statusMessage && <div className="toast">{statusMessage}</div>}
    </div>
  );
}

function getLoginErrorMessage(error: unknown) {
  const code = getErrorCode(error);

  if (code === "auth/cancelled-popup-request") {
    return "登入視窗已被新的登入要求取消，請稍等一下再按一次。";
  }
  if (code === "auth/popup-closed-by-user") {
    return "你已關閉登入視窗，若要登入請再按一次 Gmail 登入。";
  }
  if (code === "auth/popup-blocked") {
    return "瀏覽器封鎖了登入視窗，請允許彈出視窗後再試一次。";
  }

  return error instanceof Error ? error.message : "登入失敗。";
}

function getFirebaseAdminErrorMessage(error: unknown) {
  const code = getErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("permission-denied") || combined.includes("insufficient permissions")) {
    return "Firestore Rules 尚未發布或權限不足。請到 Firebase Console 的 Firestore Rules 貼上 firestore.rules 並發布。";
  }
  if (
    combined.includes("連線逾時") ||
    combined.includes("deadline-exceeded") ||
    combined.includes("unavailable")
  ) {
    return "Firestore 連線逾時，請確認 Firestore Database 已建立，並稍後再試。";
  }
  if (combined.includes("failed-precondition") || combined.includes("not-found")) {
    return "Firestore Database 可能尚未建立，請先到 Firebase Console 建立 Firestore Database。";
  }

  return message || "初始化管理者失敗，請確認 Firebase Firestore 已建立且 Rules 已發布。";
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
}

function StatementPanel({
  problem,
  publicCases,
  totalScore,
}: {
  problem: Problem;
  publicCases: number;
  totalScore: number;
}) {
  return (
    <div className="panel-scroll">
      <div className="panel-heading">
        <h2>{problem.title}</h2>
        <span>{problem.difficulty}</span>
      </div>
      <p className="statement-text">{problem.description}</p>
      <InfoBlock title="輸入格式" body={problem.inputFormat} />
      <InfoBlock title="輸出格式" body={problem.outputFormat} />
      <div className="metric-grid">
        <Metric label="公開測資" value={`${publicCases} 筆`} />
        <Metric label="總分" value={`${totalScore} 分`} />
      </div>
      <h3>範例</h3>
      {problem.examples.length === 0 && <p className="muted">此題未設定範例。</p>}
      {problem.examples.map((example) => (
        <div className="example-box" key={example.title}>
          <strong>{example.title}</strong>
          <span>輸入</span>
          <pre>{example.input}</pre>
          <span>輸出</span>
          <pre>{example.output}</pre>
          {example.description && <p>{example.description}</p>}
        </div>
      ))}
    </div>
  );
}

function TestPanel({
  input,
  output,
  busy,
  onInputChange,
  onRun,
}: {
  input: string;
  output: string;
  busy: boolean;
  onInputChange: (value: string) => void;
  onRun: () => void;
}) {
  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>自行測試</h2>
        <span>不寫入排行榜</span>
      </div>
      <textarea
        className="code-input"
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        placeholder="輸入測試資料，空白或換行都會依序餵給詢問積木。"
      />
      <button className="primary-button wide" onClick={onRun} disabled={busy}>
        <Play size={17} />
        執行測試
      </button>
      <div className="output-box">
        <span>輸出結果</span>
        <pre>{output || "尚未執行"}</pre>
      </div>
    </div>
  );
}

function ScorePanel({
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
  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>前端計分</h2>
        <span>{submissions.length}/{MAX_SUBMISSIONS_PER_PROBLEM} 次</span>
      </div>
      {!user && <p className="warning-text">訪客可計分，但只保存於本機；登入後才會寫入排行榜。</p>}
      <button className="primary-button wide" onClick={onGrade} disabled={busy}>
        <Save size={17} />
        正式計分
      </button>
      {result && (
        <>
          <div className="score-card">
            <strong>
              {result.score} / {result.maxScore}
            </strong>
            <span>通過 {result.passedCases} / {result.totalCases}，答題率 {Math.round(result.passRate * 100)}%</span>
          </div>
          <div className="case-list">
            {result.cases.map((item) => (
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

function HistoryPanel({
  submissions,
  onLoad,
}: {
  submissions: SubmissionRecord[];
  onLoad: (xml: string) => void;
}) {
  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>評分紀錄</h2>
        <span>{submissions.length} 筆</span>
      </div>
      {submissions.length === 0 && <p className="muted">尚無紀錄。</p>}
      {submissions.map((item) => (
        <div className="history-row" key={item.id}>
          <div>
            <strong>
              {item.score} / {item.maxScore}
            </strong>
            <span>{new Date(item.createdAt).toLocaleString("zh-TW")}</span>
          </div>
          <button className="ghost-button" onClick={() => onLoad(item.blocklyXml)}>
            載入
          </button>
        </div>
      ))}
    </div>
  );
}

function LeaderboardPanel({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>排行榜</h2>
        <span>前端計分版</span>
      </div>
      {leaderboard.length === 0 && <p className="muted">尚無登入使用者提交紀錄。</p>}
      {leaderboard.map((entry, index) => (
        <div className="leader-row" key={entry.uid}>
          <span className="rank">{index + 1}</span>
          <div>
            <strong>{entry.displayName}</strong>
            <small>{Math.round(entry.passRate * 100)}% / {entry.submitCount} 次</small>
          </div>
          <strong>{entry.score}</strong>
        </div>
      ))}
    </div>
  );
}

function AdminPanel({
  admin,
  importJson,
  firebaseReady,
  busy,
  adminBusy,
  onImportJsonChange,
  onInitializeAdmin,
  onImport,
}: {
  admin: boolean;
  importJson: string;
  firebaseReady: boolean;
  busy: boolean;
  adminBusy: boolean;
  onImportJsonChange: (value: string) => void;
  onInitializeAdmin: () => void;
  onImport: () => void;
}) {
  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>題目管理</h2>
        <span>{admin ? "管理者" : "未啟用"}</span>
      </div>
      {!firebaseReady && (
        <p className="warning-text">目前未設定 Firebase，管理資料會保存於本機 localStorage。</p>
      )}
      {!admin ? (
        <button className="primary-button wide" onClick={onInitializeAdmin} disabled={adminBusy}>
          <Upload size={17} />
          {adminBusy ? "初始化中..." : "初始化管理者"}
        </button>
      ) : (
        <>
          <textarea
            className="json-input"
            value={importJson}
            onChange={(event) => onImportJsonChange(event.target.value)}
          />
          <button className="primary-button wide" onClick={onImport} disabled={busy}>
            <Upload size={17} />
            匯入 JSON 題目
          </button>
        </>
      )}
    </div>
  );
}

function InfoBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="info-block">
      <span>{title}</span>
      <p>{body}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const defaultImportJson = JSON.stringify(
  {
    title: "範例題目",
    description: "請輸入兩個數字並輸出總和。",
    inputFormat: "兩個整數。",
    outputFormat: "兩數總和。",
    difficulty: "easy",
    category: "運算",
    examples: [{ title: "範例一", input: "3 5", output: "8" }],
    cases: [
      {
        groupTitle: "公開測資",
        caseTitle: "C1",
        input: "3 5",
        output: "8",
        score: 10,
        visibility: "public",
      },
      {
        groupTitle: "練習測資",
        caseTitle: "C2",
        input: "10 11",
        output: "21",
        score: 10,
        visibility: "hidden",
      },
    ],
  },
  null,
  2,
);
