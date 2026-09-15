import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  UserCircle,
  Users,
} from "lucide-react";
import BlocklyWorkspace from "./components/BlocklyWorkspace";
import { hasFirebaseConfig } from "./firebase";
import {
  deleteManagedUserProfile,
  loadAdminProfile,
  loadAdminProfiles,
  loadManagedUsers,
  setManagedUserAdmin,
  setManagedUserTeacherSchool,
  setManagedUserDisabled,
} from "./services/adminService";
import {
  getAccountStatusLabel,
  getEffectiveRole,
  getRoleLabel,
  inferUserRoleFromEmail,
  loadUserProfile,
  saveAccountSchoolSelection,
} from "./services/accountService";
import { isDemoAdmin, initializeFirstAdmin, loginWithGoogle, logout, subscribeToAuth } from "./services/authStore";
import {
  createLearningClass,
  joinClassByCode,
  loadClassMembers,
  loadClassSubmissionViews,
  loadStudentClassMembers,
  loadTeacherClasses,
  setClassJoinEnabled,
  setClassMemberStatus,
} from "./services/classStore";
import { createContestDraft, loadContests, saveContest } from "./services/contestStore";
import { gradeProblem, runCustomTest } from "./services/gradingEngine";
import {
  loadGlobalLeaderboard,
  removeUserFromLeaderboards,
  updateGlobalLeaderboard,
} from "./services/leaderboardService";
import {
  deleteProblemIfUnused,
  exportProblemsToCsv,
  getProblemCsvTemplate,
  importProblemsFromCsv,
  importProblemsFromJson,
  loadAllProblemsForAdmin,
  loadProblems,
  saveProblem,
  type ProblemImportResult,
  type ProblemImportMode,
} from "./services/problemStore";
import {
  deleteSubmissionsForUser,
  loadAllSubmissions,
  loadSubmissions,
  loadUserSubmissions,
  saveSubmission,
  MAX_SUBMISSIONS_PER_PROBLEM,
} from "./services/submissionService";
import {
  createSchoolAccount,
  createSchoolDraft,
  loadSchoolAccounts,
  loadSchools,
  loadSchoolsByIds,
  parseDomainText,
  previewRosterImport,
  saveRosterEntries,
  saveSchool,
  type RosterImportPreview,
} from "./services/schoolStore";
import type {
  AdminProfile,
  AppUser,
  ClassMember,
  ClassSubmissionView,
  ContestEvent,
  ContestStatus,
  GradeResult,
  LearningClass,
  LeaderboardEntry,
  ManagedUser,
  Problem,
  School,
  SchoolAccount,
  SubmissionRecord,
  UserRole,
  WorkspaceMode,
} from "./types";

const APP_TITLE = "宜蘭縣資訊科技創意實作競賽";

type TabKey = "statement" | "test" | "score" | "history" | "leaderboard" | "account" | "classes" | "admin";
type PracticeStatus = "completed" | "in-progress" | "not-started";
type AdminSectionKey = "contests" | "schoolAccounts" | "problems" | "users" | "progress";
type UserDirectoryRoleFilter = "all" | "teacher" | "student";

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

const contestStatusFlow: Array<{ key: ContestStatus; label: string; tone: "idle" | "ready" | "active" | "warning" | "done" }> = [
  { key: "draft", label: "草稿", tone: "idle" },
  { key: "roster", label: "報名／名單匯入", tone: "ready" },
  { key: "waiting", label: "等候開始", tone: "ready" },
  { key: "active", label: "競賽中", tone: "active" },
  { key: "paused", label: "暫停", tone: "warning" },
  { key: "ended", label: "結束", tone: "warning" },
  { key: "review", label: "成績審核", tone: "ready" },
  { key: "published", label: "正式公布", tone: "done" },
  { key: "archived", label: "封存", tone: "idle" },
];

const tabs: Array<{ key: TabKey; label: string; icon: typeof Play }> = [
  { key: "statement", label: "題目說明", icon: FileJson },
  { key: "test", label: "自行測試", icon: Play },
  { key: "score", label: "評分", icon: CheckCircle2 },
  { key: "history", label: "評分紀錄", icon: History },
  { key: "leaderboard", label: "排行榜", icon: Trophy },
  { key: "account", label: "我的帳號", icon: UserCircle },
  { key: "classes", label: "我的班級", icon: Users },
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
  const [schoolAccounts, setSchoolAccounts] = useState<SchoolAccount[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [importJson, setImportJson] = useState(defaultImportJson);
  const [importCsv, setImportCsv] = useState(getProblemCsvTemplate());
  const [rosterCsv, setRosterCsv] = useState(defaultRosterCsv);
  const [rosterPreview, setRosterPreview] = useState<RosterImportPreview | null>(null);
  const [rosterContestId, setRosterContestId] = useState("");
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
    [effectiveRole, superAdmin, user],
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
    if (!user) {
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
    if (
      (!admin && activeTab === "admin") ||
      (!user && activeTab === "account") ||
      (activeTab === "classes" && effectiveRole !== "teacher")
    ) {
      setActiveTab("statement");
    }
  }, [activeTab, admin, effectiveRole, user]);

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
        const nextSchoolAccounts = await loadAdminDataset("學校帳號資料", loadSchoolAccounts);
        setManagedUsers(nextUsers);
        setAdminProfiles(nextAdminProfiles);
        setManagedAdminUids(new Set(nextAdminProfiles.map((item) => item.uid)));
        setAdminSubmissions(nextSubmissions);
        setAdminProblems(nextAdminProblems);
        setContests(nextContests);
        setSchools(nextSchools);
        setSchoolAccounts(nextSchoolAccounts);
        return;
      }

      const assignedSchoolIds = adminProfile?.role === "teacher" ? adminProfile.schoolIds || [] : [];
      const [nextSchools, nextSchoolAccounts] = await Promise.all([
        loadSchoolsByIds(assignedSchoolIds),
        loadSchoolAccounts(assignedSchoolIds),
      ]);
      setManagedUsers([]);
      setAdminProfiles(adminProfile ? [adminProfile] : []);
      setManagedAdminUids(adminProfile ? new Set([adminProfile.uid]) : new Set());
      setAdminSubmissions([]);
      setAdminProblems([]);
      setContests([]);
      setSchools(nextSchools);
      setSchoolAccounts(nextSchoolAccounts);
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

  useEffect(() => {
    if (!superAdmin) {
      setRosterContestId("");
      setRosterPreview(null);
      return;
    }
    if (contests.length > 0 && !contests.some((contest) => contest.id === rosterContestId)) {
      setRosterContestId(contests[0].id);
      setRosterPreview(null);
    }
  }, [contests, rosterContestId, superAdmin]);

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
      setRosterPreview(null);
      setStatusMessage("學校網域已儲存。");
    } catch (error) {
      setStatusMessage(getSchoolWriteErrorMessage(error, "學校網域儲存失敗。"));
    } finally {
      setAdminBusy(false);
    }
  }

  function handlePreviewRosterImport() {
    if (!superAdmin) {
      setStatusMessage("只有超級管理者可以預覽賽事名單。");
      return;
    }
    if (!rosterContestId) {
      setStatusMessage("請先選擇要匯入的賽事。");
      return;
    }
    if (schools.length === 0) {
      setStatusMessage("請先建立學校網域，系統才能用 Email 自動歸校。");
      return;
    }
    const preview = previewRosterImport(rosterCsv, rosterContestId, schools);
    setRosterPreview(preview);
    setStatusMessage(
      `名單預覽完成：可匯入 ${preview.validRows.length} 筆，需修正 ${preview.invalidRows.length} 筆。`,
    );
  }

  async function handleSaveRosterImport() {
    if (!superAdmin) {
      setStatusMessage("只有超級管理者可以匯入賽事名單。");
      return;
    }
    if (!rosterPreview || rosterPreview.validRows.length === 0) {
      setStatusMessage("沒有可匯入的有效名單，請先預覽並修正錯誤。");
      return;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      const result = await saveRosterEntries(rosterPreview.contestId, rosterPreview.validRows);
      const targetContest = contests.find((contest) => contest.id === rosterPreview.contestId);
      if (targetContest) {
        await saveContest({
          ...targetContest,
          participantCount: rosterPreview.validRows.length,
          schoolCount: new Set(rosterPreview.validRows.map((row) => row.schoolId)).size,
        });
        await refreshContestList(targetContest.id);
      }
      setStatusMessage(`已匯入 ${result.importedCount} 筆賽事名單。`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "賽事名單匯入失敗。");
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

  async function handleCreateSchoolAccount(schoolId: string, email: string, name: string) {
    const school = schools.find((item) => item.id === schoolId);
    if (!school) {
      setStatusMessage("請先選擇要新增帳號的學校。");
      return false;
    }

    setAdminBusy(true);
    setStatusMessage("");
    try {
      await createSchoolAccount(school, email, name, user?.uid || adminProfile?.uid || "");
      await loadAdminData();
      setStatusMessage(`已新增 ${name.trim()} 的本校帳號。`);
      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "本校帳號新增失敗。");
      return false;
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
                adminProfile={adminProfile}
                adminProfiles={adminProfiles}
                adminDataBusy={adminDataBusy}
                adminSubmissions={adminSubmissions}
                adminUids={managedAdminUids}
                contests={contests}
                currentUser={user}
                schools={schools}
                schoolAccounts={schoolAccounts}
                problems={adminProblems.length > 0 ? adminProblems : problems}
                users={managedUsers}
                importJson={importJson}
                importCsv={importCsv}
                importMode={problemImportMode}
                rosterCsv={rosterCsv}
                rosterContestId={rosterContestId}
                rosterPreview={rosterPreview}
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
                onRosterCsvChange={(value) => {
                  setRosterCsv(value);
                  setRosterPreview(null);
                }}
                onRosterContestChange={(value) => {
                  setRosterContestId(value);
                  setRosterPreview(null);
                }}
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
                onPreviewRosterImport={handlePreviewRosterImport}
                onSaveRosterImport={handleSaveRosterImport}
                onSelectProblemForEdit={handleSelectProblemForEdit}
                onSaveEditedProblem={handleSaveEditedProblem}
                onCancelProblemEdit={handleCancelProblemEdit}
                onDeleteProblem={handleDeleteProblem}
                onRefreshAdminData={loadAdminData}
                onSetUserAdmin={handleSetManagedUserAdmin}
                onSetUserSchoolAdmin={handleSetManagedUserSchoolAdmin}
                onCreateSchoolAccount={handleCreateSchoolAccount}
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

async function loadAdminDataset<T>(label: string, loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    throw new Error(`後台資料讀取失敗：${label}：${getBackendReadErrorMessage(error)}`);
  }
}

async function runAdminMutationStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new Error(`${label}失敗：${getBackendWriteErrorMessage(error)}`);
  }
}

function getBackendReadErrorMessage(error: unknown) {
  const code = getErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("permission-denied") || combined.includes("insufficient permissions")) {
    return "權限不足。系統目前尚未把此登入帳號辨識為正式超級管理者。";
  }

  return message || "讀取失敗。";
}

function getBackendWriteErrorMessage(error: unknown) {
  const code = getErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("permission-denied") || combined.includes("insufficient permissions")) {
    return "權限不足。請確認目前登入帳號仍是正式超級管理者；若剛調整過權限，請重新整理後再試。";
  }

  return message || "寫入失敗。";
}

function getSchoolWriteErrorMessage(error: unknown, fallback: string) {
  const code = getErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  const combined = `${code} ${message}`.toLowerCase();

  if (combined.includes("permission-denied") || combined.includes("insufficient permissions")) {
    return "新增/儲存學校需要正式登入的超級管理者權限。請先登出再用超級管理者帳號登入；若仍失敗，請確認此帳號在後台管理者清單中為「超級管理者」。";
  }

  return message || fallback;
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

function AccountPanel({
  user,
  profile,
  adminProfile,
  effectiveRole,
  schools,
  selectedSchoolId,
  studentJoinCode,
  studentClassMembers,
  busy,
  onSchoolChange,
  onSaveSchool,
  onStudentJoinCodeChange,
  onJoinClass,
}: {
  user: AppUser | null;
  profile: ManagedUser | null;
  adminProfile: AdminProfile | null;
  effectiveRole: UserRole;
  schools: School[];
  selectedSchoolId: string;
  studentJoinCode: string;
  studentClassMembers: ClassMember[];
  busy: boolean;
  onSchoolChange: (schoolId: string) => void;
  onSaveSchool: () => void;
  onStudentJoinCodeChange: (value: string) => void;
  onJoinClass: () => void;
}) {
  const roleLabel = getRoleLabel(effectiveRole);
  const schoolName = adminProfile?.schoolName || profile?.schoolName || "尚未設定";
  const schoolVerified = adminProfile?.schoolVerified || profile?.schoolVerified;
  const accountStatus = getAccountStatusLabel(profile?.status || adminProfile?.status, profile?.disabled);
  const emailDomain = profile?.emailDomain || (user?.email ? user.email.split("@")[1] : "");

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>我的帳號</h2>
        <span>{roleLabel}</span>
      </div>

      {!user ? (
        <p className="warning-text">請先登入後查看帳號資訊。</p>
      ) : (
        <>
          <section className="account-card">
            <div>
              <span className="account-label">姓名</span>
              <strong>{profile?.displayName || user.displayName || "未命名使用者"}</strong>
            </div>
            <div>
              <span className="account-label">Email</span>
              <strong>{user.email || "-"}</strong>
            </div>
            <div>
              <span className="account-label">身份</span>
              <strong>{roleLabel}</strong>
            </div>
            <div>
              <span className="account-label">帳號狀態</span>
              <strong>{accountStatus}</strong>
            </div>
            <div>
              <span className="account-label">Email 網域</span>
              <strong>{emailDomain || "-"}</strong>
            </div>
            <div>
              <span className="account-label">所屬學校</span>
              <strong>{schoolName}</strong>
              {effectiveRole === "teacher" && (
                <small>{schoolVerified ? "超管已確認" : "教師自填，待超管確認"}</small>
              )}
            </div>
          </section>

          {effectiveRole === "teacher" && (
            <section className="admin-section">
              <div className="section-title-row">
                <div>
                  <h3>任教學校設定</h3>
                  <p>教師可以先自行設定任教學校；超管仍可在後台調整與確認。這個設定會作為未來建立班級時的預設學校。</p>
                </div>
              </div>
              {schools.length === 0 ? (
                <p className="warning-text">目前尚無可選學校，請先由超管建立學校資料。</p>
              ) : (
                <div className="account-school-form">
                  <label className="problem-form-field">
                    任教學校
                    <select value={selectedSchoolId} onChange={(event) => onSchoolChange(event.target.value)}>
                      <option value="">請選擇學校</option>
                      {schools
                        .filter((school) => school.enabled !== false)
                        .map((school) => (
                          <option key={school.id} value={school.id}>
                            {school.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button className="primary-button" type="button" onClick={onSaveSchool} disabled={busy || !selectedSchoolId}>
                    儲存學校設定
                  </button>
                </div>
              )}
            </section>
          )}

          {effectiveRole === "student" && (
            <section className="admin-section">
              <div className="section-title-row">
                <div>
                  <h3>班級代碼</h3>
                  <p>輸入教師提供的班級代碼，就能加入班級；加入後教師會在「我的班級」看到你的名單。</p>
                </div>
              </div>
              <div className="join-code-form">
                <label className="problem-form-field">
                  班級代碼
                  <input
                    value={studentJoinCode}
                    placeholder="例如 ILC-8K3Q"
                    onChange={(event) => onStudentJoinCodeChange(event.target.value.toUpperCase())}
                  />
                </label>
                <button className="primary-button" type="button" onClick={onJoinClass} disabled={busy || !studentJoinCode.trim()}>
                  加入班級
                </button>
              </div>

              <div className="admin-table">
                <div className="admin-table-head student-class-table-row">
                  <span>班級</span>
                  <span>學校</span>
                  <span>授課教師</span>
                  <span>加入時間</span>
                  <span>狀態</span>
                </div>
                {studentClassMembers.length === 0 && <p className="muted table-empty">尚未加入任何班級。</p>}
                {studentClassMembers.map((member) => (
                  <div className="student-class-table-row" key={member.id}>
                    <span>{member.className}</span>
                    <span>{member.schoolName || "-"}</span>
                    <span>{member.teacherName || "-"}</span>
                    <span>{formatContestDateTime(member.joinedAt)}</span>
                    <span className={member.status === "removed" ? "status-pill disabled" : "status-pill"}>
                      {member.status === "removed" ? "已移除" : "已加入"}
                    </span>
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

function ClassesPanel({
  classes,
  members,
  submissionViews,
  classNameDraft,
  busy,
  onClassNameChange,
  onCreateClass,
  onToggleJoin,
  onSetMemberStatus,
}: {
  classes: LearningClass[];
  members: ClassMember[];
  submissionViews: ClassSubmissionView[];
  classNameDraft: string;
  busy: boolean;
  onClassNameChange: (value: string) => void;
  onCreateClass: () => void;
  onToggleJoin: (learningClass: LearningClass, joinEnabled: boolean) => void;
  onSetMemberStatus: (member: ClassMember, status: ClassMember["status"]) => void;
}) {
  const membersByClassId = useMemo(() => {
    const grouped = new Map<string, ClassMember[]>();
    for (const member of members) {
      grouped.set(member.classId, [...(grouped.get(member.classId) || []), member]);
    }
    return grouped;
  }, [members]);

  const submissionsByClassId = useMemo(() => {
    const grouped = new Map<string, ClassSubmissionView[]>();
    for (const item of submissionViews) {
      grouped.set(item.classId, [...(grouped.get(item.classId) || []), item]);
    }
    return grouped;
  }, [submissionViews]);

  const [activeClassSection, setActiveClassSection] =
    useState<"classes" | "students" | "submissions">("classes");
  const activeMemberCount = members.filter((member) => member.status !== "removed").length;
  const classSectionTitle =
    activeClassSection === "classes"
      ? "班級管理"
      : activeClassSection === "students"
        ? "學生名單"
        : "答題記錄";
  const classSectionDescription =
    activeClassSection === "classes"
      ? "管理班級代碼、開放加入狀態與班級基本資訊。"
      : activeClassSection === "students"
        ? "依班級查看學生名單，可將學生移除或恢復加入狀態。"
        : "依班級查看學生提交後同步到班級的答題紀錄。";

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>我的班級</h2>
        <span>{classes.length} 個班級 · {activeMemberCount} 位學生 · {submissionViews.length} 筆答題紀錄</span>
      </div>

      <div className="admin-top-tabs" role="tablist" aria-label="班級管理功能表">
        <button
          className={activeClassSection === "classes" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeClassSection === "classes"}
          onClick={() => setActiveClassSection("classes")}
        >
          班級管理
        </button>
        <button
          className={activeClassSection === "students" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeClassSection === "students"}
          onClick={() => setActiveClassSection("students")}
        >
          學生名單
        </button>
        <button
          className={activeClassSection === "submissions" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeClassSection === "submissions"}
          onClick={() => setActiveClassSection("submissions")}
        >
          答題記錄
        </button>
      </div>

      {activeClassSection === "classes" && (
      <section className="admin-section">
        <div className="section-title-row">
          <div>
            <h3>建立班級</h3>
            <p>輸入班級名稱後，系統會自動產生班級代碼。學生可在「我的帳號」輸入代碼加入。</p>
          </div>
        </div>
        <div className="class-create-form">
          <label className="problem-form-field">
            班級名稱
            <input
              value={classNameDraft}
              placeholder="例如 603、七年一班、資訊社"
              onChange={(event) => onClassNameChange(event.target.value)}
            />
          </label>
          <button className="primary-button" type="button" onClick={onCreateClass} disabled={busy || !classNameDraft.trim()}>
            建立班級
          </button>
        </div>
      </section>
      )}

      <section className="admin-section">
        <div className="section-title-row">
          <div>
            <h3>{classSectionTitle}</h3>
            <p>{classSectionDescription}</p>
          </div>
        </div>

        {classes.length === 0 && <p className="muted">尚未建立班級。</p>}
        {classes.map((learningClass) => {
          const classMembers = membersByClassId.get(learningClass.id) || [];
          const activeMembers = classMembers.filter((member) => member.status !== "removed");
          const classSubmissions = submissionsByClassId.get(learningClass.id) || [];
          return (
            <div className="class-card" key={learningClass.id}>
              <div className="class-card-head">
                <div>
                  <h4>{learningClass.name}</h4>
                  <p>{learningClass.schoolName || "未設定學校"}｜{learningClass.teacherName}</p>
                </div>
                <div className="class-code-box">
                  <span>班級代碼</span>
                  <strong>{learningClass.joinCode}</strong>
                </div>
              </div>

              <div className="class-card-meta">
                <span className={learningClass.joinEnabled ? "status-pill" : "status-pill disabled"}>
                  {learningClass.joinEnabled ? "開放加入" : "關閉加入"}
                </span>
                <span>{activeMembers.length} 位學生</span>
                <span>{classSubmissions.length} 筆答題紀錄</span>
                <span>建立：{formatContestDateTime(learningClass.createdAt)}</span>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={busy}
                  onClick={() => onToggleJoin(learningClass, !learningClass.joinEnabled)}
                >
                  {learningClass.joinEnabled ? "關閉加入" : "開放加入"}
                </button>
              </div>

              {activeClassSection === "students" && (
              <div className="admin-table">
                <div className="admin-table-head class-member-table-row">
                  <span>學生</span>
                  <span>Email</span>
                  <span>加入時間</span>
                  <span>狀態</span>
                  <span>操作</span>
                </div>
                {classMembers.length === 0 && <p className="muted table-empty">尚無學生加入。</p>}
                {classMembers.map((member) => (
                  <div className="class-member-table-row" key={member.id}>
                    <span>{member.studentName}</span>
                    <span>{member.studentEmail || "-"}</span>
                    <span>{formatContestDateTime(member.joinedAt)}</span>
                    <span className={member.status === "removed" ? "status-pill disabled" : "status-pill"}>
                      {member.status === "removed" ? "已移除" : "已加入"}
                    </span>
                    <span>
                      <button
                        className="ghost-button compact"
                        type="button"
                        disabled={busy}
                        onClick={() => onSetMemberStatus(member, member.status === "removed" ? "active" : "removed")}
                      >
                        {member.status === "removed" ? "恢復" : "移除"}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              )}

              {activeClassSection === "submissions" && (
              <div className="class-management-block">
                <div className="section-title-row compact">
                  <div>
                    <h4>學生答題紀錄</h4>
                    <p>只顯示此班級學生之後提交並同步到班級的紀錄。</p>
                  </div>
                  <span className="section-pill">{classSubmissions.length} 筆</span>
                </div>
                <div className="admin-table">
                  <div className="admin-table-head class-submission-table-row">
                    <span>時間</span>
                    <span>學生</span>
                    <span>題目</span>
                    <span>答題率</span>
                    <span>分數</span>
                    <span>狀態</span>
                  </div>
                  {classSubmissions.length === 0 && (
                    <p className="muted table-empty">尚無班級答題紀錄；學生下一次提交後會出現在這裡。</p>
                  )}
                  {classSubmissions.slice(0, 50).map((item) => (
                    <div className="class-submission-table-row" key={item.id}>
                      <span>{formatContestDateTime(item.createdAt)}</span>
                      <span>{item.studentName}</span>
                      <span>{item.problemTitle}</span>
                      <span>{Math.round(item.passRate * 100)}%</span>
                      <span>{item.score}/{item.maxScore}</span>
                      <span className={item.isFullScore ? "status-pill" : "status-pill warning"}>
                        {item.isFullScore ? "已完成" : item.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function AdminPanel({
  admin,
  superAdmin,
  adminProfile,
  adminProfiles,
  adminDataBusy,
  adminSubmissions,
  adminUids,
  contests,
  currentUser,
  schools,
  schoolAccounts,
  importJson,
  importCsv,
  importMode,
  rosterCsv,
  rosterContestId,
  rosterPreview,
  editingContestId,
  editingContestDraft,
  editingSchoolId,
  editingSchoolDraft,
  editingProblemId,
  editingProblemDraft,
  problemSubmissionCounts,
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
  onRosterCsvChange,
  onRosterContestChange,
  onEditingContestDraftChange,
  onEditingSchoolDraftChange,
  onEditingProblemDraftChange,
  onInitializeAdmin,
  onCreateContest,
  onImport,
  onUploadJsonFile,
  jsonFileInputRef,
  onSelectContestForEdit,
  onSaveEditedContest,
  onMoveContestStatus,
  onCreateSchool,
  onSelectSchoolForEdit,
  onSaveEditedSchool,
  onPreviewRosterImport,
  onSaveRosterImport,
  onSelectProblemForEdit,
  onSaveEditedProblem,
  onCancelProblemEdit,
  onDeleteProblem,
  onRefreshAdminData,
  onSetUserAdmin,
  onSetUserSchoolAdmin,
  onCreateSchoolAccount,
  onSetUserDisabled,
  onClearUserSubmissions,
  onDeleteUser,
}: {
  admin: boolean;
  superAdmin: boolean;
  adminProfile: AdminProfile | null;
  adminProfiles: AdminProfile[];
  adminDataBusy: boolean;
  adminSubmissions: SubmissionRecord[];
  adminUids: Set<string>;
  contests: ContestEvent[];
  currentUser: AppUser | null;
  schools: School[];
  schoolAccounts: SchoolAccount[];
  importJson: string;
  importCsv: string;
  importMode: ProblemImportMode;
  rosterCsv: string;
  rosterContestId: string;
  rosterPreview: RosterImportPreview | null;
  editingContestId: string;
  editingContestDraft: ContestEvent | null;
  editingSchoolId: string;
  editingSchoolDraft: School | null;
  editingProblemId: string;
  editingProblemDraft: Problem | null;
  problemSubmissionCounts: Record<string, number>;
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
  onRosterCsvChange: (value: string) => void;
  onRosterContestChange: (value: string) => void;
  onEditingContestDraftChange: (value: ContestEvent | null) => void;
  onEditingSchoolDraftChange: (value: School | null) => void;
  onEditingProblemDraftChange: (value: Problem | null) => void;
  onInitializeAdmin: () => void;
  onCreateContest: (previous?: ContestEvent) => void;
  onImport: () => void;
  onUploadJsonFile: (file: File | undefined) => void;
  jsonFileInputRef: RefObject<HTMLInputElement | null>;
  onSelectContestForEdit: (contestId: string) => void;
  onSaveEditedContest: (contest: ContestEvent) => void;
  onMoveContestStatus: (contest: ContestEvent, nextStatus: ContestStatus) => void;
  onCreateSchool: () => void;
  onSelectSchoolForEdit: (schoolId: string) => void;
  onSaveEditedSchool: (school: School) => void;
  onPreviewRosterImport: () => void;
  onSaveRosterImport: () => void;
  onSelectProblemForEdit: (problemId: string) => void;
  onSaveEditedProblem: (problem: Problem) => void;
  onCancelProblemEdit: () => void;
  onDeleteProblem: (problemId: string) => void;
  onRefreshAdminData: () => void;
  onSetUserAdmin: (user: ManagedUser, makeAdmin: boolean) => void;
  onSetUserSchoolAdmin: (user: ManagedUser, schoolId: string) => void;
  onCreateSchoolAccount: (schoolId: string, email: string, name: string) => Promise<boolean> | boolean;
  onSetUserDisabled: (user: ManagedUser, disabled: boolean) => void;
  onClearUserSubmissions: (user: ManagedUser) => void;
  onDeleteUser: (user: ManagedUser) => void;
}) {
  const progressRows = buildUserProgressRows(users, problems, adminSubmissions, adminUids);
  const userSubmissionCounts = countSubmissionsByUser(adminSubmissions);
  const adminProfileByUid = useMemo(
    () => new Map(adminProfiles.map((profile) => [profile.uid, profile])),
    [adminProfiles],
  );
  const schoolNameById = useMemo(
    () => new Map(schools.map((school) => [school.id, school.name])),
    [schools],
  );
  const assignableSchools = useMemo(
    () => schools.filter((school) => school.enabled !== false),
    [schools],
  );
  const [activeAdminSection, setActiveAdminSection] = useState<AdminSectionKey>(
    superAdmin ? "contests" : "schoolAccounts",
  );
  const [schoolAdminSchoolId, setSchoolAdminSchoolId] = useState("");
  const [schoolAccountSchoolId, setSchoolAccountSchoolId] = useState("");
  const [schoolAccountEmail, setSchoolAccountEmail] = useState("");
  const [schoolAccountName, setSchoolAccountName] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<UserDirectoryRoleFilter>("all");
  const [userSchoolFilterId, setUserSchoolFilterId] = useState("all");
  const [expandedProgressUserId, setExpandedProgressUserId] = useState("");
  const adminSections: Array<{ key: AdminSectionKey; label: string }> = superAdmin
    ? [
        { key: "contests", label: "賽事管理" },
        { key: "schoolAccounts", label: "學校帳號" },
        { key: "problems", label: "題目管理" },
        { key: "users", label: "使用者管理" },
        { key: "progress", label: "使用者解題資料" },
      ]
    : [
        { key: "schoolAccounts", label: "本校帳號" },
      ];
  const openContestCount = contests.filter((contest) => contest.status !== "archived").length;
  const selectedSchoolAccountSchoolId = schoolAccountSchoolId || assignableSchools[0]?.id || "";
  const visibleSchoolAccounts =
    selectedSchoolAccountSchoolId
      ? schoolAccounts.filter((account) => account.schoolId === selectedSchoolAccountSchoolId)
      : schoolAccounts;
  const adminRoleLabel = superAdmin ? "超級管理者" : adminProfile?.role === "teacher" ? "教師" : "管理者";
  const schoolAccountsByUid = useMemo(() => {
    const grouped = new Map<string, SchoolAccount[]>();
    for (const account of schoolAccounts) {
      if (!account.uid) {
        continue;
      }
      grouped.set(account.uid, [...(grouped.get(account.uid) || []), account]);
    }
    return grouped;
  }, [schoolAccounts]);
  const schoolAccountsByEmail = useMemo(() => {
    const grouped = new Map<string, SchoolAccount[]>();
    for (const account of schoolAccounts) {
      const email = normalizeEmailForLookup(account.normalizedEmail || account.email);
      if (!email) {
        continue;
      }
      grouped.set(email, [...(grouped.get(email) || []), account]);
    }
    return grouped;
  }, [schoolAccounts]);
  const userDirectoryRows = useMemo(
    () =>
      users.map((item) => {
        const profile = adminProfileByUid.get(item.uid);
        const role = getManagedUserDirectoryRole(item, profile);
        const schoolIds = getManagedUserSchoolIds(
          item,
          profile,
          schoolAccountsByUid,
          schoolAccountsByEmail,
        );
        const schoolNames = schoolIds
          .map((schoolId) => schoolNameById.get(schoolId) || schoolId)
          .filter(Boolean);
        const schoolLabel =
          schoolNames.length > 0
            ? Array.from(new Set(schoolNames)).join("、")
            : item.schoolName || profile?.schoolName || "尚未設定";

        return {
          item,
          role,
          roleLabel: getManagedUserDirectoryRoleLabel(role),
          schoolIds,
          schoolLabel,
        };
      }),
    [adminProfileByUid, schoolAccountsByEmail, schoolAccountsByUid, schoolNameById, users],
  );
  const visibleUserDirectoryRows = useMemo(
    () =>
      userDirectoryRows.filter((row) => {
        const roleMatched = userRoleFilter === "all" || row.role === userRoleFilter;
        const schoolMatched =
          userSchoolFilterId === "all" || row.schoolIds.includes(userSchoolFilterId);
        return roleMatched && schoolMatched;
      }),
    [userDirectoryRows, userRoleFilter, userSchoolFilterId],
  );
  const visibleTeacherCount = visibleUserDirectoryRows.filter((row) => row.role === "teacher").length;
  const visibleStudentCount = visibleUserDirectoryRows.filter((row) => row.role === "student").length;
  const visibleNoSchoolCount = visibleUserDirectoryRows.filter((row) => row.schoolIds.length === 0).length;

  useEffect(() => {
    const allowedSectionKeys = new Set(adminSections.map((section) => section.key));
    if (!allowedSectionKeys.has(activeAdminSection)) {
      setActiveAdminSection(adminSections[0]?.key || "schoolAccounts");
    }
  }, [activeAdminSection, adminSections]);

  useEffect(() => {
    if (assignableSchools.length === 0) {
      setSchoolAdminSchoolId("");
      setSchoolAccountSchoolId("");
      setUserSchoolFilterId("all");
      return;
    }
    if (!assignableSchools.some((school) => school.id === schoolAdminSchoolId)) {
      setSchoolAdminSchoolId(assignableSchools[0].id);
    }
    if (!assignableSchools.some((school) => school.id === schoolAccountSchoolId)) {
      setSchoolAccountSchoolId(assignableSchools[0].id);
    }
    if (userSchoolFilterId !== "all" && !assignableSchools.some((school) => school.id === userSchoolFilterId)) {
      setUserSchoolFilterId("all");
    }
  }, [assignableSchools, schoolAccountSchoolId, schoolAdminSchoolId, userSchoolFilterId]);

  const getAdminRoleLabel = (item: ManagedUser) => {
    const profile = adminProfileByUid.get(item.uid);
    if (!profile) {
      return getRoleLabel(item.role);
    }
    if (profile.role === "super") {
      return "超級管理者";
    }
    const schoolNames = (profile.schoolIds || [profile.schoolId || ""])
      .filter(Boolean)
      .map((schoolId) => schoolNameById.get(schoolId) || profile.schoolName || schoolId);
    return schoolNames.length > 0 ? `教師：${schoolNames.join("、")}` : "教師";
  };

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>管理中心</h2>
        <span>{admin ? adminRoleLabel : "未啟用"}</span>
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

          {superAdmin && activeAdminSection === "contests" && (
            <section className="admin-section">
              <div className="section-title-row">
                <div>
                  <h3>年度賽事生命週期</h3>
                  <p>每年建立一個獨立賽事實例，從草稿、名單匯入、競賽中、成績審核到封存逐步管理。</p>
                </div>
                <div className="admin-file-actions">
                  <button className="ghost-button" onClick={onRefreshAdminData} disabled={adminDataBusy}>
                    重新整理
                  </button>
                  <button className="primary-button" onClick={() => onCreateContest()} disabled={adminBusy}>
                    新增賽事草稿
                  </button>
                </div>
              </div>

              <div className="contest-lifecycle-strip" aria-label="賽事生命週期">
                {contestStatusFlow.map((status) => (
                  <span className={`contest-status-step ${status.tone}`} key={status.key}>
                    {status.label}
                  </span>
                ))}
              </div>

              <div className="metric-row">
                <Metric label="賽事總數" value={`${contests.length} 場`} />
                <Metric label="未封存賽事" value={`${openContestCount} 場`} />
                <Metric label="題庫可用題數" value={`${problems.length} 題`} />
              </div>

              <div className="admin-table">
                <div className="admin-table-head contest-table-row">
                  <span>年度</span>
                  <span>賽事名稱</span>
                  <span>狀態</span>
                  <span>模式</span>
                  <span>開始</span>
                  <span>結束</span>
                  <span>題目</span>
                  <span>參賽</span>
                  <span>學校</span>
                  <span>操作</span>
                </div>
                {contests.length === 0 && <p className="muted table-empty">尚未建立賽事。請先新增年度賽事草稿。</p>}
                {contests.map((contest) => {
                  const expanded = editingContestId === contest.id;
                  const nextStatus = getNextContestStatus(contest.status);
                  return (
                    <div className="contest-table-item" key={contest.id}>
                      <div
                        className={expanded ? "contest-table-row clickable active" : "contest-table-row clickable"}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectContestForEdit(contest.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectContestForEdit(contest.id);
                          }
                        }}
                      >
                        <span>{contest.year}</span>
                        <span>{contest.title}</span>
                        <span className={`contest-status-badge ${contest.status}`}>
                          {getContestStatusLabel(contest.status)}
                        </span>
                        <span>{getContestModeLabel(contest.mode)}</span>
                        <span>{formatContestDateTime(contest.startAt)}</span>
                        <span>{formatContestDateTime(contest.endAt)}</span>
                        <span>{contest.problemIds.length} 題</span>
                        <span>{contest.participantCount || 0} 人</span>
                        <span>{contest.schoolCount || 0} 校</span>
                        <div className="contest-actions">
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectContestForEdit(contest.id);
                            }}
                          >
                            {expanded ? "收合" : "編輯"}
                          </button>
                          {nextStatus && (
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={adminBusy}
                              onClick={(event) => {
                                event.stopPropagation();
                                onMoveContestStatus(contest, nextStatus);
                              }}
                            >
                              下一階段：{getContestStatusLabel(nextStatus)}
                            </button>
                          )}
                          <button
                            className="ghost-button"
                            type="button"
                            disabled={adminBusy}
                            onClick={(event) => {
                              event.stopPropagation();
                              onCreateContest(contest);
                            }}
                          >
                            複製明年
                          </button>
                        </div>
                      </div>
                      {expanded && editingContestDraft && (
                        <ContestEditorForm
                          contest={editingContestDraft}
                          busy={adminBusy}
                          onChange={onEditingContestDraftChange}
                          onSave={() => onSaveEditedContest(editingContestDraft)}
                          onCancel={() => onSelectContestForEdit(contest.id)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <section className="admin-subsection">
                <div className="section-title-row">
                  <div>
                    <h3>學校設定</h3>
                    <p>建立可供教師選擇的學校清單；Email 網域欄位暫保留為選填備註，不再作為學校判斷核心。</p>
                  </div>
                  <button className="primary-button" type="button" onClick={onCreateSchool} disabled={adminBusy}>
                    新增學校
                  </button>
                </div>
                <div className="admin-table">
                  <div className="admin-table-head school-table-row">
                    <span>學校</span>
                    <span>Email 網域/備註</span>
                    <span>狀態</span>
                    <span>操作</span>
                  </div>
                  {schools.length === 0 && <p className="muted table-empty">尚未建立學校資料。請先新增學校。</p>}
                  {schools.map((school) => {
                    const expanded = editingSchoolId === school.id;
                    return (
                      <div className="school-table-item" key={school.id}>
                        <div
                          className={expanded ? "school-table-row clickable active" : "school-table-row clickable"}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectSchoolForEdit(school.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectSchoolForEdit(school.id);
                            }
                          }}
                        >
                          <span>{school.name}</span>
                          <span>{school.domains.join("、") || "-"}</span>
                          <span className={school.enabled === false ? "status-pill disabled" : "status-pill"}>
                            {school.enabled === false ? "停用" : "啟用"}
                          </span>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectSchoolForEdit(school.id);
                            }}
                          >
                            {expanded ? "收合" : "編輯"}
                          </button>
                        </div>
                        {expanded && editingSchoolDraft && (
                          <SchoolEditorForm
                            school={editingSchoolDraft}
                            busy={adminBusy}
                            onChange={onEditingSchoolDraftChange}
                            onSave={() => onSaveEditedSchool(editingSchoolDraft)}
                            onCancel={() => onSelectSchoolForEdit(school.id)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="admin-subsection">
                <div className="section-title-row">
                  <div>
                    <h3>賽事名單匯入</h3>
                    <p>CSV 只需要兩欄：email,name。此區暫保留舊版預覽流程，後續賽事名單會調整為「先選學校，再匯入 email,name」。</p>
                  </div>
                  {rosterPreview && (
                    <span className="section-pill">
                      可匯入 {rosterPreview.validRows.length} 筆／需修正 {rosterPreview.invalidRows.length} 筆
                    </span>
                  )}
                </div>
                <div className="roster-import-grid">
                  <label className="admin-field">
                    匯入賽事
                    <select value={rosterContestId} onChange={(event) => onRosterContestChange(event.target.value)}>
                      <option value="">請選擇賽事</option>
                      {contests.map((contest) => (
                        <option key={contest.id} value={contest.id}>
                          {contest.year}｜{contest.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="admin-field roster-csv-field">
                    CSV 名單資料
                    <textarea
                      className="json-input compact"
                      value={rosterCsv}
                      onChange={(event) => onRosterCsvChange(event.target.value)}
                    />
                  </label>
                </div>
                <div className="problem-form-actions">
                  <button className="ghost-button" type="button" onClick={onPreviewRosterImport} disabled={adminBusy}>
                    預覽檢查
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={onSaveRosterImport}
                    disabled={adminBusy || !rosterPreview || rosterPreview.validRows.length === 0}
                  >
                    匯入有效名單
                  </button>
                </div>
                {rosterPreview && (
                  <div className="admin-table roster-preview-table">
                    <div className="admin-table-head roster-table-row">
                      <span>列</span>
                      <span>Email</span>
                      <span>姓名</span>
                      <span>學校</span>
                      <span>網域</span>
                      <span>檢查結果</span>
                    </div>
                    {rosterPreview.rows.map((row) => (
                      <div className="roster-table-row" key={`${row.rowNumber}-${row.email}`}>
                        <span>{row.rowNumber}</span>
                        <span>{row.email || "-"}</span>
                        <span>{row.name || "-"}</span>
                        <span>{row.schoolName || "-"}</span>
                        <span>{row.domain || "-"}</span>
                        <span className={row.valid ? "ok-text" : "danger-text"}>
                          {row.valid ? "可匯入" : row.errors.join("、")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </section>
          )}

          {activeAdminSection === "schoolAccounts" && (
            <section className="admin-section">
              <div className="section-title-row">
                <div>
                  <h3>{superAdmin ? "學校帳號管理" : "本校帳號管理"}</h3>
                  <p>
                    {superAdmin
                      ? "可檢視並新增各校一般使用者帳號；這份名冊與年度賽事名單分開，方便未來再調整教師權限。"
                      : "教師只能新增與查看被指派學校的帳號，暫不開放賽事資料與全站答題資料。"}
                  </p>
                </div>
                <button className="ghost-button" onClick={onRefreshAdminData} disabled={adminDataBusy}>
                  重新整理
                </button>
              </div>

              {assignableSchools.length === 0 ? (
                <p className="warning-text">
                  {superAdmin ? "尚未建立學校資料，請先到賽事管理新增學校網域。" : "尚未指派可管理的學校，請聯絡超級管理者。"}
                </p>
              ) : (
                <>
                  <div className="school-account-form">
                    <label className="problem-form-field">
                      學校
                      <select
                        value={selectedSchoolAccountSchoolId}
                        onChange={(event) => setSchoolAccountSchoolId(event.target.value)}
                        disabled={!superAdmin && assignableSchools.length <= 1}
                      >
                        {assignableSchools.map((school) => (
                          <option key={school.id} value={school.id}>
                            {school.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="problem-form-field">
                      學生 Email
                      <input
                        type="email"
                        value={schoolAccountEmail}
                        placeholder="student@example.edu.tw"
                        onChange={(event) => setSchoolAccountEmail(event.target.value)}
                      />
                    </label>
                    <label className="problem-form-field">
                      姓名
                      <input
                        value={schoolAccountName}
                        placeholder="王小明"
                        onChange={(event) => setSchoolAccountName(event.target.value)}
                      />
                    </label>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={adminBusy || !selectedSchoolAccountSchoolId}
                      onClick={async () => {
                        const created = await onCreateSchoolAccount(
                          selectedSchoolAccountSchoolId,
                          schoolAccountEmail,
                          schoolAccountName,
                        );
                        if (created) {
                          setSchoolAccountEmail("");
                          setSchoolAccountName("");
                        }
                      }}
                    >
                      新增本校帳號
                    </button>
                  </div>

                  <div className="metric-row">
                    <Metric label="可管理學校" value={`${assignableSchools.length} 校`} />
                    <Metric label="目前顯示帳號" value={`${visibleSchoolAccounts.length} 筆`} />
                    <Metric label="全部學校帳號" value={`${schoolAccounts.length} 筆`} />
                  </div>

                  <div className="admin-table">
                    <div className="admin-table-head school-account-table-row">
                      <span>學校</span>
                      <span>Email</span>
                      <span>姓名</span>
                      <span>網域</span>
                      <span>狀態</span>
                      <span>建立時間</span>
                    </div>
                    {visibleSchoolAccounts.length === 0 && (
                      <p className="muted table-empty">目前尚無本校帳號。</p>
                    )}
                    {visibleSchoolAccounts.map((account) => (
                      <div className="school-account-table-row" key={account.id}>
                        <span>{account.schoolName || schoolNameById.get(account.schoolId) || "-"}</span>
                        <span>{account.email}</span>
                        <span>{account.name}</span>
                        <span>{account.domain || "-"}</span>
                        <span className={account.status === "disabled" ? "status-pill disabled" : "status-pill"}>
                          {account.status === "disabled" ? "停用" : "啟用"}
                        </span>
                        <span>{formatContestDateTime(account.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {activeAdminSection === "problems" && (
            <>
          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>題庫匯入與匯出</h3>
                <p>JSON 可單題或整包匯入；CSV 可匯出後用 Excel 編輯再貼回匯入。本版含「選擇 JSON 檔案匯入」欄位。</p>
              </div>
              <div className="admin-file-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => jsonFileInputRef.current?.click()}
                  disabled={busy}
                >
                  <Upload size={17} />
                  上傳 JSON 檔
                </button>
                <button className="ghost-button" onClick={onExportCsv}>
                  匯出 CSV
                </button>
              </div>
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
              <span className="json-file-picker">
                <span>選擇 JSON 檔案匯入</span>
                <input
                  ref={jsonFileInputRef}
                  className="json-file-input"
                  type="file"
                  accept=".json,application/json,text/json"
                  onChange={(event) => onUploadJsonFile(event.target.files?.[0])}
                  disabled={busy}
                />
              </span>
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
                <p>點選題目列可展開或收合編輯表單；已有提交紀錄的題目不可刪除，請改為草稿或封存。</p>
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
                  <span>範例</span>
                  <span>測資</span>
                  <span>隱藏</span>
                  <span>非範例</span>
                  <span>提交</span>
                  <span>狀態</span>
                  <span>操作</span>
                </div>
                {problems.length === 0 && <p className="muted table-empty">尚無題目。</p>}
                {problems.map((problem) => {
                  const caseSummary = getProblemCaseSummary(problem);
                  const submissionCount = problemSubmissionCounts[problem.id] || 0;
                  const expanded = editingProblemId === problem.id;
                  return (
                    <div className="problem-table-item" key={problem.id}>
                      <div
                        className={expanded ? "problem-table-row clickable active" : "problem-table-row clickable"}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectProblemForEdit(problem.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectProblemForEdit(problem.id);
                          }
                        }}
                      >
                        <span>{problem.id}</span>
                        <span>{problem.year || "-"}</span>
                        <span>{problem.category}</span>
                        <span>{problem.title}</span>
                        <span>{caseSummary.exampleCount}</span>
                        <span>{caseSummary.caseCount}</span>
                        <span>{caseSummary.hiddenCount}</span>
                        <span className={caseSummary.nonExampleCount > 0 ? "ok-text" : "danger-text"}>
                          {caseSummary.nonExampleCount}
                        </span>
                        <span>{submissionCount}</span>
                        <span>{problem.status}</span>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectProblemForEdit(problem.id);
                          }}
                        >
                          {expanded ? "收合" : "編輯"}
                        </button>
                      </div>
                      {expanded && editingProblemDraft && (
                        <ProblemEditorForm
                          problem={editingProblemDraft}
                          submissionCount={submissionCount}
                          busy={busy}
                          onChange={onEditingProblemDraftChange}
                          onSave={() => onSaveEditedProblem(editingProblemDraft)}
                          onCancel={onCancelProblemEdit}
                          onDelete={() => onDeleteProblem(problem.id)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
            </>
          )}

          {activeAdminSection === "users" && (
            <section className="admin-section">
            <div className="section-title-row">
              <div>
                    <h3>使用者權限</h3>
                <p>超級管理者可調整教師任教學校；學生維持一般使用者身份。</p>
              </div>
              <div className="admin-file-actions">
                <label className="inline-admin-select">
                  指派教師學校
                  <select
                    value={schoolAdminSchoolId}
                    onChange={(event) => setSchoolAdminSchoolId(event.target.value)}
                    disabled={assignableSchools.length === 0}
                  >
                    {assignableSchools.length === 0 && <option value="">尚無學校</option>}
                    {assignableSchools.map((school) => (
                      <option key={school.id} value={school.id}>
                        {school.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="ghost-button" onClick={onRefreshAdminData} disabled={adminDataBusy}>
                  重新整理
                </button>
              </div>
            </div>
            <div className="admin-table">
              <div className="admin-table-head user-table-row">
                <span>使用者</span>
                <span>Email</span>
                <span>最近登入</span>
                <span>權限</span>
                <span>狀態</span>
                <span>操作</span>
              </div>
              {users.length === 0 && <p className="muted table-empty">尚無使用者資料。</p>}
              <div className="user-directory-filters">
                <label className="problem-form-field">
                  身分
                  <select
                    value={userRoleFilter}
                    onChange={(event) => setUserRoleFilter(event.target.value as UserDirectoryRoleFilter)}
                  >
                    <option value="all">全部身分</option>
                    <option value="teacher">教師</option>
                    <option value="student">學生</option>
                  </select>
                </label>
                <label className="problem-form-field">
                  學校
                  <select
                    value={userSchoolFilterId}
                    onChange={(event) => setUserSchoolFilterId(event.target.value)}
                  >
                    <option value="all">全部學校</option>
                    {assignableSchools.map((school) => (
                      <option key={school.id} value={school.id}>
                        {school.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="user-directory-summary">
                  <Metric label="目前顯示" value={`${visibleUserDirectoryRows.length}/${users.length} 人`} />
                  <Metric label="教師" value={`${visibleTeacherCount} 人`} />
                  <Metric label="學生" value={`${visibleStudentCount} 人`} />
                  <Metric label="未設學校" value={`${visibleNoSchoolCount} 人`} />
                </div>
              </div>
              {users.length > 0 && visibleUserDirectoryRows.length === 0 && (
                <p className="muted table-empty">沒有符合篩選條件的使用者。</p>
              )}
              {visibleUserDirectoryRows.map((row) => {
                const item = row.item;
                const itemAdminProfile = adminProfileByUid.get(item.uid);
                const itemIsSuperAdmin = itemAdminProfile?.role === "super";
                const isSelf = item.uid === currentUser?.uid;
                const itemSubmissionCount = userSubmissionCounts[item.uid] || 0;
                return (
                  <div className="user-table-row" key={item.uid}>
                    <span>{item.displayName || "未命名使用者"}</span>
                    <span>{item.email || "-"}</span>
                    <span>{formatManagedTimestamp(item.lastLoginAt)}</span>
                    <span className="table-role-stack">
                      <strong>{row.roleLabel}</strong>
                      <small>{row.schoolLabel}</small>
                    </span>
                    <span className={item.disabled ? "status-pill disabled" : "status-pill"}>
                      {item.disabled ? "停用" : "啟用"} / {itemSubmissionCount} 筆
                    </span>
                    <div className="user-actions">
                      <button
                        className="ghost-button"
                        onClick={() => onSetUserAdmin(item, !itemIsSuperAdmin)}
                        disabled={adminBusy || isSelf}
                      >
                        {itemIsSuperAdmin ? "改為一般" : "設為超管"}
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => onSetUserSchoolAdmin(item, schoolAdminSchoolId)}
                        disabled={adminBusy || isSelf || !schoolAdminSchoolId}
                      >
                        設為教師
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => onSetUserDisabled(item, !item.disabled)}
                        disabled={adminBusy || isSelf}
                      >
                        {item.disabled ? "啟用" : "停用"}
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => onClearUserSubmissions(item)}
                        disabled={adminBusy || itemSubmissionCount === 0}
                      >
                        清除答題
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => onDeleteUser(item)}
                        disabled={adminBusy || isSelf}
                      >
                        刪除使用者
                      </button>
                    </div>
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
              {progressRows.map((row) => {
                const expanded = expandedProgressUserId === row.uid;
                const userSubmissions = adminSubmissions.filter(
                  (item) => (item.uid || "guest") === row.uid,
                );
                return (
                  <div className="progress-table-item" key={row.uid}>
                    <div
                      className={expanded ? "progress-table-row clickable active" : "progress-table-row clickable"}
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedProgressUserId(expanded ? "" : row.uid)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setExpandedProgressUserId(expanded ? "" : row.uid);
                        }
                      }}
                    >
                  <span>{row.displayName}</span>
                  <span>{row.role}</span>
                  <span>{row.lastLoginAt}</span>
                  <span>{row.completedCount}/{problems.length}</span>
                  <span>{Math.round(row.averagePassRate * 100)}%</span>
                  <span>{row.submitCount} 次</span>
                  <span>{row.lastSubmittedAt ? new Date(row.lastSubmittedAt).toLocaleString("zh-TW") : "-"}</span>
                  <span>{row.problemStatusText}</span>
                    </div>
                    {expanded && (
                      <div className="user-progress-detail">
                        <div className="admin-table-head submission-table-row">
                          <span>{"\u6642\u9593"}</span>
                          <span>{"\u984c\u76ee"}</span>
                          <span>{"\u7b54\u984c\u7387"}</span>
                          <span>{"\u5206\u6578"}</span>
                          <span>{"\u72c0\u614b"}</span>
                        </div>
                        {userSubmissions.length === 0 && (
                          <p className="muted table-empty">{"\u5c1a\u7121\u63d0\u4ea4\u7d00\u9304\u3002"}</p>
                        )}
                        {userSubmissions.map((item) => (
                          <div className="submission-table-row" key={item.id}>
                            <span>{new Date(item.createdAt).toLocaleString("zh-TW")}</span>
                            <span>{item.problemTitle}</span>
                            <span>{Math.round(item.passRate * 100)}%</span>
                            <span>{item.score}/{item.maxScore}</span>
                            <span>{isFullScoreSubmission(item) ? "\u5df2\u5b8c\u6210" : item.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          )}
        </>
      )}
    </div>
  );
}

function SchoolEditorForm({
  school,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  school: School;
  busy: boolean;
  onChange: (school: School | null) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const updateSchool = <K extends keyof School>(key: K, value: School[K]) => {
    onChange({ ...school, [key]: value });
  };

  return (
    <div className="school-edit-row">
      <div className="school-form-grid">
        <label className="problem-form-field">
          學校 ID
          <input value={school.id} readOnly />
        </label>
        <label className="problem-form-field">
          學校名稱
          <input value={school.name} onChange={(event) => updateSchool("name", event.target.value)} />
        </label>
        <label className="problem-form-field">
          狀態
          <select
            value={school.enabled === false ? "disabled" : "enabled"}
            onChange={(event) => updateSchool("enabled", event.target.value === "enabled")}
          >
            <option value="enabled">啟用</option>
            <option value="disabled">停用</option>
          </select>
        </label>
      </div>
      <label className="problem-form-field">
        Email 網域/備註（選填；目前不再用來判斷學校）
        <textarea
          value={school.domains.join("\n")}
          onChange={(event) => updateSchool("domains", parseDomainText(event.target.value))}
        />
      </label>
      <div className="problem-form-actions">
        <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
          <Save size={17} />
          儲存學校
        </button>
        <button className="ghost-button" type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
    </div>
  );
}

function ContestEditorForm({
  contest,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  contest: ContestEvent;
  busy: boolean;
  onChange: (contest: ContestEvent | null) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const updateContest = <K extends keyof ContestEvent>(key: K, value: ContestEvent[K]) => {
    onChange({ ...contest, [key]: value });
  };

  return (
    <div className="contest-edit-row">
      <div className="contest-form-grid">
        <label className="problem-form-field">
          賽事 ID
          <input value={contest.id} readOnly />
        </label>
        <label className="problem-form-field">
          年度
          <input value={contest.year} onChange={(event) => updateContest("year", event.target.value)} />
        </label>
        <label className="problem-form-field">
          賽事名稱
          <input value={contest.title} onChange={(event) => updateContest("title", event.target.value)} />
        </label>
        <label className="problem-form-field">
          狀態
          <select
            value={contest.status}
            onChange={(event) => updateContest("status", event.target.value as ContestStatus)}
          >
            {contestStatusFlow.map((status) => (
              <option key={status.key} value={status.key}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="problem-form-field">
          模式
          <select
            value={contest.mode}
            onChange={(event) => updateContest("mode", event.target.value as ContestEvent["mode"])}
          >
            <option value="contest">正式競賽</option>
            <option value="practice">練習活動</option>
            <option value="hybrid">競賽＋練習</option>
          </select>
        </label>
      </div>

      <div className="contest-form-grid secondary">
        <label className="problem-form-field">
          報名開始
          <input
            type="datetime-local"
            value={formatDateTimeInputValue(contest.registrationStartAt)}
            onChange={(event) => updateContest("registrationStartAt", event.target.value)}
          />
        </label>
        <label className="problem-form-field">
          報名結束
          <input
            type="datetime-local"
            value={formatDateTimeInputValue(contest.registrationEndAt)}
            onChange={(event) => updateContest("registrationEndAt", event.target.value)}
          />
        </label>
        <label className="problem-form-field">
          競賽開始
          <input
            type="datetime-local"
            value={formatDateTimeInputValue(contest.startAt)}
            onChange={(event) => updateContest("startAt", event.target.value)}
          />
        </label>
        <label className="problem-form-field">
          競賽結束
          <input
            type="datetime-local"
            value={formatDateTimeInputValue(contest.endAt)}
            onChange={(event) => updateContest("endAt", event.target.value)}
          />
        </label>
        <label className="problem-form-field">
          參賽人數
          <input
            type="number"
            min="0"
            value={contest.participantCount || 0}
            onChange={(event) => updateContest("participantCount", Math.max(0, Number(event.target.value) || 0))}
          />
        </label>
        <label className="problem-form-field">
          學校數
          <input
            type="number"
            min="0"
            value={contest.schoolCount || 0}
            onChange={(event) => updateContest("schoolCount", Math.max(0, Number(event.target.value) || 0))}
          />
        </label>
      </div>

      <label className="problem-form-field">
        賽事說明
        <textarea value={contest.description || ""} onChange={(event) => updateContest("description", event.target.value)} />
      </label>

      <label className="problem-form-field">
        競賽題目 ID（一行一題，未來可接題目選擇器）
        <textarea
          value={contest.problemIds.join("\n")}
          onChange={(event) => updateContest("problemIds", parseProblemIdText(event.target.value))}
        />
      </label>

      <div className="contest-note-grid">
        <label className="problem-form-field">
          名單／報名備註
          <textarea value={contest.rosterNote || ""} onChange={(event) => updateContest("rosterNote", event.target.value)} />
        </label>
        <label className="problem-form-field">
          成績審核／公布備註
          <textarea value={contest.resultNote || ""} onChange={(event) => updateContest("resultNote", event.target.value)} />
        </label>
      </div>

      <div className="contest-editor-summary">
        <span>目前階段：{getContestStatusLabel(contest.status)}</span>
        <span>競賽題數：{contest.problemIds.length} 題</span>
        <span>更新時間：{formatContestDateTime(contest.updatedAt)}</span>
      </div>

      <div className="problem-form-actions">
        <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
          <Save size={17} />
          儲存賽事
        </button>
        <button className="ghost-button" type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
    </div>
  );
}

function ProblemEditorForm({
  problem,
  submissionCount,
  busy,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  problem: Problem;
  submissionCount: number;
  busy: boolean;
  onChange: (problem: Problem) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const updateProblem = <K extends keyof Problem>(key: K, value: Problem[K]) => {
    onChange({ ...problem, [key]: value });
  };
  const updateExample = (index: number, patch: Partial<Problem["examples"][number]>) => {
    onChange({
      ...problem,
      examples: problem.examples.map((example, itemIndex) =>
        itemIndex === index ? { ...example, ...patch } : example,
      ),
    });
  };
  const updateCase = (index: number, patch: Partial<Problem["cases"][number]>) => {
    onChange({
      ...problem,
      cases: problem.cases.map((testCase, itemIndex) =>
        itemIndex === index ? { ...testCase, ...patch } : testCase,
      ),
    });
  };

  return (
    <div className="problem-edit-row">
      <div className="problem-form-grid">
        <label className="problem-form-field">
          ID
          <input value={problem.id} readOnly />
        </label>
        <label className="problem-form-field">
          年份
          <input value={problem.year || ""} onChange={(event) => updateProblem("year", event.target.value)} />
        </label>
        <label className="problem-form-field">
          分類
          <input value={problem.category} onChange={(event) => updateProblem("category", event.target.value)} />
        </label>
        <label className="problem-form-field">
          題目
          <input value={problem.title} onChange={(event) => updateProblem("title", event.target.value)} />
        </label>
        <label className="problem-form-field">
          難度
          <select
            value={problem.difficulty}
            onChange={(event) => updateProblem("difficulty", event.target.value as Problem["difficulty"])}
          >
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
          </select>
        </label>
        <label className="problem-form-field">
          狀態
          <select
            value={problem.status}
            onChange={(event) => updateProblem("status", event.target.value as Problem["status"])}
          >
            <option value="published">published</option>
            <option value="draft">draft</option>
            <option value="archived">archived</option>
          </select>
        </label>
      </div>

      <label className="problem-form-field">
        題目說明
        <textarea value={problem.description} onChange={(event) => updateProblem("description", event.target.value)} />
      </label>
      <label className="problem-form-field">
        輸入格式
        <textarea value={problem.inputFormat} onChange={(event) => updateProblem("inputFormat", event.target.value)} />
      </label>
      <label className="problem-form-field">
        輸出格式
        <textarea value={problem.outputFormat} onChange={(event) => updateProblem("outputFormat", event.target.value)} />
      </label>

      <div className="problem-array-editor">
        <div className="array-title-row">
          <h4>範例</h4>
          <button
            className="ghost-button"
            type="button"
            onClick={() =>
              onChange({
                ...problem,
                examples: [...problem.examples, { title: `範例 ${problem.examples.length + 1}`, input: "", output: "" }],
              })
            }
          >
            新增範例
          </button>
        </div>
        {problem.examples.length === 0 && <p className="muted">尚無範例。</p>}
        {problem.examples.map((example, index) => (
          <div className="problem-array-row example-array-row" key={`example-${index}`}>
            <input
              value={example.title}
              onChange={(event) => updateExample(index, { title: event.target.value })}
              placeholder="範例標題"
            />
            <textarea
              value={example.input}
              onChange={(event) => updateExample(index, { input: event.target.value })}
              placeholder="輸入"
            />
            <textarea
              value={example.output}
              onChange={(event) => updateExample(index, { output: event.target.value })}
              placeholder="輸出"
            />
            <button
              className="ghost-button"
              type="button"
              onClick={() =>
                onChange({ ...problem, examples: problem.examples.filter((_, itemIndex) => itemIndex !== index) })
              }
            >
              刪除列
            </button>
          </div>
        ))}
      </div>

      <div className="problem-array-editor">
        <div className="array-title-row">
          <h4>測資</h4>
          <button
            className="ghost-button"
            type="button"
            onClick={() =>
              onChange({
                ...problem,
                cases: [
                  ...problem.cases,
                  {
                    groupTitle: "測資",
                    caseTitle: `C${problem.cases.length + 1}`,
                    input: "",
                    output: "",
                    score: 10,
                    visibility: "hidden",
                  },
                ],
              })
            }
          >
            新增測資
          </button>
        </div>
        {problem.cases.length === 0 && <p className="warning-text">沒有測資時無法正式評分滿分。</p>}
        {problem.cases.map((testCase, index) => (
          <div className="problem-array-row case-array-row" key={`case-${index}`}>
            <input
              value={testCase.groupTitle}
              onChange={(event) => updateCase(index, { groupTitle: event.target.value })}
              placeholder="群組"
            />
            <input
              value={testCase.caseTitle}
              onChange={(event) => updateCase(index, { caseTitle: event.target.value })}
              placeholder="編號"
            />
            <textarea
              value={testCase.input}
              onChange={(event) => updateCase(index, { input: event.target.value })}
              placeholder="輸入"
            />
            <textarea
              value={testCase.output}
              onChange={(event) => updateCase(index, { output: event.target.value })}
              placeholder="輸出"
            />
            <input
              type="number"
              min="0"
              value={testCase.score}
              onChange={(event) => updateCase(index, { score: Math.max(0, Number(event.target.value) || 0) })}
              placeholder="分數"
            />
            <select
              value={testCase.visibility}
              onChange={(event) => updateCase(index, { visibility: event.target.value as Problem["cases"][number]["visibility"] })}
            >
              <option value="public">public</option>
              <option value="hidden">hidden</option>
            </select>
            <button
              className="ghost-button"
              type="button"
              onClick={() =>
                onChange({ ...problem, cases: problem.cases.filter((_, itemIndex) => itemIndex !== index) })
              }
            >
              刪除列
            </button>
          </div>
        ))}
      </div>

      {submissionCount > 0 && (
        <p className="warning-text">已有 {submissionCount} 筆解題紀錄，不能刪除，請改為 draft 或 archived。</p>
      )}
      <div className="problem-form-actions">
        <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
          <Save size={17} />
          儲存
        </button>
        <button className="ghost-button" type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button
          className="danger-button"
          type="button"
          onClick={onDelete}
          disabled={busy || submissionCount > 0}
        >
          刪除題目
        </button>
      </div>
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

function GuishanIslandIcon() {
  return (
    <svg className="guishan-logo" viewBox="0 0 96 72" role="img" aria-label="可愛龜山島圖示">
      <path className="logo-sun" d="M78 15a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
      <path className="logo-ray" d="M70 1v7M70 22v7M56 15h7M77 15h7M60 5l5 5M75 20l5 5M80 5l-5 5M65 20l-5 5" />
      <path className="logo-wave" d="M5 58c7-6 14-6 21 0s14 6 21 0 14-6 21 0 14 6 23 0" />
      <path className="logo-wave logo-wave-soft" d="M13 66c7-5 13-5 20 0s13 5 20 0 13-5 20 0" />
      <path
        className="logo-island"
        d="M16 49c2-12 11-22 24-25 9-2 19 1 25 8 8 1 14 6 16 15 1 4-2 8-7 8H23c-5 0-8-2-7-6Z"
      />
      <path className="logo-shell" d="M31 43c6-6 21-7 30 0-7 5-22 5-30 0Z" />
      <circle className="logo-eye" cx="62" cy="39" r="2.3" />
      <path className="logo-smile" d="M66 44c3 3 7 3 10 0" />
      <path className="logo-cheek" d="M74 39c2 1 3 3 2 5" />
    </svg>
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

function cloneProblem(problem: Problem): Problem {
  return JSON.parse(JSON.stringify(problem)) as Problem;
}

function cloneContest(contest: ContestEvent): ContestEvent {
  return JSON.parse(JSON.stringify(contest)) as ContestEvent;
}

function cloneSchool(school: School): School {
  return JSON.parse(JSON.stringify(school)) as School;
}

function sanitizeSchoolDraft(school: School): School {
  const now = new Date().toISOString();
  return {
    ...school,
    name: school.name.trim() || "未命名學校",
    domains: Array.from(new Set(school.domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))),
    enabled: school.enabled !== false,
    updatedAt: now,
    createdAt: school.createdAt || now,
  };
}

function sanitizeContestDraft(contest: ContestEvent): ContestEvent {
  const now = new Date().toISOString();
  return {
    ...contest,
    title: contest.title.trim() || "未命名賽事",
    year: contest.year.trim() || String(new Date().getFullYear()),
    description: contest.description?.trim() || "",
    startAt: contest.startAt || "",
    endAt: contest.endAt || "",
    registrationStartAt: contest.registrationStartAt || "",
    registrationEndAt: contest.registrationEndAt || "",
    problemIds: parseProblemIdText(contest.problemIds.join("\n")),
    participantCount: Math.max(0, Math.round(contest.participantCount || 0)),
    schoolCount: Math.max(0, Math.round(contest.schoolCount || 0)),
    rosterNote: contest.rosterNote?.trim() || "",
    resultNote: contest.resultNote?.trim() || "",
    updatedAt: now,
    createdAt: contest.createdAt || now,
  };
}

function getContestStatusLabel(status: ContestStatus) {
  return contestStatusFlow.find((item) => item.key === status)?.label || status;
}

function getContestModeLabel(mode: ContestEvent["mode"]) {
  if (mode === "practice") {
    return "練習活動";
  }
  if (mode === "hybrid") {
    return "競賽＋練習";
  }
  return "正式競賽";
}

function getNextContestStatus(status: ContestStatus): ContestStatus | undefined {
  const transitions: Partial<Record<ContestStatus, ContestStatus>> = {
    draft: "roster",
    roster: "waiting",
    waiting: "active",
    active: "ended",
    paused: "active",
    ended: "review",
    review: "published",
    published: "archived",
  };
  return transitions[status];
}

function parseProblemIdText(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function formatDateTimeInputValue(value: string | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 16);
  }
  const localTime = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function formatContestDateTime(value: string | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-TW");
}

function sanitizeProblemDraft(problem: Problem): Problem {
  const now = new Date().toISOString();
  const output: Problem = {
    id: problem.id,
    title: problem.title.trim() || "未命名題目",
    description: problem.description.trim(),
    inputFormat: problem.inputFormat.trim(),
    outputFormat: problem.outputFormat.trim(),
    difficulty: problem.difficulty,
    category: problem.category.trim() || "未分類",
    status: problem.status,
    examples: (problem.examples || []).map((example, index) => ({
      title: example.title.trim() || `範例 ${index + 1}`,
      input: example.input,
      output: example.output,
      ...(example.description?.trim() ? { description: example.description.trim() } : {}),
    })),
    cases: (problem.cases || []).map((testCase, index) => ({
      groupTitle: testCase.groupTitle.trim() || "測資",
      caseTitle: testCase.caseTitle.trim() || `C${index + 1}`,
      input: testCase.input,
      output: testCase.output,
      score: Math.max(0, Number(testCase.score) || 0),
      visibility: testCase.visibility === "public" ? "public" : "hidden",
    })),
    createdAt: problem.createdAt || now,
    updatedAt: now,
  };

  if (problem.year?.trim()) {
    output.year = problem.year.trim();
  }
  if (problem.categories?.length) {
    output.categories = problem.categories.map((item) => item.trim()).filter(Boolean);
  }
  if (problem.source) {
    output.source = problem.source;
  }
  if (problem.sourceId) {
    output.sourceId = problem.sourceId;
  }
  if (problem.sourceUrls && Object.keys(problem.sourceUrls).length > 0) {
    output.sourceUrls = problem.sourceUrls;
  }
  if (problem.imageSources && problem.imageSources.length > 0) {
    output.imageSources = problem.imageSources;
  }
  if (problem.toolboxConfig !== undefined) {
    output.toolboxConfig = problem.toolboxConfig;
  }
  return output;
}

function countSubmissionsByProblem(records: SubmissionRecord[]) {
  return records.reduce<Record<string, number>>((counts, record) => {
    counts[record.problemId] = (counts[record.problemId] || 0) + 1;
    return counts;
  }, {});
}

function countSubmissionsByUser(records: SubmissionRecord[]) {
  return records.reduce<Record<string, number>>((counts, record) => {
    const uid = record.uid || "guest";
    counts[uid] = (counts[uid] || 0) + 1;
    return counts;
  }, {});
}

function getManagedUserDirectoryRole(item: ManagedUser, profile?: AdminProfile): UserRole {
  if (profile?.role === "super") {
    return "super";
  }
  if (profile?.role === "teacher") {
    return "teacher";
  }
  if (item.role === "teacher" || item.role === "student") {
    return item.role;
  }
  return inferUserRoleFromEmail(item.email);
}

function getManagedUserDirectoryRoleLabel(role: UserRole) {
  if (role === "super") {
    return "超級管理者";
  }
  if (role === "teacher") {
    return "教師";
  }
  return "學生";
}

function getManagedUserSchoolIds(
  item: ManagedUser,
  profile: AdminProfile | undefined,
  schoolAccountsByUid: Map<string, SchoolAccount[]>,
  schoolAccountsByEmail: Map<string, SchoolAccount[]>,
) {
  const schoolIds = new Set<string>();
  addSchoolId(schoolIds, item.schoolId);
  addSchoolId(schoolIds, profile?.schoolId);
  (profile?.schoolIds || []).forEach((schoolId) => addSchoolId(schoolIds, schoolId));
  (schoolAccountsByUid.get(item.uid) || []).forEach((account) => addSchoolId(schoolIds, account.schoolId));
  (schoolAccountsByEmail.get(normalizeEmailForLookup(item.email)) || []).forEach((account) =>
    addSchoolId(schoolIds, account.schoolId),
  );
  return Array.from(schoolIds);
}

function addSchoolId(target: Set<string>, schoolId?: string) {
  const normalized = (schoolId || "").trim();
  if (normalized) {
    target.add(normalized);
  }
}

function normalizeEmailForLookup(email?: string | null) {
  return (email || "").trim().toLowerCase();
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
        return best && isFullScoreSubmission(best);
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
        bestRecord && isFullScoreSubmission(bestRecord)
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

function isFullScoreSubmission(record: SubmissionRecord) {
  return (
    record.maxScore > 0 &&
    record.status === "accepted" &&
    record.totalCases > 0 &&
    record.passedCases === record.totalCases &&
    record.score >= record.maxScore
  );
}

function getProblemCaseSummary(problem: Problem) {
  const examples = problem.examples || [];
  const cases = problem.cases || [];
  const nonExampleCount = cases.filter(
    (testCase) =>
      !examples.some(
        (example) =>
          normalizeComparableText(example.input) === normalizeComparableText(testCase.input) &&
          normalizeComparableText(example.output) === normalizeComparableText(testCase.output),
      ),
  ).length;

  return {
    exampleCount: examples.length,
    caseCount: cases.length,
    hiddenCount: cases.filter((testCase) => testCase.visibility === "hidden").length,
    nonExampleCount,
  };
}

function normalizeComparableText(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
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

const defaultRosterCsv = `email,name
student001@school-domain.edu.tw,王小明
student002@school-domain.edu.tw,陳小華`;
