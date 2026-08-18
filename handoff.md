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

**2026-08-17 進度：搬遷已在新機（KFES）執行到步驟 6**

環境檢查（步驟 1–4）全通過：Node v26.4.0、Git 2.53.0、`G:` 已掛載、`config.local.json` 四個鍵齊全、時區 Taipei、AC 睡眠／休眠皆為「永不」、無電池（桌機，`DisallowStartIfOnBatteries` 不會擋）。

兩個排程已註冊並**啟用**，身分 `kfes`／`LogonType=Interactive`，下次執行 08-17 18:00／18:30。步驟 5 的手動測試依使用者決定跳過（當時 07:45，三大法人資料未出，且會與舊機重複），直接讓排程當晚實跑。

**發現文件錯誤並已修正**：XML 的 `UserId` 是舊機 SID，`Register-ScheduledTask -User` 覆蓋不了，會噴 `The parameter is incorrect. (11,8):UserId:`（`0x80070057`）。正解是先在記憶體 `-replace` 掉 `<UserId>` 再註冊。已寫回 `deploy/搬遷步驟.md` 步驟 6。

## 🚦 目前狀態

- **可運行**，無做到一半的工作。
- 新機（KFES）排程已啟用；**舊筆電（DESKTOP-31QBU95）的兩個排程當時仍啟用、尚未停用** ← 接手時第一件事就是確認這點。
- 新機 `AutoAdminLogon = 0`，**自動登入尚未設定**（需使用者自行用 `netplwiz` 處理，重開機後 `G:` 才會回來）。
- 未完成項目：Firebase Cloud Functions 上線（卡在 Blaze 方案未升級，非程式問題）。

**已知缺漏、無法回補**（非 bug）：

- 08-13 的 `0050`、`0056` — 元大投信只回最新一日，歷史拿不回來
- 08-14 的 `00983A`、`00990A` — 持股為美股、資料 T+1，須待 08-18 公告

## ➡️ 下一步

> 以下 1–5 都必須在**使用者的 Windows 機器**上做，雲端 Agent 環境沒有 `G:`、也連不到投信網站，無法代勞。

1. **（最優先）確認舊筆電兩個排程已停用**。08-17 收工時尚未停用，兩台同時跑會產生 Google Drive 衝突副本並寄兩封重複的信。在 DESKTOP-31QBU95 執行 `Disable-ScheduledTask -TaskName "ETF持股每日快照"`、`Disable-ScheduledTask -TaskName "三大法人每日快照"`。
2. **在新機設定自動登入**（`netplwiz`），目前 `AutoAdminLogon = 0`。
3. **驗收 08-17 當晚首跑**：`Get-ScheduledTaskInfo` 兩個工作的 `LastTaskResult` 應為 `0x0`，並確認 `data/etf_holdings/2026-08-17/` 有 14 檔、`reports/etf-analysis-latest.html` 有產生、信箱收到信。若有兩份衝突副本或兩封信，代表舊機也跑了。
4. 新機連續跑穩兩、三天後才算搬遷完成（`deploy/搬遷步驟.md` 步驟 7）。停用而非刪除，出狀況可 `Enable-ScheduledTask` 救回。
5. 08-18 之後補確認 `00983A`、`00990A` 的 08-14 資料是否已出現。
6. **本機的 08-15～08-18 快照尚未推上 GitHub**（`origin/master` 的 `data/` 只到 08-14）；回到有資料的機器時記得 commit。
7. Firebase Cloud Functions 上線仍卡在 Blaze 方案（非程式問題）。上線時要**補 `firebase.json` 的 `/api/**` → `api` function hosting rewrite**，現有設定只有 `**` → `/index.html`，`/api/*` 會被吃掉。詳見 `docs/cloud-functions-api.md`。

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

- 時間：2026-08-18
- 更新者：Claude Code @ 雲端 remote session（Linux 容器，無 `G:`、無投信網站連線）
- Git push：branch `claude/kaigong-evz7w8`
- 本次做的事：把 `api-core.js` → `functions/api-core.js` 的手動副本改成腳本產生（`scripts/sync-api-core.mjs`，`npm run sync:functions`／`check:functions`，並掛上 firebase `predeploy`），同步更新 `CLAUDE.md`／`agents.md`／`docs/cloud-functions-api.md`。順帶記下 `firebase.json` 缺 `/api/**` rewrite 這個未爆彈。
- 排程搬遷相關的驗收（上面下一步 1–5）**沒有動**，雲端環境做不到，仍待使用者在 Windows 機器上處理。
- Obsidian（L3）：❌ 未更新
