# shared/

前端（`src/`）與 Worker（`worker/src/`）共用的純函式，不可依賴瀏覽器或 Workers 專屬 API。

階段 2 會把以下邏輯搬進來：

- `problemImport.ts`：bdesigner JSON → 題目結構的轉換
- `runner.ts`：執行學生程式的 `prompt` / `alert` / `console` 代理與輸出正規化
