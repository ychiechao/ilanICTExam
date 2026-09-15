import { Save } from "lucide-react";
import type { Problem } from "../../types";

export function ProblemEditorForm({
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
