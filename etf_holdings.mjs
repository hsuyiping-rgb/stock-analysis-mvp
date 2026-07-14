import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// 每日抓取主動式 ETF 申購買回清單（PCF）持股快照。
// 用法：node etf_holdings.mjs [--date 115/07/15]（民國年公告日，預設抓最新）
// 產出：data/etf_holdings/YYYY-MM-DD/{代號}.json 與 {代號}.csv

const ROOT = process.cwd();
const DATA_DIR = resolve(ROOT, "data", "etf_holdings");
const OPTIONS = parseArgs(process.argv.slice(2));
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// fundCode／fundId 是各投信內部代碼，與股票代號不同，逆向方式見 docs/etf-holdings-research.md。
const ETF_LIST = [
  { stockNo: "00981A", name: "主動統一台股增長", issuer: "統一投信", fetcher: fetchUniPcf, fundCode: "49YTW" },
  { stockNo: "00403A", name: "主動統一升級50", issuer: "統一投信", fetcher: fetchUniPcf, fundCode: "63YTW" },
  { stockNo: "00982A", name: "主動群益台灣強棒", issuer: "群益投信", fetcher: fetchCapitalPcf, fundCode: "399" },
  { stockNo: "00992A", name: "主動群益科技創新", issuer: "群益投信", fetcher: fetchCapitalPcf, fundCode: "500" },
  { stockNo: "00980A", name: "主動野村臺灣優選", issuer: "野村投信", fetcher: fetchNomuraPcf, fundCode: "00980A" },
  { stockNo: "00985A", name: "主動野村台灣50", issuer: "野村投信", fetcher: fetchNomuraPcf, fundCode: "00985A" },
  { stockNo: "00999A", name: "主動野村臺灣高息", issuer: "野村投信", fetcher: fetchNomuraPcf, fundCode: "00999A" },
  // 00983A 實際持股為美股（ARK 創新策略），做台股共識分析時需依代號格式過濾。
  { stockNo: "00983A", name: "主動中信ARK創新", issuer: "中信投信", fetcher: fetchCtbcPcf, fundCode: "E0034" },
  { stockNo: "00995A", name: "主動中信台灣卓越", issuer: "中信投信", fetcher: fetchCtbcPcf, fundCode: "E0036" },
  { stockNo: "00406A", name: "主動中信台灣收益", issuer: "中信投信", fetcher: fetchCtbcPcf, fundCode: "E0038" },
  // 元大：0050/0056 為被動式（成分變動慢，但權重可做大盤對照基準）；00990A 為海外主動式。
  { stockNo: "0050", name: "元大台灣50", issuer: "元大投信", fetcher: fetchYuantaPcf, fundCode: "0050" },
  { stockNo: "0056", name: "元大高股息", issuer: "元大投信", fetcher: fetchYuantaPcf, fundCode: "0056" },
  { stockNo: "00990A", name: "主動元大AI新經濟", issuer: "元大投信", fetcher: fetchYuantaPcf, fundCode: "00990A" }
];

const cookieCache = new Map();

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const results = [];
  for (const etf of ETF_LIST) {
    try {
      const snapshot = await etf.fetcher(etf);
      results.push(snapshot);
      await saveSnapshot(snapshot);
      console.log(`${etf.stockNo} ${etf.name}：持股 ${snapshot.stocks.length} 檔（資料日 ${snapshot.tranDate}）`);
    } catch (error) {
      console.error(`${etf.stockNo} 抓取失敗：${error.message}`);
      process.exitCode = 1;
    }
  }
  if (results.length) {
    const day = results[0].tranDate;
    console.log(`快照已存到 ${join(DATA_DIR, day)}`);
  }
}

// ---- 統一投信（ezmoney.com.tw） ----

async function fetchUniPcf(etf) {
  const base = "https://www.ezmoney.com.tw";
  const cookie = await warmupCookie(`${base}/ETF/Transaction/PCF`);
  // PCF 是「隔日申購買回清單」，公告日為次一營業日，持股基準日為當日。
  // 依序嘗試明天、今天、往前數日的公告日，取第一個有效回應。
  const candidates = OPTIONS.date ? [OPTIONS.date] : rocDateCandidates();
  let lastError = null;
  for (const rocDate of candidates) {
    const response = await fetch(`${base}/ETF/Transaction/GetPCF`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": USER_AGENT,
        "Referer": `${base}/ETF/Transaction/PCF`,
        "Cookie": cookie
      },
      body: JSON.stringify({ fundCode: etf.fundCode, date: rocDate, specificDate: true })
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      lastError = new Error(`公告日 ${rocDate} 回應非 JSON（可能無該日清單）`);
      continue;
    }
    const stockAsset = (data.asset || []).find((asset) => asset.AssetCode === "ST");
    if (!stockAsset || !Array.isArray(stockAsset.Details) || !stockAsset.Details.length) {
      lastError = new Error(`公告日 ${rocDate} 沒有股票明細`);
      continue;
    }
    const tranDate = parseDotNetDate(data.pcf?.[0]?.TranDate);
    if (!tranDate) {
      lastError = new Error(`公告日 ${rocDate} 的資料日期無法解析`);
      continue;
    }
    return {
      stockNo: etf.stockNo,
      name: etf.name,
      issuer: etf.issuer,
      tranDate,
      postDate: rocToIso(rocDate),
      fetchedAt: new Date().toISOString(),
      nav: data.pcf?.find((row) => row.PCFCode === "P_UNIT")?.Amount ?? null,
      fundNetAsset: data.pcf?.find((row) => row.PCFCode === "NAV")?.Amount ?? null,
      stocks: normalizeStocks(stockAsset.Details.map((row) => ({
        code: row.DetailCode,
        name: row.DetailName,
        shares: row.Share,
        amount: row.Amount,
        weight: row.NavRate
      })))
    };
  }
  throw lastError || new Error("找不到可用的公告日");
}

// ---- 群益投信（capitalfund.com.tw，Incapsula 防護需先取 cookie） ----

async function fetchCapitalPcf(etf) {
  const base = "https://www.capitalfund.com.tw";
  const referer = `${base}/etf/product/detail/${etf.fundCode}/buyback`;
  const cookie = await warmupCookie(referer);
  // date 傳 null 抓最新公告；也可指定公告日 YYYY-MM-DD 查歷史。
  const date = OPTIONS.date ? rocToIso(OPTIONS.date) : null;
  const response = await fetch(`${base}/CFWeb/api/etf/buyback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "Referer": referer,
      "Cookie": cookie
    },
    body: JSON.stringify({ fundId: etf.fundCode, date })
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`回應非 JSON（HTTP ${response.status}，可能被防護擋下）`);
  }
  if (payload.code !== 200 || !payload.data?.stocks?.length) {
    throw new Error(`API 回應異常（code ${payload.code}，股票 ${payload.data?.stocks?.length ?? 0} 檔）`);
  }
  const pcf = payload.data.pcf || {};
  return {
    stockNo: etf.stockNo,
    name: etf.name,
    issuer: etf.issuer,
    tranDate: pcf.date2 || "",
    postDate: pcf.date1 || "",
    fetchedAt: new Date().toISOString(),
    nav: pcf.pUnit ?? null,
    fundNetAsset: pcf.nav ?? null,
    stocks: normalizeStocks(payload.data.stocks.map((row) => ({
      code: row.stocNo,
      name: row.stocName,
      shares: row.share,
      amount: null,
      weight: row.weight
    })))
  };
}

// ---- 野村投信（nomurafunds.com.tw，無防護、免 cookie） ----

async function fetchNomuraPcf(etf) {
  const base = "https://www.nomurafunds.com.tw/API/ETFAPI/api/Fund";
  const headers = { "Content-Type": "application/json", "User-Agent": USER_AGENT };
  // 先問最新公告日（AllDate 有上市以來全部日期，可查歷史）。
  let date;
  if (OPTIONS.date) {
    date = rocToIso(OPTIONS.date);
  } else {
    const dateResponse = await fetch(`${base}/GetFundTradeInfoDate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ FundNo: etf.fundCode, Type: 1 })
    });
    const datePayload = await dateResponse.json();
    date = String(datePayload.Entries?.LatestDate || "").replaceAll("/", "-");
    if (!date) throw new Error("查不到最新公告日");
  }
  const response = await fetch(`${base}/GetFundTradeInfo`, {
    method: "POST",
    headers,
    body: JSON.stringify({ FundNo: etf.fundCode, Type: 1, Date: date })
  });
  const payload = await response.json();
  const entries = payload.Entries;
  if (payload.StatusCode !== 0 || !entries?.Stocks?.length) {
    throw new Error(`API 回應異常（StatusCode ${payload.StatusCode}，${payload.Message || "無股票明細"}）`);
  }
  return {
    stockNo: etf.stockNo,
    name: etf.name,
    issuer: etf.issuer,
    tranDate: String(entries.CNavDtStr || "").replaceAll("/", "-"),
    postDate: parseDotNetDate(entries.CPcfdate),
    fetchedAt: new Date().toISOString(),
    nav: entries.CAnceNav ? Number(entries.CAnceNav) : null,
    fundNetAsset: entries.CAnceTotalAv ?? null,
    stocks: normalizeStocks(entries.Stocks.map((row) => ({
      code: row.CStockCode,
      name: row.CStockName,
      shares: row.CQuantity,
      amount: null,
      weight: row.CWeightsPct
    })))
  };
}

// ---- 中信投信（ctbcinvestments.com.tw，Incapsula 防護＋token 換發） ----

let ctbcToken = "";

async function fetchCtbcPcf(etf) {
  const base = "https://www.ctbcinvestments.com.tw";
  const cookie = await warmupCookie(`${base}/Etf`);
  if (!ctbcToken) {
    const authResponse = await fetch(`${base}/API/home/AuthToken?token=www.ctbcinvestments.com`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT, "Cookie": cookie },
      body: "{}"
    });
    const authPayload = await authResponse.json();
    if (authPayload.ResultCode !== 0 || !authPayload.Data?.token) {
      throw new Error(`AuthToken 換發失敗（ResultCode ${authPayload.ResultCode}）`);
    }
    ctbcToken = encodeURIComponent(authPayload.Data.token);
  }
  // StartDate 用西元 YYYY/MM/DD，回傳該日（或之前最近一日）的持股。
  const startDate = OPTIONS.date
    ? rocToIso(OPTIONS.date).replaceAll("-", "/")
    : new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
  const response = await fetch(`${base}/API/etf/ETFHoldingWeight?token=${ctbcToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT, "Cookie": cookie },
    body: JSON.stringify({ FID: etf.fundCode, StartDate: startDate })
  });
  const payload = await response.json();
  if (payload.ResultCode !== 0) {
    throw new Error(`API 回應異常（${payload.ResultMsg || payload.ResultCode}）`);
  }
  const assets = payload.Data?.FundAssets?.[0];
  const stockGroup = (payload.Data?.FundAssetsDetail || []).find((group) => group.Code === "STOCK");
  if (!assets || !stockGroup?.Data?.length) {
    throw new Error("沒有股票明細");
  }
  return {
    stockNo: etf.stockNo,
    name: etf.name,
    issuer: etf.issuer,
    tranDate: String(assets["資料日期"] || "").replaceAll("/", "-"),
    postDate: "",
    fetchedAt: new Date().toISOString(),
    nav: parseNumber(assets["基金每單位淨值"]),
    fundNetAsset: parseNumber(assets["基金淨資產"]),
    stocks: normalizeStocks(stockGroup.Data.map((row) => ({
      code: row.code_,
      name: row.name_,
      shares: parseNumber(row.qty_),
      amount: parseNumber(row.amount_),
      weight: parseNumber(row.weights_)
    })))
  };
}

// ---- 元大投信（etfapi.yuantaetfs.com，開放 GET、免 cookie） ----

async function fetchYuantaPcf(etf) {
  // bridge API 只支援最新一日；歷史需自行累積快照。
  const params = new URLSearchParams({
    APIType: "ETFAPI",
    CompanyName: "YUANTAFUNDS",
    FuncId: "PCF/Daily",
    AppName: "ETF",
    Device: "3",
    Platform: "ETF",
    ticker: etf.fundCode
  });
  const response = await fetch(`https://etfapi.yuantaetfs.com/ectranslation/api/bridge?${params}`, {
    headers: { "User-Agent": USER_AGENT }
  });
  const payload = await response.json();
  const pcf = payload.PCF;
  const stocks = payload.FundWeights?.StockWeights;
  if (!pcf?.trandate || !stocks?.length) {
    throw new Error(`API 回應異常（HTTP ${response.status}，無持股明細）`);
  }
  const raw = String(pcf.trandate);
  return {
    stockNo: etf.stockNo,
    name: etf.name,
    issuer: etf.issuer,
    tranDate: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
    postDate: pcf.anndate ? `${String(pcf.anndate).slice(0, 4)}-${String(pcf.anndate).slice(4, 6)}-${String(pcf.anndate).slice(6, 8)}` : "",
    fetchedAt: new Date().toISOString(),
    nav: pcf.nav ?? null,
    fundNetAsset: pcf.totalav ?? null,
    stocks: normalizeStocks(stocks.map((row) => ({
      code: row.code,
      name: row.name,
      shares: row.qty,
      amount: null,
      weight: row.weights
    })))
  };
}

// ---- 共用工具 ----

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isNaN(parsed) ? null : parsed;
}

// 網站可能用「設 cookie 再重導」做檢查（統一）或 Incapsula 防護（群益），
// Node fetch 不保留 cookie 會造成重導循環，因此手動跟隨重導並累積 cookie。
async function warmupCookie(url) {
  const origin = new URL(url).origin;
  if (cookieCache.has(origin)) return cookieCache.get(origin);
  const jar = new Map();
  let current = url;
  for (let hop = 0; hop < 8; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, "Cookie": cookieHeader(jar) }
    });
    for (const item of response.headers.getSetCookie?.() || []) {
      const [pair] = item.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) {
      throw new Error(`${origin} 暖身請求回應 ${response.status}`);
    }
    const header = cookieHeader(jar);
    cookieCache.set(origin, header);
    return header;
  }
  throw new Error(`${origin} 重導過多，無法取得 cookie`);
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function normalizeStocks(rows) {
  return rows
    .map((row) => ({
      code: String(row.code).trim(),
      name: String(row.name).trim(),
      shares: row.shares,
      amount: row.amount,
      weight: row.weight
    }))
    .sort((a, b) => b.weight - a.weight);
}

async function saveSnapshot(snapshot) {
  const dir = join(DATA_DIR, snapshot.tranDate);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${snapshot.stockNo}.json`), JSON.stringify(snapshot, null, 2), "utf8");
  const csvLines = ["code,name,shares,amount,weight"];
  for (const stock of snapshot.stocks) {
    csvLines.push(`${stock.code},${stock.name},${stock.shares},${stock.amount ?? ""},${stock.weight}`);
  }
  await writeFile(join(dir, `${snapshot.stockNo}.csv`), `﻿${csvLines.join("\n")}\n`, "utf8");
}

// 回應日期可能是 ISO 字串或 ASP.NET 的 /Date(毫秒)/ 格式，統一轉成 YYYY-MM-DD（台北時區）。
function parseDotNetDate(value) {
  if (!value) return "";
  let date;
  const match = /\/Date\((\d+)/.exec(String(value));
  if (match) {
    date = new Date(Number(match[1]));
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return "";
  const taipei = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const month = String(taipei.getMonth() + 1).padStart(2, "0");
  const day = String(taipei.getDate()).padStart(2, "0");
  return `${taipei.getFullYear()}-${month}-${day}`;
}

function rocToIso(rocDate) {
  const [year, month, day] = rocDate.split("/");
  return `${Number(year) + 1911}-${month}-${day}`;
}

// 公告日候選：明天優先（收盤後已上傳次日清單），再回退到今天與前幾個營業日。
function rocDateCandidates() {
  const list = [];
  for (const offset of [1, 0, -1, -2, -3]) {
    const date = new Date(Date.now() + offset * 86400000);
    const taipei = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const roc = taipei.getFullYear() - 1911;
    const month = String(taipei.getMonth() + 1).padStart(2, "0");
    const day = String(taipei.getDate()).padStart(2, "0");
    list.push(`${roc}/${month}/${day}`);
  }
  return list;
}

function parseArgs(args) {
  const options = { date: "" };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--date") {
      options.date = args[index + 1] || "";
      index += 1;
    }
  }
  return options;
}
