import { Download, LogIn, LogOut, Play, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_TITLE, defaultImportJson, tabs } from "./app/constants";
import type { TabKey } from "./app/constants";
import BlocklyWorkspace from "./components/BlocklyWorkspace";
import { AdminPanel } from "./components/admin/AdminPanel";
import { AnnouncementScreen } from "./components/AnnouncementScreen";
import { ContestLoginForm } from "./components/contest/ContestLoginForm";
import { ContestShell } from "./components/contest/ContestShell";
import { AccountPanel } from "./components/panels/AccountPanel";
import { ClassesPanel } from "./components/panels/ClassesPanel";
import { HistoryPanel } from "./components/panels/HistoryPanel";
import { LeaderboardPanel } from "./components/panels/LeaderboardPanel";
import { ScorePanel } from "./components/panels/ScorePanel";
import { StatementPanel } from "./components/panels/StatementPanel";
import { TestPanel } from "./components/panels/TestPanel";
import { GuishanIslandIcon, PracticeStatusBadge } from "./components/ui";
import { hasFirebaseConfig } from "./firebase";
import { getEffectiveRole, loadUserProfile, saveAccountSchoolSelection } from "./services/accountService";
import { deleteManagedUserProfile, loadAdminProfile, loadAdminProfiles, loadManagedUsers, setManagedUserAdmin, setManagedUserDisabled, setManagedUserTeacherSchool } from "./services/adminService";
import { initializeFirstAdmin, isDemoAdmin, loginWithGoogle, logout, subscribeToAuth } from "./services/authStore";
import { createLearningClass, joinClassByCode, loadClassMembers, loadClassSubmissionViews, loadStudentClassMembers, loadTeacherClasses, setClassJoinEnabled, setClassMemberStatus } from "./services/classStore";
import { createContestDraft, loadContests, saveContest } from "./services/contestStore";
import { DEFAULT_PLATFORM_STATE, subscribePlatform } from "./services/platformStore";
import { gradeProblem, runCustomTest } from "./services/gradingEngine";
import { loadGlobalLeaderboard, removeUserFromLeaderboards, updateGlobalLeaderboard } from "./services/leaderboardService";
import { deleteProblemIfUnused, exportProblemsToCsv, getProblemCsvTemplate, importProblemsFromCsv, importProblemsFromJson, loadAllProblemsForAdmin, loadProblems, saveProblem } from "./services/problemStore";
import type { ProblemImportMode } from "./services/problemStore";
import { createSchoolDraft, loadSchools, loadSchoolsByIds, saveSchool } from "./services/schoolStore";
import { deleteSubmissionsForUser, loadAllSubmissions, loadSubmissions, loadUserSubmissions, saveSubmission } from "./services/submissionService";
import type { AdminProfile, AppUser, ClassMember, ClassSubmissionView, ContestEvent, ContestStatus, GradeResult, LeaderboardEntry, LearningClass, ManagedUser, PlatformState, Problem, School, SubmissionRecord, WorkspaceMode } from "./types";
import { countSubmissionsByProblem } from "./utils/adminUsers";
import { cloneContest, cloneProblem, cloneSchool, getContestStatusLabel, sanitizeContestDraft, sanitizeProblemDraft, sanitizeSchoolDraft } from "./utils/drafts";
import { getFirebaseAdminErrorMessage, getLoginErrorMessage, getSchoolWriteErrorMessage, loadAdminDataset, runAdminMutationStep } from "./utils/errors";
import { buildPracticeStatsByProblem, ensureSolveStartedAt, formatImportStatus, formatPracticeSubtitle, getDefaultTestInput, getLegacyWorkspaceKey, getSharedWorkspaceKey, getSolveStartedAt, hasMeaningfulWorkspaceXml, mergeSubmissionRecord, runInteractiveProgram, slugFileName } from "./utils/practice";

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
  const [superAdmin, setSuperAdmin] = useState(false);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [accountProfile, setAccountProfile] = useState<ManagedUser | null>(null);
  const [accountSchoolId, setAccountSchoolId] = useState("");
  const [teacherClasses, setTeacherClasses] = useState<LearningClass[]>([]);
  const [classMembers, setClassMembers] = useState<ClassMember[]>([]);
  const [classSubmissionViews, setClassSubmissionViews] = useState<ClassSubmissionView[]>([]);
  const [studentClassMembers, setStudentClassMembers] = useState<ClassMember[]>([]);
  const [classNameDraft, setClassNameDraft] = useState("");
  const [studentJoinCode, setStudentJoinCode] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [customOutput, setCustomOutput] = useState("");
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [practiceSubmissions, setPracticeSubmissions] = useState<SubmissionRecord[]>([]);
  const [adminSubmissions, setAdminSubmissions] = useState<SubmissionRecord[]>([]);
  const [adminProblems, setAdminProblems] = useState<Problem[]>([]);
  const [contests, setContests] = useState<ContestEvent[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [importJson, setImportJson] = useState(defaultImportJson);
  const [importCsv, setImportCsv] = useState(getProblemCsvTemplate());
  const [problemImportMode, setProblemImportMode] = useState<ProblemImportMode>("append");
  const [editingProblemId, setEditingProblemId] = useState("");
  const [editingProblemDraft, setEditingProblemDraft] = useState<Problem | null>(null);
  const [editingContestId, setEditingContestId] = useState("");
  const [editingContestDraft, setEditingContestDraft] = useState<ContestEvent | null>(null);
  const [editingSchoolId, setEditingSchoolId] = useState("");
  const [editingSchoolDraft, setEditingSchoolDraft] = useState<School | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [adminProfiles, setAdminProfiles] = useState<AdminProfile[]>([]);
  const [managedAdminUids, setManagedAdminUids] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [platform, setPlatform] = useState<PlatformState>(DEFAULT_PLATFORM_STATE);
  const [platformReady, setPlatformReady] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminDataBusy, setAdminDataBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [classBusy, setClassBusy] = useState(false);
  const [yearFilter, setYearFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const xmlFileInputRef = useRef<HTMLInputElement | null>(null);
  const problemJsonFileInputRef = useRef<HTMLInputElement | null>(null);

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
  const effectiveRole = useMemo(
    () => getEffectiveRole(user, accountProfile, adminProfile),
    [accountProfile, adminProfile, user],
  );
  const managementMaximized =
    (activeTab === "admin" && admin) ||
    (activeTab === "classes" && effectiveRole === "teacher");

  const availableTabs = useMemo(
    () =>
      tabs.filter((tab) => {
        if (platform.mode !== "practice") {
          return tab.key === "admin" && superAdmin;
        }
        if (tab.key === "admin") {
          return superAdmin;
        }
        if (tab.key === "account") {
          return Boolean(user);
        }
        if (tab.key === "classes") {
          return effectiveRole === "teacher";
        }
        return true;
      }),
    [effectiveRole, platform.mode, superAdmin, user],
  );

  // 全站模式：任何人可讀，超管切換後即時跟隨（規格 4.2）。
  useEffect(() => {
    return subscribePlatform((next) => {
      setPlatform(next);
      setPlatformReady(true);
    });
  }, []);

  useEffect(() => {
    document.title = APP_TITLE;
  }, []);

  // 練習資料在模式切換時重新讀取：競賽期間開著頁面的人，切回練習模式後不必重新整理。
  useEffect(() => {
    if (!platformReady || (platform.mode !== "practice" && !superAdmin)) {
      return;
    }
    loadProblems()
      .then((loaded) => {
        setProblems(loaded);
        setSelectedProblemId((current) => current || loaded[0]?.id || "");
        setCustomInput((current) => current || getDefaultTestInput(loaded[0]));
      })
      .catch((error) => console.info("題目讀取失敗", error));
    loadGlobalLeaderboard()
      .then(setLeaderboard)
      .catch(() => setLeaderboard([]));
  }, [platform.mode, platformReady, superAdmin]);

  useEffect(() => {
    return subscribeToAuth(async (nextUser) => {
      setUser(nextUser);
      if (nextUser?.accountType === "contest") {
        setAdminProfile(null);
        setAdmin(false);
        setSuperAdmin(false);
        setAccountProfile(null);
        return;
      }
      if (nextUser) {
        const nextAdminProfile = await loadAdminProfile(nextUser.uid);
        const nextSuperAdmin = nextAdminProfile?.role === "super";
        setAdminProfile(nextAdminProfile);
        setAdmin(nextSuperAdmin);
        setSuperAdmin(nextSuperAdmin);
        return;
      }
      const demoAdmin = isDemoAdmin();
      setAdmin(demoAdmin);
      setSuperAdmin(demoAdmin);
      setAccountProfile(null);
      setAdminProfile(
        demoAdmin
          ? {
              uid: "demo-admin",
              displayName: "Demo Admin",
              role: "super",
              schoolIds: [],
            }
          : null,
      );
    });
  }, []);

  useEffect(() => {
    let active = true;
    if (user?.accountType === "contest") {
      setPracticeSubmissions([]);
      return () => {
        active = false;
      };
    }
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
    let active = true;
    if (!user || user.accountType === "contest") {
      setAccountProfile(null);
      setAccountSchoolId("");
      return () => {
        active = false;
      };
    }

    Promise.all([loadUserProfile(user.uid), loadSchools()])
      .then(([nextProfile, nextSchools]) => {
        if (!active) {
          return;
        }
        setAccountProfile(nextProfile);
        setSchools((current) => (current.length > 0 ? current : nextSchools));
        const currentSchoolId = adminProfile?.schoolId || adminProfile?.schoolIds?.[0] || nextProfile?.schoolId || "";
        setAccountSchoolId(currentSchoolId);
      })
      .catch(() => {
        if (active) {
          setAccountProfile(null);
        }
      });

    return () => {
      active = false;
    };
  }, [adminProfile?.schoolId, adminProfile?.schoolIds, user]);

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
    if (platform.mode !== "practice" && superAdmin && activeTab !== "admin") {
      setActiveTab("admin");
      return;
    }
    if (
      (!admin && activeTab === "admin") ||
      (!user && activeTab === "account") ||
      (activeTab === "classes" && effectiveRole !== "teacher")
    ) {
      setActiveTab("statement");
    }
  }, [activeTab, admin, effectiveRole, platform.mode, superAdmin, user]);

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
      if (superAdmin) {
        const nextUsers = await loadAdminDataset("使用者資料", loadManagedUsers);
        const nextAdminProfiles = await loadAdminDataset("管理者權限資料", loadAdminProfiles);
        const nextSubmissions = await loadAdminDataset("答題紀錄", loadAllSubmissions);
        const nextAdminProblems = await loadAdminDataset("題目管理資料", loadAllProblemsForAdmin);
        const nextContests = await loadAdminDataset("賽事資料", loadContests);
        const nextSchools = await loadAdminDataset("學校資料", loadSchools);
        setManagedUsers(nextUsers);
        setAdminProfiles(nextAdminProfiles);
        setManagedAdminUids(new Set(nextAdminProfiles.map((item) => item.uid)));
        setAdminSubmissions(nextSubmissions);
        setAdminProblems(nextAdminProblems);
        setContests(nextContests);
        setSchools(nextSchools);
        return;
      }

      const assignedSchoolIds = adminProfile?.role === "teacher" ? adminProfile.schoolIds || [] : [];
      const nextSchools = await loadSchoolsByIds(assignedSchoolIds);
      setManagedUsers([]);
      setAdminProfiles(adminProfile ? [adminProfile] : []);
      setManagedAdminUids(adminProfile ? new Set([adminProfile.uid]) : new Set());
      setAdminSubmissions([]);
      setAdminProblems([]);
      setContests([]);
      setSchools(nextSchools);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "後台資料讀取失敗。");
    } finally {
      setAdminDataBusy(false);
    }
  }, [admin, adminProfile, superAdmin]);

  const loadClassData = useCallback(async () => {
    if (!user) {
      setTeacherClasses([]);
      setClassMembers([]);
      setClassSubmissionViews([]);
      setStudentClassMembers([]);
      return;
    }

    try {
      if (effectiveRole === "teacher") {
        const nextClasses = await loadTeacherClasses(user.uid);
        const classIds = nextClasses.map((item) => item.id);
        const [nextMembers, nextSubmissionViews] = await Promise.all([
          loadClassMembers(classIds),
          loadClassSubmissionViews(classIds),
        ]);
        setTeacherClasses(nextClasses);
        setClassMembers(nextMembers);
        setClassSubmissionViews(nextSubmissionViews);
        setStudentClassMembers([]);
        return;
      }

      const nextStudentMembers = await loadStudentClassMembers(user.uid);
      setTeacherClasses([]);
      setClassMembers([]);
      setClassSubmissionViews([]);
      setStudentClassMembers(nextStudentMembers);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "班級資料讀取失敗。");
    }
  }, [effectiveRole, user]);

  useEffect(() => {
    if (activeTab === "admin" && admin) {
      loadAdminData();
    }
  }, [activeTab, admin, loadAdminData]);

  useEffect(() => {
    if (activeTab === "classes" || activeTab === "account") {
      loadClassData();
    }
  }, [activeTab, loadClassData]);

  const refreshProblemLists = useCallback(
    async (preferredProblemId?: string) => {
      const [publishedProblems, allProblems] = await Promise.all([
        loadProblems(),
        admin ? loadAllProblemsForAdmin() : Promise.resolve<Problem[]>([]),
      ]);
      setProblems(publishedProblems);
      if (admin) {
        setAdminProblems(allProblems);
      }

      const nextSelected =
        (preferredProblemId && publishedProblems.some((problem) => problem.id === preferredProblemId)
          ? preferredProblemId
          : undefined) ||
        publishedProblems[0]?.id ||
        "";
      setSelectedProblemId(nextSelected);
      return { publishedProblems, allProblems };
    },
    [admin],
  );

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
        setSuperAdmin(true);
      }
      if (status === "created") {
        setStatusMessage("已啟用管理模式，你現在是第一位管理者。");
      } else if (status === "already-admin") {
        setStatusMessage("你已經是管理者。");
      } else if (status === "bootstrap-exists") {
        setAdmin(false);
        setSuperAdmin(false);
        setStatusMessage("管理者已存在，請使用已授權的管理者帳號登入。");
      } else {
        setStatusMessage("已啟用本機管理模式。");
      }
    } catch (error) {
      const demoAdmin = isDemoAdmin();
      setAdmin(demoAdmin);
      setSuperAdmin(demoAdmin);
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
        user ? "已完成評分並寫入紀錄。" : "訪客評分已保存於本機，登入後可寫入排行榜。",
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
      const { publishedProblems } = await refreshProblemLists(result.imported[0]?.id);
      if (result.imported[0]?.year) {
        setYearFilter(result.imported[0].year);
      }
      setCategoryFilter("all");
      setSelectedProblemId(result.imported[0]?.id || publishedProblems[0]?.id || "");
      setStatusMessage(formatImportStatus("JSON", result));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "題目匯入失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadProblemJsonFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setBusy(true);
    setStatusMessage("");
    try {
      const rawJson = await file.text();
      setImportJson(rawJson);
      const result = await importProblemsFromJson(rawJson, problemImportMode);
      const { publishedProblems } = await refreshProblemLists(result.imported[0]?.id);
      if (result.imported[0]?.year) {
        setYearFilter(result.imported[0].year);
      }
      setCategoryFilter("all");
      setSelectedProblemId(result.imported[0]?.id || publishedProblems[0]?.id || "");
      setStatusMessage(formatImportStatus("JSON 檔案", result));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "JSON 檔案題目匯入失敗。");
    } finally {
      setBusy(false);
      if (problemJsonFileInputRef.current) {
        problemJsonFileInputRef.current.value = "";
      }
    }
  }

  async function handleImportCsvProblems() {
    setBusy(true);
    setStatusMessage("");
    try {
      const result = await importProblemsFromCsv(importCsv, problemImportMode);
      const { publishedProblems } = await refreshProblemLists(result.imported[0]?.id);
      if (result.imported[0]?.year) {
        setYearFilter(result.imported[0].year);
      }
      setCategoryFilter("all");
      setSelectedProblemId(result.imported[0]?.id || publishedProblems[0]?.id || "");
      setStatusMessage(formatImportStatus("CSV", result));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "CSV 題目匯入失敗。");
    } finally {
      setBusy(false);
    }
  }

  function handleExportCsvProblems() {
    const csv = exportProblemsToCsv(admin ? adminProblems : problems);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ilanICTExam-problems.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleSelectProblemForEdit(problemId: string) {
    if (editingProblemId === problemId) {
      setEditingProblemId("");
      setEditingProblemDraft(null);
      return;
    }

    const problem = (adminProblems.length > 0 ? adminProblems : problems).find(
      (item) => item.id === problemId,
    );
    setEditingProblemId(problemId);
    setEditingProblemDraft(problem ? cloneProblem(problem) : null);
  }

  function handleCancelProblemEdit() {
    setEditingProblemId("");
    setEditingProblemDraft(null);
  }

  async function handleSaveEditedProblem(problem: Problem) {
    if (!problem.title.trim() || !problem.description.trim()) {
      setStatusMessage("題目標題與說明不可空白。");
      return;
    }

    setBusy(true);
    setStatusMessage("");
    try {
      const savedProblem = sanitizeProblemDraft(problem);
      await saveProblem(savedProblem);
      await refreshProblemLists(savedProblem.id);
      setEditingProblemId(savedProblem.id);
      setEditingProblemDraft(cloneProblem(savedProblem));
      setStatusMessage("題目已儲存。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "題目儲存失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProblem(problemId: string) {
    if (!window.confirm("確定要刪除這題嗎？只有完全沒有提交紀錄的題目才能刪除。")) {
      return;
    }

    setBusy(true);
    setStatusMessage("");
    try {
      await deleteProblemIfUnused(problemId);
      const { publishedProblems } = await refreshProblemLists(
        selectedProblemId === problemId ? undefined : selectedProblemId,
      );
      if (selectedProblemId === problemId) {
        setSelectedProblemId(publishedProblems[0]?.id || "");
      }
      setEditingProblemId("");
      setEditingProblemDraft(null);
      setStatusMessage("題目已刪除。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "題目刪除失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function refreshContestList(preferredContestId?: string) {
    if (!superAdmin) {
      setContests([]);
      setEditingContestId("");
      setEditingContestDraft(null);
      return [];
    }
    const nextContests = await loadContests();
    setContests(nextContests);
    if (preferredContestId) {
      const selected = nextContests.find((item) => item.id === preferredContestId);
      if (selected) {
        setEditingContestId(selected.id);
        setEditingContestDraft(cloneContest(selected));
      }
    }
    return nextContests;
  }

  function handleSelectContestForEdit(contestId: string) {
    if (editingContestId === contestId) {
      setEditingContestId("");
      setEditingContestDraft(null);
      return;
    }
    const contest = contests.find((item) => item.id === contestId);
    setEditingContestId(contestId);
    setEditingContestDraft(contest ? cloneContest(contest) : null);
  }

  async function handleCreateContestDraft(previous?: ContestEvent) {
    if (!superAdmin) {
      setStatusMessage("只有超級管理者可以建立賽事。");
      return;
    }
    setAdminBusy(true);
    setStatusMessage("");
    try {
      const saved = await saveContest(createContestDraft(previous));
      await refreshContestList(saved.id);
      setStatusMessage(previous ? "已複製為下一年度賽事草稿。" : "已建立年度賽事草稿。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "賽事草稿建立失敗。");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleSaveEditedContest(contest: ContestEvent) {
    if (!superAdmin) {
      setStatusMessage("只有超級管理者可以儲存賽事設定。");
      return;
    }
    if (!contest.title.trim() || !contest.year.trim()) {
      setStatusMessage("賽事名稱與年度不可空白。");
      return;
    }
    if (contest.startAt && contest.endAt && contest.startAt > contest.endAt) {
      setStatusMessage("賽事結束時間不可早於開始時間。");
      return;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      const saved = await saveContest(sanitizeContestDraft(contest));
      await refreshContestList(saved.id);
      setStatusMessage("賽事設定已儲存。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "賽事設定儲存失敗。");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleMoveContestStatus(contest: ContestEvent, nextStatus: ContestStatus) {
    if (!superAdmin) {
      setStatusMessage("只有超級管理者可以切換賽事狀態。");
      return;
    }
    setAdminBusy(true);
    setStatusMessage("");
    try {
      const saved = await saveContest({ ...contest, status: nextStatus });
      await refreshContestList(saved.id);
      setStatusMessage(`賽事狀態已切換為「${getContestStatusLabel(nextStatus)}」。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "賽事狀態切換失敗。");
    } finally {
      setAdminBusy(false);
    }
  }

  async function refreshSchoolList(preferredSchoolId?: string) {
    if (!superAdmin) {
      setSchools([]);
      setEditingSchoolId("");
      setEditingSchoolDraft(null);
      return [];
    }
    const nextSchools = await loadSchools();
    setSchools(nextSchools);
    if (preferredSchoolId) {
      const selected = nextSchools.find((item) => item.id === preferredSchoolId);
      if (selected) {
        setEditingSchoolId(selected.id);
        setEditingSchoolDraft(cloneSchool(selected));
      }
    }
    return nextSchools;
  }

  async function handleCreateSchoolDraft() {
    if (hasFirebaseConfig && !user) {
      setStatusMessage("請先登入已授權的超級管理者帳號，再新增學校。");
      return;
    }
    if (!superAdmin) {
      setStatusMessage("只有超級管理者可以建立學校網域。");
      return;
    }
    setAdminBusy(true);
    setStatusMessage("");
    try {
      const saved = await saveSchool(createSchoolDraft());
      await refreshSchoolList(saved.id);
      setStatusMessage("已建立學校網域草稿。");
    } catch (error) {
      setStatusMessage(getSchoolWriteErrorMessage(error, "學校網域草稿建立失敗。"));
    } finally {
      setAdminBusy(false);
    }
  }

  function handleSelectSchoolForEdit(schoolId: string) {
    if (editingSchoolId === schoolId) {
      setEditingSchoolId("");
      setEditingSchoolDraft(null);
      return;
    }
    const school = schools.find((item) => item.id === schoolId);
    setEditingSchoolId(schoolId);
    setEditingSchoolDraft(school ? cloneSchool(school) : null);
  }

  async function handleSaveEditedSchool(school: School) {
    if (hasFirebaseConfig && !user) {
      setStatusMessage("請先登入已授權的超級管理者帳號，再儲存學校。");
      return;
    }
    if (!superAdmin) {
      setStatusMessage("只有超級管理者可以儲存學校網域。");
      return;
    }
    if (!school.name.trim()) {
      setStatusMessage("學校名稱不可空白。");
      return;
    }
    if (school.domains.length === 0) {
      setStatusMessage("請至少設定一個 Email 網域。");
      return;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      const saved = await saveSchool(sanitizeSchoolDraft(school));
      await refreshSchoolList(saved.id);
      setStatusMessage("學校網域已儲存。");
    } catch (error) {
      setStatusMessage(getSchoolWriteErrorMessage(error, "學校網域儲存失敗。"));
    } finally {
      setAdminBusy(false);
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

  async function handleSetManagedUserSchoolAdmin(target: ManagedUser, schoolId: string) {
    if (target.uid === user?.uid) {
      setStatusMessage("為避免誤鎖管理權限，不能在這裡變更自己的管理者身分。");
      return;
    }
    const school = schools.find((item) => item.id === schoolId);
    if (!school) {
      setStatusMessage("請先選擇要指派給教師的學校。");
      return;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      await setManagedUserTeacherSchool(target, school, user);
      await loadAdminData();
      setStatusMessage(`已將 ${target.displayName || target.email || target.uid} 設為「${school.name}」教師。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "教師權限更新失敗。");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleSaveAccountSchool() {
    if (!user) {
      setStatusMessage("請先登入後再設定學校。");
      return;
    }
    if (effectiveRole !== "teacher") {
      setStatusMessage("目前只有教師帳號需要設定任教學校。");
      return;
    }
    const school = schools.find((item) => item.id === accountSchoolId);
    if (!school) {
      setStatusMessage("請先選擇任教學校。");
      return;
    }

    setAccountBusy(true);
    setStatusMessage("");
    try {
      await saveAccountSchoolSelection({
        user,
        school,
        role: "teacher",
        actorUid: user.uid,
        source: "self",
        verified: false,
      });
      const [nextProfile, nextAdminProfile] = await Promise.all([
        loadUserProfile(user.uid),
        loadAdminProfile(user.uid),
      ]);
      setAccountProfile(nextProfile);
      setAdminProfile(nextAdminProfile);
      setStatusMessage("已儲存任教學校，超管仍可在後台調整或確認。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "任教學校儲存失敗。");
    } finally {
      setAccountBusy(false);
    }
  }

  function getTeacherSchoolForClass() {
    const schoolId =
      adminProfile?.schoolId ||
      adminProfile?.schoolIds?.[0] ||
      accountProfile?.schoolId ||
      accountSchoolId;
    return schools.find((item) => item.id === schoolId);
  }

  async function handleCreateLearningClass() {
    if (!user) {
      setStatusMessage("請先登入後再建立班級。");
      return;
    }
    if (effectiveRole !== "teacher") {
      setStatusMessage("只有教師可以建立班級。");
      return;
    }

    const teacherSchool = getTeacherSchoolForClass();
    if (!teacherSchool) {
      setStatusMessage("請先到「我的帳號」設定任教學校，再建立班級。");
      return;
    }

    setClassBusy(true);
    setStatusMessage("");
    try {
      const createdClass = await createLearningClass({
        name: classNameDraft,
        teacher: user,
        school: teacherSchool,
      });
      setClassNameDraft("");
      await loadClassData();
      setStatusMessage(`已建立班級「${createdClass.name}」，班級代碼：${createdClass.joinCode}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "班級建立失敗。");
    } finally {
      setClassBusy(false);
    }
  }

  async function handleToggleClassJoin(learningClass: LearningClass, joinEnabled: boolean) {
    setClassBusy(true);
    setStatusMessage("");
    try {
      await setClassJoinEnabled(learningClass, joinEnabled);
      await loadClassData();
      setStatusMessage(joinEnabled ? "已開放學生加入班級。" : "已關閉學生加入班級。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "班級加入狀態更新失敗。");
    } finally {
      setClassBusy(false);
    }
  }

  async function handleSetClassMemberStatus(member: ClassMember, status: ClassMember["status"]) {
    setClassBusy(true);
    setStatusMessage("");
    try {
      await setClassMemberStatus(member, status);
      await loadClassData();
      setStatusMessage(status === "removed" ? "已將學生從班級移除。" : "已恢復學生班級成員狀態。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "班級學生狀態更新失敗。");
    } finally {
      setClassBusy(false);
    }
  }

  async function handleJoinClassByCode() {
    if (!user) {
      setStatusMessage("請先登入後再加入班級。");
      return;
    }
    if (effectiveRole !== "student") {
      setStatusMessage("目前只有學生帳號可以用班級代碼加入班級。");
      return;
    }

    setAccountBusy(true);
    setStatusMessage("");
    try {
      const member = await joinClassByCode(studentJoinCode, user);
      setStudentJoinCode("");
      await loadClassData();
      setStatusMessage(`已加入班級「${member.className}」。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "加入班級失敗。");
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleSetManagedUserDisabled(target: ManagedUser, disabled: boolean) {
    if (target.uid === user?.uid) {
      setStatusMessage("不能停用目前登入中的管理者帳號。");
      return;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      await setManagedUserDisabled(target, disabled, user);
      await loadAdminData();
      setStatusMessage(disabled ? "使用者已停用。" : "使用者已啟用。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "使用者停用狀態更新失敗。");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleClearManagedUserSubmissions(target: ManagedUser) {
    if (!window.confirm(`確定要清除「${target.displayName || target.email || target.uid}」的所有答題紀錄嗎？`)) {
      return;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      const result = await runAdminMutationStep("清除答題紀錄", () => deleteSubmissionsForUser(target.uid));
      await runAdminMutationStep("更新排行榜", () => removeUserFromLeaderboards(target.uid));
      await runAdminMutationStep("重新讀取後台資料", loadAdminData);
      if (target.uid === user?.uid) {
        setPracticeSubmissions([]);
        setSubmissions([]);
      }
      setLeaderboard(await runAdminMutationStep("重新讀取排行榜", loadGlobalLeaderboard));
      setStatusMessage(`已清除 ${result.submissionsDeleted} 筆答題紀錄。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "答題紀錄清除失敗。");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleDeleteManagedUser(target: ManagedUser) {
    if (target.uid === user?.uid) {
      setStatusMessage("不能刪除目前登入中的管理者帳號。");
      return;
    }
    if (
      !window.confirm(
        `確定要刪除「${target.displayName || target.email || target.uid}」嗎？這會連同答題紀錄與排行榜資料一起清除。`,
      )
    ) {
      return;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      const result = await runAdminMutationStep("清除答題紀錄", () => deleteSubmissionsForUser(target.uid));
      await runAdminMutationStep("更新排行榜", () => removeUserFromLeaderboards(target.uid));
      await runAdminMutationStep("刪除使用者資料", () => deleteManagedUserProfile(target));
      await runAdminMutationStep("重新讀取後台資料", loadAdminData);
      setLeaderboard(await runAdminMutationStep("重新讀取排行榜", loadGlobalLeaderboard));
      setStatusMessage(`使用者已刪除，並清除 ${result.submissionsDeleted} 筆答題紀錄。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "使用者刪除失敗。");
    } finally {
      setAdminBusy(false);
    }
  }

  function resetWorkspace() {
    localStorage.removeItem(workspaceStorageKey);
    legacyWorkspaceStorageKeys.forEach((key) => localStorage.removeItem(key));
    window.location.reload();
  }

  if (!platformReady) {
    return (
      <main className="loading-screen">
        <RefreshCw className="spin" />
        <span>載入平台中...</span>
      </main>
    );
  }

  // 競賽帳號：只在競賽模式有畫面；其他模式登出並回到公告。
  if (user?.accountType === "contest") {
    if (platform.mode === "contest" && user.contestId && platform.activeContestIds.includes(user.contestId)) {
      return <ContestShell platform={platform} user={user} onLogout={() => logout()} />;
    }
    void logout();
  }

  // 競賽或維護模式：非超管只看到公告（規格 4.3、5.3）。
  if (platform.mode !== "practice" && !superAdmin) {
    return (
      <AnnouncementScreen
        platform={platform}
        user={user?.accountType === "contest" ? null : user}
        loginBusy={loginBusy}
        onGoogleLogin={handleLogin}
        onLogout={() => logout()}
      >
        {!user && <ContestLoginForm />}
      </AnnouncementScreen>
    );
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
        <div className="brand-lockup">
          <GuishanIslandIcon />
          <div className="brand-text">
            <h1>{APP_TITLE}</h1>
            <span>宜蘭創意程式挑戰</span>
          </div>
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

      {platform.announcement && <div className="platform-banner">{platform.announcement}</div>}

      <main className={managementMaximized ? "workspace-layout admin-maximized" : "workspace-layout"}>
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
            {activeTab === "account" && (
              <AccountPanel
                user={user}
                profile={accountProfile}
                adminProfile={adminProfile}
                effectiveRole={effectiveRole}
                schools={schools}
                selectedSchoolId={accountSchoolId}
                studentJoinCode={studentJoinCode}
                studentClassMembers={studentClassMembers}
                busy={accountBusy}
                onSchoolChange={setAccountSchoolId}
                onSaveSchool={handleSaveAccountSchool}
                onStudentJoinCodeChange={setStudentJoinCode}
                onJoinClass={handleJoinClassByCode}
              />
            )}
            {activeTab === "classes" && (
              <ClassesPanel
                classes={teacherClasses}
                members={classMembers}
                submissionViews={classSubmissionViews}
                classNameDraft={classNameDraft}
                busy={classBusy}
                onClassNameChange={setClassNameDraft}
                onCreateClass={handleCreateLearningClass}
                onToggleJoin={handleToggleClassJoin}
                onSetMemberStatus={handleSetClassMemberStatus}
              />
            )}
            {activeTab === "admin" && (
              <AdminPanel
                admin={admin}
                superAdmin={superAdmin}
                platform={platform}
                onStatusMessage={setStatusMessage}
                adminProfile={adminProfile}
                adminProfiles={adminProfiles}
                adminDataBusy={adminDataBusy}
                adminSubmissions={adminSubmissions}
                adminUids={managedAdminUids}
                contests={contests}
                currentUser={user}
                schools={schools}
                problems={adminProblems.length > 0 ? adminProblems : problems}
                users={managedUsers}
                importJson={importJson}
                importCsv={importCsv}
                importMode={problemImportMode}
                editingProblemId={editingProblemId}
                editingProblemDraft={editingProblemDraft}
                editingContestId={editingContestId}
                editingContestDraft={editingContestDraft}
                editingSchoolId={editingSchoolId}
                editingSchoolDraft={editingSchoolDraft}
                problemSubmissionCounts={countSubmissionsByProblem(adminSubmissions)}
                onImportJsonChange={setImportJson}
                onImportCsvChange={setImportCsv}
                onImportModeChange={setProblemImportMode}
                onEditingProblemDraftChange={setEditingProblemDraft}
                onInitializeAdmin={handleInitializeAdmin}
                onCreateContest={handleCreateContestDraft}
                onImport={handleImportProblems}
                onUploadJsonFile={handleUploadProblemJsonFile}
                jsonFileInputRef={problemJsonFileInputRef}
                onImportCsv={handleImportCsvProblems}
                onExportCsv={handleExportCsvProblems}
                onSelectContestForEdit={handleSelectContestForEdit}
                onEditingContestDraftChange={setEditingContestDraft}
                onSaveEditedContest={handleSaveEditedContest}
                onMoveContestStatus={handleMoveContestStatus}
                onCreateSchool={handleCreateSchoolDraft}
                onSelectSchoolForEdit={handleSelectSchoolForEdit}
                onEditingSchoolDraftChange={setEditingSchoolDraft}
                onSaveEditedSchool={handleSaveEditedSchool}
                onSelectProblemForEdit={handleSelectProblemForEdit}
                onSaveEditedProblem={handleSaveEditedProblem}
                onCancelProblemEdit={handleCancelProblemEdit}
                onDeleteProblem={handleDeleteProblem}
                onRefreshAdminData={loadAdminData}
                onSetUserAdmin={handleSetManagedUserAdmin}
                onSetUserSchoolAdmin={handleSetManagedUserSchoolAdmin}
                onSetUserDisabled={handleSetManagedUserDisabled}
                onClearUserSubmissions={handleClearManagedUserSubmissions}
                onDeleteUser={handleDeleteManagedUser}
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
