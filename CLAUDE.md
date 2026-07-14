# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

台股／美股股票分析平台，由三個獨立子系統組成：

1. **股價分析網站 MVP**（`server.js` + `api-core.js` + `index.html`/`app.js`/`styles.css`）— 單檔股票查詢、財報健檢、均線買賣點，靜態前端 + 本機/雲端 API。
2. **每日股票投資秘書**（`stock_secretary.mjs`）— 讀取個人持股清單，產生 HTML 晨報。
3. **ETF 持股研究管線**（`etf_holdings.mjs`）— 每日抓取台股主動式／被動式 ETF 的申購買回清單（PCF），用於選股與資金流向研究。

三者共用 Node.js（`type: module`，無建置步驟，無框架），可獨立執行。

## Commands

```powershell
npm.cmd start                              # 啟動本機 API + 靜態網站 http://127.0.0.1:8787
node .\stock_secretary.mjs .\holdings.csv --market tw   # 產生台股晨報
node .\stock_secretary.mjs .\holdings.csv --market us   # 產生美股晚報
node .\etf_holdings.mjs                    # 抓當日 ETF 持股快照
node .\etf_holdings.mjs --date 115/07/10   # 抓指定公告日（民國年，僅部分投信支援回補）
```

無 lint／test／build script；`package.json` 只有 `start`。改動後以實際執行上述指令驗證（打對應 `/api/*` 端點或檢查 `reports/`、`data/` 輸出）。

## Architecture

### API 核心與雙重部署路徑

`api-core.js` 是所有股票資料 API 的實作（Yahoo/Google/MOPS/TWSE OpenAPI/FinMind），`handleRequest()` 是唯一入口，依 pathname 分派到 `/api/yahoo/:symbol`、`/api/google/:symbol`、`/api/mops/:symbol`、`/api/chips/:symbol`、`/api/stock/:symbol`（彙整版）。

- 本機執行：`server.js` 建立 Node HTTP server 呼叫 `handleRequest()`。
- Firebase Cloud Functions 部署：`functions/api-core.js` 是**手動維護的副本**，不是 import——修改 `api-core.js` 的 API 邏輯後必須同步複製到 `functions/api-core.js`，否則本機與雲端行為會分歧（見 `docs/cloud-functions-api.md`）。目前 Functions 部署被 Firebase Blaze 方案卡住，尚未上線。
- 前端（`index.html`/`app.js`/`styles.css`）另有一份存在 Supabase 表 `stock_analysis_projects`（見 `docs/supabase-page-deployment.md`）作為版本化備份，非即時同步。

### 資料來源與快取

- 價格／K 線：Yahoo Finance chart endpoint，台股依序嘗試 `.TW`/`.TWO`。
- 財報／月營收：TWSE OpenAPI（`REVENUE_ENDPOINTS`/`INCOME_ENDPOINTS`/`BALANCE_ENDPOINTS` 會依市場別 L/O/X 逐一嘗試）。
- 籌碼：FinMind API，需要 sponsor token 才能取得完整分點資料；token 讀取順序為 `FINMIND_TOKEN` 環境變數 → `config.local.json`（gitignored，本機專用，勿提交）。
- FinMind 分點資料是 parquet 格式，用 `parquetjs-lite` 解析；此套件**建議安裝在 Google Drive 同步資料夾之外**（例如 `%USERPROFILE%\.stock-mvp-deps`），避免雲端同步鎖檔案衝突，詳見 `docs/chips-api.md`。
- `api-core.js` 內有簡易 in-memory `cache`（`fetchJson`/`fetchText` 帶 TTL），重啟 process 即失效。

### 每日股票投資秘書

`stock_secretary.mjs` 讀 `holdings.csv`（欄位：`market`/`symbol`/`name`/`quantity`/`cost_basis`/`last_known_price`/`watch_tags`），依 `--market tw|us` 過濾，逐檔組 HTML 卡片（價格、K 線、FinMind 籌碼、Google News RSS 新聞摘要），輸出到 `reports/daily-{market}-YYYY-MM-DD.html` 與 `reports/latest-{market}.html`。`run_daily_stock_secretary.ps1`／`run_us_stock_secretary.ps1` 是 Windows 工作排程器進入點。`holdings.csv` 因 `.gitignore` 的 `*.csv` 規則不進版控，是本機個人資料。

### ETF 持股研究管線

`etf_holdings.mjs` 對每個 ETF 呼叫對應投信的 fetcher 函式，正規化後存到 `data/etf_holdings/{YYYY-MM-DD}/{股票代號}.json`（含 CSV，但 CSV 被 gitignore）。目前涵蓋 5 家投信、13 檔 ETF（統一、群益、野村、中信、元大），各投信端點是逆向工程得來，非官方公開 API，**新增或除錯投信端點前務必先讀 `docs/etf-holdings-research.md`**——裡面記錄了每家的認證方式（cookie 暖身／Incapsula／token 換發）、payload 格式與已知陷阱（例如中信 API 欄位名 `fundId` vs `fundNo` 不一致會導致 500、群益需要先取 cookie 才能過 Incapsula）。

- 各投信歷史查詢能力不同：統一、群益、野村、中信支援指定公告日回補；元大只回最新一日，無法回補歷史。
- 00983A（中信 ARK 創新）、00990A（元大 AI 新經濟）持股實際是美股，資料日期 T+1，代號格式與台股不同，做台股共識分析時需過濾。
- 排程：Windows 工作排程器「ETF持股每日快照」週一至五 18:00 執行 `run_etf_holdings.ps1`，記錄寫到 `data/etf_holdings/logs/run-YYYY-MM-DD.log`。

## Notes

- 全部 Windows 環境，腳本用 PowerShell（`.ps1`）與 Node ESM（`.mjs`/`.js` with `"type": "module"`）。
- 敏感設定只放 `config.local.json`（FinMind token）與 Windows 排程器，不寫入程式碼或提交到 git。
