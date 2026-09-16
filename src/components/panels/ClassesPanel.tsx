import { useEffect, useMemo, useState } from "react";
import type { ClassMember, ClassSubmissionView, LearningClass, Problem } from "../../types";
import { formatContestDateTime } from "../../utils/format";
import { Metric } from "../ui";

type ClassSection = "classes" | "students" | "submissions";
const ALL_CLASSES = "all";

interface ClassesPanelProps {
  classes: LearningClass[];
  members: ClassMember[];
  submissionViews: ClassSubmissionView[];
  problems: Problem[];
  classNameDraft: string;
  busy: boolean;
  onClassNameChange: (value: string) => void;
  onCreateClass: () => void;
  onToggleJoin: (learningClass: LearningClass, joinEnabled: boolean) => void;
  onSetMemberStatus: (member: ClassMember, status: ClassMember["status"]) => void;
}

/** 每位學生在班級內的彙總（資料來源 classSubmissionViews，教師只看得到自己班級）。 */
interface StudentProgress {
  studentUid: string;
  studentName: string;
  studentEmail: string;
  classNames: string[];
  bestByProblem: Map<string, ClassSubmissionView>;
  completedCount: number;
  attemptedCount: number;
  averagePassRate: number;
  submitCount: number;
  lastSubmittedAt?: string;
  records: ClassSubmissionView[];
}

export function ClassesPanel({
  classes,
  members,
  submissionViews,
  problems,
  classNameDraft,
  busy,
  onClassNameChange,
  onCreateClass,
  onToggleJoin,
  onSetMemberStatus,
}: ClassesPanelProps) {
  const [section, setSection] = useState<ClassSection>("classes");
  const [selectedClassId, setSelectedClassId] = useState<string>(ALL_CLASSES);
  const [selectedStudentUid, setSelectedStudentUid] = useState("");

  // 班級被刪除或還沒載入時，選單退回「全部班級」。
  useEffect(() => {
    if (selectedClassId !== ALL_CLASSES && !classes.some((item) => item.id === selectedClassId)) {
      setSelectedClassId(ALL_CLASSES);
    }
  }, [classes, selectedClassId]);

  const selectedClass = classes.find((item) => item.id === selectedClassId);
  const visibleMembers = useMemo(
    () => (selectedClassId === ALL_CLASSES ? members : members.filter((member) => member.classId === selectedClassId)),
    [members, selectedClassId],
  );
  const visibleViews = useMemo(
    () =>
      selectedClassId === ALL_CLASSES
        ? submissionViews
        : submissionViews.filter((item) => item.classId === selectedClassId),
    [selectedClassId, submissionViews],
  );

  const progressRows = useMemo(
    () => buildStudentProgress(visibleMembers, visibleViews),
    [visibleMembers, visibleViews],
  );
  const progressByUid = useMemo(() => new Map(progressRows.map((row) => [row.studentUid, row])), [progressRows]);
  const selectedStudent = selectedStudentUid ? progressByUid.get(selectedStudentUid) : undefined;

  const activeMemberCount = members.filter((member) => member.status !== "removed").length;
  const membersByClassId = useMemo(() => {
    const grouped = new Map<string, ClassMember[]>();
    for (const member of members) {
      grouped.set(member.classId, [...(grouped.get(member.classId) || []), member]);
    }
    return grouped;
  }, [members]);
  const viewsByClassId = useMemo(() => {
    const grouped = new Map<string, ClassSubmissionView[]>();
    for (const item of submissionViews) {
      grouped.set(item.classId, [...(grouped.get(item.classId) || []), item]);
    }
    return grouped;
  }, [submissionViews]);

  const classSelector = (
    <label className="inline-admin-select">
      班級
      <select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)}>
        <option value={ALL_CLASSES}>全部班級</option>
        {classes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="panel-stack">
      <div className="panel-heading">
        <h2>我的班級</h2>
        <span>
          {classes.length} 個班級 · {activeMemberCount} 位學生 · {submissionViews.length} 筆答題紀錄
        </span>
      </div>

      <div className="admin-top-tabs" role="tablist" aria-label="班級管理功能表">
        {(
          [
            ["classes", "班級管理"],
            ["students", "學生名單"],
            ["submissions", "答題記錄"],
          ] as Array<[ClassSection, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            className={section === key ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={section === key}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "classes" && (
        <>
          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>建立班級</h3>
                <p>輸入班級名稱後，系統會自動產生班級代碼。學生在「我的帳號」輸入代碼即可加入，並自動帶入本班學校。</p>
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
              <button
                className="primary-button"
                type="button"
                onClick={onCreateClass}
                disabled={busy || !classNameDraft.trim()}
              >
                建立班級
              </button>
            </div>
          </section>

          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>班級管理</h3>
                <p>開放或關閉班級代碼加入。關閉後既有學生不受影響，只是新學生無法再用代碼加入。</p>
              </div>
            </div>
            {classes.length === 0 && <p className="muted">尚未建立班級。</p>}
            {classes.map((learningClass) => {
              const classMembers = membersByClassId.get(learningClass.id) || [];
              const activeMembers = classMembers.filter((member) => member.status !== "removed");
              const classViews = viewsByClassId.get(learningClass.id) || [];
              return (
                <div className="class-card" key={learningClass.id}>
                  <div className="class-card-head">
                    <div>
                      <h4>{learningClass.name}</h4>
                      <p>
                        {learningClass.schoolName || "未設定學校"}｜{learningClass.teacherName}
                      </p>
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
                    <span>{classViews.length} 筆答題紀錄</span>
                    <span>建立：{formatContestDateTime(learningClass.createdAt)}</span>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={busy}
                      onClick={() => onToggleJoin(learningClass, !learningClass.joinEnabled)}
                    >
                      {learningClass.joinEnabled ? "關閉班級" : "開啟班級"}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        setSelectedClassId(learningClass.id);
                        setSection("submissions");
                      }}
                    >
                      看答題記錄
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

      {section === "students" && (
        <section className="admin-section">
          <div className="section-title-row">
            <div>
              <h3>學生名單</h3>
              <p>點選學生可查看個人答題儀表板；可將學生移除或恢復。</p>
            </div>
            <div className="admin-file-actions">{classSelector}</div>
          </div>
          <div className="admin-table">
            <div className="admin-table-head class-member-table-row">
              <span>學生</span>
              <span>Email</span>
              <span>{selectedClassId === ALL_CLASSES ? "班級" : "加入時間"}</span>
              <span>狀態</span>
              <span>操作</span>
            </div>
            {visibleMembers.length === 0 && <p className="muted table-empty">尚無學生加入。</p>}
            {visibleMembers.map((member) => {
              const active = selectedStudentUid === member.studentUid;
              return (
                <div
                  className={active ? "class-member-table-row clickable active" : "class-member-table-row clickable"}
                  key={member.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedStudentUid(active ? "" : member.studentUid)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedStudentUid(active ? "" : member.studentUid);
                    }
                  }}
                >
                  <span>{member.studentName}</span>
                  <span>{member.studentEmail || "-"}</span>
                  <span>{selectedClassId === ALL_CLASSES ? member.className : formatContestDateTime(member.joinedAt)}</span>
                  <span className={member.status === "removed" ? "status-pill disabled" : "status-pill"}>
                    {member.status === "removed" ? "已移除" : "已加入"}
                  </span>
                  <span>
                    <button
                      className="ghost-button compact"
                      type="button"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSetMemberStatus(member, member.status === "removed" ? "active" : "removed");
                      }}
                    >
                      {member.status === "removed" ? "恢復" : "移除"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          {selectedStudent && (
            <StudentDashboard
              student={selectedStudent}
              problems={problems}
              onClose={() => setSelectedStudentUid("")}
            />
          )}
          {selectedStudentUid && !selectedStudent && (
            <p className="muted">這位學生還沒有任何答題紀錄。</p>
          )}
        </section>
      )}

      {section === "submissions" && (
        <>
          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>{selectedClass ? `${selectedClass.name} 答題儀表板` : "全部班級答題儀表板"}</h3>
                <p>依每位學生各題最佳答題率彙整；點選學生可展開詳細提交紀錄。只包含學生加入班級後的提交。</p>
              </div>
              <div className="admin-file-actions">{classSelector}</div>
            </div>

            <div className="metric-row">
              <Metric label="學生" value={`${visibleMembers.filter((m) => m.status !== "removed").length} 人`} />
              <Metric label="已作答學生" value={`${progressRows.filter((row) => row.submitCount > 0).length} 人`} />
              <Metric label="提交次數" value={`${visibleViews.length} 次`} />
              <Metric
                label="平均答題率"
                value={`${Math.round(
                  (progressRows.reduce((sum, row) => sum + row.averagePassRate, 0) / Math.max(1, progressRows.length)) * 100,
                )}%`}
              />
            </div>

            <div className="admin-table">
              <div className="admin-table-head class-progress-row">
                <span>學生</span>
                <span>{selectedClassId === ALL_CLASSES ? "班級" : "Email"}</span>
                <span>完成題數</span>
                <span>答題率</span>
                <span>提交</span>
                <span>最後作答</span>
                <span>題目完成狀況</span>
              </div>
              {progressRows.length === 0 && <p className="muted table-empty">尚無答題紀錄。</p>}
              {progressRows.map((row) => {
                const expanded = selectedStudentUid === row.studentUid;
                return (
                  <div className="progress-table-item" key={row.studentUid}>
                    <div
                      className={expanded ? "class-progress-row clickable active" : "class-progress-row clickable"}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedStudentUid(expanded ? "" : row.studentUid)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedStudentUid(expanded ? "" : row.studentUid);
                        }
                      }}
                    >
                      <span>{row.studentName}</span>
                      <span>{selectedClassId === ALL_CLASSES ? row.classNames.join("、") : row.studentEmail || "-"}</span>
                      <span>
                        {row.completedCount}/{problems.length}
                      </span>
                      <span>{Math.round(row.averagePassRate * 100)}%</span>
                      <span>{row.submitCount} 次</span>
                      <span>{row.lastSubmittedAt ? formatContestDateTime(row.lastSubmittedAt) : "-"}</span>
                      <span>{formatStatusSummary(row, problems)}</span>
                    </div>
                    {expanded && (
                      <div className="user-progress-detail">
                        <StudentDashboard student={row} problems={problems} embedded />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>各題完成狀況</h3>
                <p>每一題有多少學生完成、嘗試中、尚未作答。</p>
              </div>
            </div>
            <ProblemCompletionTable rows={progressRows} problems={problems} />
          </section>

          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>最近提交</h3>
                <p>最新 50 筆。</p>
              </div>
              <span className="section-pill">{visibleViews.length} 筆</span>
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
              {visibleViews.length === 0 && (
                <p className="muted table-empty">尚無班級答題紀錄；學生下一次提交後會出現在這裡。</p>
              )}
              {visibleViews.slice(0, 50).map((item) => (
                <div className="class-submission-table-row" key={item.id}>
                  <span>{formatContestDateTime(item.createdAt)}</span>
                  <span>{item.studentName}</span>
                  <span>{item.problemTitle}</span>
                  <span>{Math.round(item.passRate * 100)}%</span>
                  <span>
                    {item.score}/{item.maxScore}
                  </span>
                  <span className={item.isFullScore ? "status-pill" : "status-pill warning"}>
                    {item.isFullScore ? "已完成" : item.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** 學生個人答題儀表板：各題最佳成績與提交紀錄。 */
function StudentDashboard({
  student,
  problems,
  embedded = false,
  onClose,
}: {
  student: StudentProgress;
  problems: Problem[];
  embedded?: boolean;
  onClose?: () => void;
}) {
  const attemptedProblems = problems.filter((problem) => student.bestByProblem.has(problem.id));
  return (
    <div className={embedded ? "student-dashboard embedded" : "student-dashboard"}>
      {!embedded && (
        <div className="section-title-row compact">
          <div>
            <h4>{student.studentName} 的答題儀表板</h4>
            <p>{student.studentEmail || student.classNames.join("、")}</p>
          </div>
          {onClose && (
            <button className="ghost-button compact" type="button" onClick={onClose}>
              關閉
            </button>
          )}
        </div>
      )}
      <div className="metric-row">
        <Metric label="完成題數" value={`${student.completedCount}/${problems.length}`} />
        <Metric label="嘗試中" value={`${student.attemptedCount} 題`} />
        <Metric label="平均答題率" value={`${Math.round(student.averagePassRate * 100)}%`} />
        <Metric label="提交次數" value={`${student.submitCount} 次`} />
      </div>

      <h5 className="student-dashboard-subtitle">各題最佳成績</h5>
      <div className="admin-table">
        <div className="admin-table-head submission-table-row">
          <span>題目</span>
          <span>最佳答題率</span>
          <span>最佳分數</span>
          <span>提交</span>
          <span>狀態</span>
        </div>
        {attemptedProblems.length === 0 && <p className="muted table-empty">尚未作答任何題目。</p>}
        {attemptedProblems.map((problem) => {
          const best = student.bestByProblem.get(problem.id)!;
          const count = student.records.filter((item) => item.problemId === problem.id).length;
          return (
            <div className="submission-table-row" key={problem.id}>
              <span>{problem.title}</span>
              <span>{Math.round(best.passRate * 100)}%</span>
              <span>
                {best.score}/{best.maxScore}
              </span>
              <span>{count} 次</span>
              <span className={best.isFullScore ? "status-pill" : "status-pill warning"}>
                {best.isFullScore ? "已完成" : "嘗試中"}
              </span>
            </div>
          );
        })}
      </div>

      <h5 className="student-dashboard-subtitle">提交紀錄</h5>
      <div className="admin-table">
        <div className="admin-table-head submission-table-row">
          <span>時間</span>
          <span>題目</span>
          <span>答題率</span>
          <span>分數</span>
          <span>狀態</span>
        </div>
        {student.records.map((item) => (
          <div className="submission-table-row" key={item.id}>
            <span>{formatContestDateTime(item.createdAt)}</span>
            <span>{item.problemTitle}</span>
            <span>{Math.round(item.passRate * 100)}%</span>
            <span>
              {item.score}/{item.maxScore}
            </span>
            <span>{item.isFullScore ? "已完成" : item.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProblemCompletionTable({ rows, problems }: { rows: StudentProgress[]; problems: Problem[] }) {
  const stats = problems
    .map((problem) => {
      let completed = 0;
      let attempted = 0;
      for (const row of rows) {
        const best = row.bestByProblem.get(problem.id);
        if (!best) continue;
        if (best.isFullScore) completed += 1;
        else attempted += 1;
      }
      return { problem, completed, attempted, untouched: Math.max(0, rows.length - completed - attempted) };
    })
    .filter((item) => item.completed + item.attempted > 0)
    .sort((a, b) => b.completed - a.completed || b.attempted - a.attempted);

  if (stats.length === 0) {
    return <p className="muted table-empty">尚無任何題目被作答。</p>;
  }
  return (
    <div className="admin-table">
      <div className="admin-table-head submission-table-row">
        <span>題目</span>
        <span>完成</span>
        <span>嘗試中</span>
        <span>尚未作答</span>
        <span>完成率</span>
      </div>
      {stats.map(({ problem, completed, attempted, untouched }) => (
        <div className="submission-table-row" key={problem.id}>
          <span>{problem.title}</span>
          <span>{completed} 人</span>
          <span>{attempted} 人</span>
          <span>{untouched} 人</span>
          <span>{rows.length === 0 ? "-" : `${Math.round((completed / rows.length) * 100)}%`}</span>
        </div>
      ))}
    </div>
  );
}

function buildStudentProgress(members: ClassMember[], views: ClassSubmissionView[]): StudentProgress[] {
  const byUid = new Map<string, StudentProgress>();
  const ensure = (uid: string, name: string, email: string) => {
    let row = byUid.get(uid);
    if (!row) {
      row = {
        studentUid: uid,
        studentName: name,
        studentEmail: email,
        classNames: [],
        bestByProblem: new Map(),
        completedCount: 0,
        attemptedCount: 0,
        averagePassRate: 0,
        submitCount: 0,
        records: [],
      };
      byUid.set(uid, row);
    }
    return row;
  };

  for (const member of members) {
    if (member.status === "removed") continue;
    const row = ensure(member.studentUid, member.studentName, member.studentEmail || "");
    if (!row.classNames.includes(member.className)) {
      row.classNames.push(member.className);
    }
  }
  for (const view of views) {
    const row = ensure(view.studentUid, view.studentName, view.studentEmail || "");
    row.records.push(view);
    const current = row.bestByProblem.get(view.problemId);
    if (!current || isBetter(view, current)) {
      row.bestByProblem.set(view.problemId, view);
    }
  }

  for (const row of byUid.values()) {
    row.records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    row.submitCount = row.records.length;
    row.lastSubmittedAt = row.records[0]?.createdAt;
    const bests = Array.from(row.bestByProblem.values());
    row.completedCount = bests.filter((item) => item.isFullScore).length;
    row.attemptedCount = bests.length - row.completedCount;
    row.averagePassRate = bests.length === 0 ? 0 : bests.reduce((sum, item) => sum + item.passRate, 0) / bests.length;
  }

  return Array.from(byUid.values()).sort((a, b) => {
    if (b.completedCount !== a.completedCount) return b.completedCount - a.completedCount;
    if (b.averagePassRate !== a.averagePassRate) return b.averagePassRate - a.averagePassRate;
    return a.studentName.localeCompare(b.studentName, "zh-Hant", { numeric: true });
  });
}

function isBetter(candidate: ClassSubmissionView, current: ClassSubmissionView) {
  if (candidate.passRate !== current.passRate) return candidate.passRate > current.passRate;
  if (candidate.score !== current.score) return candidate.score > current.score;
  return Date.parse(candidate.createdAt) < Date.parse(current.createdAt);
}

function formatStatusSummary(row: StudentProgress, problems: Problem[]) {
  const completed = problems.filter((problem) => row.bestByProblem.get(problem.id)?.isFullScore).map((p) => p.title);
  const attempted = problems
    .filter((problem) => row.bestByProblem.has(problem.id) && !row.bestByProblem.get(problem.id)?.isFullScore)
    .map((p) => p.title);
  const parts: string[] = [];
  if (completed.length > 0) parts.push(`完成：${summarize(completed)}`);
  if (attempted.length > 0) parts.push(`嘗試中：${summarize(attempted)}`);
  return parts.length > 0 ? parts.join("；") : "尚未作答";
}

function summarize(titles: string[]) {
  return titles.length <= 3 ? titles.join("、") : `${titles.slice(0, 3).join("、")} 等 ${titles.length} 題`;
}
