import { getAccountStatusLabel, getRoleLabel } from "../../services/accountService";
import type { AdminProfile, AppUser, ClassMember, ManagedUser, School, UserRole } from "../../types";
import { formatContestDateTime } from "../../utils/format";

export function AccountPanel({
  user,
  profile,
  adminProfile,
  effectiveRole,
  pendingTeacher,
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
  pendingTeacher: boolean;
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
  // 學生一旦加入班級，學校就由班級決定，不再開放自選（規格 7.3）。
  const activeMemberships = studentClassMembers.filter((member) => member.status !== "removed");
  const schoolLockedByClass = effectiveRole === "student" && activeMemberships.length > 0;
  const lockingMembership = activeMemberships.find((member) => member.schoolName) || activeMemberships[0];
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
              {effectiveRole === "teacher" && <small>{schoolVerified ? "管理者已設定" : "待管理者確認"}</small>}
              {pendingTeacher && <small className="warning-text">教師身分待管理者啟用</small>}
            </div>
          </section>

          {pendingTeacher && (
            <section className="admin-section">
              <div className="section-title-row">
                <div>
                  <h3>教師身分尚未啟用</h3>
                  <p>
                    你的 Email 屬於教師網域。請聯絡管理者在後台為你設定任教學校，設定完成後即可使用「我的班級」功能。
                    在此之前，這個帳號以學生身分使用。
                  </p>
                </div>
              </div>
            </section>
          )}

          {effectiveRole === "teacher" && (
            <section className="admin-section">
              <div className="section-title-row">
                <div>
                  <h3>任教學校</h3>
                  <p>任教學校由管理者設定，建立班級時會自動帶入；如需變更請聯絡管理者。</p>
                </div>
              </div>
              <p>
                <strong>{schoolName}</strong>
              </p>
            </section>
          )}

          {effectiveRole === "student" && !pendingTeacher && (
          <section className="admin-section">
            <div className="section-title-row">
              <div>
                <h3>所屬學校設定</h3>
                <p>請先選擇你的學校，校排行與班級資料會依此顯示；加入班級後會自動改為班級的學校。</p>
              </div>
            </div>

              {schoolLockedByClass ? (
                <p className="muted">
                  你已加入班級「{lockingMembership?.className}」，學校由班級決定為「
                  {lockingMembership?.schoolName || schoolName}」。如需更改，請洽老師或管理者。
                </p>
              ) : schools.length === 0 ? (
                <p className="warning-text">目前尚無可選學校，請先由超管建立學校資料。</p>
              ) : (
                <div className="account-school-form">
                  <label className="problem-form-field">
                    學校
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

          {effectiveRole === "student" && !pendingTeacher && (
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
