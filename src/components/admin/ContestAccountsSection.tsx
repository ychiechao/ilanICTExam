import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  importContestAccounts,
  loadContestAccounts,
  resetContestAccountPassword,
  setContestAccountStatus,
  type ContestAccountImportRow,
  type IssuedContestAccount,
} from "../../services/contestAccountStore";
import { GraderError, hasGraderConfig } from "../../services/grader";
import { createSchoolDraft, saveSchool } from "../../services/schoolStore";
import type { ContestAccount, ContestEvent, School } from "../../types";
import { csvDateStamp, downloadCsv } from "../../utils/csv";
import { formatContestDateTime } from "../../utils/format";
import { Metric } from "../ui";

interface ContestAccountsSectionProps {
  contests: ContestEvent[];
  schools: School[];
  busy: boolean;
  onStatus: (message: string) => void;
  onContestsChanged: () => void;
  /** 從「賽事管理」點進來時預選的賽事。 */
  initialContestId?: string;
}

interface PreviewRow extends ContestAccountImportRow {
  line: number;
  error?: string;
  /** 學校名稱不是完全一致、由系統自動對應時的提示。 */
  hint?: string;
  /** 「學校管理」裡沒有這所學校，匯入時會自動新增。 */
  newSchool?: boolean;
}

const SAMPLE_CSV = "學校,姓名\n大福國小,王小明\n大福國小,陳小華\n順安國小,林小三";

/** 後台「競賽帳號」：每場賽事獨立匯入、發放帳號卡、重設密碼、停用（規格 8.2）。 */
export function ContestAccountsSection({ contests, schools, busy, onStatus, onContestsChanged, initialContestId }: ContestAccountsSectionProps) {
  const candidateContests = contests.filter((contest) => contest.status !== "archived");
  const [contestId, setContestId] = useState(initialContestId || candidateContests[0]?.id || "");
  const [csvText, setCsvText] = useState("");
  /** 預設學校：名單只有姓名（或學校欄空白）時自動帶入。 */
  const [defaultSchoolId, setDefaultSchoolId] = useState("");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [accounts, setAccounts] = useState<ContestAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [working, setWorking] = useState(false);
  const [issued, setIssued] = useState<IssuedContestAccount[]>([]);
  const [issuedLabel, setIssuedLabel] = useState("");
  const [showCards, setShowCards] = useState(false);
  const [qrByUsername, setQrByUsername] = useState<Record<string, string>>({});

  const contest = contests.find((item) => item.id === contestId);
  const enabledSchools = useMemo(() => schools.filter((school) => school.enabled !== false), [schools]);
  const defaultSchool = schools.find((school) => school.id === defaultSchoolId);

  useEffect(() => {
    if (!contestId && candidateContests[0]) {
      setContestId(candidateContests[0].id);
    }
  }, [candidateContests, contestId]);

  const refreshAccounts = useCallback(async () => {
    if (!contestId) {
      setAccounts([]);
      return;
    }
    setLoadingAccounts(true);
    try {
      setAccounts(await loadContestAccounts(contestId));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "競賽帳號讀取失敗。");
    } finally {
      setLoadingAccounts(false);
    }
  }, [contestId, onStatus]);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  // 帳號卡的 QR code 只帶帳號，不帶密碼（決策 H）。
  useEffect(() => {
    if (!showCards || issued.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const item of issued) {
        next[item.username] = await QRCode.toDataURL(item.username, { margin: 0, width: 96 });
      }
      if (!cancelled) setQrByUsername(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [issued, showCards]);

  function handlePreview() {
    const rows = parseCsv(csvText);
    if (rows.length === 0) {
      onStatus("請先貼上名單（學校,姓名 或 只有姓名）。");
      return;
    }
    setPreview(
      rows.map(({ line, cells }) => {
        // 只有一欄時視為姓名（除非它本身就是學校名稱），學校用預設學校帶入。
        const singleIsSchool = cells.length === 1 && matchSchool(cells[0], schools).kind === "exact";
        const [schoolName = "", name = "", note = ""] = cells.length === 1 && !singleIsSchool ? ["", cells[0]] : cells;
        const errors: string[] = [];
        let hint: string | undefined;
        let school: School | undefined;
        let newSchool = false;
        if (!name.trim()) errors.push("缺姓名");
        if (!schoolName.trim()) {
          school = defaultSchool;
          if (school) hint = "帶入預設學校";
          else errors.push("缺學校（可在上方選預設學校）");
        } else {
          const matched = matchSchool(schoolName, schools);
          if (matched.kind === "exact") school = matched.school;
          else if (matched.kind === "fuzzy") {
            school = matched.school;
            hint = `「${schoolName.trim()}」自動對應為「${school.name}」`;
          } else if (matched.kind === "ambiguous") errors.push(`「${schoolName.trim()}」符合多所學校：${matched.candidates.map((item) => item.name).join("、")}`);
          else {
            // 學校管理裡沒有這所學校：匯入時自動新增，不擋匯入。
            newSchool = true;
            hint = `將自動新增學校「${schoolName.trim()}」`;
          }
        }
        return {
          line,
          name: name.trim(),
          schoolId: school?.id ?? "",
          schoolName: school?.name ?? schoolName.trim(),
          note: note.trim(),
          hint,
          newSchool,
          error: errors.length > 0 ? errors.join("、") : undefined,
        };
      }),
    );
  }

  async function handleImport() {
    if (!contest || !preview) return;
    const valid = preview.filter((row) => !row.error);
    if (valid.length === 0) {
      onStatus("沒有可匯入的列，請先修正錯誤。");
      return;
    }
    const newSchoolNames = Array.from(new Set(valid.filter((row) => row.newSchool).map((row) => row.schoolName)));
    const newSchoolText = newSchoolNames.length > 0 ? `，並在「學校管理」新增 ${newSchoolNames.length} 所學校（${newSchoolNames.join("、")}）` : "";
    if (!window.confirm(`確定為「${contest.title}」匯入 ${valid.length} 個帳號${newSchoolText}？密碼只會顯示這一次。`)) {
      return;
    }
    setWorking(true);
    try {
      // 先把名單裡不存在的學校建立起來，帳號才會綁到正式的學校 ID。
      const createdSchoolIds = new Map<string, string>();
      for (const [index, name] of newSchoolNames.entries()) {
        const school = await saveSchool({ ...createSchoolDraft(), id: `school-${Date.now()}-${index}`, name });
        createdSchoolIds.set(name, school.id);
      }
      const rows = valid.map(({ name, schoolId, schoolName, note }) => ({
        name,
        schoolId: schoolId || createdSchoolIds.get(schoolName) || "",
        schoolName,
        note,
      }));
      const result = await importContestAccounts(contest.id, rows);
      setIssued(result.accounts);
      setIssuedLabel(`${contest.title}｜批次 ${result.batchId}`);
      setPreview(null);
      setCsvText("");
      onStatus(`已匯入 ${result.accounts.length} 個帳號，請立即下載或列印帳號卡。`);
      await refreshAccounts();
      onContestsChanged();
    } catch (error) {
      onStatus(error instanceof GraderError || error instanceof Error ? error.message : "匯入失敗。");
    } finally {
      setWorking(false);
    }
  }

  async function handleReset(account: ContestAccount) {
    if (!contest) return;
    if (!window.confirm(`重設 ${account.username}（${account.name}）的密碼？舊密碼立即失效。`)) return;
    setWorking(true);
    try {
      const result = await resetContestAccountPassword(contest.id, account.username);
      setIssued([
        {
          username: result.username,
          password: result.password,
          name: account.name,
          schoolName: account.schoolName,
          schoolSeq: account.schoolSeq,
          note: account.note ?? "",
        },
      ]);
      setIssuedLabel(`${contest.title}｜重設密碼`);
      onStatus(`${account.username} 密碼已重設，新密碼顯示在下方。`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "重設失敗。");
    } finally {
      setWorking(false);
    }
  }

  async function handleToggleStatus(account: ContestAccount) {
    if (!contest) return;
    const next = account.status === "disabled" ? "active" : "disabled";
    setWorking(true);
    try {
      await setContestAccountStatus(contest.id, account.username, next);
      await refreshAccounts();
      onStatus(`${account.username} 已${next === "disabled" ? "停用" : "啟用"}。`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "狀態更新失敗。");
    } finally {
      setWorking(false);
    }
  }

  function downloadIssuedCsv() {
    downloadCsv(
      `競賽帳號-${contest?.title ?? contestId}-${csvDateStamp()}.csv`,
      ["學校序號", "學校", "姓名", "帳號", "密碼"],
      issued.map((item) => [item.schoolSeq ?? "", item.schoolName, item.name, item.username, item.password]),
    );
  }

  // 帳號清單（不含密碼）：學校序號、學校、姓名、帳號、狀態、首次登入。
  function downloadAccountListCsv() {
    downloadCsv(
      "競賽帳號清單-" + (contest?.title ?? contestId) + "-" + csvDateStamp() + ".csv",
      ["學校序號", "學校", "姓名", "帳號", "狀態", "首次登入"],
      accounts.map((item) => [
        item.schoolSeq ?? "",
        item.schoolName,
        item.name,
        item.username,
        item.status === "disabled" ? "停用" : "啟用",
        item.firstLoginAt ? formatContestDateTime(item.firstLoginAt) : "",
      ]),
    );
  }

  const validPreviewCount = preview?.filter((row) => !row.error).length ?? 0;
  const activeCount = accounts.filter((item) => item.status === "active").length;
  const loggedInCount = accounts.filter((item) => item.firstLoginAt).length;
  const disabled = busy || working;

  return (
    <section className="admin-section">
      <div className="section-title-row">
        <div>
          <h3>競賽帳號</h3>
          <p>每場賽事獨立匯入。帳號由系統依組別編號（E-001、J-001…），密碼隨機產生、只顯示一次，請立即下載或列印帳號卡分發。</p>
        </div>
        <div className="admin-file-actions">
          <label className="inline-admin-select">
            賽事
            <select value={contestId} onChange={(event) => setContestId(event.target.value)} disabled={disabled}>
              {candidateContests.length === 0 && <option value="">尚無賽事</option>}
              {candidateContests.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button" type="button" onClick={() => void refreshAccounts()} disabled={disabled || loadingAccounts}>
            重新整理
          </button>
          <button className="ghost-button" type="button" onClick={downloadAccountListCsv} disabled={accounts.length === 0}>
            匯出帳號清單
          </button>
        </div>
      </div>

      {!hasGraderConfig() && <p className="warning-text">尚未設定評分伺服器位址（VITE_GRADER_URL），無法匯入。</p>}
      {!contest && <p className="muted">請先在「賽事管理」建立賽事。</p>}

      {contest && (
        <>
          <div className="metric-row">
            <Metric label="組別" value={contest.division === "J" ? "J 國中組" : "E 國小組"} />
            <Metric label="帳號數" value={`${accounts.length} 個`} />
            <Metric label="啟用中" value={`${activeCount} 個`} />
            <Metric label="已登入過" value={`${loggedInCount} 個`} />
          </div>

          <div className="admin-subsection">
            <h4>批次匯入</h4>
            <p className="muted">
              每列「學校,姓名」，用逗號或 Tab 分隔，可直接從 Excel 貼上；第一列若是標題會自動略過。學校名稱會自動對應「學校管理」中的學校（可省略縣市、簡稱如「大福」），沒有的學校會在匯入時自動新增；
              若名單只有姓名，請先選「預設學校」。系統會自動產生帳號、密碼與各校序號。
            </p>
            <label className="inline-admin-select">
              預設學校
              <select
                value={defaultSchoolId}
                onChange={(event) => {
                  setDefaultSchoolId(event.target.value);
                  setPreview(null);
                }}
                disabled={disabled}
              >
                <option value="">（不指定，每列都要填學校）</option>
                {enabledSchools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              className="json-input"
              rows={8}
              value={csvText}
              placeholder={SAMPLE_CSV}
              onChange={(event) => {
                setCsvText(event.target.value);
                setPreview(null);
              }}
              disabled={disabled}
            />
            <div className="admin-file-actions">
              <label className="ghost-button file-button">
                從檔案讀入
                <input
                  type="file"
                  accept=".csv,.txt,.tsv"
                  className="hidden-file-input"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setCsvText(await file.text());
                      setPreview(null);
                    }
                    event.target.value = "";
                  }}
                />
              </label>
              <button className="ghost-button" type="button" onClick={handlePreview} disabled={disabled || !csvText.trim()}>
                預覽
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleImport()}
                disabled={disabled || !preview || validPreviewCount === 0 || !hasGraderConfig()}
              >
                {working ? "匯入中…" : `匯入 ${validPreviewCount} 筆`}
              </button>
            </div>

            {preview && (
              <div className="admin-table">
                <div className="admin-table-head contest-account-preview-row">
                  <span>列</span>
                  <span>學校</span>
                  <span>姓名</span>
                  <span>備註</span>
                  <span>檢查</span>
                </div>
                {preview.map((row) => (
                  <div className={row.error ? "contest-account-preview-row invalid" : "contest-account-preview-row"} key={row.line}>
                    <span>{row.line}</span>
                    <span>{row.schoolName || "-"}</span>
                    <span>{row.name || "-"}</span>
                    <span>{row.note || "-"}</span>
                    <span className={row.error ? "warning-text" : "ok-text"}>{row.error ?? (row.hint ? `可匯入（${row.hint}）` : "可匯入")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {issued.length > 0 && (
            <div className="admin-subsection issued-accounts">
              <div className="section-title-row compact">
                <div>
                  <h4>本次產生的帳號密碼（只顯示這一次）</h4>
                  <p className="muted">{issuedLabel}。離開此頁後無法再查看密碼，只能重設。</p>
                </div>
                <div className="admin-file-actions">
                  <button className="ghost-button" type="button" onClick={downloadIssuedCsv}>
                    下載 CSV
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setShowCards((value) => !value)}>
                    {showCards ? "收合帳號卡" : "產生帳號卡"}
                  </button>
                  {showCards && (
                    <button className="primary-button" type="button" onClick={() => window.print()}>
                      列印
                    </button>
                  )}
                  <button className="ghost-button" type="button" onClick={() => setIssued([])}>
                    清除
                  </button>
                </div>
              </div>
              <div className="admin-table">
                <div className="admin-table-head issued-account-row">
                  <span>學校序號</span>
                  <span>學校</span>
                  <span>姓名</span>
                  <span>帳號</span>
                  <span>密碼</span>
                </div>
                {issued.map((item) => (
                  <div className="issued-account-row" key={item.username}>
                    <span>{item.schoolSeq ?? "-"}</span>
                    <span>{item.schoolName}</span>
                    <span>{item.name}</span>
                    <span className="mono">{item.username}</span>
                    <span className="mono">{item.password}</span>
                  </div>
                ))}
              </div>
              {showCards && (
                <div className="account-cards print-area">
                  {issued.map((item) => (
                    <div className="account-card-print" key={item.username}>
                      <div className="account-card-head">
                        <strong>{contest.title}</strong>
                        <span>
                          {item.schoolName}
                          {item.schoolSeq ? " #" + item.schoolSeq : ""}
                        </span>
                      </div>
                      <div className="account-card-body">
                        <div>
                          <div className="account-card-name">{item.name}</div>
                          <div className="account-card-field">
                            <span>帳號</span>
                            <strong className="mono">{item.username}</strong>
                          </div>
                          <div className="account-card-field">
                            <span>密碼</span>
                            <strong className="mono">{item.password}</strong>
                          </div>
                        </div>
                        {qrByUsername[item.username] && <img src={qrByUsername[item.username]} alt="" width={72} height={72} />}
                      </div>
                      <div className="account-card-foot">{window.location.origin}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="admin-subsection">
            <div className="section-title-row compact">
              <div>
                <h4>帳號列表</h4>
                <p className="muted">重設密碼會立刻讓舊密碼失效；停用後該帳號無法登入。</p>
              </div>
            </div>
            <div className="admin-table">
              <div className="admin-table-head contest-account-row">
                <span>帳號</span>
                <span>學校序號</span>
                <span>學校</span>
                <span>姓名</span>
                <span>狀態</span>
                <span>首次登入</span>
                <span>操作</span>
              </div>
              {loadingAccounts && <p className="muted table-empty">讀取中…</p>}
              {!loadingAccounts && accounts.length === 0 && <p className="muted table-empty">尚未匯入任何帳號。</p>}
              {accounts.map((account) => (
                <div className="contest-account-row" key={account.id}>
                  <span className="mono">{account.username}</span>
                  <span>{account.schoolSeq ?? "-"}</span>
                  <span>{account.schoolName || "-"}</span>
                  <span>{account.name}</span>
                  <span className={account.status === "disabled" ? "status-pill disabled" : "status-pill"}>
                    {account.status === "disabled" ? "停用" : "啟用"}
                  </span>
                  <span>{account.firstLoginAt ? formatContestDateTime(account.firstLoginAt) : "尚未登入"}</span>
                  <span className="user-actions">
                    <button className="ghost-button compact" type="button" onClick={() => void handleReset(account)} disabled={disabled}>
                      重設密碼
                    </button>
                    <button className="ghost-button compact" type="button" onClick={() => void handleToggleStatus(account)} disabled={disabled}>
                      {account.status === "disabled" ? "啟用" : "停用"}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** 逗號或 Tab 分隔；支援雙引號包住含逗號的欄位；略過空行與看起來像標題的第一列。 */
function parseCsv(text: string): Array<{ line: number; cells: string[] }> {
  const rows: Array<{ line: number; cells: string[] }> = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    const cells = raw.includes("\t") ? raw.split("\t") : splitCommaLine(raw);
    rows.push({ line: index + 1, cells: cells.map((cell) => cell.trim()) });
  });
  if (rows.length > 0) {
    const [first] = rows;
    const looksLikeHeader = first.cells.some((cell) => /^(學校|姓名|備註|school|name|note)$/i.test(cell));
    if (looksLikeHeader) rows.shift();
  }
  return rows;
}

/**
 * 學校名稱對應：先完全一致，再比對正規化後的名稱（去空白、去「○○縣／市」前綴、去「立」字），
 * 最後允許唯一的包含關係（「大福」→「大福國小」、「宜蘭縣大福國民小學」→「大福國小」）。
 */
function matchSchool(
  input: string,
  schools: School[],
): { kind: "exact" | "fuzzy"; school: School } | { kind: "ambiguous"; candidates: School[] } | { kind: "none" } {
  const raw = input.trim();
  const exact = schools.find((school) => school.name.trim() === raw);
  if (exact) return { kind: "exact", school: exact };

  const target = normalizeSchoolName(raw);
  if (!target) return { kind: "none" };
  const normalized = schools.map((school) => ({ school, key: normalizeSchoolName(school.name) }));

  const same = normalized.filter((item) => item.key === target);
  if (same.length === 1) return { kind: "fuzzy", school: same[0].school };
  if (same.length > 1) return { kind: "ambiguous", candidates: same.map((item) => item.school) };

  const partial = normalized.filter((item) => item.key.includes(target) || target.includes(item.key));
  if (partial.length === 1) return { kind: "fuzzy", school: partial[0].school };
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial.map((item) => item.school) };
  return { kind: "none" };
}

function normalizeSchoolName(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/^(臺|台)?[一-龥]{1,2}(縣|市)(立)?/, "")
    .replace(/^(縣|市|國|私)立/, "")
    .replace(/國民小學$/, "國小")
    .replace(/國民中學$/, "國中")
    .toLowerCase();
}

function splitCommaLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((char === "," || char === "，") && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
