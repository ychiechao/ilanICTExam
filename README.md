# 宜蘭縣資訊科技創意實作競賽平台

Blockly／Scratch 積木程式解題平台，v3.0 起有兩種模式：

- **練習模式**（平時）：老師開班、學生用 Google 帳號解題，班級／學校／全縣三層排行。
- **競賽模式**（賽事當天）：主辦單位匯入競賽帳號與題庫，參賽者用印製帳號登入，Cloudflare Worker 在伺服器端評分；另有「演練賽」可在練習模式下開放測試帳號。

- 正式站：https://ilanictexam.pages.dev（`main`）
- 預覽站：https://v3-dev.ilanictexam.pages.dev（`v3-dev`）
- 規格：[software-spec-v3.md](software-spec-v3.md)（第 17 章為實作差異）；實作計畫：[implementation-plan.md](implementation-plan.md)

## 架構

| 部分 | 內容 |
| --- | --- |
| 前端 `src/` | React 19 + TypeScript + Vite 7 + Blockly 12；Firebase Auth（Google／自訂 token）+ Firestore |
| Worker `worker/` | Cloudflare Worker `ilanictexam-grader`：競賽登入、評分（JS-Interpreter）、帳號／題庫匯入、審核、賽事管理；KV `CONTEST_CASES`（測資）、`PASSWORDS`（密碼雜湊） |
| 共用 `shared/` | 題庫匯入解析、評分比對邏輯（前端與 Worker 共用） |
| Firestore | `firestore.rules`、`firestore.indexes.json`（`firebase.json` 指向） |
| 工具 `scripts/` | `firestore-admin.mjs get|set|merge|delete|hash`（用服務帳號直接讀寫 Firestore，測試與救援用） |

## 本機開發

前置：Node 20+，`.env.local`（Firebase Web 設定 + `VITE_GRADER_URL=http://127.0.0.1:8787`），`worker/.dev.vars`（`ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`、`FIREBASE_SERVICE_ACCOUNT_B64=<服務帳號 JSON 的 base64>`）。這兩個檔案都不進版本控制。

```bash
npm install
npm run dev                 # 前端 http://localhost:5173
cd worker && npx wrangler dev   # Worker http://127.0.0.1:8787（本機 KV 與正式 KV 分開）
```

型別檢查：`npx tsc --noEmit -p tsconfig.json`（前端）、`cd worker && npx tsc --noEmit -p tsconfig.json`（Worker）。

## 部署

```bash
npx wrangler deploy --config worker/wrangler.jsonc                       # Worker
npx vite build && npx wrangler pages deploy dist --project-name ilanictexam --branch main    # 正式站
npx vite build && npx wrangler pages deploy dist --project-name ilanictexam --branch v3-dev  # 預覽站
npx firebase deploy --only firestore                                      # Rules 與索引（兩站共用同一專案）
```

Windows PowerShell 5.1 不支援 `&&`，且預設擋 `npx.ps1`：請一行一個指令並改用 `npx.cmd`。

Worker 的 `wrangler.jsonc` 中 `ALLOWED_ORIGINS` 要包含前端網址；密鑰 `FIREBASE_SERVICE_ACCOUNT_B64` 用 `npx wrangler secret put` 設定。

## 主要目錄

```
src/App.tsx                    入口：平台模式、登入、練習模式主畫面
src/components/admin/          後台：平台狀態、儀表板、成績審核、賽事、競賽帳號、競賽題庫、學校、題目、使用者
src/components/contest/        參賽者：登入、作答區、全螢幕軟鎖、演練賽入口
src/components/panels/         練習模式：題目說明、測試、評分、紀錄、排行榜、帳號、我的班級
src/services/                  Firestore／Worker 存取層
public/solutions/              114 程式解題手冊（靜態網頁，部署後在 /solutions/index.html，教師「我的班級」提供連結）
worker/src/routes/             Worker 路由（login、grade、contestAccounts、contestProblems、contestAdmin、contestReview、board）
```
