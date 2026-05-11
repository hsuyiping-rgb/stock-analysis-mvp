# 股價投資分析買賣點網站 MVP

這是「單檔股票查詢 + 財報健檢 + 均線買賣點 + AI 報告」的 MVP，已加入本機後端 API。

## 啟動方式

```powershell
npm.cmd start
```

開啟網站：

```text
http://127.0.0.1:8787
```

## 後端 API

### Yahoo Finance

```text
GET /api/yahoo/:symbol
```

用途：股價、成交量、日線收盤價、5MA、10MA、20MA、60MA、股價更新時間。

範例：

```text
http://127.0.0.1:8787/api/yahoo/2357
http://127.0.0.1:8787/api/yahoo/AAPL
```

### Google Finance

```text
GET /api/google/:symbol
```

用途：後端查核 Google Finance 頁面、回傳查核連結、頁面標題、可解析時的價格文字。

注意：Google Finance 沒有穩定官方公開 API；此 adapter 只作查核與備援，不應作唯一行情來源。

範例：

```text
http://127.0.0.1:8787/api/google/2357
http://127.0.0.1:8787/api/google/NVDA
```

### MOPS / TWSE OpenAPI

```text
GET /api/mops/:symbol
```

用途：台股月營收、最新季度財報、財報季度、月營收月份、出表日。

可傳入價格，用來計算 P/B、P/E 等估值：

```text
http://127.0.0.1:8787/api/mops/2357?price=650
```

### 綜合分析資料

```text
GET /api/stock/:symbol
```

用途：前端主要使用的彙整 API，會整合 Yahoo、Google Finance、MOPS / TWSE OpenAPI。

範例：

```text
http://127.0.0.1:8787/api/stock/2357
```

## 已實測結果

以 `2357` 為例：

- Yahoo Finance：成功取得股價、成交量、均線與股價更新時間。
- Google Finance：成功連通並取得查核頁標題。
- MOPS / TWSE OpenAPI：成功取得 2026/03 月營收與 2026/04/17 出表日。
- 財報季報：目前 TWSE OpenAPI 對部分股票未回傳最新季報列，API 會明確標示未取得。

## 下一步

- 補接 TPEX OpenAPI，完整支援上櫃公司財報。
- 補接 SEC companyfacts 或授權財報 API，支援美股基本面。
- 加入快取資料庫，避免每次查詢都即時打外部來源。
- 加入正式錯誤記錄與資料更新排程。
