/** 產生 CSV 文字並觸發下載。加 BOM 讓 Excel 直接以 UTF-8 開啟中文。 */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | undefined | null>>) {
  const lines = [header, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string | number | undefined | null) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvDateStamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
