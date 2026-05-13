# 每日股票投資秘書

這個工具會依據 `holdings.csv` 產生每日 HTML 晨報，輸出到 `reports/latest.html` 與 `reports/daily-YYYY-MM-DD.html`。

## 手動產生

```powershell
node .\stock_secretary.mjs .\holdings.csv
```

只產出台股：

```powershell
node .\stock_secretary.mjs .\holdings.csv --market tw
```

只產出美股：

```powershell
node .\stock_secretary.mjs .\holdings.csv --market us
```

## 自動排程

已準備兩個排程腳本：

- `run_daily_stock_secretary.ps1`：台股晨報，輸出 `reports/latest-tw.html`
- `run_us_stock_secretary.ps1`：美股晚報，輸出 `reports/latest-us.html`

## 持股清單欄位

- `market`：台股或美股
- `symbol`：股票代號
- `name`：名稱
- `quantity`：庫存
- `cost_basis`：成本均價
- `last_known_price`：Excel 匯入時的參考現價
- `watch_tags`：你想在晨報中保留的觀察分類

## 資料限制

- 台股籌碼採 FinMind 免費資料集；若 ETF 或部分股票沒有資料，晨報會標示失敗或空值。
- 美股目前先提供價格、K 線與新聞；籌碼欄位暫不納入。
- 新聞摘要是依 Google News RSS 標題整理，重要決策仍應點開原文與公司公告確認。
