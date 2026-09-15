import { useMemo, useState } from "react";
import { tabs } from "../../app/constants";
import type { ClassMember, ClassSubmissionView, LearningClass } from "../../types";
import { formatContestDateTime } from "../../utils/format";

export function ClassesPanel({
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
