import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
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
import { loadAdminUids, loadManagedUsers, setManagedUserAdmin } from "./services/adminService";
import { isAdmin, isDemoAdmin, initializeFirstAdmin, loginWithGoogle, logout, subscribeToAuth } from "./services/authStore";
import { gradeProblem, runCustomTest } from "./services/gradingEngine";
import { loadGlobalLeaderboard, updateGlobalLeaderboard } from "./services/leaderboardService";
import {
  exportProblemsToCsv,
  getProblemCsvTemplate,
  importProblemsFromCsv,
  importProblemsFromJson,
  loadProblems,
  type ProblemImportResult,
  type ProblemImportMode,
} from "./services/problemStore";
import {
  loadAllSubmissions,
  loadSubmissions,
  loadUserSubmissions,
  saveSubmission,
  MAX_SUBMISSIONS_PER_PROBLEM,
} from "./services/submissionService";
import type {
  AppUser,
  GradeResult,
  LeaderboardEntry,
  ManagedUser,
  Problem,
  SubmissionRecord,
  WorkspaceMode,
} from "./types";

const APP_TITLE = "宜蘭縣資訊科技創意實作競賽";

type TabKey = "statement" | "test" | "score" | "history" | "leaderboard" | "admin";
type PracticeStatus = "completed" | "in-progress" | "not-started";
type AdminSectionKey = "problems" | "users" | "progress";

interface PracticeStats {
  status: PracticeStatus;
  bestScore: number;
  maxScore: number;
  bestPassRate: number;
  submitCount: number;
  hasDraft: boolean;
  lastSubmittedAt?: string;
  lastMode?: WorkspaceMode;
}

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
  const [practiceSubmissions, setPracticeSubmissions] = useState<SubmissionRecord[]>([]);
  const [adminSubmissions, setAdminSubmissions] = useState<SubmissionRecord[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [importJson, setImportJson] = useState(defaultImportJson);
  const [importCsv, setImportCsv] = useState(getProblemCsvTemplate());
  const [problemImportMode, setProblemImportMode] = useState<ProblemImportMode>("append");
  const [editingProblemId, setEditingProblemId] = useState("");
  const [editingProblemJson, setEditingProblemJson] = useState("");
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [managedAdminUids, setManagedAdminUids] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminDataBusy, setAdminDataBusy] = useState(false);
  const [yearFilter, setYearFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const xmlFileInputRef = useRef<HTMLInputElement | null>(null);

  const years = useMemo(
    () =>
      Array.from(new Set(problems.map((problem) => problem.year).filter(Boolean) as string[])).sort((a, b) =>
        b.localeCompare(a, "zh-Hant", { numeric: true }),
      ),
    [problems],
  );

  const categories = useMemo(() => {
    const categorySource =
      yearFilter === "all" ? problems : problems.filter((problem) => problem.year === yearFilter);
    return Array.from(new Set(categorySource.map((problem) => problem.category))).sort((a, b) =>
      a.localeCompare(b, "zh-Hant", { numeric: true }),
    );
  }, [problems, yearFilter]);

  const visibleProblems = useMemo(
    () =>
      problems.filter(
        (problem) =>
          (yearFilter === "all" || problem.year === yearFilter) &&
          (categoryFilter === "all" || problem.category === categoryFilter),
      ),
    [categoryFilter, problems, yearFilter],
  );

  const selectedProblem = useMemo(
    () =>
      visibleProblems.find((problem) => problem.id === selectedProblemId) ||
      visibleProblems[0] ||
      problems.find((problem) => problem.id === selectedProblemId) ||
      problems[0],
    [problems, selectedProblemId, visibleProblems],
  );

  const workspaceStorageKey = selectedProblem
    ? getSharedWorkspaceKey(selectedProblem.id)
    : "yilan-workspace";

  const legacyWorkspaceStorageKeys = useMemo(() => {
    if (!selectedProblem) {
      return [];
    }
    const scratchKey = getLegacyWorkspaceKey(selectedProblem.id, "Scratch");
    const blocklyKey = getLegacyWorkspaceKey(selectedProblem.id, "Blockly");
    return mode === "Scratch" ? [scratchKey, blocklyKey] : [blocklyKey, scratchKey];
  }, [mode, selectedProblem]);

  const practiceStatsByProblemId = useMemo(
    () => buildPracticeStatsByProblem(problems, practiceSubmissions),
    [generatedCode, practiceSubmissions, problems],
  );

  const selectedPracticeStats = selectedProblem
    ? practiceStatsByProblemId[selectedProblem.id]
    : undefined;
  const adminMaximized = activeTab === "admin" && admin;

  const availableTabs = useMemo(
    () => (admin ? tabs : tabs.filter((tab) => tab.key !== "admin")),
    [admin],
  );

  useEffect(() => {
    document.title = APP_TITLE;
    loadProblems().then((loaded) => {
      setProblems(loaded);
      setSelectedProblemId((current) => current || loaded[0]?.id || "");
      setCustomInput(getDefaultTestInput(loaded[0]));
    });
    loadGlobalLeaderboard().then(setLeaderboard);
  }, []);

  useEffect(() => {
    return subscribeToAuth(async (nextUser) => {
      setUser(nextUser);
      setAdmin(nextUser ? await isAdmin(nextUser.uid) : isDemoAdmin());
    });
  }, []);

  useEffect(() => {
    let active = true;
    loadUserSubmissions(user?.uid)
      .then((records) => {
        if (active) {
          setPracticeSubmissions(records);
        }
      })
      .catch(() => {
        if (active) {
          setPracticeSubmissions([]);
        }
      });

    return () => {
      active = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (visibleProblems.length === 0) {
      return;
    }
    if (!visibleProblems.some((problem) => problem.id === selectedProblemId)) {
      setSelectedProblemId(visibleProblems[0].id);
    }
  }, [selectedProblemId, visibleProblems]);

  useEffect(() => {
    if (!selectedProblem) {
      return;
    }
    setCustomInput(getDefaultTestInput(selectedProblem));
    setCustomOutput("");
    setGradeResult(null);
    setRecordXml("");
    ensureSolveStartedAt(selectedProblem.id);
    loadSubmissions(user?.uid, selectedProblem.id).then(setSubmissions);
  }, [selectedProblem, user?.uid]);

  useEffect(() => {
    if (!admin && activeTab === "admin") {
      setActiveTab("statement");
    }
  }, [activeTab, admin]);

  const handleWorkspaceChange = useCallback((payload: { code: string; xml: string }) => {
    setGeneratedCode(payload.code);
    setBlocklyXml(payload.xml);
    if (selectedProblem?.id && hasMeaningfulWorkspaceXml(payload.xml)) {
      ensureSolveStartedAt(selectedProblem.id);
    }
  }, [selectedProblem?.id]);

  const loadAdminData = useCallback(async () => {
    if (!admin) {
      return;
    }

    setAdminDataBusy(true);
    try {
      const [nextUsers, nextAdminUids, nextSubmissions] = await Promise.all([
        loadManagedUsers(),
        loadAdminUids(),
        loadAllSubmissions(),
      ]);
      setManagedUsers(nextUsers);
      setManagedAdminUids(nextAdminUids);
      setAdminSubmissions(nextSubmissions);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "管理資料讀取失敗。");
    } finally {
      setAdminDataBusy(false);
    }
  }, [admin]);

  useEffect(() => {
    if (activeTab === "admin" && admin) {
      loadAdminData();
    }
  }, [activeTab, admin, loadAdminData]);

  function handleModeChange(nextMode: WorkspaceMode) {
    if (nextMode === mode) {
      return;
    }
    if (blocklyXml) {
      localStorage.setItem(workspaceStorageKey, blocklyXml);
    }
    setRecordXml("");
    setMode(nextMode);
  }

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
    if (!generatedCode.trim()) {
      setCustomOutput("目前沒有可執行的積木，請確認工作區已有程式積木。");
      return;
    }
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

  async function handleInteractiveRun() {
    if (!generatedCode.trim()) {
      setActiveTab("test");
      setCustomOutput("目前沒有可執行的積木，請確認工作區已有程式積木。");
      return;
    }
    setBusy(true);
    setStatusMessage("");
    setActiveTab("test");
    setCustomOutput("執行中...");
    try {
      const result = await runInteractiveProgram(generatedCode, requestProgramInput);
      setCustomOutput(result.error ? `錯誤：${result.error}` : result.output || "沒有輸出");
    } catch (error) {
      setCustomOutput(error instanceof Error ? error.message : "執行失敗。");
    } finally {
      setBusy(false);
    }
  }

  function requestProgramInput(message: string) {
    const value = window.prompt(message.trim() || "請輸入資料");
    if (value === null) {
      throw new Error("執行已取消。");
    }
    return value;
  }

  async function handleGrade() {
    if (!selectedProblem) {
      return;
    }
    if (!generatedCode.trim()) {
      setGradeResult(null);
      setStatusMessage("目前沒有可執行的積木，請確認工作區已有程式積木。");
      return;
    }
    setBusy(true);
    setStatusMessage("");
    try {
      const result = await gradeProblem(selectedProblem, generatedCode);
      setGradeResult(result);
      const solveStartedAt = getSolveStartedAt(selectedProblem.id);
      const record = await saveSubmission(
        user,
        selectedProblem,
        result,
        mode,
        blocklyXml,
        generatedCode,
        solveStartedAt,
      );
      const nextPracticeSubmissions = mergeSubmissionRecord(practiceSubmissions, record);
      setSubmissions((current) => mergeSubmissionRecord(current, record));
      setPracticeSubmissions(nextPracticeSubmissions);
      if (user) {
        setLeaderboard(await updateGlobalLeaderboard(user, problems, nextPracticeSubmissions));
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
      const result = await importProblemsFromJson(importJson, problemImportMode);
      const loaded = await loadProblems();
      setProblems(loaded);
      if (result.imported[0]?.year) {
        setYearFilter(result.imported[0].year);
      }
      setCategoryFilter("all");
      setSelectedProblemId(result.imported[0]?.id || loaded[0]?.id || "");
      setStatusMessage(formatImportStatus("JSON", result));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "題目匯入失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportCsvProblems() {
    setBusy(true);
    setStatusMessage("");
    try {
      const result = await importProblemsFromCsv(importCsv, problemImportMode);
      const loaded = await loadProblems();
      setProblems(loaded);
      if (result.imported[0]?.year) {
        setYearFilter(result.imported[0].year);
      }
      setCategoryFilter("all");
      setSelectedProblemId(result.imported[0]?.id || loaded[0]?.id || "");
      setStatusMessage(formatImportStatus("CSV", result));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "CSV 題目匯入失敗。");
    } finally {
      setBusy(false);
    }
  }

  function handleExportCsvProblems() {
    const csv = exportProblemsToCsv(problems);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ilanICTExam-problems.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleSelectProblemForEdit(problemId: string) {
    const problem = problems.find((item) => item.id === problemId);
    setEditingProblemId(problemId);
    setEditingProblemJson(problem ? JSON.stringify(problem, null, 2) : "");
  }

  async function handleSaveEditedProblem() {
    if (!editingProblemJson.trim()) {
      setStatusMessage("請先選擇題目或貼上單題 JSON。");
      return;
    }

    setBusy(true);
    setStatusMessage("");
    try {
      const result = await importProblemsFromJson(editingProblemJson, "overwrite");
      const loaded = await loadProblems();
      setProblems(loaded);
      setSelectedProblemId(result.imported[0]?.id || selectedProblemId);
      setEditingProblemId(result.imported[0]?.id || editingProblemId);
      setStatusMessage(`已更新 ${result.imported.length} 題。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "題目 JSON 儲存失敗。");
    } finally {
      setBusy(false);
    }
  }

  function handleDownloadXml() {
    const xml = blocklyXml || localStorage.getItem(workspaceStorageKey) || "";
    if (!xml.trim()) {
      setStatusMessage("目前沒有可下載的積木資料。");
      return;
    }

    const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugFileName(selectedProblem?.title || "workspace")}.xml`;
    link.click();
    URL.revokeObjectURL(url);
    setStatusMessage("已下載目前積木 XML。");
  }

  function handleUploadXmlFile(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const xml = String(reader.result || "");
      if (!xml.includes("<xml")) {
        setStatusMessage("這個檔案看起來不是 Blockly XML。");
        return;
      }
      if (!selectedProblem) {
        setStatusMessage("請先選擇題目再上傳 XML。");
        return;
      }
      localStorage.setItem(workspaceStorageKey, xml);
      ensureSolveStartedAt(selectedProblem.id);
      setRecordXml(xml);
      setStatusMessage("已載入 XML 到目前題目的工作區。");
      if (xmlFileInputRef.current) {
        xmlFileInputRef.current.value = "";
      }
    };
    reader.onerror = () => setStatusMessage("XML 檔案讀取失敗。");
    reader.readAsText(file);
  }

  async function handleSetManagedUserAdmin(target: ManagedUser, makeAdmin: boolean) {
    if (target.uid === user?.uid) {
      setStatusMessage("為避免誤鎖管理權限，不能在這裡變更自己的管理者身分。");
      return;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      await setManagedUserAdmin(target, makeAdmin, user);
      await loadAdminData();
      setStatusMessage(makeAdmin ? "已設為管理者。" : "已改為一般使用者。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "使用者權限更新失敗。");
    } finally {
      setAdminBusy(false);
    }
  }

  function resetWorkspace() {
    localStorage.removeItem(workspaceStorageKey);
    legacyWorkspaceStorageKeys.forEach((key) => localStorage.removeItem(key));
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

      <main className={adminMaximized ? "workspace-layout admin-maximized" : "workspace-layout"}>
        <aside className="problem-rail">
          <button className="rail-title">題目列表</button>
          <div className="rail-filters">
            <label>
              年份
              <select
                value={yearFilter}
                onChange={(event) => {
                  setYearFilter(event.target.value);
                  setCategoryFilter("all");
                }}
              >
                <option value="all">全部年份</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year} 年度
                  </option>
                ))}
              </select>
            </label>
            <label>
              分類
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">全部分類</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <span>{visibleProblems.length} 題</span>
          </div>
          {visibleProblems.map((problem) => {
            const stats = practiceStatsByProblemId[problem.id];
            return (
              <button
                key={problem.id}
                className={problem.id === selectedProblem.id ? "problem-item active" : "problem-item"}
                onClick={() => setSelectedProblemId(problem.id)}
              >
                <span className="problem-item-title">
                  {problem.title}
                  <PracticeStatusBadge stats={stats} compact />
                </span>
                <small>
                  {problem.year ? `${problem.year} 年度 / ${problem.category}` : problem.category}
                  <br />
                  {formatPracticeSubtitle(stats)}
                </small>
              </button>
            );
          })}
        </aside>

        <section className="editor-panel">
          <div className="editor-toolbar">
            <div>
              <strong>{selectedProblem.title}</strong>
              <span>
                {selectedProblem.year ? `${selectedProblem.year} 年度 / ` : ""}
                {selectedProblem.category} / {publicCases} 筆公開測資 / {totalScore} 分
                <PracticeStatusBadge stats={selectedPracticeStats} />
              </span>
            </div>
            <div className="segmented">
              <button className={mode === "Scratch" ? "selected" : ""} onClick={() => handleModeChange("Scratch")}>
                Scratch
              </button>
              <button className={mode === "Blockly" ? "selected" : ""} onClick={() => handleModeChange("Blockly")}>
                Blockly
              </button>
            </div>
            <div className="toolbar-actions">
              <button className="primary-button" onClick={handleInteractiveRun} disabled={busy}>
                <Play size={16} />
                執行程式
              </button>
              <button className="ghost-button" onClick={handleDownloadXml}>
                <Download size={16} />
                下載 XML
              </button>
              <button className="ghost-button" onClick={() => xmlFileInputRef.current?.click()}>
                <Upload size={16} />
                上傳 XML
              </button>
              <input
                ref={xmlFileInputRef}
                className="hidden-file-input"
                type="file"
                accept=".xml,text/xml,application/xml"
                onChange={(event) => handleUploadXmlFile(event.target.files?.[0])}
              />
              <button className="ghost-button" onClick={resetWorkspace}>
                <RefreshCw size={16} />
                重設
              </button>
            </div>
          </div>
          <BlocklyWorkspace
            mode={mode}
            storageKey={workspaceStorageKey}
            fallbackStorageKeys={legacyWorkspaceStorageKeys}
            recordXml={recordXml}
            onChange={handleWorkspaceChange}
          />
        </section>

        <section className="side-panel">
          <div className="vertical-tabs">
            {availableTabs.map((tab) => {
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
              <HistoryPanel
                problems={problems}
                selectedProblemId={selectedProblem.id}
                statsByProblemId={practiceStatsByProblemId}
                submissions={submissions}
                onLoad={(xml) => {
                  localStorage.setItem(workspaceStorageKey, xml);
                  ensureSolveStartedAt(selectedProblem.id);
                  setRecordXml(xml);
                }}
                onSelectProblem={(problemId) => {
                  setSelectedProblemId(problemId);
                  setActiveTab("statement");
                }}
              />
            )}
            {activeTab === "leaderboard" && <LeaderboardPanel leaderboard={leaderboard} />}
            {activeTab === "admin" && (
              <AdminPanel
                admin={admin}
                adminDataBusy={adminDataBusy}
                adminSubmissions={adminSubmissions}
                adminUids={managedAdminUids}
                currentUser={user}
                problems={problems}
                users={managedUsers}
                importJson={importJson}
                importCsv={importCsv}
                importMode={problemImportMode}
                editingProblemId={editingProblemId}
                editingProblemJson={editingProblemJson}
                onImportJsonChange={setImportJson}
                onImportCsvChange={setImportCsv}
                onImportModeChange={setProblemImportMode}
                onEditingProblemJsonChange={setEditingProblemJson}
                onInitializeAdmin={handleInitializeAdmin}
                onImport={handleImportProblems}
                onImportCsv={handleImportCsvProblems}
                onExportCsv={handleExportCsvProblems}
                onSelectProblemForEdit={handleSelectProblemForEdit}
                onSaveEditedProblem={handleSaveEditedProblem}
                onRefreshAdminData={loadAdminData}
                onSetUserAdmin={handleSetManagedUserAdmin}
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

function getDefaultTestInput(problem: Problem | undefined) {
  return problem?.examples[0]?.input || problem?.cases.find((item) => item.visibility === "public")?.input || "";
}

async function runInteractiveProgram(
  code: string,
  askInput: (message: string) => string,
): Promise<{ output: string; error?: string }> {
  const output: string[] = [];
  const maxOutputLength = 2000;
  const alertOutput = (value: unknown) => {
    const text = String(value);
    output.push(text);
    window.alert(text);
  };
  const consoleProxy = {
    log: (...values: unknown[]) => output.push(values.map(String).join(" ")),
  };
  const promptSync = (message = "") => askInput(String(message || "請輸入資料"));
  const windowProxy = {
    alert: alertOutput,
    prompt: promptSync,
  };

  try {
    const runner = new Function("window", "prompt", "alert", "console", code);
    runner(windowProxy, promptSync, alertOutput, consoleProxy);
    const joined = output.join(" ").trim();
    return {
      output:
        joined.length > maxOutputLength
          ? `${joined.slice(0, maxOutputLength)}...(輸出過長，已截斷)`
          : joined,
    };
  } catch (error) {
    return {
      output: output.join(" ").trim(),
      error: error instanceof Error ? error.message : "執行失敗",
    };
  }
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
        <Metric label="年份" value={problem.year ? `${problem.year} 年度` : "未設定"} />
        <Metric label="分類" value={problem.category} />
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
      <div className="test-action-grid">
        <button className="primary-button wide removed-interactive-run" onClick={() => undefined} disabled={busy}>
          <Play size={17} />
          互動執行程式
        </button>
        <button className="ghost-button wide" onClick={onRun} disabled={busy}>
          <Play size={17} />
          用測試資料執行
        </button>
      </div>
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
  const publicCaseResults = result?.cases.filter((item) => item.visibility !== "hidden") || [];
  const hiddenCaseResults = result?.cases.filter((item) => item.visibility === "hidden") || [];
  const hiddenPassedCases = hiddenCaseResults.filter((item) => item.passed).length;

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
            {publicCaseResults.map((item) => (
              <div className={item.passed ? "case-row passed" : "case-row"} key={item.caseTitle}>
                <span>{item.caseTitle}</span>
                <strong>{item.passed ? "通過" : "未通過"}</strong>
                <small>{item.error || item.actual || "沒有輸出"}</small>
              </div>
            ))}
            {hiddenCaseResults.length > 0 && (
              <div className={hiddenPassedCases === hiddenCaseResults.length ? "case-row passed" : "case-row"}>
                <span>隱藏測資</span>
                <strong>
                  {hiddenPassedCases} / {hiddenCaseResults.length}
                </strong>
                <small>不顯示輸入與標準輸出</small>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HistoryPanel({
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

function LeaderboardPanel({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
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

function AdminPanel({
  admin,
  adminDataBusy,
  adminSubmissions,
  adminUids,
  currentUser,
  importJson,
  importCsv,
  importMode,
  editingProblemId,
  editingProblemJson,
  problems,
  users,
  firebaseReady,
  busy,
  adminBusy,
  onExportCsv,
  onImportCsv,
  onImportCsvChange,
  onImportJsonChange,
  onImportModeChange,
  onEditingProblemJsonChange,
  onInitializeAdmin,
  onImport,
  onSelectProblemForEdit,
  onSaveEditedProblem,
  onRefreshAdminData,
  onSetUserAdmin,
}: {
  admin: boolean;
  adminDataBusy: boolean;
  adminSubmissions: SubmissionRecord[];
  adminUids: Set<string>;
  currentUser: AppUser | null;
  importJson: string;
  importCsv: string;
  importMode: ProblemImportMode;
  editingProblemId: string;
  editingProblemJson: string;
  problems: Problem[];
  users: ManagedUser[];
  firebaseReady: boolean;
  busy: boolean;
  adminBusy: boolean;
  onExportCsv: () => void;
  onImportCsv: () => void;
  onImportCsvChange: (value: string) => void;
  onImportJsonChange: (value: string) => void;
  onImportModeChange: (value: ProblemImportMode) => void;
  onEditingProblemJsonChange: (value: string) => void;
  onInitializeAdmin: () => void;
  onImport: () => void;
  onSelectProblemForEdit: (problemId: string) => void;
  onSaveEditedProblem: () => void;
  onRefreshAdminData: () => void;
  onSetUserAdmin: (user: ManagedUser, makeAdmin: boolean) => void;
}) {
  const progressRows = buildUserProgressRows(users, problems, adminSubmissions, adminUids);
  const recentSubmissions = adminSubmissions.slice(0, 24);
  const [activeAdminSection, setActiveAdminSection] = useState<AdminSectionKey>("problems");
  const adminSections: Array<{ key: AdminSectionKey; label: string }> = [
    { key: "problems", label: "題目管理" },
    { key: "users", label: "使用者管理" },
    { key: "progress", label: "使用者解題資料" },
  ];

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>管理中心</h2>
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
          <div className="admin-top-tabs" role="tablist" aria-label="管理功能表">
            {adminSections.map((section) => (
              <button
                key={section.key}
                className={activeAdminSection === section.key ? "active" : ""}
                onClick={() => setActiveAdminSection(section.key)}
                type="button"
                role="tab"
                aria-selected={activeAdminSection === section.key}
              >
                {section.label}
              </button>
            ))}
          </div>

          {activeAdminSection === "problems" && (
            <>
          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>題庫匯入與匯出</h3>
                <p>JSON 可單題或整包匯入；CSV 可匯出後用 Excel 編輯再貼回匯入。</p>
              </div>
              <button className="ghost-button" onClick={onExportCsv}>
                匯出 CSV
              </button>
            </div>
            <div className="admin-mode-row">
              <span>匯入模式</span>
              <div className="segmented">
                <button
                  className={importMode === "append" ? "selected" : ""}
                  onClick={() => onImportModeChange("append")}
                >
                  新增
                </button>
                <button
                  className={importMode === "overwrite" ? "selected" : ""}
                  onClick={() => onImportModeChange("overwrite")}
                >
                  覆蓋
                </button>
              </div>
            </div>
            <label className="admin-field">
              單題或整包 JSON
              <textarea
                className="json-input compact"
                value={importJson}
                onChange={(event) => onImportJsonChange(event.target.value)}
              />
            </label>
            <button className="primary-button wide" onClick={onImport} disabled={busy}>
              <Upload size={17} />
              匯入 JSON 題目
            </button>
            <label className="admin-field">
              CSV 題目資料
              <textarea
                className="json-input compact"
                value={importCsv}
                onChange={(event) => onImportCsvChange(event.target.value)}
              />
            </label>
            <button className="primary-button wide" onClick={onImportCsv} disabled={busy}>
              <Upload size={17} />
              匯入 CSV 題目
            </button>
          </section>

          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>編輯題庫</h3>
                <p>選擇題目後可直接編輯單題 JSON；儲存時會覆蓋相同 ID 題目。</p>
              </div>
              <span className="section-pill">{problems.length} 題</span>
            </div>
            <div className="admin-problem-editor">
              <div className="admin-table">
                <div className="admin-table-head problem-table-row">
                  <span>ID</span>
                  <span>年份</span>
                  <span>分類</span>
                  <span>題目</span>
                  <span>狀態</span>
                  <span>操作</span>
                </div>
                {problems.length === 0 && <p className="muted table-empty">尚無題目。</p>}
                {problems.map((problem) => (
                  <div className="problem-table-row" key={problem.id}>
                    <span>{problem.id}</span>
                    <span>{problem.year || "-"}</span>
                    <span>{problem.category}</span>
                    <span>{problem.title}</span>
                    <span>{problem.status}</span>
                    <button className="ghost-button" onClick={() => onSelectProblemForEdit(problem.id)}>
                      編輯
                    </button>
                  </div>
                ))}
              </div>
              <label className="admin-field">
                單題 JSON 編輯
                <textarea
                  className="json-input"
                  value={editingProblemJson}
                  onChange={(event) => onEditingProblemJsonChange(event.target.value)}
                  placeholder="請從左側題目列表選擇題目，或貼上單題 JSON。"
                />
              </label>
              <button
                className="primary-button wide"
                onClick={onSaveEditedProblem}
                disabled={busy || (!editingProblemId && !editingProblemJson.trim())}
              >
                <Save size={17} />
                儲存題目 JSON
              </button>
            </div>
          </section>
            </>
          )}

          {activeAdminSection === "users" && (
            <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>使用者權限</h3>
                <p>管理者可進入管理頁；一般使用者不會看到管理標籤。</p>
              </div>
              <button className="ghost-button" onClick={onRefreshAdminData} disabled={adminDataBusy}>
                重新整理
              </button>
            </div>
            <div className="admin-table">
              <div className="admin-table-head user-table-row">
                <span>使用者</span>
                <span>Email</span>
                <span>最近登入</span>
                <span>權限</span>
                <span>操作</span>
              </div>
              {users.length === 0 && <p className="muted table-empty">尚無使用者資料。</p>}
              {users.map((item) => {
                const itemIsAdmin = adminUids.has(item.uid);
                const isSelf = item.uid === currentUser?.uid;
                return (
                  <div className="user-table-row" key={item.uid}>
                    <span>{item.displayName || "未命名使用者"}</span>
                    <span>{item.email || "-"}</span>
                    <span>{formatManagedTimestamp(item.lastLoginAt)}</span>
                    <span>{itemIsAdmin ? "管理者" : "一般使用者"}</span>
                    <button
                      className="ghost-button"
                      onClick={() => onSetUserAdmin(item, !itemIsAdmin)}
                      disabled={adminBusy || isSelf}
                    >
                      {itemIsAdmin ? "改為一般" : "設為管理者"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
          )}

          {activeAdminSection === "progress" && (
            <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>使用者答題狀況</h3>
                <p>依每位使用者各題最佳答題率彙整，並列出最近提交紀錄。</p>
              </div>
              <span className="section-pill">{adminSubmissions.length} 筆提交</span>
            </div>
            <div className="admin-table">
              <div className="admin-table-head progress-table-row">
                <span>使用者</span>
                <span>角色</span>
                <span>最近登入</span>
                <span>完成題數</span>
                <span>答題率</span>
                <span>提交</span>
                <span>最後作答</span>
                <span>題目完成狀況</span>
              </div>
              {progressRows.length === 0 && <p className="muted table-empty">尚無答題紀錄。</p>}
              {progressRows.map((row) => (
                <div className="progress-table-row" key={row.uid}>
                  <span>{row.displayName}</span>
                  <span>{row.role}</span>
                  <span>{row.lastLoginAt}</span>
                  <span>{row.completedCount}/{problems.length}</span>
                  <span>{Math.round(row.averagePassRate * 100)}%</span>
                  <span>{row.submitCount} 次</span>
                  <span>{row.lastSubmittedAt ? new Date(row.lastSubmittedAt).toLocaleString("zh-TW") : "-"}</span>
                  <span>{row.problemStatusText}</span>
                </div>
              ))}
            </div>
            <div className="admin-table">
              <div className="admin-table-head submission-table-row">
                <span>時間</span>
                <span>使用者</span>
                <span>題目</span>
                <span>答題率</span>
                <span>分數</span>
              </div>
              {recentSubmissions.length === 0 && <p className="muted table-empty">尚無最近提交。</p>}
              {recentSubmissions.map((item) => (
                <div className="submission-table-row" key={item.id}>
                  <span>{new Date(item.createdAt).toLocaleString("zh-TW")}</span>
                  <span>{item.displayName}</span>
                  <span>{item.problemTitle}</span>
                  <span>{Math.round(item.passRate * 100)}%</span>
                  <span>{item.score}/{item.maxScore}</span>
                </div>
              ))}
            </div>
          </section>
          )}
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

function formatManagedTimestamp(value: unknown) {
  if (!value) {
    return "-";
  }
  if (typeof value === "string") {
    return formatDateTime(value);
  }
  if (typeof value === "object" && value && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toLocaleString("zh-TW");
  }
  if (typeof value === "object" && value && "seconds" in value) {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000).toLocaleString("zh-TW");
    }
  }
  return "-";
}

function formatDateTime(value: string | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-TW");
}

function formatDuration(ms: number | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} 小時 ${minutes} 分 ${seconds} 秒`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${seconds} 秒`;
  }
  return `${seconds} 秒`;
}

function formatProblemStatusSummary(completedTitles: string[], attemptedTitles: string[], untouchedCount: number) {
  const parts: string[] = [];
  if (completedTitles.length > 0) {
    parts.push(`完成：${summarizeTitles(completedTitles)}`);
  }
  if (attemptedTitles.length > 0) {
    parts.push(`未滿分：${summarizeTitles(attemptedTitles)}`);
  }
  if (untouchedCount > 0) {
    parts.push(`未作答：${untouchedCount} 題`);
  }
  return parts.join("；") || "-";
}

function summarizeTitles(titles: string[]) {
  const preview = titles.slice(0, 3).join("、");
  return titles.length > 3 ? `${preview} 等 ${titles.length} 題` : preview;
}

function buildUserProgressRows(
  users: ManagedUser[],
  problems: Problem[],
  records: SubmissionRecord[],
  adminUids: Set<string>,
) {
  const usersById = new Map(users.map((item) => [item.uid, item]));
  for (const record of records) {
    if (!usersById.has(record.uid || "")) {
      usersById.set(record.uid || "guest", {
        uid: record.uid || "guest",
        displayName: record.displayName || "訪客",
      });
    }
  }

  return Array.from(usersById.values())
    .map((item) => {
      const userRecords = records.filter((record) => (record.uid || "guest") === item.uid);
      const bestByProblem = new Map<string, SubmissionRecord>();
      for (const record of userRecords) {
        bestByProblem.set(record.problemId, getBetterSubmission(bestByProblem.get(record.problemId), record));
      }

      const bestRecords = Array.from(bestByProblem.values());
      const completedProblems = problems.filter((problem) => {
        const best = bestByProblem.get(problem.id);
        return best && (best.isFullScore || best.score >= getProblemMaxScore(problem));
      });
      const attemptedProblems = problems.filter(
        (problem) => bestByProblem.has(problem.id) && !completedProblems.some((item) => item.id === problem.id),
      );
      const untouchedCount = Math.max(0, problems.length - completedProblems.length - attemptedProblems.length);
      const averagePassRate =
        problems.length === 0
          ? 0
          : bestRecords.reduce((sum, record) => sum + record.passRate, 0) / problems.length;
      const completedTitles = completedProblems.map((problem) => problem.title);
      const attemptedTitles = attemptedProblems.map((problem) => problem.title);

      return {
        uid: item.uid,
        displayName: item.displayName || item.email || "未命名使用者",
        role: adminUids.has(item.uid) ? "管理者" : "一般",
        lastLoginAt: formatManagedTimestamp(item.lastLoginAt),
        completedCount: completedProblems.length,
        averagePassRate,
        submitCount: userRecords.length,
        lastSubmittedAt: userRecords[0]?.createdAt,
        problemStatusText: formatProblemStatusSummary(completedTitles, attemptedTitles, untouchedCount),
      };
    })
    .sort((a, b) => {
      if (b.averagePassRate !== a.averagePassRate) {
        return b.averagePassRate - a.averagePassRate;
      }
      if (b.completedCount !== a.completedCount) {
        return b.completedCount - a.completedCount;
      }
      return a.displayName.localeCompare(b.displayName, "zh-Hant", { numeric: true });
    });
}

function PracticeStatusBadge({
  stats,
  compact = false,
}: {
  stats?: PracticeStats;
  compact?: boolean;
}) {
  const status = stats?.status || "not-started";
  return (
    <span className={`practice-status-badge ${status} ${compact ? "compact" : ""}`}>
      {getPracticeStatusLabel(status)}
    </span>
  );
}

function getPracticeStatusLabel(status: PracticeStatus) {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "in-progress") {
    return "未完成";
  }
  return "未作答";
}

function formatPracticeSubtitle(stats?: PracticeStats) {
  if (!stats || stats.status === "not-started") {
    return "尚未作答";
  }
  if (stats.submitCount === 0 && stats.hasDraft) {
    return "已保存作答草稿";
  }
  const scoreText = `最佳 ${stats.bestScore}/${stats.maxScore} 分`;
  const submitText = `${stats.submitCount} 次提交`;
  return stats.lastSubmittedAt
    ? `${scoreText}，${submitText}，${new Date(stats.lastSubmittedAt).toLocaleDateString("zh-TW")}`
    : `${scoreText}，${submitText}`;
}

function buildPracticeStatsByProblem(
  problems: Problem[],
  records: SubmissionRecord[],
): Record<string, PracticeStats> {
  const recordsByProblem = new Map<string, SubmissionRecord[]>();
  for (const record of records) {
    const problemRecords = recordsByProblem.get(record.problemId) || [];
    problemRecords.push(record);
    recordsByProblem.set(record.problemId, problemRecords);
  }

  return Object.fromEntries(
    problems.map((problem) => {
      const problemRecords = (recordsByProblem.get(problem.id) || []).sort(compareSubmissionCreatedAt);
      const maxScore = getProblemMaxScore(problem);
      const bestRecord = problemRecords.reduce<SubmissionRecord | undefined>(
        (current, record) => getBetterSubmission(current, record),
        undefined,
      );
      const bestScore = bestRecord?.score || 0;
      const bestPassRate = bestRecord?.passRate || 0;
      const hasDraft = hasSavedWorkspace(problem.id);
      const status: PracticeStatus =
        bestScore >= maxScore && maxScore > 0
          ? "completed"
          : problemRecords.length > 0 || hasDraft
            ? "in-progress"
            : "not-started";

      return [
        problem.id,
        {
          status,
          bestScore,
          maxScore,
          bestPassRate,
          submitCount: problemRecords.length,
          hasDraft,
          lastSubmittedAt: problemRecords[0]?.createdAt,
          lastMode: problemRecords[0]?.mode,
        },
      ];
    }),
  );
}

function getBetterSubmission(current: SubmissionRecord | undefined, incoming: SubmissionRecord) {
  if (!current) {
    return incoming;
  }
  if (incoming.score !== current.score) {
    return incoming.score > current.score ? incoming : current;
  }
  if (incoming.passRate !== current.passRate) {
    return incoming.passRate > current.passRate ? incoming : current;
  }
  if (incoming.elapsedMs !== current.elapsedMs) {
    return incoming.elapsedMs < current.elapsedMs ? incoming : current;
  }
  return incoming.createdAt > current.createdAt ? incoming : current;
}

function getProblemMaxScore(problem: Problem) {
  return problem.cases.reduce((sum, item) => sum + item.score, 0);
}

function mergeSubmissionRecord(current: SubmissionRecord[], record: SubmissionRecord) {
  return [record, ...current.filter((item) => item.id !== record.id)].sort(compareSubmissionCreatedAt);
}

function compareSubmissionCreatedAt(a: SubmissionRecord, b: SubmissionRecord) {
  return b.createdAt.localeCompare(a.createdAt);
}

function hasSavedWorkspace(problemId: string) {
  try {
    return [
      getSharedWorkspaceKey(problemId),
      getLegacyWorkspaceKey(problemId, "Scratch"),
      getLegacyWorkspaceKey(problemId, "Blockly"),
    ].some((key) => hasMeaningfulWorkspaceXml(localStorage.getItem(key)));
  } catch {
    return false;
  }
}

function hasMeaningfulWorkspaceXml(xml: string | null) {
  return Boolean(xml && (xml.includes("<block") || xml.includes("<variables")));
}

function ensureSolveStartedAt(problemId: string) {
  const key = getSolveStartKey(problemId);
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, new Date().toISOString());
  }
}

function getSolveStartedAt(problemId: string) {
  return localStorage.getItem(getSolveStartKey(problemId)) || new Date().toISOString();
}

function getSolveStartKey(problemId: string) {
  return `yilan-solve-started-at-${problemId}`;
}

function getSharedWorkspaceKey(problemId: string) {
  return `yilan-workspace-${problemId}`;
}

function getLegacyWorkspaceKey(problemId: string, mode: WorkspaceMode) {
  return `yilan-workspace-${problemId}-${mode}`;
}

function slugFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "workspace";
}

function formatImportStatus(source: string, result: ProblemImportResult) {
  const modeText = result.mode === "append" ? "新增" : "覆蓋";
  const skippedText = result.skipped.length > 0 ? `，跳過 ${result.skipped.length} 題重複 ID` : "";
  return `${source} ${modeText}匯入完成：${result.imported.length} 題${skippedText}。`;
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
