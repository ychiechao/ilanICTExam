# 帳號旁線上人數

## 使用與統計口徑

- 登入後在練習、競賽及公告頁帳號旁顯示「線上 N 人」。
- 計算同一網站中有有效即時連線的登入帳號；各角色皆計入，未登入訪客不計。
- 同一 UID 多分頁只計一次；關閉其中一頁不會扣人，最後一頁離開才扣人。
- 正式站與預覽站依 Origin 分開；這不是賽事後台的五分鐘線上指標。
- 正常登出／關閉即時移除；斷網連線以 90 秒心跳期限及每 30 秒的清除檢查處理，最晚約兩分鐘移除。
- 未知、離線、初始化及故障顯示「—」；退避重連上限五分鐘。登入 Token 到期會重連取得新的 Token。

## 架構與安全

前端只建立一條根層級連線，切換題目、分頁或管理畫面不重建。
Worker 的 GET /presence 驗證允許的 Origin 及 Firebase ID Token；
Token 放在 WebSocket 子協定請求標頭，不放 URL，不回傳也不傳入 Durable Object。
每個允許的網站 Origin 對應一個 SQLite Durable Object，透過可休眠的 WebSocket 附件保存 UID、連線時間及 Token 有效期限，不保存姓名或 Email。
只廣播 {type: "online-count", count}，拒絕前端自行提交人數。每帳號最多十條分頁連線。
自動 ping/pong 用於心跳；排程清除 stale/expired 連線，空房間不再排程。
此功能不讀寫 Firestore、不修改 Firebase Rules，也不改動競賽評分或榜單口徑。

## 驗證與發布

前端：npm run test:presence、npm run test:leaderboard、npm run build。
Worker：npm run types、npm run check、npm test。
測試以本機產生的 RSA 金鑰及模擬 Google JWKS 驗證登入，禁止接觸正式帳號或 Firestore。
驗證多分頁去重、多角色、登出、網路中斷、重連、心跳逾時、休眠恢復、Token 到期、Origin 隔離及偽造訊息拒絕。
GitHub Actions 發布 Pages 與 Worker；第一次發布以 site-presence-v1 migration 建立 SQLite Durable Object。此資料不包含使用者名單。
需保留 SITE_PRESENCE binding 與 migration，並將允許的前端 Origin 列於 ALLOWED_ORIGINS。
