import { Users } from "lucide-react";
import type { OnlinePresenceState } from "../../shared/sitePresence";

export function OnlineCountBadge({ presence }: { presence: OnlinePresenceState }) {
  const online = presence.status === "online" && presence.count !== null;
  const hint = online
    ? "目前在本站登入的帳號數，同帳號多個分頁只算一人；斷線後最晚約 2 分鐘移出統計。"
    : presence.status === "connecting" ? "正在連線取得線上人數。"
    : presence.status === "offline" ? "目前離線，恢復連線後會自動更新人數。"
    : "暫時無法取得線上人數，系統會自動重新連線。";
  return (
    <span className={`online-count${online ? " is-online" : ""}`} role="status" aria-atomic="true" title={hint}>
      <Users size={16} aria-hidden="true" />
      <span>線上</span>
      <strong>{online ? presence.count!.toLocaleString("zh-TW") : "—"}</strong>
      <span>人</span>
    </span>
  );
}
