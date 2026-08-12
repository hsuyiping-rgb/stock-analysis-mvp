# 交接檔（handoff.md）

> 任何 Agent、任何電腦接手前**必讀**；收工時**必更新**。本檔只放交接必需的精簡資訊，詳細脈絡放 Obsidian。

## ⏯️ 目前做到哪

專案初始化完成（本次補建 L1 藍圖與交接檔）。同時把累積約三週未進版控的每日快照 commit 進去（commit `b9b0499`，182 個 JSON 檔，涵蓋 2026-07-20～08-12）。

## 🚦 目前狀態

- **可運行**。三個子系統都正常，無做到一半的工作。
- 兩個每日排程持續正常執行，2026-08-12 的 log 顯示 `exit code: 0`、email 皆寄送成功。
- 未完成項目只有 Firebase Cloud Functions 上線（卡在 Blaze 方案未升級，非程式問題）。

## ➡️ 下一步

1. 無急迫待辦。若要推進，優先處理 `api-core.js` 與 `functions/api-core.js` 的手動副本問題（改為共用模組，避免本機與雲端行為分歧）。
2. 每隔一段時間記得 commit `data/` 底下累積的每日快照——排程只寫檔不進版控，容易累積數週。
3. 若要動 ETF 投信端點，先讀 `docs/etf-holdings-research.md`。

## ⚠️ 注意事項

- **絕對路徑必須含「AI作品」這層**，寫死路徑時極易漏掉，曾導致排程 `LastTaskResult=0xFFFD0000` 且完全不產生 log。
- Bash 工具對這個中文路徑常編碼失敗；改用 PowerShell 相對路徑，或 `git -C "G:/我的雲端硬碟/AI作品/投資股票分析"`（正斜線）。
- Gmail app password 若由 Claude 內建瀏覽器產生會被 Google 事後撤銷（出現 `5.7.0 Authentication Required`），須用使用者自己的 Chrome 產生。
- `data/` 底下 CSV 被 gitignore，只有 JSON 進版控；`holdings.csv` 為本機個人資料，不進版控。
- 00983A、00990A 持股實際是美股、資料 T+1，做台股共識分析時需過濾。

## 🕐 最後更新

- 時間：2026-08-12 21:06
- 更新者：Claude Opus 5 @ DESKTOP-31QBU95
- Git push：待推
