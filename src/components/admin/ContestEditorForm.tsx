import { Save } from "lucide-react";
import { contestStatusFlow } from "../../app/constants";
import type { ContestEvent, ContestStatus } from "../../types";
import { getContestStatusLabel, parseProblemIdText } from "../../utils/drafts";
import { formatContestDateTime, formatDateTimeInputValue } from "../../utils/format";

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
        <label className="problem-form-field">
          組別（帳號前綴）
          <select value={contest.division || "E"} onChange={(event) => updateContest("division", event.target.value)}>
            <option value="E">E 國小組</option>
            <option value="J">J 國中組</option>
          </select>
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
