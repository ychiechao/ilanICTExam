import { Play } from "lucide-react";

export function TestPanel({
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
