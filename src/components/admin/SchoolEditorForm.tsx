import { Save } from "lucide-react";
import { parseDomainText } from "../../services/schoolStore";
import type { School } from "../../types";

export function SchoolEditorForm({
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
        備註（選填，例如 Email 網域）
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
