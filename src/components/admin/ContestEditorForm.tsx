import { Save } from "lucide-react";
import type { ContestEvent } from "../../types";
import { getContestStatusLabel } from "../../utils/drafts";
import { formatContestDateTime, formatDateTimeInputValue } from "../../utils/format";

/**
 * 賽事基本設定。狀態由「賽事管理」的階段按鈕與「平台狀態 → 比賽控制」推進；
 * 參賽人數、學校數、題數由帳號與題庫匯入自動帶入，這裡只顯示。
 */
export function ContestEditorForm({
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
          年度
          <input value={contest.year} onChange={(event) => updateContest("year", event.target.value)} />
        </label>
        <label className="problem-form-field">
          賽事名稱
          <input value={contest.title} onChange={(event) => updateContest("title", event.target.value)} />
        </label>
        <label className="problem-form-field">
          組別（帳號前綴）
          <select value={contest.division || "E"} onChange={(event) => updateContest("division", event.target.value)}>
            <option value="E">E 國小組</option>
            <option value="J">J 國中組</option>
          </select>
        </label>
      </div>

      <div className="contest-form-grid secondary">
        <label className="problem-form-field">
          比賽長度（分鐘；演練賽可設到 20160＝14 天）
          <input
            type="number"
            min={5}
            max={20160}
            value={contest.durationMinutes ?? 120}
            onChange={(event) => updateContest("durationMinutes", Math.max(5, Number(event.target.value) || 120))}
          />
        </label>
        <label className="problem-form-field">
          每題提交上限
          <input
            type="number"
            min={1}
            max={50}
            value={contest.maxSubmissionsPerProblem ?? 10}
            onChange={(event) => updateContest("maxSubmissionsPerProblem", Math.max(1, Number(event.target.value) || 10))}
          />
        </label>
        <label className="problem-form-field">
          預定開始（選填，實際以「開始比賽」為準）
          <input
            type="datetime-local"
            value={formatDateTimeInputValue(contest.startAt)}
            onChange={(event) => updateContest("startAt", event.target.value)}
          />
        </label>
        <label className="problem-form-field">
          預定結束（選填）
          <input
            type="datetime-local"
            value={formatDateTimeInputValue(contest.endAt)}
            onChange={(event) => updateContest("endAt", event.target.value)}
          />
        </label>
      </div>

      <label className="problem-form-field">
        賽事說明（參賽者登入後會看到）
        <textarea value={contest.description || ""} onChange={(event) => updateContest("description", event.target.value)} />
      </label>

      <label className="problem-form-field">
        備註（只有主辦單位看得到）
        <textarea value={contest.rosterNote || ""} onChange={(event) => updateContest("rosterNote", event.target.value)} />
      </label>

      <div className="contest-editor-summary">
        <span>目前階段：{getContestStatusLabel(contest.status)}</span>
        <span>競賽帳號：{contest.accountCount ?? 0} 個</span>
        <span>競賽題目：{contest.problemCount ?? 0} 題</span>
        <span>賽事 ID：{contest.id}</span>
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
