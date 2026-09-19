import { ArrowLeft } from "lucide-react";
import { APP_TITLE } from "../../app/constants";
import type { ContestEvent, PlatformState } from "../../types";
import { GuishanIslandIcon } from "../ui";
import { ContestLoginForm } from "./ContestLoginForm";

interface RehearsalLoginScreenProps {
  platform: PlatformState;
  contests: ContestEvent[];
  onBack: () => void;
}

/**
 * 演練賽登入頁：練習模式下，首頁「模擬賽登入」按進來的畫面。
 * 登入成功後 App 會依 accountType 切到 ContestShell，與正式賽相同。
 */
export function RehearsalLoginScreen({ platform, contests, onBack }: RehearsalLoginScreenProps) {
  const rehearsal = platform.rehearsalContestIds
    .map((id) => contests.find((contest) => contest.id === id))
    .filter((contest): contest is ContestEvent => Boolean(contest));
  return (
    <div className="app-shell announcement-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <GuishanIslandIcon />
          <div className="brand-text">
            <h1>{APP_TITLE}</h1>
            <span>模擬賽</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={onBack}>
            <ArrowLeft size={17} />
            回練習平台
          </button>
        </div>
      </header>
      <main className="announcement-main">
        <section className="announcement-card">
          <span className="status-pill">模擬賽</span>
          <h2>{rehearsal.length === 1 ? rehearsal[0].title : "模擬賽練習"}</h2>
          <p className="muted">
            用主辦單位發的測試帳號登入，畫面與正式競賽完全相同（倒數、全螢幕、提交次數）。
            {rehearsal.length > 0 && `開放中：${rehearsal.map((contest) => contest.title).join("、")}。`}
          </p>
          {platform.announcement && <p className="announcement-text">{platform.announcement}</p>}
        </section>
        <ContestLoginForm />
      </main>
    </div>
  );
}
