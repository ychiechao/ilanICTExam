import type { Problem } from "../../types";
import { InfoBlock, Metric } from "../ui";

export function StatementPanel({
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
      <p className="muted input-model-hint">
        每個「要求輸入」積木會依序取得一個數值，空白與換行都算分隔（例如「3」「300」「450」「420」共四次輸入）。
        要讀多個數值請用迴圈，不需要自己切割字串。
      </p>
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
