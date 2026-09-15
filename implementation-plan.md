# v3.0 分階段實作拆解

對應規格書 v3.0（`software-spec-v3.md`）。每個階段列出：目標、工作項目（含會動到的檔案）、Rules 變更、驗證方式、風險，以及需要你先確認的決策點。時程以「工作天」粗估，指一個人專注實作的天數，含自測，不含等待部署或現場測試。

## 總覽

| 階段 | 內容 | 粗估 | 縣賽前必要 |
| --- | --- | --- | --- |
| 0 | 環境整理：git、目錄、Firebase 服務帳號、Worker 專案骨架 | 1 天 | 是 |
| 1 | 平台模式開關、Rules 模式檢查、Worker 基礎（token 驗證與簽發、`/login`、`/time`）、稽核紀錄 | 4 天 | 是 |
| 2 | 競賽核心：帳號匯入、題庫匯入、`/grade` 評分、作答頁、排行榜、壓測 | 7 天 | 是 |
| 3 | 儀表板、投影畫面、審核與作廢、匯出、異常事件、賽後複製題庫 | 4 天 | 審核與儀表板是 |
| 4 | 練習模式升級：三層排行、教師批次登記、進度表、班級編輯、回填工具 | 4 天 | 否 |
| 合計 | | 約 20 天 | |

階段 0 → 1 → 2 → 3 有依賴關係必須依序；階段 4 只依賴階段 1 的 Rules 改動，可以在階段 2 之後任何時間插入，或由另一人並行。

## 階段 0：環境整理

### 目標

讓專案有一個乾淨的、可提交的起點，並準備 Worker 需要的外部資源。

### 現況問題

1. **專案的 `.git` 是空目錄，不是有效的 repo。** git 實際上被 `C:\Users\chiechao\.git`（家目錄裡一個沒有任何 commit 的意外 repo）接管，所以 `git status` 列出整個家目錄。
2. 專案根目錄有三個舊副本：`c3-branch-work/`、`deploy-main-work/`、`ilanICTExam-ready/`，前兩個的 `.git` 擁有者是另一個 Windows 使用者，目前帳號無法操作。
3. `.gitignore` 已排除 `dist/`、log、題庫來源檔，但沒有排除上述三個子目錄。

### 工作項目

| # | 項目 | 說明 |
| --- | --- | --- |
| 0.1 | 修復 git | 刪掉空的 `.git` 目錄，在專案內 `git init`，把目前狀態提交為 baseline 並打 tag `v2.0` |
| 0.2 | 三個子目錄 | 建議整個移出專案目錄（例如搬到 `Documents/舊版備份/`），或加進 `.gitignore`。需要你決定 |
| 0.3 | 家目錄的 `.git` | 建議刪除 `C:\Users\chiechao\.git`，否則任何家目錄下的資料夾都會被它接管。需要你決定 |
| 0.4 | Firebase 服務帳號 | Firebase Console → 專案設定 → 服務帳號 → 產生新私密金鑰。只放進 Worker secret，不進 repo |
| 0.5 | Worker 專案骨架 | 在同一 repo 建 `worker/`：`wrangler.toml`、`src/index.ts`、`package.json`、`tsconfig.json`。建立三個 KV namespace：`CONTEST_CASES`、`PASSWORDS`、`LOCKS` |
| 0.6 | 共用程式碼目錄 | 建 `shared/`，放前端與 Worker 都要用的純函式（題庫轉換、輸出正規化、執行器）。兩邊 `tsconfig` 都 include 它 |
| 0.7 | 環境變數 | `.env.example` 加 `VITE_GRADER_URL`；`wrangler.toml` 加 `FIREBASE_PROJECT_ID` |

### 驗證

- `git log` 有一個 commit，`git status` 只列專案內的變更。
- `npm run build` 成功。
- `cd worker && npx wrangler dev` 啟動，`GET /time` 回傳 JSON。

## 階段 1：平台模式與 Worker 基礎

### 目標

超管可以切換模式；競賽模式下教師與學生被 Rules 擋住；Worker 能驗證 Firebase ID token、簽發自訂 token、處理競賽帳號登入。這個階段結束時還沒有題目與評分，但「誰能進來」已經確定。

### 工作項目

**前端**

| # | 項目 | 檔案 |
| --- | --- | --- |
| 1.1 | `PlatformState` 型別與 `platformStore.ts`：`subscribePlatform(cb)`、`savePlatformState()`、切換前檢查 | `src/types.ts`、新 `src/services/platformStore.ts` |
| 1.2 | App 頂層訂閱模式，依模式與身分決定畫面：`practice` 走現有流程；`contest` 與 `maintenance` 時，超管進後台，其他人只看 `AnnouncementPanel` | `src/App.tsx` |
| 1.3 | **拆分 `App.tsx`**：4615 行的單一檔案在後面每個階段都會被大量修改。建議在這裡先把 `AdminPanel`、`ClassesPanel`、`AccountPanel`、`LeaderboardPanel`、各 `EditorForm` 與工具函式拆到 `src/components/` 與 `src/utils/`。純搬移不改行為 | `src/App.tsx` → 約 10 個新檔案 |
| 1.4 | 後台「平台狀態」區塊：模式選擇、多選賽事、公告文字、切換前檢查結果、確認對話框 | `src/components/admin/PlatformSection.tsx` |
| 1.5 | 競賽帳號登入表單：競賽模式下登入頁顯示帳號密碼欄位，送 `/login`，用 `signInWithCustomToken` 登入；token 到期前呼叫 `/refresh` | `src/services/authStore.ts`、`src/components/ContestLogin.tsx` |
| 1.6 | `auditStore.ts`：`writeAuditLog(action, targetType, targetId, summary)`；平台切換與賽事狀態變更先接上 | 新 `src/services/auditStore.ts` |
| 1.7 | 移除 v2.0 名單相關 UI：`rosterCsv`、`previewRosterImport`、`saveRosterEntries`、`contestRoster` 集合、`schoolAccounts` 分頁 | `src/App.tsx`、`src/services/schoolStore.ts` |

**Worker**

| # | 項目 | 檔案 |
| --- | --- | --- |
| 1.8 | 路由骨架、CORS、錯誤格式統一（`{ ok, code, message }`） | `worker/src/index.ts`、`worker/src/router.ts` |
| 1.9 | 服務帳號 JWT：用 WebCrypto RS256 簽 JWT 換 Google OAuth access token（快取 50 分鐘） | `worker/src/google/serviceAccount.ts` |
| 1.10 | Firestore REST 客戶端：`getDoc`、`setDoc`、`runQuery`、`batchWrite`，含 Firestore 值型別轉換 | `worker/src/google/firestore.ts` |
| 1.11 | Firebase ID token 驗證：抓 `securetoken@system.gserviceaccount.com` 公鑰（依 `Cache-Control` 快取）、驗簽章、`aud`、`iss`、`exp` | `worker/src/auth/verifyIdToken.ts` |
| 1.12 | 自訂 token 簽發：RS256、`uid = contest_{contestId}_{username}`、claims 含 `accountType`、`contestId`、`username`、`schoolId`、`displayName` | `worker/src/auth/customToken.ts` |
| 1.13 | `/login`：查 `contestAccounts`、KV 取雜湊比對（PBKDF2-SHA256，見決策點）、檢查模式與賽事啟用、寫 `firstLoginAt`、依帳號限速 | `worker/src/routes/login.ts` |
| 1.14 | `/refresh`：驗現有 ID token、檢查賽事仍啟用、重簽 | `worker/src/routes/refresh.ts` |
| 1.15 | `/time` | `worker/src/routes/time.ts` |

**Rules**

| # | 變更 |
| --- | --- |
| 1.16 | 新增 `mode()`、`isContestAccount(contestId)`、`inPractice()` 函式 |
| 1.17 | `settings/platform`：任何人可讀，超管可寫 |
| 1.18 | `problems`、`submissions`、`userProblemStats`、`classes`、`classMembers`、`classSubmissionViews`、`leaderboards`：每條 `allow` 前面加 `inPractice() || isSuperAdmin()`，並排除 `accountType == "contest"` |
| 1.19 | `contestAccounts`：超管可讀，客戶端不可寫 |
| 1.20 | `auditLogs`：超管可讀、可建立，不可改刪 |

### 驗證

- 超管切到 `contest`，另一個瀏覽器的學生畫面 2 秒內變成公告頁。
- 學生在競賽模式下用 DevTools 直接對 `submissions` 做 `addDoc`，收到 `permission-denied`。
- 手動在 Firestore 建一筆 `contestAccounts` 與 KV 雜湊，用帳號密碼登入成功，`request.auth.token.contestId` 在 Rules 模擬器中可讀。
- 練習模式下 `/login` 回 403。
- 切換模式後 `auditLogs` 多一筆。

### 風險

- 拆檔（1.3）是純重構但範圍大，建議獨立成一個 commit，拆完先跑一次完整功能確認再往下。
- Firebase 自訂 token 的 `aud` 必須是 `https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit`，`iss`/`sub` 都是服務帳號 email，這幾個值錯了 `signInWithCustomToken` 只會回模糊錯誤，第一次接要留時間除錯。

## 階段 2：競賽核心

### 目標

完整跑通「匯入帳號 → 匯入題庫 → 參賽者登入 → 提交 → Worker 評分 → 排行榜」。這是縣賽的核心，也是最大的階段。

### 工作項目

**帳號**

| # | 項目 | 檔案 |
| --- | --- | --- |
| 2.1 | `contests` 型別擴充：`division`、`maxSubmissionsPerProblem`、`dashboard`、`accountCount`、`problemCount`、`casesSyncedAt`；`ContestEditorForm` 對應欄位 | `src/types.ts`、`src/components/admin/ContestEditorForm.tsx` |
| 2.2 | Worker `/contest-accounts/{contestId}`：解析 CSV（學校、姓名、備註）、產生 `E-001` 流水號（接續已有）、產生 8 碼密碼、PBKDF2 雜湊寫 KV、`contestAccounts` 批次寫入、回傳一次性明碼清單、寫 `auditLogs` | `worker/src/routes/contestAccounts.ts` |
| 2.3 | Worker `/reset-password`、`/contest-accounts/{id}/disable` | 同上 |
| 2.4 | 後台「競賽帳號」分頁：上傳與預覽、匯入結果、一次性清單下載 CSV、列印帳號卡（`@media print` 每張一格）、帳號列表（狀態、首次登入、裝置）、重設密碼、停用 | `src/components/admin/ContestAccountsSection.tsx`、`src/styles.css` |

**題庫**

| # | 項目 | 檔案 |
| --- | --- | --- |
| 2.5 | 把現有 `problemStore.ts` 裡 bdesigner JSON → `Problem` 的轉換抽到 `shared/problemImport.ts`，前端與 Worker 共用 | `shared/problemImport.ts`、`src/services/problemStore.ts` |
| 2.6 | Worker `/contest-problems/{contestId}`：轉換 → 拆公開部分與測資 → `contestProblems` 批次寫入、KV `cases:{contestId}:{problemId}`、更新 `contests.problemCount`、`casesSyncedAt`；賽事為 `active` 時拒絕 | `worker/src/routes/contestProblems.ts` |
| 2.7 | 後台「競賽題庫」分頁：上傳、結果摘要（題數、缺測資警告）、題目清單唯讀 | `src/components/admin/ContestProblemsSection.tsx` |

**評分**

| # | 項目 | 檔案 |
| --- | --- | --- |
| 2.8 | 把 `gradingWorker.ts` 的執行器（`prompt`/`alert`/`console` 代理、輸出截斷）與 `gradingEngine.ts` 的 `normalizeOutput`、`splitInputs` 抽到 `shared/runner.ts` | `shared/runner.ts`、`src/workers/gradingWorker.ts`、`src/services/gradingEngine.ts` |
| 2.9 | Worker `/grade`：驗 token → 讀 claims → 讀 `settings/platform` → 讀 `contests/{id}` 時段 → KV 計數器檢查次數 → KV 鎖 → 讀測資 → 逐筆執行 → 寫 `contestSubmissions` → 更新排行榜 entry → 重算儀表板快照 → 釋放鎖 | `worker/src/routes/grade.ts`、`worker/src/grading/` |
| 2.10 | 逾時隔離（見決策點 B）：每筆測資透過 service binding 自呼叫 `/run-case`，單筆無限迴圈被 CPU limit 砍掉時只影響那一筆 | `worker/src/routes/runCase.ts`、`worker/wrangler.toml` |
| 2.11 | 排行榜與儀表板計算：讀該場全部 entries（≤ 300 筆）在 Worker 內排序、產生快照 | `worker/src/grading/leaderboard.ts` |

**前端作答**

| # | 項目 | 檔案 |
| --- | --- | --- |
| 2.12 | `ContestPanel.tsx`：訂閱 `contestProblems`、倒數（`/time` 校正一次後用本機時鐘）、題目清單（最佳分、剩餘次數）、重用 `BlocklyWorkspace`、自行測試用範例測資（本機 Web Worker）、提交 → `/grade`、訂閱自己的 `contestSubmissions` | `src/components/contest/ContestPanel.tsx`、`src/services/contestSubmissionStore.ts` |
| 2.13 | 競賽模式下的頂欄：賽事名稱、姓名學校、倒數、公告、登出 | 同上 |

**Rules**

| # | 變更 |
| --- | --- |
| 2.14 | `contestProblems`：超管或 `isContestAccount(resource.data.contestId) && mode() == "contest"` 可讀；不可寫 |
| 2.15 | `contestSubmissions`：超管或 `resource.data.uid == request.auth.uid` 可讀；不可寫 |
| 2.16 | `contests`：競賽帳號可讀自己那一場（只用於前端顯示名稱與時段） |
| 2.17 | `leaderboards/contest/{id}/entries`、`contestDashboards`：暫時只有超管可讀（階段 3 再依 visibility 開放） |

**測試**

| # | 項目 |
| --- | --- |
| 2.18 | 壓測腳本 `scripts/loadtest.mjs`：建 200 個測試帳號、並發登入、每人每題提交 3 次、統計延遲與錯誤率 |
| 2.19 | CPU 量測：拿題庫中最重的 5 題（迴圈最多的）跑 `/grade`，記錄 Worker CPU 時間，決定免費或付費方案 |

### 驗證

- 匯入 3 個帳號後，Firestore 沒有任何密碼欄位；KV 有 3 筆雜湊。
- 匯入題庫後，`contestProblems` 文件裡搜不到隱藏測資的答案字串。
- 用帳號登入、提交一題，`contestSubmissions` 出現一筆，`createdAt` 是伺服器時間。
- 用 DevTools 對 `contestSubmissions` 做 `addDoc` 被拒。
- 提交一支無限迴圈程式，回傳逾時，其他測資照常評分（若採決策點 B 的隔離）。
- 第 11 次提交同一題被拒。
- 5 秒內連續提交兩次，第二次被限速。
- 國小組帳號嘗試讀國中組 `contestProblems` 被拒。
- 壓測 200 人並發，錯誤率 < 1%，p95 延遲可接受。

### 風險

- **CPU 時間**是這個階段最大的不確定因素。Workers 免費方案每次請求 CPU 10 ms，Blockly 產生的程式跑一筆有迴圈的測資很可能超過。建議一開始就以 Workers Paid（每月 5 美元，CPU 30 秒）規劃，2.19 量測只是確認。
- 服務帳號寫 Firestore 每次都是 REST 呼叫，一次提交約 6–8 次往返（讀 platform、contest、計數、寫提交、寫 entry、寫快照）。200 人同時提交沒問題，但儀表板快照重算若改成每次全量重寫，可能成為熱點；可加 KV 節流（每 3 秒最多重算一次）。

## 階段 3：儀表板、審核、稽核

### 目標

主辦單位在賽事期間有畫面可看、可對外投影；賽後能審核、作廢、匯出；有異常事件可查。

### 工作項目

| # | 項目 | 檔案 |
| --- | --- | --- |
| 3.1 | 超管儀表板頁：訂閱 `contestDashboards/{id}`，顯示總覽、排行、學校統計、各題狀態、最近提交；兩場並排或切換 | `src/components/admin/DashboardSection.tsx` |
| 3.2 | `visibility` 開關：寫 `contests.dashboard.visibility` + `auditLogs`；產生或作廢 `boardToken` | 同上 |
| 3.3 | 參賽者端「儀表板」分頁：依 visibility 顯示或隱藏；`showNames` 為 false 時只顯示學校與帳號 | `src/components/contest/ContestDashboardTab.tsx` |
| 3.4 | Worker `/board/{contestId}?token=`：回傳自包含 HTML（內嵌快照 JSON，每 10 秒 `fetch` 同一端點的 `?format=json` 更新） | `worker/src/routes/board.ts` |
| 3.5 | 審核頁：該場全部 `contestSubmissions` 依人彙總、異常標記（`codeHash` 重複、結束前 60 秒提交、`contestEvents` 計數）、單筆作廢對話框 → `/void`、匯出 CSV | `src/components/admin/ReviewSection.tsx` |
| 3.6 | Worker `/void`：標記 `voided`、重算該人 entry 與快照、寫 `auditLogs` | `worker/src/routes/void.ts` |
| 3.7 | `contestEvents` 前端 hook：`visibilitychange`、`paste`（積木區外）、XML 匯入、提交；Worker 在 `/login` 寫 `login` 與 `fingerprint_changed` | `src/hooks/useContestEvents.ts`、`worker/src/routes/login.ts` |
| 3.8 | Worker `/release/{contestId}`：KV 測資 + `contestProblems` → `problems`（`status: draft`、`sourceContestId`）；寫 `contests.releasedToPractice` | `worker/src/routes/release.ts` |
| 3.9 | 賽事狀態與模式連動：切回 practice 時 `active` → `ended`；`archived` 時批次停用該場帳號 | `src/services/platformStore.ts`、`src/services/contestStore.ts` |

**Rules**

| # | 變更 |
| --- | --- |
| 3.10 | `contestDashboards`、`leaderboards/contest`：依 `contests/{id}.dashboard.visibility` 開放給 `participants` 或所有已登入 |
| 3.11 | `contestEvents`：本人可建立（`uid`、`createdAt == request.time`），超管可讀，不可改刪 |

### 驗證

- 切 visibility 到 `participants`，參賽者畫面 2 秒內出現儀表板分頁；切回後消失。
- `/board` 不登入可開；作廢 token 後回 403。
- 作廢一筆滿分提交後，該人排行下降，快照更新。
- 匯出 CSV 欄位與規格書 8.8 一致。
- 參賽者切換分頁三次，`contestEvents` 有三筆。
- `/release` 後練習題庫多出草稿題，發布後可用前端評分正常作答。

## 階段 4：練習模式升級

### 目標

教師與學生的日常功能：三層排行、批次登記、進度表。與縣賽無關，可獨立排程。

### 工作項目

| # | 項目 | 檔案 |
| --- | --- | --- |
| 4.1 | `userStats` 型別與 `userStatsStore.ts`：提交後更新自己的彙總（總分、完成數、`problemScores`、`schoolId`、`classIds`） | `src/types.ts`、新 `src/services/userStatsStore.ts`、`src/services/submissionService.ts` |
| 4.2 | 三層排行查詢：班級（`classIds array-contains`）、校（`schoolId ==`）、縣（全部），各依 `totalScore desc, completedCount desc, lastSubmittedAt asc`；`LeaderboardPanel` 改三個 tab 與班級切換 | `src/services/leaderboardService.ts`、`src/components/LeaderboardPanel.tsx` |
| 4.3 | 建立 Firestore 複合索引（`firestore.indexes.json`）：`schoolId + totalScore`、`classIds + totalScore` | `firestore.indexes.json`、`firebase.json` |
| 4.4 | 移除舊 `leaderboards/{problemId}` 寫入與 `updateGlobalLeaderboard` | `src/services/leaderboardService.ts` |
| 4.5 | 教師批次登記：貼上名單 → 前端解析 → `classMembers` 建 `pending`（含 `normalizedEmail`、`seatNumber`）；名單表格顯示已登入 / 尚未登入 | `src/components/ClassesPanel.tsx`、`src/services/classStore.ts` |
| 4.6 | 學生登入時認領：`claimPendingMemberships(user)` 查 `normalizedEmail == email && status == pending` → 寫 uid、改 active、`users.schoolId` 帶入 | `src/services/classStore.ts`、`src/services/authStore.ts` |
| 4.7 | 進度表：學生 × 題目矩陣、每格狀態、點開提交紀錄、上方統計、CSV 匯出 | `src/components/ClassesPanel.tsx` |
| 4.8 | 班級編輯：改名、封存；封存班級不出現在學生排行選項 | 同上 |
| 4.9 | 超管回填工具：掃 `classMembers` active → 補 `classSubmissionViews` 與 `userStats` | `src/components/admin/MaintenanceSection.tsx` |
| 4.10 | 清掉 `schoolStore.ts` 中 `schoolAccounts` 相關程式碼 | `src/services/schoolStore.ts` |

**Rules**

| # | 變更 |
| --- | --- |
| 4.11 | `userStats`：已登入可讀（練習模式），本人可寫自己的 |
| 4.12 | `classMembers`：教師可為自己班級 create `status == "pending"` 且無 `studentUid`；本人可 update `normalizedEmail == request.auth.token.email` 的 pending 文件，且只改 `studentUid`、`status`、`joinedAt` |

### 驗證

- 學生提交後 `userStats` 更新，三個排行榜排序正確。
- 教師貼 5 筆名單，其中 1 筆 Email 打錯；4 位學生 Google 登入後自動出現在班級，打錯的那筆維持「尚未登入」。
- 學生用代碼加入的班級也出現在班級排行選項。
- 進度表格數與學生數 × 題數一致，CSV 可開。

## 需要你先確認的決策點

| 編號 | 決策 | 我的建議 | 影響 |
| --- | --- | --- | --- |
| A | Cloudflare Workers 一開始就用 Paid 方案（每月 5 美元）？ | 是。免費 10 ms CPU 幾乎確定不夠跑迴圈題，等量測再升級只是多花一輪 | 階段 2 排程 |
| B | 每筆測資是否透過 service binding 隔離執行？ | 是。否則一筆無限迴圈會讓整次提交的其他測資也拿不到分數，學生會覺得不公平 | 階段 2 多約 1 天 |
| C | 密碼雜湊用 WebCrypto 內建的 PBKDF2-SHA256（10 萬次），而不是 bcrypt / Argon2？ | 是。Workers 沒有原生 bcrypt，PBKDF2 對 8 碼隨機密碼、單場賽事的用途已足夠 | 無 |
| D | Worker 放在同一 repo 的 `worker/` 目錄（monorepo）？ | 是。`shared/` 才能兩邊共用，一次 commit 同時改前端與 Worker | 階段 0 |
| E | 階段 1 一併拆分 `App.tsx`？ | 是。後面四個階段都會大改這個檔案，先拆可以讓每個 commit 的 diff 可讀 | 階段 1 多約 1 天 |
| F | 三個舊子目錄（`c3-branch-work` 等）移出專案？家目錄的 `.git` 刪除？ | 移出、刪除 | 階段 0 |
| G | 階段 4 的排程：縣賽後再做，還是與階段 2 並行？ | 縣賽日期決定。若還有兩個月以上，建議階段 2 之後先做階段 4 讓教師端早點用，再做階段 3 | 整體時程 |
| H | 帳號卡版面：每張 A4 幾張卡、要不要 QR code（掃了直接帶入帳號）？ | A4 八張、加 QR code 帶帳號不帶密碼 | 階段 2.4 |

## 每個階段的交付方式

- 每個階段結束提交一次 PR 等級的整理（若你要用 GitHub，我可以在階段 0 建 remote）。
- 每個階段完成後，我會用上面的「驗證」清單逐項跑過並回報結果，包含沒過的項目。
- 階段 2 結束時會給你壓測與 CPU 量測的實際數字，供決策 A 最終確認。
