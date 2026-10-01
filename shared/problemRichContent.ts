export interface ProblemStatementTable {
  title?: string;
  columns: string[];
  rows: string[][];
  note?: string;
}

export interface ProblemRichContentLike {
  id?: string;
  sourceId?: string;
  title?: string;
  category?: string;
  description?: string;
}

export function normalizeStatementTables(value: unknown): ProblemStatementTable[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const columns = normalizeStringArray(item.columns);
      const rawRows = Array.isArray(item.rows) ? item.rows : [];
      const rows = rawRows
        .map((row) => normalizeTableRow(row, columns))
        .filter((row) => row.length > 0 && row.some(Boolean));
      if (columns.length === 0 || rows.length === 0) return null;
      const table: ProblemStatementTable = {
        columns,
        rows,
      };
      const title = readText(item.title);
      const note = readText(item.note);
      if (title) table.title = title;
      if (note) table.note = note;
      return table;
    })
    .filter((item): item is ProblemStatementTable => Boolean(item));
}

export function normalizeProblemImageSources(remoteImages: unknown, localImages?: unknown) {
  const local = normalizeStringArray(localImages).map(resolveProblemImageSource);
  const remote = normalizeStringArray(remoteImages).map(resolveProblemImageSource);
  return uniqueStrings([...local, ...remote]);
}

export function resolveProblemImageSource(source: string) {
  const value = source.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("/")) {
    return value;
  }
  if (value.startsWith("assets/")) {
    return `/solutions/${value}`;
  }
  if (value.startsWith("solutions/")) {
    return `/${value}`;
  }
  return value;
}

export function mergeStatementTables(...groups: Array<ProblemStatementTable[] | undefined>) {
  const output: ProblemStatementTable[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const table of group ?? []) {
      const key = JSON.stringify([table.title || "", table.columns, table.rows]);
      if (!seen.has(key)) {
        seen.add(key);
        output.push(table);
      }
    }
  }
  return output;
}

export function getKnownStatementTables(problem: ProblemRichContentLike): ProblemStatementTable[] {
  const title = problem.title || "";
  const sourceId = normalizeProblemSourceId(problem);
  const description = problem.description || "";

  if (title.includes("奇緣蛋糕特賣") && sourceId === "24") {
    return [
      {
        title: "蛋糕折扣表",
        columns: ["購買個數 N", "折扣"],
        rows: [
          ["1～5 個", "九折"],
          ["6～10 個", "八折"],
          ["11～15 個", "七折"],
          ["16 個以上", "六折"],
        ],
      },
      {
        title: "運費規則",
        columns: ["折扣後金額", "運費"],
        rows: [
          ["未滿 1,200 元", "80 元"],
          ["1,200 元以上", "免運"],
        ],
      },
    ];
  }

  if (title.includes("健康小管家") && (sourceId === "25" || sourceId === "37" || description.includes("BMI"))) {
    return [
      {
        title: "BMI 分類表",
        columns: ["BMI 數值", "BMI 分類等級"],
        rows: [
          ["小於 18.5", "體重過輕"],
          ["18.5～24.9", "正常範圍"],
          ["25.0～29.9", "體重過重"],
          ["30.0～34.9", "輕度肥胖"],
          ["35.0～39.9", "中度肥胖"],
          ["40.0 以上", "重度肥胖"],
        ],
      },
    ];
  }

  if (title.includes("幸運號碼大樂透") && (sourceId === "27" || sourceId === "39" || description.includes("幸運號碼"))) {
    return [
      {
        title: "中獎獎金規則",
        columns: ["對中號碼的數量", "獎金金額"],
        rows: [
          ["5 個", "100,000"],
          ["4 個", "10,000"],
          ["3 個", "2,000"],
          ["2 個", "500"],
          ["1 個", "200"],
          ["0 個", "0"],
        ],
      },
    ];
  }

  if (title.includes("幸運數字彩虹樂透") && sourceId === "29") {
    return [
      {
        title: "中獎規則與獎金",
        columns: ["猜中號碼個數", "獎金"],
        rows: [
          ["6 個", "100,000"],
          ["5 個", "10,000"],
          ["4 個", "1,000"],
          ["3 個", "100"],
          ["2 個", "0"],
          ["1 個", "0"],
          ["0 個", "0"],
        ],
      },
    ];
  }

  if (title.includes("我的健康小管家") && (sourceId === "30" || sourceId === "42" || description.includes("BMR"))) {
    return [
      {
        title: "BMR 能量分類表",
        columns: ["BMR 數值（大卡）", "分類"],
        rows: [
          ["小於 1,200", "極低能量"],
          ["1,200～1,499", "較低能量"],
          ["1,500～1,799", "標準能量"],
          ["1,800～2,099", "較高能量"],
          ["2,100 以上", "極高能量"],
        ],
      },
    ];
  }

  if (title.includes("東台線上 3C 購物平台") && sourceId === "31") {
    return [
      {
        title: "商品編號與金額",
        columns: ["編號", "金額"],
        rows: [
          ["1", "3,490"],
          ["2", "7,990"],
          ["3", "3,990"],
          ["4", "2,590"],
          ["5", "6,890"],
          ["6", "3,490"],
          ["7", "1,490"],
        ],
      },
    ];
  }

  if (title.includes("寶可夢聯盟大挑戰") && sourceId === "79") {
    return [
      {
        title: "戰技加成倍率",
        columns: ["攻擊力與防禦力比較", "戰技加成"],
        rows: [
          ["攻擊力 > 防禦力", "2"],
          ["攻擊力 = 防禦力", "3"],
          ["攻擊力 < 防禦力", "1"],
        ],
      },
    ];
  }

  return [];
}

export function getKnownStatementAddenda(problem: ProblemRichContentLike) {
  const title = problem.title || "";
  const sourceId = normalizeProblemSourceId(problem);
  if (title.includes("寶可夢聯盟大挑戰") && sourceId === "79") {
    return [
      "計算每隻寶可夢的戰鬥力後，請輸出戰鬥力第二高的寶可夢資料，格式為：名稱 攻擊力 防禦力 戰鬥力。題目測資保證戰鬥力不重複。",
    ];
  }
  return [];
}

function normalizeProblemSourceId(problem: ProblemRichContentLike) {
  const raw = String(problem.sourceId || problem.id || "");
  const direct = raw.replace(/^0+/, "");
  if (/^\d+$/.test(direct)) {
    return direct;
  }
  const match = raw.match(/(?:^|-)(\d+)$/);
  return match ? match[1].replace(/^0+/, "") || "0" : "";
}

function normalizeTableRow(value: unknown, columns: string[]) {
  if (Array.isArray(value)) {
    return value.map((item) => readText(item));
  }
  if (isRecord(value)) {
    return columns.map((column) => readText(value[column]));
  }
  return [];
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => readText(item)).filter(Boolean);
}

function readText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}
