# 115 程式解題手冊

115 年題庫共 70 題（宜蘭縣國小 25、宜蘭縣國中 25、全國賽國小 10、全國賽國中 10）的逐題解說，
附競賽平台可直接匯入的 Blockly XML 參考解答。

產出網站在 `public/solutions-115/`，隨網站一起部署在 `/solutions-115/index.html`，
不依賴外部字型、框架、CDN 或伺服器資料庫，可以離線開啟。
`solutions-115.zip` 包含 70 題的 XML。

## 來源與驗證

- 題庫來源：上層 `ilan_115_problems.json`、`national_115_elementary_problems.json`、
  `national_115_junior_problems.json`（與線上平台同一份題目與測資）。
- `notes.txt`：逐題人工撰寫的說明、拆解、實作、策略、主類別與核心概念（以 `|` 分欄）。
- `solutions.cjs`：每題演算法；`blockly-compiler.cjs` 轉成真實積木 XML，沒有執行任意程式碼積木。
- `validate.cjs` 使用平台相同的 Blockly 12 載入 XML、檢查沒有孤立積木、產生 JavaScript，
  再依平台的輸入拆詞與輸出空白正規化方式比對題庫測資。
- 目前 70 題全部通過：70/70 匯入成功，350/350 筆測資相符（含隱藏測資）。

## 重建

在已安裝上層相依套件（blockly、typescript）的工作區中依序執行：

```bash
node solution-ebook-115/prepare.cjs
node solution-ebook-115/validate.cjs
node solution-ebook-115/build.cjs
```

`validate.cjs` 可以只重跑指定題號，例如 `node solution-ebook-115/validate.cjs 45 46`。
`show.cjs` 用來查看題目原文，例如 `node solution-ebook-115/show.cjs 1 8`。
重建後把 `dist/` 的內容複製回 `public/solutions-115/`，並重新壓縮 `solutions-115.zip`。
