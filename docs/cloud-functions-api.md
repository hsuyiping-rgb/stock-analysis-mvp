# Cloud Functions API 搬遷狀態

## 已完成

- `api-core.js`：抽出共用 API 邏輯。
- `server.js`：改成只啟動本機 Node HTTP server，並呼叫 `api-core.js`。
- `functions/index.js`：新增 Firebase Cloud Functions v2 `api` HTTP function。
- `functions/api-core.js`：部署用副本，由 `scripts/sync-api-core.mjs` 從根目錄 `api-core.js` 自動產生，**請勿手動編輯**。
- `firebase.json`：新增 Functions source 與 `predeploy` 同步步驟（`/api/**` 的 hosting rewrite 尚未加，見下方「注意」）。
- Staging 目錄：`C:\Users\vm\stock-analysis-firebase-deploy`

## api-core.js 副本同步

Firebase 部署只會上傳 `firebase.json` 指定的 `functions/` 目錄，function 無法 import 目錄外的模組，因此 `functions/api-core.js` 必須是實體副本。這份副本現在由腳本產生，不再靠人記得手動複製：

```powershell
npm.cmd run sync:functions    # 把 api-core.js 複製到 functions/api-core.js
npm.cmd run check:functions   # 只檢查是否一致，不一致以 exit code 1 結束
```

`firebase.json` 的 functions `predeploy` 已掛上 `npm run sync:functions`，所以 `firebase deploy` 一定會先同步再上傳。改完 `api-core.js` 後提交前，建議跑一次 `npm run check:functions` 確認兩份一致。

## 部署指令

```powershell
cd "C:\Users\vm\stock-analysis-firebase-deploy"
firebase.cmd deploy --only functions:api --project teaching-3b748
```

## 目前阻擋

Firebase 回覆：

```text
Your project teaching-3b748 must be on the Blaze (pay-as-you-go) plan.
Required API cloudbuild.googleapis.com can't be enabled until the upgrade is complete.
```

升級頁面：

```text
https://console.firebase.google.com/project/teaching-3b748/usage/details
```

## 注意

- **`firebase.json` 目前沒有 `/api/**` → `api` function 的 hosting rewrite**（現有 rewrite 是 `**` → `/index.html`）。Functions 真的上線時必須補上，且要排在 `**` 之前，否則 `/api/*` 會被吃掉變成回傳 `index.html`。
- 目前本機開發仍使用 `http://127.0.0.1:8787/api/...`。
- FinMind token 尚未放進 Cloud Functions secret；Free API 可先不帶 token 使用，若要提高額度，需再設定 secret 或環境變數。
