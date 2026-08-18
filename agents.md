# 投資股票分析（專案藍圖）

> 本檔為跨 Agent 通用的專案藍圖（AGENTS.md 開放標準）。任何 Agent 的每個 session 都應先讀本檔＋`handoff.md`。
> 技術細節（架構、API、資料來源、踩坑）請讀 `CLAUDE.md` 與 `docs/`，本檔不重複。

## 專案簡介

台股／美股股票分析平台，由三個可獨立執行的子系統組成，共用 Node.js（`type: module`，無建置步驟、無框架）：

1. **股價分析網站 MVP** — 單檔股票查詢、財報健檢、均線買賣點（`server.js` + `api-core.js` + 靜態前端）
2. **每日股票投資秘書** — 讀個人持股清單產生 HTML 晨報／晚報（`stock_secretary.mjs`）
3. **研究管線** — 每日抓 ETF 持股（PCF）與三大法人買賣超，做選股與資金流向研究（`etf_holdings.mjs`、`institutional_flows.mjs`）

目標：把選股所需的籌碼、法人、ETF 持股資料自動化收集並每日寄送分析報告，減少人工查詢。

## 關鍵時程

- 無固定 deadline，屬長期自用工具
- 每日排程（週一至五）：18:00 ETF 持股快照、18:30 三大法人快照，兩者皆自動寄送 email 報告

## 目標與路線圖

- [x] 階段一：股價分析網站 MVP（本機 API + 靜態前端）
- [x] 階段二：每日股票投資秘書（台股晨報 + 美股晚報，Windows 排程）
- [x] 階段三：ETF 持股研究管線（5 家投信、13 檔 ETF，每日快照）
- [x] 階段四：三大法人熱門股 + 5/20/60 成本線研究管線
- [x] 階段五：ETF 分析報告接入每日 email 自動寄送
- [ ] 階段六：Firebase Cloud Functions 上線（**卡在 Blaze 方案未升級**）
- [ ] 階段七：兩個每日排程搬到不關機的 Windows 電腦（筆電在 18:00 常睡眠，曾整天沒資料）。SOP 見 `deploy/搬遷步驟.md`
- [x] `api-core.js` → `functions/api-core.js` 的副本改由 `scripts/sync-api-core.mjs` 產生（`npm run sync:functions`／`check:functions`，並掛在 firebase `predeploy`），不再手動複製
- [ ] 待辦：元大投信端點只回最新一日，無法回補歷史，尚無解法

## 資料夾結構

```
投資股票分析/
├─ agents.md / handoff.md      本藍圖與交接檔（本次初始化新增）
├─ CLAUDE.md                   技術規範與架構說明（Agent 必讀）
├─ README.md
├─ api-core.js                 所有股票 API 實作，handleRequest() 為唯一入口
├─ server.js                   本機 HTTP server
├─ index.html / app.js / styles.css   靜態前端
├─ stock_secretary.mjs         每日投資秘書
├─ etf_holdings.mjs            ETF 持股抓取
├─ etf_analysis.mjs            ETF 持股分析報告
├─ institutional_flows.mjs     三大法人資料抓取
├─ institutional_analysis.mjs  三大法人分析報告
├─ run_*.ps1                   Windows 工作排程器進入點（4 支）
├─ scripts/sync-api-core.mjs   把 api-core.js 同步到 functions/（--check 只驗證）
├─ deploy/                     排程搬遷 SOP（搬遷步驟.md）與工作排程器匯出檔（*.xml）
├─ config.local.json           FinMind token、Gmail app password（gitignored）
├─ data/
│  ├─ etf_holdings/{YYYY-MM-DD}/{代號}.json
│  └─ institutional/{YYYY-MM-DD}/twse.json
├─ reports/                    產出的 HTML／txt 報告
├─ docs/                       chips-api、etf-holdings-research、cloud-functions-api 等
├─ functions/                  Firebase Cloud Functions（api-core.js 為自動產生副本，勿手改）
└─ firebase-public/
```

## 同步層級（本專案初始化至第 3 層級）

| 層級 | 平台 | 位置 | 讀取時機 |
|------|------|------|---------|
| L1 | 本地（GDrive） | `agents.md`＋`handoff.md` | 每個 session |
| L2 | GitHub | [hsuyiping-rgb/stock-analysis-mvp](https://github.com/hsuyiping-rgb/stock-analysis-mvp)（私有） | 指定時 |
| L3 | Obsidian | `投資股票分析/專案工作流程.md` | 有需要時 |

## 工作約定

- 任何 Agent、任何電腦：**開工先讀 `handoff.md`，收工必更新 `handoff.md`**
- 修改共用檔案前先讀最新內容，避免覆蓋其他 Agent 的變更
- 所有回應與文件使用繁體中文
- 修改前先確認計畫，優先保留原有資料結構
- **絕對路徑務必含「AI作品」這層**：`G:\我的雲端硬碟\AI作品\投資股票分析`（排程曾因漏這層而失效）
- 敏感設定只放 `config.local.json` 與 Windows 排程器，不寫入程式碼、不提交 git
- 改 `api-core.js` 的 API 邏輯後，跑 `npm run sync:functions` 同步到 `functions/api-core.js`（提交前可用 `npm run check:functions` 驗證）
- 新增或除錯投信端點前，**務必先讀 `docs/etf-holdings-research.md`**
