import { Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { contestStatusFlow, tabs } from "../../app/constants";
import type { AdminSectionKey, UserDirectoryRoleFilter } from "../../app/constants";
import { ContestAccountsSection } from "./ContestAccountsSection";
import { ContestProblemsSection } from "./ContestProblemsSection";
import { DashboardSection } from "./DashboardSection";
import { ReviewSection } from "./ReviewSection";
import { PlatformSection } from "./PlatformSection";
import { getRoleLabel } from "../../services/accountService";
import { loadUserSubmissions } from "../../services/submissionService";
import type { ProblemImportMode } from "../../services/problemStore";
import type { AdminProfile, AppUser, ContestEvent, ContestStatus, ManagedUser, PlatformState, Problem, School, SubmissionRecord, UserProblemStat } from "../../types";
import { buildUserProgressRows, countSubmissionsByUser, countTotalSubmissions, getManagedUserDirectoryRole, getManagedUserDirectoryRoleLabel, getManagedUserSchoolIds, normalizeEmailForLookup } from "../../utils/adminUsers";
import { getContestStatusLabel, getContestTransitions } from "../../utils/drafts";
import { formatContestDateTime, formatManagedTimestamp } from "../../utils/format";
import { getProblemCaseSummary, isFullScoreSubmission } from "../../utils/practice";
import { Metric } from "../ui";
import { ContestEditorForm } from "./ContestEditorForm";
import { ProblemEditorForm } from "./ProblemEditorForm";
import { SchoolEditorForm } from "./SchoolEditorForm";

export function AdminPanel({
  admin,
  superAdmin,
  platform,
  onStatusMessage,
  adminProfile,
  adminProfiles,
  adminDataBusy,
  adminStats,
  adminUids,
  contests,
  currentUser,
  schools,
  importJson,
  importCsv,
  importMode,
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
  onResetContest,
  onReleaseContest,
  onRebuildLeaderboard,
  onDeleteContest,
  onCreateSchool,
  onSelectSchoolForEdit,
  onSaveEditedSchool,
  onSelectProblemForEdit,
  onSaveEditedProblem,
  onCancelProblemEdit,
  onDeleteProblem,
  onRefreshAdminData,
  onSetUserAdmin,
  onSetUserSchoolAdmin,
  onSetUserSchool,
  onSetUserDisabled,
  onClearUserSubmissions,
  onDeleteUser,
}: {
  admin: boolean;
  superAdmin: boolean;
  platform: PlatformState;
  onStatusMessage: (message: string) => void;
  adminProfile: AdminProfile | null;
  adminProfiles: AdminProfile[];
  adminDataBusy: boolean;
  /** userProblemStats 彙總；展開某人時才另外讀他的提交紀錄。 */
  adminStats: UserProblemStat[];
  adminUids: Set<string>;
  contests: ContestEvent[];
  currentUser: AppUser | null;
  schools: School[];
  importJson: string;
  importCsv: string;
  importMode: ProblemImportMode;
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
  /** 清空該場所有資料、退回草稿（Worker 執行）。 */
  onResetContest: (contest: ContestEvent) => void;
  /** 只有空的草稿可刪。 */
  onDeleteContest: (contest: ContestEvent) => void;
  /** 賽後把競賽題庫複製到練習題庫（Worker 執行）。 */
  onReleaseContest: (contest: ContestEvent) => void;
  /** 重建所有使用者的排行榜彙總 userStats。 */
  onRebuildLeaderboard: () => void;
  onCreateSchool: () => void;
  onSelectSchoolForEdit: (schoolId: string) => void;
  onSaveEditedSchool: (school: School) => void;
  onSelectProblemForEdit: (problemId: string) => void;
  onSaveEditedProblem: (problem: Problem) => void;
  onCancelProblemEdit: () => void;
  onDeleteProblem: (problemId: string) => void;
  onRefreshAdminData: () => void;
  onSetUserAdmin: (user: ManagedUser, makeAdmin: boolean) => void;
  onSetUserSchoolAdmin: (user: ManagedUser, schoolId: string) => void;
  onSetUserSchool: (user: ManagedUser, schoolId: string) => void;
  onSetUserDisabled: (user: ManagedUser, disabled: boolean) => void;
  onClearUserSubmissions: (user: ManagedUser) => void;
  onDeleteUser: (user: ManagedUser) => void;
}) {
  const progressRows = buildUserProgressRows(users, problems, adminStats, adminUids);
  const userSubmissionCounts = countSubmissionsByUser(adminStats);
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
    "platform",
  );
  // 從賽事列表跳到「競賽帳號／競賽題庫」時要預選的賽事。
  const [focusContestId, setFocusContestId] = useState("");
  const [schoolAdminSchoolId, setSchoolAdminSchoolId] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<UserDirectoryRoleFilter>("all");
  const [userSchoolFilterId, setUserSchoolFilterId] = useState("all");
  const [expandedProgressUserId, setExpandedProgressUserId] = useState("");
  const [expandedUserSubmissions, setExpandedUserSubmissions] = useState<SubmissionRecord[]>([]);
  const [expandedUserLoading, setExpandedUserLoading] = useState(false);

  // 展開某位使用者時才讀他的提交紀錄（只查該 uid，不整包讀）。
  useEffect(() => {
    if (!expandedProgressUserId) {
      setExpandedUserSubmissions([]);
      return;
    }
    let cancelled = false;
    setExpandedUserLoading(true);
    loadUserSubmissions(expandedProgressUserId)
      .then((items) => {
        if (!cancelled) setExpandedUserSubmissions(items);
      })
      .catch(() => {
        if (!cancelled) setExpandedUserSubmissions([]);
      })
      .finally(() => {
        if (!cancelled) setExpandedUserLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedProgressUserId]);
  const adminSections: Array<{ key: AdminSectionKey; label: string }> = superAdmin
    ? [
        { key: "platform", label: "平台狀態" },
        { key: "dashboard", label: "儀表板" },
        { key: "review", label: "成績審核" },
        { key: "contests", label: "賽事管理" },
        { key: "contestAccounts", label: "競賽帳號" },
        { key: "contestProblems", label: "競賽題庫" },
        { key: "schools", label: "學校管理" },
        { key: "problems", label: "題目管理" },
        { key: "users", label: "使用者管理" },
        { key: "progress", label: "使用者解題資料" },
      ]
    : [];
  const openContestCount = contests.filter((contest) => contest.status !== "archived").length;
  const adminRoleLabel = superAdmin ? "超級管理者" : adminProfile?.role === "teacher" ? "教師" : "管理者";
  const userDirectoryRows = useMemo(
    () =>
      users.map((item) => {
        const profile = adminProfileByUid.get(item.uid);
        const role = getManagedUserDirectoryRole(item, profile);
        const schoolIds = getManagedUserSchoolIds(
          item,
          profile,
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
    [adminProfileByUid, schoolNameById, users],
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

  // 進入使用者管理時若名單是空的（首次載入偶爾沒跟上），自動重新讀取一次。
  const autoRefreshedRef = useRef(false);
  useEffect(() => {
    if (activeAdminSection === "users" && users.length === 0 && !adminDataBusy && !autoRefreshedRef.current) {
      autoRefreshedRef.current = true;
      onRefreshAdminData();
    }
  }, [activeAdminSection, adminDataBusy, onRefreshAdminData, users.length]);

  useEffect(() => {
    const allowedSectionKeys = new Set(adminSections.map((section) => section.key));
    if (!allowedSectionKeys.has(activeAdminSection)) {
      setActiveAdminSection(adminSections[0]?.key || "platform");
    }
  }, [activeAdminSection, adminSections]);

  useEffect(() => {
    if (assignableSchools.length === 0) {
      setSchoolAdminSchoolId("");
      setUserSchoolFilterId("all");
      return;
    }
    if (!assignableSchools.some((school) => school.id === schoolAdminSchoolId)) {
      setSchoolAdminSchoolId(assignableSchools[0].id);
    }
    if (userSchoolFilterId !== "all" && !assignableSchools.some((school) => school.id === userSchoolFilterId)) {
      setUserSchoolFilterId("all");
    }
  }, [assignableSchools, schoolAdminSchoolId, userSchoolFilterId]);

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

          {superAdmin && activeAdminSection === "platform" && (
            <PlatformSection
              platform={platform}
              contests={contests}
              currentUser={currentUser}
              busy={adminBusy}
              onStatus={onStatusMessage}
              onMoveContestStatus={onMoveContestStatus}
              onContestsChanged={onRefreshAdminData}
            />
          )}

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
                  <span>組別</span>
                  <span>狀態</span>
                  <span>開始</span>
                  <span>結束</span>
                  <span>題目</span>
                  <span>帳號</span>
                  <span>操作</span>
                </div>
                {contests.length === 0 && <p className="muted table-empty">尚未建立賽事。請先新增年度賽事草稿。</p>}
                {contests.map((contest) => {
                  const expanded = editingContestId === contest.id;
                  const transitions = getContestTransitions(contest);
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
                        <span>{contest.division === "J" ? "國中" : "國小"}</span>
                        <span className={`contest-status-badge ${contest.status}`}>
                          {getContestStatusLabel(contest.status)}
                        </span>
                        <span>{formatContestDateTime(contest.startAt)}</span>
                        <span>{formatContestDateTime(contest.endAt)}</span>
                        <span>{contest.problemCount ?? 0} 題</span>
                        <span>{contest.accountCount ?? 0} 個</span>
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
                          {transitions.previous && (
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={adminBusy}
                              title={transitions.previous.buttonLabel ?? "退回：" + transitions.previous.label}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (transitions.previous?.confirm && !window.confirm(transitions.previous.confirm)) return;
                                onMoveContestStatus(contest, transitions.previous!.status);
                              }}
                            >
                              {transitions.previous.buttonLabel ?? `← ${transitions.previous.label}`}
                            </button>
                          )}
                          {transitions.next && (
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={adminBusy || Boolean(transitions.next.blocked)}
                              title={transitions.next.blocked ? "無法前進：" + transitions.next.blocked : "前進到 " + transitions.next.label}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (transitions.next?.confirm && !window.confirm(transitions.next.confirm)) return;
                                onMoveContestStatus(contest, transitions.next!.status);
                              }}
                            >
                              {transitions.next.label} →
                            </button>
                          )}
                          {(contest.status === "draft" || contest.status === "roster" || contest.status === "waiting") && (
                            <>
                              <button
                                className="ghost-button"
                                type="button"
                                disabled={adminBusy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setFocusContestId(contest.id);
                                  setActiveAdminSection("contestAccounts");
                                }}
                              >
                                匯入帳號（{contest.accountCount ?? 0}）
                              </button>
                              <button
                                className="ghost-button"
                                type="button"
                                disabled={adminBusy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setFocusContestId(contest.id);
                                  setActiveAdminSection("contestProblems");
                                }}
                              >
                                匯入題庫（{contest.problemCount ?? 0}）
                              </button>
                            </>
                          )}
                          {transitions.archive && (
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={adminBusy}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (transitions.archive?.confirm && !window.confirm(transitions.archive.confirm)) return;
                                onMoveContestStatus(contest, transitions.archive!.status);
                              }}
                            >
                              {transitions.archive.buttonLabel}
                            </button>
                          )}
                          {(contest.status === "waiting" || contest.status === "active" || contest.status === "paused") && (
                            <span className="muted contest-control-hint">開始／暫停／結束在「平台狀態」操作</span>
                          )}
                          {transitions.next?.blocked && <span className="warning-text contest-control-hint">{transitions.next.blocked}</span>}
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
                          {(contest.status === "ended" || contest.status === "review" || contest.status === "published" || contest.status === "archived") &&
                            (contest.problemCount ?? 0) > 0 && (
                              <button
                                className="ghost-button"
                                type="button"
                                disabled={adminBusy}
                                title={contest.releasedToPractice ? "已釋出過；再按會只新增練習題庫還沒有的題目" : "把競賽題庫複製到練習題庫（草稿）"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onReleaseContest(contest);
                                }}
                              >
                                {contest.releasedToPractice ? "已釋出題庫" : "釋出到練習題庫"}
                              </button>
                            )}
                          {contest.status !== "active" && contest.status !== "paused" && !isEmptyDraft(contest) && (
                            <button
                              className="danger-button"
                              type="button"
                              disabled={adminBusy}
                              title="刪除帳號、題庫、作答紀錄與排行榜，保留設定並退回草稿"
                              onClick={(event) => {
                                event.stopPropagation();
                                onResetContest(contest);
                              }}
                            >
                              重置
                            </button>
                          )}
                          {isEmptyDraft(contest) && (
                            <button
                              className="danger-button"
                              type="button"
                              disabled={adminBusy}
                              title="只有沒有帳號、題庫的草稿可以刪除"
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteContest(contest);
                              }}
                            >
                              刪除
                            </button>
                          )}
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


            </section>
          )}

          {superAdmin && activeAdminSection === "dashboard" && (
            <DashboardSection
              contests={contests}
              currentUser={currentUser}
              busy={adminBusy}
              onStatus={onStatusMessage}
              onContestsChanged={onRefreshAdminData}
            />
          )}

          {superAdmin && activeAdminSection === "review" && (
            <ReviewSection contests={contests} busy={adminBusy} onStatus={onStatusMessage} />
          )}

          {superAdmin && activeAdminSection === "contestAccounts" && (
            <ContestAccountsSection
              key={focusContestId}
              initialContestId={focusContestId}
              contests={contests}
              schools={schools}
              busy={adminBusy}
              onStatus={onStatusMessage}
              onContestsChanged={onRefreshAdminData}
            />
          )}

          {superAdmin && activeAdminSection === "contestProblems" && (
            <ContestProblemsSection
              key={focusContestId}
              initialContestId={focusContestId}
              contests={contests}
              busy={adminBusy}
              onStatus={onStatusMessage}
              onContestsChanged={onRefreshAdminData}
            />
          )}

          {superAdmin && activeAdminSection === "schools" && (
            <section className="admin-section">
              <div className="section-title-row">
                <div>
                  <h3>學校管理</h3>
                  <p>建立學校清單，供教師任教學校、學生所屬學校與班級使用。按「新增學校」輸入名稱即可，Email 網域為選填備註。</p>
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
                <p>每一列的學校下拉可直接改該使用者的學校（教師會同步更新任教學校）。「設為教師」會用上方選的學校。</p>
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
                      <select
                        className="row-school-select"
                        value={row.schoolIds[0] || ""}
                        onChange={(event) => event.target.value && onSetUserSchool(item, event.target.value)}
                        disabled={adminBusy || itemIsSuperAdmin}
                        aria-label="所屬學校"
                      >
                        <option value="">未設學校</option>
                        {assignableSchools.map((school) => (
                          <option key={school.id} value={school.id}>
                            {school.name}
                          </option>
                        ))}
                      </select>
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
              <div className="admin-file-actions">
                <span className="section-pill">{countTotalSubmissions(adminStats)} 筆提交</span>
                {superAdmin && (
                  <button className="ghost-button" type="button" disabled={adminBusy} onClick={onRebuildLeaderboard} title="用每人每題統計重建 userStats（班級／學校／全縣排行榜的資料來源）">
                    重建排行榜彙總
                  </button>
                )}
              </div>
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
                const userSubmissions = expanded ? expandedUserSubmissions : [];
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
                        {expandedUserLoading && <p className="muted table-empty">讀取中…</p>}
                        {!expandedUserLoading && userSubmissions.length === 0 && (
                          <p className="muted table-empty">尚無提交紀錄。</p>
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

/** 空的草稿：沒有帳號也沒有題庫，可以直接刪除；其他情況先重置。 */
function isEmptyDraft(contest: ContestEvent) {
  return contest.status === "draft" && !(contest.accountCount ?? 0) && !(contest.problemCount ?? 0);
}
