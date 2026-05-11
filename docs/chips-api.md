# 券商分點籌碼 API

```text
GET /api/chips/:symbol
```

資料來源使用 FinMind API 頁面的 sponsor 資料入口：

```text
https://api.finmindtrade.com/api/v4/storage_objects
```

參數：

```text
dataset=TaiwanStockTradingDailyReport
date=YYYY-MM-DD
```

此 API 回傳 parquet 檔，後端使用安裝在本機資料夾的 `parquetjs-lite` 解析後，再依 `stock_id` 過濾查詢股票。此資料集為 sponsor 會員資料；若未設定 token 或帳號權限不足，API 會回傳 `ok:false` 與原因，前端會顯示「待串接」。

parquet 解析套件建議安裝在非 Google Drive 同步資料夾：

```powershell
npm.cmd install --prefix "$env:USERPROFILE\.stock-mvp-deps" parquetjs-lite@0.8.7 --no-audit --no-fund --no-package-lock
```

啟動前設定 token：

```powershell
$env:FINMIND_TOKEN="你的 FinMind sponsor token"
npm.cmd start
```

也可以建立本機設定檔 `config.local.json`：

```json
{
  "FINMIND_TOKEN": "你的 FinMind sponsor token"
}
```

`config.local.json` 只放在本機，不要上傳或分享。

回傳內容包含近 `5 / 20 / 60` 交易日的買超分點、賣超分點、買進股數、賣出股數、買賣超張數，以及依成交價與買賣股數估算的分點均價。

```text
http://127.0.0.1:8787/api/chips/2454
```
