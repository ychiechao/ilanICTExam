import { useEffect, useState } from "react";
import {
  PLATFORM_MODE_LABELS,
  getContestActivationWarnings,
  savePlatformState,
  validateContestActivation,
} from "../../services/platformStore";
import { ContestControlPanel } from "./ContestControlPanel";
import { writeAuditLog } from "../../services/auditStore";
import type { AppUser, ContestEvent, ContestStatus, PlatformMode, PlatformState } from "../../types";
import { getContestStatusLabel } from "../../utils/drafts";
import { formatContestDateTime } from "../../utils/format";
import { Metric } from "../ui";

interface PlatformSectionProps {
  platform: PlatformState;
  contests: ContestEvent[];
  currentUser: AppUser | null;
  busy: boolean;
  onStatus: (message: string) => void;
  onMoveContestStatus: (contest: ContestEvent, nextStatus: ContestStatus) => Promise<void> | void;
  onContestsChanged: () => void;
}

const MODE_DESCRIPTIONS: Record<PlatformMode, string> = {
  practice: "教師與學生正常使用，練習題、班級、排行榜全部開放。",
  contest: "教師與學生帳號失效，只有勾選賽事的競賽帳號可以登入作答。",
  maintenance: "所有人只看到公告，只有超級管理者能進入後台。",
};

/** 後台「平台狀態」：全站模式切換（規格第 4 章）。 */
export function PlatformSection({
  platform,
  contests,
  currentUser,
  busy,
  onStatus,
  onMoveContestStatus,
  onContestsChanged,
}: PlatformSectionProps) {
  const [mode, setMode] = useState<PlatformMode>(platform.mode);
  const [selectedContestIds, setSelectedContestIds] = useState<string[]>(platform.activeContestIds);
  const [announcement, setAnnouncement] = useState(platform.announcement);
  const [saving, setSaving] = useState(false);

  // 其他超管或另一個分頁改了模式時，把表單同步成最新狀態。
  // 已刪除的賽事 ID 直接從勾選清單拿掉（賽事清單載入後才判斷），儲存時就會一併清掉。
  useEffect(() => {
    setMode(platform.mode);
    setSelectedContestIds(
      contests.length > 0 ? platform.activeContestIds.filter((id) => contests.some((contest) => contest.id === id)) : platform.activeContestIds,
    );
    setAnnouncement(platform.announcement);
  }, [contests, platform.activeContestIds, platform.announcement, platform.mode]);

  const candidateContests = contests.filter((contest) => contest.status !== "archived");
  const activeContests = platform.activeContestIds
    .map((id) => contests.find((contest) => contest.id === id))
    .filter((contest): contest is ContestEvent => Boolean(contest));
  const blockers = mode === "contest" ? validateContestActivation(contests, selectedContestIds) : [];
  const warnings = mode === "contest" ? getContestActivationWarnings(contests, selectedContestIds) : [];
  const dirty =
    mode !== platform.mode ||
    announcement.trim() !== platform.announcement ||
    selectedContestIds.slice().sort().join(",") !== platform.activeContestIds.slice().sort().join(",");

  function toggleContest(contestId: string) {
    setSelectedContestIds((current) =>
      current.includes(contestId) ? current.filter((id) => id !== contestId) : [...current, contestId],
    );
  }

  async function handleSave() {
    if (mode === "contest" && blockers.length > 0) {
      onStatus(blockers[0]);
      return;
    }
    const nextLabel = PLATFORM_MODE_LABELS[mode];
    const confirmed = window.confirm(
      mode === "contest"
        ? `確定切換為${nextLabel}？教師與學生帳號會立即失效，所有線上使用者畫面會馬上改變。`
        : `確定切換為${nextLabel}？`,
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    try {
      const next: PlatformState = { mode, activeContestIds: selectedContestIds, announcement };
      await savePlatformState(next, currentUser);

      // 切回練習模式時，仍在「競賽中」的賽事自動結束（規格 4.4）。
      if (mode !== "contest") {
        for (const contest of activeContests) {
          if (contest.status === "active") {
            await onMoveContestStatus(contest, "ended");
          }
        }
      }

      await writeAuditLog(
        {
          action: "platform.mode",
          targetType: "platform",
          targetId: "platform",
          summary: `${PLATFORM_MODE_LABELS[platform.mode]} → ${nextLabel}${
            mode === "contest" ? `，啟用賽事：${selectedContestIds.join(", ")}` : ""
          }`,
        },
        currentUser,
      );
      onStatus(`已切換為${nextLabel}。`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "平台模式切換失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-section">
      <div className="section-title-row">
        <div>
          <h3>平台狀態</h3>
          <p>切換全站模式。切換後所有已登入使用者的畫面會即時跟隨，不需重新整理。</p>
        </div>
      </div>

      <div className="metric-row">
        <Metric label="目前模式" value={PLATFORM_MODE_LABELS[platform.mode]} />
        <Metric
          label="啟用中的賽事"
          value={activeContests.length > 0 ? activeContests.map((contest) => contest.title).join("、") : "無"}
        />
        <Metric label="最後變更" value={formatContestDateTime(platform.updatedAt) || "尚未設定"} />
      </div>

      <div className="platform-mode-options" role="radiogroup" aria-label="平台模式">
        {(Object.keys(PLATFORM_MODE_LABELS) as PlatformMode[]).map((key) => (
          <label key={key} className={mode === key ? "platform-mode-option active" : "platform-mode-option"}>
            <input type="radio" name="platform-mode" value={key} checked={mode === key} onChange={() => setMode(key)} />
            <span className="platform-mode-title">{PLATFORM_MODE_LABELS[key]}</span>
            <span className="muted">{MODE_DESCRIPTIONS[key]}</span>
          </label>
        ))}
      </div>

      {mode === "contest" && (
        <div className="admin-subsection">
          <h4>啟用的賽事</h4>
          {candidateContests.length === 0 ? (
            <p className="muted">還沒有可啟用的賽事，請先在「賽事管理」建立。</p>
          ) : (
            <div className="platform-contest-list">
              {candidateContests.map((contest) => (
                <label key={contest.id} className="platform-contest-item">
                  <input
                    type="checkbox"
                    checked={selectedContestIds.includes(contest.id)}
                    onChange={() => toggleContest(contest.id)}
                  />
                  <span className="platform-contest-title">{contest.title}</span>
                  <span className="muted">
                    {getContestStatusLabel(contest.status)} · 題目 {contest.problemCount ?? 0} · 帳號{" "}
                    {contest.accountCount ?? 0} · {contest.startAt ? formatContestDateTime(contest.startAt) : "未設定時段"}
                  </span>
                </label>
              ))}
            </div>
          )}
          {blockers.length > 0 && (
            <ul className="platform-check-list">
              {blockers.map((item) => (
                <li key={item} className="warning-text">
                  {item}
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="platform-check-list">
              {warnings.map((item) => (
                <li key={item} className="muted">
                  提醒：{item}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {platform.mode === "contest" && activeContests.length > 0 && (
        <ContestControlPanel
          contests={activeContests}
          currentUser={currentUser}
          busy={busy}
          onStatus={onStatus}
          onChanged={onContestsChanged}
        />
      )}

      <label className="admin-field">
        公告（顯示在所有使用者畫面頂端）
        <textarea
          rows={3}
          value={announcement}
          onChange={(event) => setAnnouncement(event.target.value)}
          placeholder="例如：115 年縣賽 10:00 開始，請各校於 9:40 前完成登入。"
        />
      </label>

      <div className="admin-file-actions">
        <button
          className="primary-button"
          onClick={handleSave}
          disabled={busy || saving || !dirty || (mode === "contest" && blockers.length > 0)}
        >
          {saving ? "切換中…" : `套用：${PLATFORM_MODE_LABELS[mode]}`}
        </button>
      </div>
    </section>
  );
}
