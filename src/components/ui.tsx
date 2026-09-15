import type { PracticeStats } from "../app/constants";
import { getPracticeStatusLabel } from "../utils/practice";

export function InfoBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="info-block">
      <span>{title}</span>
      <p>{body}</p>
    </div>
  );
}

export function GuishanIslandIcon() {
  return (
    <svg className="guishan-logo" viewBox="0 0 96 72" role="img" aria-label="可愛龜山島圖示">
      <path className="logo-sun" d="M78 15a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
      <path className="logo-ray" d="M70 1v7M70 22v7M56 15h7M77 15h7M60 5l5 5M75 20l5 5M80 5l-5 5M65 20l-5 5" />
      <path className="logo-wave" d="M5 58c7-6 14-6 21 0s14 6 21 0 14-6 21 0 14 6 23 0" />
      <path className="logo-wave logo-wave-soft" d="M13 66c7-5 13-5 20 0s13 5 20 0 13-5 20 0" />
      <path
        className="logo-island"
        d="M16 49c2-12 11-22 24-25 9-2 19 1 25 8 8 1 14 6 16 15 1 4-2 8-7 8H23c-5 0-8-2-7-6Z"
      />
      <path className="logo-shell" d="M31 43c6-6 21-7 30 0-7 5-22 5-30 0Z" />
      <circle className="logo-eye" cx="62" cy="39" r="2.3" />
      <path className="logo-smile" d="M66 44c3 3 7 3 10 0" />
      <path className="logo-cheek" d="M74 39c2 1 3 3 2 5" />
    </svg>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


export function PracticeStatusBadge({
  stats,
  compact = false,
}: {
  stats?: PracticeStats;
  compact?: boolean;
}) {
  const status = stats?.status || "not-started";
  return (
    <span className={`practice-status-badge ${status} ${compact ? "compact" : ""}`}>
      {getPracticeStatusLabel(status)}
    </span>
  );
}
