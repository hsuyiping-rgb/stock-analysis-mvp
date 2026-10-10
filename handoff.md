
# 交接檔（handoff.md）

> 任何 Agent、任何電腦接手前**必讀**；收工時**必更新**。本檔只放交接必需的精簡資訊，詳細脈絡放 Obsidian。

## ⏯️ 目前做到哪

**2026-10-10 下午（KFES）**：持股秘書兩個排程已在 KFES 註冊並驗證完成，**10/12（一）起自動執行**。

- 已註冊「台股持股秘書」（週一至五 08:00）、「美股持股秘書」（21:00），帳號 `KFES\kfes`、`LogonType=Interactive`。手動觸發：週末正確 SKIPPED、`0x0`；`-IgnoreTradingDay` 強制寄信成功，使用者已收到信。
- 確認 KFES 自動登入（`AutoAdminLogon=1`，本機帳號 kfes 無密碼）、AC 睡眠／休眠皆為永不；**尚未實際重開機驗證**。
- 10/9 國慶補假休市，無 10/9 快照屬正常；已 commit 的快照到 10-08，無遺漏。
- 前次（舊筆電）：持股秘書規則訊號、交易日判斷、寄信排程 XML（`bd436a8`），`holdings.csv` 台股 22 檔／美股 9 檔已更新。

## 🚦 目前狀態

- **可運行**；KFES 共四個排程：持股秘書台股 08:00、美股 21:00，ETF 快照 18:00、三大法人 18:30。
- 未完成：Firebase Cloud Functions 上線（卡在 Blaze 方案）。

## ➡️ 下一步

1. 10/12（一）確認收到 `Stock Secretary TW`（08:00 後）與 `US`（21:00 後），排程 `LastTaskResult=0x0`。
2. 找空檔重開 KFES 一次（避開 08:00、18:00～18:40、21:00），確認自動登入且 `G:` 自動掛回。
3. 在 KFES 定期 commit 10/12 之後的每日快照，避免一次累積數週。
4. 小修（可選）：`etf_holdings.mjs` 結尾「快照已存到」只顯示第一檔的資料日，休市日會誤導（實際每檔依各自資料日存檔）。
5. 長線：`api-core.js` 與 `functions/api-core.js` 改共用模組。

## ⚠️ 注意事項

- **有買賣就要更新 `holdings.csv`**（不進版控），否則訊號與占比會失準。台股庫存截圖可直接丟給 Agent 轉錄。
- `US_HOLIDAYS` 只寫到 2027 年，**2027 年底要補 2028**。TWSE 休市日 API 只回當年度，跨年初幾天若查不到會視為交易日。
- 規則訊號是機械式門檻計算，不是投資建議；門檻在 `secretary_rules.json` 調整。
- **舊筆電不要註冊持股秘書排程**；兩台不可同時啟用（Drive 衝突副本＋重複寄信）。舊筆電的快照排程是停用不是刪除。
- **絕對路徑必須含「AI作品」這層**，漏掉會讓排程 `LastTaskResult=0xFFFD0000` 且不產生 log。
- `.ps1` 必須 ASCII-only（PowerShell 5.1 以 Big5 讀檔）；手動測試要加 `-ExecutionPolicy Bypass`，否則被執行原則擋下。
- Bash 工具對中文路徑常編碼失敗；用 `git -C "G:/我的雲端硬碟/AI作品/投資股票分析"`（正斜線）。
- Gmail app password 若由 Claude 內建瀏覽器產生會被 Google 撤銷，須用使用者自己的 Chrome 產生。
- `config.local.json`、`holdings.csv`、`資產報表/` 都不進版控（在 Google Drive 上）。
- 00983A、00990A 持股實際是美股、資料 T+1，做台股共識分析時需過濾。
- 排程結果碼：`0x0` 成功、`0xC000013A` 被強制終止、`0x800710E0` 要求被拒絕、`0xFFFD0000` 指令碼解析失敗。

## 🕐 最後更新

- 時間：2026-10-10 13:20 收工
- 更新者：Claude Opus 5.5 @ KFES
- Git push：見本次 commit
- Obsidian（L3）：✅ 已更新（上次做到哪、更動紀錄、排程連結）
