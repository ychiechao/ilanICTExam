

export function formatManagedTimestamp(value: unknown) {
  if (!value) {
    return "-";
  }
  if (typeof value === "string") {
    return formatDateTime(value);
  }
  if (typeof value === "object" && value && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toLocaleString("zh-TW");
  }
  if (typeof value === "object" && value && "seconds" in value) {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000).toLocaleString("zh-TW");
    }
  }
  return "-";
}

export function formatDateTime(value: string | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-TW");
}

export function formatDuration(ms: number | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} 小時 ${minutes} 分 ${seconds} 秒`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${seconds} 秒`;
  }
  return `${seconds} 秒`;
}

export function formatProblemStatusSummary(completedTitles: string[], attemptedTitles: string[], untouchedCount: number) {
  const parts: string[] = [];
  if (completedTitles.length > 0) {
    parts.push(`完成：${summarizeTitles(completedTitles)}`);
  }
  if (attemptedTitles.length > 0) {
    parts.push(`未滿分：${summarizeTitles(attemptedTitles)}`);
  }
  if (untouchedCount > 0) {
    parts.push(`未作答：${untouchedCount} 題`);
  }
  return parts.join("；") || "-";
}

export function summarizeTitles(titles: string[]) {
  const preview = titles.slice(0, 3).join("、");
  return titles.length > 3 ? `${preview} 等 ${titles.length} 題` : preview;
}


export function formatDateTimeInputValue(value: string | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 16);
  }
  const localTime = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

export function formatContestDateTime(value: string | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-TW");
}
