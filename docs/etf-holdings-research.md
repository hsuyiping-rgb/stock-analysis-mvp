# 台股 ETF 持股研究：資料來源與收集管線

目標：追蹤台股 ETF（主動式優先）實際持股，回答三個問題——
共識持股（多檔 ETF 同時重押什麼）、資金流向（主動式經理人每日增減碼）、
超配訊號（ETF 權重相對大盤市值權重的偏離）。

## 研究範圍：台股主動式 ETF 名單（2026-07 共 22 檔）

成長型（17 檔）：

| 代號 | 名稱 | 投信 |
|---|---|---|
| 00980A | 主動野村臺灣優選 | 野村 |
| 00981A | 主動統一台股增長 | 統一 |
| 00982A | 主動群益台灣強棒 | 群益 |
| 00983A | 主動中信ARK創新 | 中國信託 |
| 00985A | 主動野村台灣50 | 野村 |
| 00986A | 主動台新龍頭成長 | 台新 |
| 00987A | 主動台新優勢成長 | 台新 |
| 00991A | 主動復華未來50 | 復華 |
| 00992A | 主動群益科技創新 | 群益 |
| 00993A | 主動安聯台灣 | 安聯 |
| 00994A | 主動第一金台股優 | 第一金 |
| 00995A | 主動中信台灣卓越 | 中國信託 |
| 00996A | 主動兆豐台灣豐收 | 兆豐 |
| 00403A | 主動統一升級50 | 統一 |
| 00404A | 主動聯博動能50 | 聯博 |
| 00405A | 主動富邦台灣龍耀 | 富邦 |
| 00407A | 主動凱基台灣 | 凱基 |

高息配息型（5 檔）：00400A 國泰動能高息、00401A 摩根台灣鑫收、
00406A 中信台灣收益、00984A 安聯台灣高息、00999A 野村臺灣高息。

名單來源：[經理人整理](https://www.managertoday.com.tw/articles/view/72424)、
[TWSE 主動式 ETF 專區](https://www.twse.com.tw/zh/products/securities/etf/products/active-list.html)。
新募集頻繁，名單需每季核對一次。

## 已驗證的資料端點

### 統一投信（00981A、00403A）— 已完成，見 `etf_holdings.mjs`

- 端點：`POST https://www.ezmoney.com.tw/ETF/Transaction/GetPCF`
- Body（JSON）：`{"fundCode":"49YTW","date":"115/07/15","specificDate":true}`
  - `fundCode`：投信內部代碼，00981A=`49YTW`、00403A=`63YTW`
  - `date`：民國年格式的「公告日」＝持股基準日的次一營業日
  - 支援查歷史日期（實測可查過去日期，深度未知）
- 前置需求：先 GET `/ETF/Transaction/PCF` 取 cookie（手動跟隨重導），
  POST 需帶 `X-Requested-With: XMLHttpRequest` 與 JSON Content-Type
- 回應：`pcf`（基金摘要，含 NAV）、`asset[]` 中 `AssetCode="ST"` 的
  `Details[]` 為個股明細（`DetailCode` 代號、`Share` 股數、`NavRate` 權重%）
- 日期欄位是 ASP.NET `/Date(毫秒)/` 格式

### 群益投信（00982A、00992A）— 已完成，見 `etf_holdings.mjs`

- 端點：`POST https://www.capitalfund.com.tw/CFWeb/api/etf/buyback`
- Body（JSON）：`{"fundId":"399","date":null}`
  - `fundId`：投信內部代碼，00982A=`399`、00992A=`500`
    （完整對照表：`POST /CFWeb/api/etf/items`，回傳全系列基金的 fundNo↔股票代號）
  - `date`：`null` 抓最新公告；帶 `YYYY-MM-DD`（西元、公告日）可查歷史，實測可行
- 前置需求：網站有 Incapsula 防護，先 GET 任一 ETF 頁面取 cookie，
  POST 帶一般瀏覽器 User-Agent 即可通過
- 回應：`data.pcf`（`date1` 公告日、`date2` 持股基準日、`pUnit` NAV）、
  `data.stocks[]`（`stocNo` 代號、`stocName` 名稱、`share` 股數、`weight` 權重%）
- 注意：payload 欄位名是 `fundId`（items API 回傳的欄位名卻是 `fundNo`），
  傳錯欄位名會回 HTTP 500

### 野村投信（00980A、00985A、00999A）— 已完成，見 `etf_holdings.mjs`

- 端點：`POST https://www.nomurafunds.com.tw/API/ETFAPI/api/Fund/GetFundTradeInfo`
- Body（JSON）：`{"FundNo":"00980A","Type":1,"Date":"2026-07-15"}`
  - `FundNo`：直接用股票代號，不需內部代碼
  - `Date`：西元公告日；最新日期先問 `POST .../GetFundTradeInfoDate`
    （回傳 `LatestDate` 與 `AllDate`——上市以來全部日期，歷史可完整回補）
- 前置需求：無，免 cookie 免防護，三家中最乾淨
- 回應：`Entries.CNavDtStr` 持股基準日、`CAnceNav` NAV、
  `Stocks[]`（`CStockCode`、`CStockName`、`CQuantity` 股數、`CWeightsPct` 權重%）、
  另有 `Futures[]`（台指期部位也揭露）與 `Bonds[]`

### 中信投信（00983A、00995A、00406A）— 已完成，見 `etf_holdings.mjs`

- 端點：`POST https://www.ctbcinvestments.com.tw/API/etf/ETFHoldingWeight?token=<TOKEN>`
- Body（JSON）：`{"FID":"E0036","StartDate":"2026/07/14"}`
  - `FID`：投信內部代碼，00983A=`E0034`、00995A=`E0036`、00406A=`E0038`
    （對照：`POST /API/etf/ETFDetail` 帶 `{"CNO":"..."}`；CNO 清單在 `POST /API/etf/ETFList`）
  - `StartDate`：西元 `YYYY/MM/DD`，回傳該日或之前最近一日，可查歷史
  - 不帶 `StartDate` 會回「SqlDateTime 溢位」錯誤
- 前置需求：Incapsula 防護（cookie＋UA 可過）；API 需先換 token：
  `POST /API/home/AuthToken?token=www.ctbcinvestments.com`（body 必須是 `{}`），
  回傳的 token 放到後續請求的 query string（要 URL encode）
- 回應：`Data.FundAssets[0]`（`資料日期`、`基金每單位淨值`）、
  `Data.FundAssetsDetail[]` 中 `Code="STOCK"` 的 `Data[]`
  （`code_`、`name_`、`qty_` 股數、`weights_` 權重%、`amount_` 金額——數字都是含逗號字串）
- 注意：**00983A 實際持股是美股**（TSLA、AMD 等 ARK 風格，代號如 `TSLA US`），
  資料日比台股型晚一天（海外 T+1）；台股共識分析要過濾

### 元大投信（0050、0056、00990A）— 已完成，見 `etf_holdings.mjs`

- 端點：`GET https://etfapi.yuantaetfs.com/ectranslation/api/bridge`
- Query 參數：`APIType=ETFAPI&CompanyName=YUANTAFUNDS&FuncId=PCF/Daily&AppName=ETF&Device=3&Platform=ETF&ticker=0050`
  - `ticker`：直接用股票代號；被動、主動、債券 ETF 全系列通用
  - 免 cookie 免 token，最開放的一家；但**只回最新一日**，歷史要自行累積
- 回應：`PCF`（`trandate` 持股基準日 YYYYMMDD、`anndate` 公告日、`nav`、`totalav`）、
  `FundWeights.StockWeights[]`（`code`、`name`、`qty` 股數、`weights` 權重%）、
  另有 `FutureWeights`／`ETFWeights`／`BondWeights` 與 `InKind.FundComposition`（實物申購籃）
- 發現方式：Nuxt SSR 網站，SPA 切換基金時攔截 XHR 得到 bridge API；
  也可直接解析頁面 `window.__NUXT__`（備援）
- 注意：00990A 為海外持股（AMD、NVDA 等美股），資料日 T+1

### 待逆向的投信 PCF 頁面

| 投信 | PCF 頁面 | 備註 |
|---|---|---|
| 國泰 | https://www.cathaysite.com.tw/ETF/purchase | |
| 富邦 | https://websys.fsit.com.tw/FubonETF/Trade/Pcf.aspx | 傳統 aspx，可能可直接解析 HTML |
| 兆豐 | https://www.megafunds.com.tw/MEGA/etf/trade_pcf.aspx | 傳統 aspx |
| 永豐 | https://sitc.sinopac.com/SinopacEtfs/Etfs/Pcf/{代號} | URL 帶代號，可能最好抓 |

逆向方法（本次驗證統一的流程，可複用）：瀏覽器開 PCF 頁 →
讀 network requests 找 XHR → 看頁面 inline JS 確認 payload 格式 →
curl/Node 重現（注意 cookie 與 header）。

### 輔助來源

- [SITCA 投信投顧公會 ETF 專區](https://www.sitca.org.tw/ROC/SITCA_ETF/etf-hub-basic.html)：全體基金月度前十大持股
- [etfinfo.tw/active](https://www.etfinfo.tw/active)：第三方彙整的主動式 ETF 持股異動，可用來核對自建資料
- TWSE OpenAPI：實測無 PCF／持股端點，僅有定期定額排行

## 執行方式

```powershell
node etf_holdings.mjs            # 抓最新一日
node etf_holdings.mjs --date 115/07/10   # 指定公告日（民國年）
```

產出：`data/etf_holdings/{資料日}/{代號}.json`（原始快照）與 `.csv`（精簡表）。

排程：已註冊 Windows 工作排程器「**ETF持股每日快照**」，
週一至週五 18:00 執行 `run_etf_holdings.ps1`（投信約 16:20–17:50 陸續上傳完畢），
執行紀錄寫到 `data/etf_holdings/logs/run-YYYY-MM-DD.log`，
錯過時間會補跑（StartWhenAvailable）。
管理指令：`Get-ScheduledTaskInfo -TaskName "ETF持股每日快照"` 看上次結果；
`Start-ScheduledTask -TaskName "ETF持股每日快照"` 手動觸發。
歷史快照部分投信不可回補（元大只留當日），排程中斷要盡快恢復。

## 下一步

1. 依規模排序逆向其他投信：台新（00986A、00987A）、復華（00991A）、
   安聯（00993A、00984A）、第一金（00994A）、兆豐（00996A）等。
2. 快照累積一週後，寫 `etf_analysis.mjs`：
   - 逐日 diff 產生增減碼表（股數變化 × 收盤價 ≒ 買賣金額）
   - 跨 ETF 共識持股排行
   - 對照 TWSE 個股市值計算超配／低配
3. 其他被動式 ETF（00878 國泰、00919 群益等）：0050／0056 已透過元大
   bridge API 每日抓；國泰、群益的被動式可沿用各自已逆向的端點擴充。
4. 分析產出併入每日股票秘書報告（`stock_secretary.mjs`）。

## 使用限制

PCF 揭露的是「已持有」部位，屬落後資訊；主動式 ETF 的 1,000 股象徵性
部位（權重 0%）是建倉觀察名單訊號，diff 分析時要與實質部位分開處理。
本資料僅供研究參考，不構成投資建議。
