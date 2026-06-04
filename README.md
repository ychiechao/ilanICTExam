# 宜蘭縣資訊科技創意實作競賽

純前端計分 MVP。此版本以 Cloudflare Pages 部署 React/Vite 前端，Firebase Spark 只用於 Google 登入與 Firestore 紀錄保存。評分、測資比對、排行榜更新都在前端完成。

## 功能

- Blockly / Scratch 風格解題工作區
- 題目說明、自行測試、正式計分、評分紀錄、排行榜
- Blockly XML 自動保存到 localStorage
- Firebase Google Sign-In
- Firestore 題目匯入、提交紀錄、個人最佳紀錄、排行榜快取
- 無 Firebase 設定時可用 localStorage 示範模式

## 本機啟動

```bash
npm install
npm run dev
```

## 建置

```bash
npm run build
```

建置輸出在 `dist`。

## Cloudflare Pages 設定

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: Cloudflare 預設可用即可

若使用 Wrangler Direct Upload，可用：

```bash
npx wrangler pages deploy dist --project-name ilanictexam
```

需要先登入 Cloudflare 或設定 `CLOUDFLARE_API_TOKEN`。

## Firebase 環境變數

複製 `.env.example` 為 `.env.local`，填入 Firebase Web config：

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Cloudflare Pages 上線時，也要把以上變數加入 Pages 專案的 Environment variables。

## Firebase Console 設定

1. 啟用 Authentication 的 Google Sign-In。
2. 在 Authentication 的 Authorized domains 加入 Cloudflare Pages 網域。
3. 建立 Firestore Database。
4. 將 `firestore.rules` 內容貼到 Firestore Rules 並發布。

## 免費方案提醒

此 MVP 不使用 Cloudflare Workers、Pages Functions、Firebase Cloud Functions、Firebase Storage，也不需要 Firebase Blaze。正式排名與防作弊能力有限，hidden 測資只做介面隱藏，不代表真正保密。
