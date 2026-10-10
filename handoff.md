
# 交接檔（handoff.md）

> 任何 Agent、任何電腦接手前**必讀**；收工時**必更新**。本檔只放交接必需的精簡資訊，詳細脈絡放 Obsidian。

## ⏯️ 目前做到哪

**2026-10-10 下午（舊筆電 DESKTOP-31QBU95）**：持股秘書升級成「每個開盤日追蹤庫存＋規則買賣訊號＋寄信」，程式完成、測試信已收到，**排程尚未在 KFES 註冊**。

- `stock_secretary.mjs`：依 `secretary_rules.json` 門檻計分 → 每檔標「可考慮加碼／續抱觀察／留意減碼」＋觸發理由；`--trading-day-only` 休市日以結束碼 10 略過（台股查 TWSE 休市日 OpenAPI、美股用程式內 `US_HOLIDAYS`）。
- `run_stock_secretary.ps1 -Market tw|us`：共用進入點，產報告＋寄信；`-IgnoreTradingDay` 供假日測試。原本兩支 run_*_secretary.ps1 改為呼叫它。
- 排程 XML：`deploy/台股持股秘書.xml`（週一至五 08:00）、`deploy/美股持股秘書.xml`（21:00 台北）。
- `holdings.csv` 已更新：台股依 10/08 庫存截圖（22 檔）、美股依交易明細算出現有庫存（9 檔，使用者已確認）。
- 另產出 `資產報表/台股庫存明細_20261008.xlsx`（`build_台股庫存明細.py`），總計與券商截圖一致。
- 08-17～10-08 每日快照已 commit（`b990bf0`）。

## 🚦 目前狀態

- **可運行**；持股秘書要等 KFES 註冊後才會自動寄。
- KFES 的 ETF（18:00）、三大法人（18:30）排程持續在跑。
- 新機 KFES 自動登入（`netplwiz`）是否已設定：未確認。
- 未完成：Firebase Cloud Functions 上線（卡在 Blaze 方案）。

## ➡️ 下一步

1. **在 KFES 執行 `deploy/搬遷步驟.md` 第 8 步**註冊兩個持股秘書排程（舊筆電不要註冊），週一確認收到 `Stock Secretary TW`（08:00 後）與 `US`（21:00 後）。
2. 每日快照之後在 KFES 定期 commit，避免一次累積數週。
3. 確認 KFES 自動登入；長線：`api-core.js` 與 `functions/api-core.js` 改共用模組。

## ⚠️ 注意事項

- **有買賣就要更新 `holdings.csv`**（不進版控），否則訊號與占比會失準。台股庫存截圖可直接丟給 Agent 轉錄。
- `US_HOLIDAYS` 只寫到 2027 年，**2027 年底要補 2028**。TWSE 休市日 API 只回當年度，跨年初幾天若查不到會視為交易日。
- 規則訊號是機械式門檻計算，不是投資建議；門檻在 `secretary_rules.json` 調整。
- **絕對路徑必須含「AI作品」這層**，漏掉會讓排程 `LastTaskResult=0xFFFD0000` 且不產生 log。
- `.ps1` 必須 ASCII-only（PowerShell 5.1 以 Big5 讀檔）；手動測試要加 `-ExecutionPolicy Bypass`，否則被執行原則擋下。
- Bash 工具對中文路徑常編碼失敗；用 `git -C "G:/我的雲端硬碟/AI作品/投資股票分析"`（正斜線）。
- 舊筆電排程是**停用不是刪除**；兩台不可同時啟用（Drive 衝突副本＋重複寄信）。
- Gmail app password 若由 Claude 內建瀏覽器產生會被 Google 撤銷，須用使用者自己的 Chrome 產生。
- `config.local.json`、`holdings.csv`、`資產報表/` 都不進版控（在 Google Drive 上）。
- 00983A、00990A 持股實際是美股、資料 T+1，做台股共識分析時需過濾。
- 排程結果碼：`0x0` 成功、`0xC000013A` 被強制終止、`0x800710E0` 要求被拒絕、`0xFFFD0000` 指令碼解析失敗。

## 🕐 最後更新

- 時間：2026-10-10 13:05 收工
- 更新者：Claude Opus 5.5 @ DESKTOP-31QBU95（舊筆電）
- Git push：✅ 已推（含 b990bf0 快照、bd436a8 持股秘書與本次交接檔 commit）
- Obsidian（L3）：✅ 已更新（決策紀錄、持股秘書踩坑、更動紀錄）
