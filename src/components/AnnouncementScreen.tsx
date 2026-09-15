import { LogIn, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { APP_TITLE } from "../app/constants";
import { PLATFORM_MODE_LABELS } from "../services/platformStore";
import type { AppUser, PlatformState } from "../types";
import { GuishanIslandIcon } from "./ui";

interface AnnouncementScreenProps {
  platform: PlatformState;
  user: AppUser | null;
  loginBusy: boolean;
  onGoogleLogin: () => void;
  onLogout: () => void;
  /** 競賽模式時放競賽帳號登入表單（階段 1.5）。 */
  children?: ReactNode;
}

/**
 * 競賽模式與維護模式下，非超管看到的畫面：只有公告，沒有任何功能入口。
 * 已登入的教師或學生會看到自己的名字與「帳號暫停使用」說明。
 */
export function AnnouncementScreen({
  platform,
  user,
  loginBusy,
  onGoogleLogin,
  onLogout,
  children,
}: AnnouncementScreenProps) {
  const isContest = platform.mode === "contest";
  return (
    <div className="app-shell announcement-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <GuishanIslandIcon />
          <div className="brand-text">
            <h1>{APP_TITLE}</h1>
            <span>{PLATFORM_MODE_LABELS[platform.mode]}</span>
          </div>
        </div>
        <div className="header-actions">
          {user ? (
            <div className="user-chip">
              {user.photoURL && <img src={user.photoURL} alt="" />}
              <span>{user.displayName}</span>
              <button className="icon-button" onClick={onLogout} title="登出">
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <button className="ghost-button" onClick={onGoogleLogin} disabled={loginBusy}>
              <LogIn size={17} />
              {loginBusy ? "登入中" : "管理者登入"}
            </button>
          )}
        </div>
      </header>

      <main className="announcement-main">
        <section className="announcement-card">
          <span className="status-pill">{PLATFORM_MODE_LABELS[platform.mode]}</span>
          <h2>{isContest ? "競賽進行中，練習平台暫停" : "平台維護中"}</h2>
          {platform.announcement ? (
            <p className="announcement-text">{platform.announcement}</p>
          ) : (
            <p className="muted">
              {isContest
                ? "教師與學生帳號在競賽期間無法使用，賽事結束後會自動恢復。"
                : "維護完成後會自動恢復，請稍後再試。"}
            </p>
          )}
          {user && (
            <p className="muted">
              你目前以 {user.displayName} 登入，這個帳號在{PLATFORM_MODE_LABELS[platform.mode]}期間無法使用。
            </p>
          )}
        </section>
        {isContest && children}
      </main>
    </div>
  );
}
