import type { ProblemStatementTable } from "../types";
import {
  getKnownStatementAddenda,
  getKnownStatementTables,
  mergeStatementTables,
  resolveProblemImageSource,
  type ProblemRichContentLike,
} from "../../shared/problemRichContent";

interface ProblemStatementContentProps {
  problem: ProblemRichContentLike & {
    imageSources?: string[];
    statementTables?: ProblemStatementTable[];
  };
}

export function ProblemStatementContent({ problem }: ProblemStatementContentProps) {
  const tables = mergeStatementTables(problem.statementTables, getKnownStatementTables(problem));
  const addenda = getKnownStatementAddenda(problem);
  const imageSources = Array.from(new Set((problem.imageSources || []).map(resolveProblemImageSource).filter(Boolean)));

  return (
    <div className="statement-rich-content">
      {problem.description && <div className="statement-rich-text">{problem.description}</div>}

      {addenda.length > 0 && (
        <div className="statement-addenda">
          {addenda.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      )}

      {tables.length > 0 && (
        <div className="statement-table-list">
          {tables.map((table, index) => (
            <StatementTable table={table} key={`${table.title || "table"}-${index}`} />
          ))}
        </div>
      )}

      {imageSources.length > 0 && (
        <div className="statement-image-list">
          <strong>題目附圖</strong>
          {imageSources.map((source, index) => (
            <figure className="statement-image-frame" key={source}>
              <img src={source} alt={`${problem.title || "題目"}附圖 ${index + 1}`} loading="lazy" />
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function StatementTable({ table }: { table: ProblemStatementTable }) {
  return (
    <div className="statement-table-card">
      {table.title && <strong>{table.title}</strong>}
      <div className="statement-table-scroll">
        <table className="statement-table">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={`${row.join("|")}-${rowIndex}`}>
                {table.columns.map((_, columnIndex) => (
                  <td key={columnIndex}>{row[columnIndex] || ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note && <p className="muted">{table.note}</p>}
    </div>
  );
}
