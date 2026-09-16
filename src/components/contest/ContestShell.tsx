import { LogOut } from "lucide-react";
import { APP_TITLE } from "../../app/constants";
import type { AppUser, PlatformState } from "../../types";
import { GuishanIslandIcon } from "../ui";

interface ContestShellProps {
  platform: PlatformState;
  user: AppUser;
  onLogout: () => void;
}

/**
 * 競賽帳號登入後的外框：頂欄顯示賽事、參賽者、公告與登出。
 * 作答區（題目、積木、提交）在階段 2 放進來；目前先顯示登入成功的資訊。
 */
export function ContestShell({ platform, user, onLogout }: ContestShellProps) {
  return (
    <div className="app-shell contest-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <GuishanIslandIcon />
          <div className="brand-text">
            <h1>{APP_TITLE}</h1>
            <span>競賽模式 · {user.contestId}</span>
          </div>
        </div>
        <div className="header-actions">
          <div className="user-chip">
            <span>
              {user.contestUsername} {user.displayName}
            </span>
            <button className="icon-button" onClick={onLogout} title="登出">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>

      {platform.announcement && <div className="platform-banner">{platform.announcement}</div>}

      <main className="announcement-main">
        <section className="announcement-card">
          <span className="status-pill">已登入</span>
          <h2>{user.displayName}，歡迎參加比賽</h2>
          <p className="muted">
            帳號 {user.contestUsername}。作答畫面將在賽事開始時開放；請不要關閉這個視窗。
          </p>
        </section>
      </main>
    </div>
  );
}
