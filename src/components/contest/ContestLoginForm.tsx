import { LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { loginWithContestAccount } from "../../services/authStore";
import { GraderError, hasGraderConfig } from "../../services/grader";

interface ContestLoginFormProps {
  onLoggedIn?: () => void;
}

/** 競賽模式登入頁上的帳號密碼表單（規格 8.3）。帳號由主辦單位列印分發。 */
export function ContestLoginForm({ onLoggedIn }: ContestLoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("請輸入帳號與密碼。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await loginWithContestAccount(username.trim(), password);
      onLoggedIn?.();
    } catch (caught) {
      setError(caught instanceof GraderError || caught instanceof Error ? caught.message : "登入失敗，請再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="announcement-card contest-login-form" onSubmit={handleSubmit}>
      <h3>參賽者登入</h3>
      <p className="muted">請使用帳號卡上的帳號與密碼登入。帳號格式例如 E-001（國小組）或 J-001（國中組）。</p>
      {!hasGraderConfig() && <p className="warning-text">尚未設定評分伺服器位址，暫時無法登入。</p>}
      <label className="admin-field">
        帳號
        <input
          id="contest-username"
          type="text"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value.toUpperCase())}
          placeholder="E-001"
          disabled={busy}
        />
      </label>
      <label className="admin-field">
        密碼
        <input
          id="contest-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </label>
      {error && <p className="warning-text">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy || !hasGraderConfig()}>
        <LogIn size={17} />
        {busy ? "登入中…" : "登入"}
      </button>
    </form>
  );
}
