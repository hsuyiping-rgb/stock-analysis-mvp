# Cloud Functions API 搬遷狀態

## 已完成

- `api-core.js`：抽出共用 API 邏輯。
- `server.js`：改成只啟動本機 Node HTTP server，並呼叫 `api-core.js`。
- `functions/index.js`：新增 Firebase Cloud Functions v2 `api` HTTP function。
- `functions/api-core.js`：部署用 API 共用模組副本。
- `firebase.json`：新增 Functions source，並將 `/api/**` rewrite 到 `api` function。
- Staging 目錄：`C:\Users\vm\stock-analysis-firebase-deploy`

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

- Cloud Functions 部署成功後，Firebase Hosting 的 `/api/**` 會改由雲端 function 服務。
- 目前本機開發仍使用 `http://127.0.0.1:8787/api/...`。
- FinMind token 尚未放進 Cloud Functions secret；Free API 可先不帶 token 使用，若要提高額度，需再設定 secret 或環境變數。
