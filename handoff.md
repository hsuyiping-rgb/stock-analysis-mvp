# 交接檔（handoff.md）

> 任何 Agent、任何電腦接手前**必讀**；收工時**必更新**。本檔只放交接必需的精簡資訊，詳細脈絡放 Obsidian。

## ⏯️ 目前做到哪

修好排程中斷問題並回補缺漏資料，同時準備好把排程搬到另一台不關機的 Windows 電腦。

**排程中斷已查明**：2026-08-13、08-14 兩天，電腦在 18:00／18:30 排程時間處於睡眠。

- ETF（`0xC000013A`）：靠 `WakeToRun` 喚醒後補跑，但剛喚醒時網路未就緒、`fetch` 無逾時而無限等待，達 30 分鐘 `ExecutionTimeLimit` 被強制終止。08-13 只抓到 4 檔、08-14 抓到 0 檔。
- 三大法人（`0x800710E0`）：`StartWhenAvailable=False`，錯過排程時間就不補跑，直接被拒絕執行。

**本次已完成**：

1. `etf_holdings.mjs` 加 `fetchWithTimeout()`（`AbortSignal.timeout(20s)`，套用全部 9 個對外請求）與 `fetchWithRetry()`（單檔失敗清 cookie 快取與中信 token，5 秒後重試一次）。commit `7cb1580`。
2. 回補 08-13、08-14 的 ETF 與三大法人快照。commit `ae12650`。
3. 兩個排程設定修正並匯出到 `deploy/`：`StartWhenAvailable=True`、`WakeToRun=True`、`ExecutionTimeLimit=PT30M`（三大法人原為 PT72H，搭配 `MultipleInstances=IgnoreNew` 會讓一次卡住擋掉後續 3 天）。commit `1460c11`。
4. 清掉 `.git/index.lock`（0 bytes，建立於 08-13 09:45，無 git 程序）。這是上次 push 一直沒成功的原因。
5. 三個積欠的 commit 全部推上 GitHub，本地與 `origin/master` 已同步。

## 🚦 目前狀態

- **可運行**，無做到一半的工作。
- 排程仍在舊筆電（DESKTOP-31QBU95）上，尚未搬遷、也尚未停用。
- 未完成項目：Firebase Cloud Functions 上線（卡在 Blaze 方案未升級，非程式問題）。

**已知缺漏、無法回補**（非 bug）：

- 08-13 的 `0050`、`0056` — 元大投信只回最新一日，歷史拿不回來
- 08-14 的 `00983A`、`00990A` — 持股為美股、資料 T+1，須待 08-18 公告

## ➡️ 下一步

1. **（主線）在另一台不關機的 Windows 電腦執行搬遷**：完全照 `deploy/搬遷步驟.md` 做。該文件含七個步驟、驗收標準與錯誤碼對照表。關鍵限制：`G:` 只存在於已登入的工作階段，排程不能設成「不論使用者是否登入都執行」，新機需自動登入、永不睡眠、時區台北。
2. 新機連續跑穩兩、三天後，回舊筆電 `Disable-ScheduledTask` 停用兩個排程（停用不刪除）。過渡期間**別讓兩台同時跑排程**，會產生 Google Drive 衝突副本並重複寄信。
3. 08-18 之後補確認 `00983A`、`00990A` 的 08-14 資料是否已出現。
4. 長線待辦：`api-core.js` 與 `functions/api-core.js` 目前是手動維護副本，考慮改為共用模組。

## ⚠️ 注意事項

- **絕對路徑必須含「AI作品」這層**，寫死路徑時極易漏掉，曾導致排程 `LastTaskResult=0xFFFD0000` 且完全不產生 log。
- Bash 工具對這個中文路徑常編碼失敗；改用 PowerShell 相對路徑，或 `git -C "G:/我的雲端硬碟/AI作品/投資股票分析"`（正斜線）。
- Gmail app password 若由 Claude 內建瀏覽器產生會被 Google 事後撤銷（出現 `5.7.0 Authentication Required`），須用使用者自己的 Chrome 產生。
- `config.local.json` 不進版控但**在 Google Drive 上**，換電腦同步下來即有，不需另外傳送憑證。
- 用 `--date` 回補時，統一／群益／野村的參數是**公告日**、對應資料日為前一營業日（`115/08/14` → 資料日 08-13）。回補會順帶重寫既有日期的檔案，但只有 `fetchedAt` 欄位變動，可 `git checkout` 還原以保持 commit 乾淨。
- `data/` 底下 CSV 被 gitignore，只有 JSON 進版控；`holdings.csv` 為本機個人資料，不進版控。
- 00983A、00990A 持股實際是美股、資料 T+1，做台股共識分析時需過濾。
- 排程結果碼速查：`0x0` 成功、`0xC000013A` 被強制終止（多半達 ExecutionTimeLimit）、`0x800710E0` 要求被拒絕（電池條件或錯過排程未補跑）、`0xFFFD0000` 指令碼解析失敗。

## 🕐 最後更新

- 時間：2026-08-16 收工
- 更新者：Claude Opus 5 @ DESKTOP-31QBU95
- Git push：✅ 已推（`ae12650`～`5ab525a` 共 5 個 commit，與 origin/master 同步）
- Obsidian（L3）：✅ `投資股票分析/專案工作流程.md` 已補決策紀錄、踩坑筆記與更動紀錄
