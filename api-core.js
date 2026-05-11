import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const PORT = Number(process.env.PORT || 8787);
const ROOT = process.cwd();
const LOCAL_CONFIG = await readLocalConfig();
const require = createRequire(import.meta.url);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const TWSE_OPENAPI = "https://openapi.twse.com.tw/v1/opendata";
const FINMIND_API = "https://api.finmindtrade.com/api/v4";
const FINMIND_TOKEN = process.env.FINMIND_TOKEN || LOCAL_CONFIG.FINMIND_TOKEN || LOCAL_CONFIG.finmindToken || "";
const STOCK_MVP_DEPS = process.env.STOCK_MVP_DEPS || join(process.env.USERPROFILE || "", ".stock-mvp-deps", "node_modules");
const CHIP_WINDOWS = [5, 20, 60];
const REVENUE_ENDPOINTS = ["t187ap05_L", "t187ap05_O", "t187ap05_P"];
const INCOME_ENDPOINTS = [
  "t187ap06_L_ci",
  "t187ap06_L_basi",
  "t187ap06_L_bd",
  "t187ap06_L_fh",
  "t187ap06_L_ins",
  "t187ap06_L_mim",
  "t187ap06_X_ci",
  "t187ap06_X_basi",
  "t187ap06_X_bd",
  "t187ap06_X_fh",
  "t187ap06_X_ins",
  "t187ap06_X_mim"
];
const BALANCE_ENDPOINTS = [
  "t187ap07_L_ci",
  "t187ap07_L_basi",
  "t187ap07_L_bd",
  "t187ap07_L_fh",
  "t187ap07_L_ins",
  "t187ap07_L_mim",
  "t187ap07_X_ci",
  "t187ap07_X_basi",
  "t187ap07_X_bd",
  "t187ap07_X_fh",
  "t187ap07_X_ins",
  "t187ap07_X_mim"
];

const cache = new Map();

async function readLocalConfig() {
  try {
    const text = await readFile(join(ROOT, "config.local.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isTaiwanSymbol(symbol) {
  return /^\d{4,6}$/.test(symbol);
}

function yahooSymbol(symbol) {
  return isTaiwanSymbol(symbol) ? `${symbol}.TW` : symbol.toUpperCase();
}

function googleFinanceUrl(symbol) {
  return isTaiwanSymbol(symbol)
    ? `https://www.google.com/finance/quote/${symbol}:TPE`
    : `https://www.google.com/finance/quote/${symbol.toUpperCase()}:NASDAQ`;
}

function nowIso() {
  return new Date().toISOString();
}

function toTaipeiTime(epochSeconds) {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false
  });
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

function movingAverage(values, period) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < period) return null;
  const slice = clean.slice(-period);
  return round(slice.reduce((sum, value) => sum + value, 0) / period);
}

function rocYearToAd(rocYear) {
  const year = Number(String(rocYear).slice(0, 3));
  return Number.isFinite(year) ? year + 1911 : null;
}

function formatRocMonth(value) {
  const text = String(value || "");
  if (text.length < 5) return text || null;
  return `${rocYearToAd(text.slice(0, 3))}/${text.slice(3, 5)}`;
}

function formatRocDate(value) {
  const text = String(value || "");
  if (text.length < 7) return text || null;
  return `${rocYearToAd(text.slice(0, 3))}/${text.slice(3, 5)}/${text.slice(5, 7)}`;
}

function quarterLabel(row) {
  if (!row) return null;
  const year = rocYearToAd(row["年度"]);
  const quarter = row["季別"];
  return year && quarter ? `${year} Q${quarter}` : null;
}

function quarterLabelFromDate(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return dateText || null;
  return `${date.getFullYear()} Q${Math.ceil((date.getMonth() + 1) / 3)}`;
}

function latestDateRows(rows) {
  const dates = [...new Set((rows || []).map((row) => row.date).filter(Boolean))].sort();
  const date = dates.at(-1);
  return { date, rows: date ? rows.filter((row) => row.date === date) : [] };
}

function typeValue(rows, type) {
  const row = rows.find((item) => item.type === type);
  return toNumber(row?.value);
}

function latestRow(rows) {
  return [...(rows || [])].filter((row) => row.date).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1) || null;
}

function findKey(row, includesText) {
  if (!row) return null;
  return Object.keys(row).find((key) => key.includes(includesText));
}

async function fetchJson(url, ttl = 30 * 60_000) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < ttl) return cached.data;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 stock-analysis-mvp",
      accept: "application/json,text/plain,*/*"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const data = await response.json();
  cache.set(url, { time: Date.now(), data });
  return data;
}

async function fetchText(url, ttl = 10 * 60_000) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < ttl) return cached.data;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 stock-analysis-mvp",
      accept: "text/html,text/plain,*/*"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const data = await response.text();
  cache.set(url, { time: Date.now(), data });
  return data;
}

function loadParquetModule() {
  try {
    const resolved = require.resolve("parquetjs-lite", { paths: [STOCK_MVP_DEPS] });
    return require(resolved);
  } catch (error) {
    throw new Error(`缺少 parquetjs-lite，請執行：npm.cmd install --prefix "$env:USERPROFILE\\.stock-mvp-deps" parquetjs-lite@0.8.7 --no-audit --no-fund --no-package-lock。原始錯誤：${error.message}`);
  }
}

async function fetchFinMindData(dataset, stockCode, startDate, endDate) {
  const url = new URL(`${FINMIND_API}/data`);
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("data_id", stockCode);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);

  const headers = {
    "user-agent": "Mozilla/5.0 stock-analysis-mvp",
    accept: "application/json"
  };
  if (FINMIND_TOKEN) headers.Authorization = `Bearer ${FINMIND_TOKEN}`;

  const cacheKey = `finmind-data:${dataset}:${stockCode}:${startDate}:${endDate}:${FINMIND_TOKEN ? "token" : "public"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < 30 * 60_000) return cached.data;

  const response = await fetch(url, { headers });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (json.status && json.status !== 200)) {
    throw new Error(json.msg || json.message || `${response.status} ${response.statusText}`);
  }
  const data = Array.isArray(json.data) ? json.data : [];
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

function sumRows(rows, field) {
  return rows.reduce((sum, row) => sum + (toNumber(row[field]) || 0), 0);
}

function latestByDate(rows) {
  return [...rows].filter((row) => row.date).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1) || null;
}

function institutionName(name) {
  return {
    Foreign_Investor: "外資",
    Foreign_Dealer_Self: "外資自營商",
    Investment_Trust: "投信",
    Dealer_self: "自營商",
    Dealer_Hedging: "自營商避險"
  }[name] || name || "法人";
}

function buildFreeChipWindow(days, tradeDates, priceRows, instRows, marginRows, shareRows) {
  const selectedDates = tradeDates.slice(-days);
  const dateSet = new Set(selectedDates);
  const selectedPrices = priceRows.filter((row) => dateSet.has(row.date));
  const selectedInst = instRows.filter((row) => dateSet.has(row.date));
  const selectedMargin = marginRows.filter((row) => dateSet.has(row.date));
  const selectedShare = shareRows.filter((row) => dateSet.has(row.date));
  const avgPrice = selectedPrices.length
    ? round(selectedPrices.reduce((sum, row) => sum + (toNumber(row.close) || 0), 0) / selectedPrices.length, 2)
    : null;

  const byName = new Map();
  for (const row of selectedInst) {
    const key = row.name || "Institutional";
    const current = byName.get(key) || { buyShares: 0, sellShares: 0, activeDays: new Set() };
    current.buyShares += toNumber(row.buy) || 0;
    current.sellShares += toNumber(row.sell) || 0;
    if (row.date) current.activeDays.add(row.date);
    byName.set(key, current);
  }

  const items = [...byName.entries()].map(([name, item]) => ({
    brokerId: name,
    brokerName: institutionName(name),
    buyShares: Math.round(item.buyShares),
    sellShares: Math.round(item.sellShares),
    netShares: Math.round(item.buyShares - item.sellShares),
    netLots: round((item.buyShares - item.sellShares) / 1000, 2),
    avgPrice,
    activeDays: item.activeDays.size,
    type: "institution"
  }));

  if (selectedMargin.length) {
    const sortedMargin = [...selectedMargin].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const first = sortedMargin[0];
    const last = sortedMargin.at(-1);
    const marginDelta = (toNumber(last?.MarginPurchaseTodayBalance) || 0) - (toNumber(first?.MarginPurchaseYesterdayBalance) || toNumber(first?.MarginPurchaseTodayBalance) || 0);
    const shortDelta = (toNumber(last?.ShortSaleTodayBalance) || 0) - (toNumber(first?.ShortSaleYesterdayBalance) || toNumber(first?.ShortSaleTodayBalance) || 0);
    items.push({
      brokerId: "MarginPurchase",
      brokerName: "融資餘額變化",
      buyShares: sumRows(selectedMargin, "MarginPurchaseBuy") * 1000,
      sellShares: (sumRows(selectedMargin, "MarginPurchaseSell") + sumRows(selectedMargin, "MarginPurchaseCashRepayment")) * 1000,
      netShares: marginDelta * 1000,
      netLots: round(marginDelta, 2),
      avgPrice,
      activeDays: selectedMargin.length,
      type: "margin"
    });
    items.push({
      brokerId: "ShortSale",
      brokerName: "融券餘額變化",
      buyShares: sumRows(selectedMargin, "ShortSaleSell") * 1000,
      sellShares: (sumRows(selectedMargin, "ShortSaleBuy") + sumRows(selectedMargin, "ShortSaleCashRepayment")) * 1000,
      netShares: shortDelta * 1000,
      netLots: round(shortDelta, 2),
      avgPrice,
      activeDays: selectedMargin.length,
      type: "margin"
    });
  }

  const shareLatest = latestByDate(selectedShare);
  const shareFirst = [...selectedShare].sort((a, b) => String(a.date).localeCompare(String(b.date))).at(0);
  if (shareLatest) {
    const latestShares = toNumber(shareLatest.foreign_investment_shares);
    const firstShares = toNumber(shareFirst?.foreign_investment_shares);
    const delta = Number.isFinite(latestShares) && Number.isFinite(firstShares) ? latestShares - firstShares : null;
    items.push({
      brokerId: "ForeignShareholding",
      brokerName: "外資持股變化",
      buyShares: delta && delta > 0 ? delta : 0,
      sellShares: delta && delta < 0 ? Math.abs(delta) : 0,
      netShares: delta,
      netLots: Number.isFinite(delta) ? round(delta / 1000, 2) : null,
      avgPrice,
      activeDays: selectedShare.length,
      type: "shareholding",
      ratio: toNumber(shareLatest.foreign_investment_shares_ratio)
    });
  }

  return {
    days,
    startDate: selectedDates[0] || null,
    endDate: selectedDates.at(-1) || null,
    rowCount: selectedInst.length + selectedMargin.length + selectedShare.length,
    topBuy: items.filter((item) => item.netShares > 0).sort((a, b) => b.netShares - a.netShares),
    topSell: items.filter((item) => item.netShares < 0).sort((a, b) => a.netShares - b.netShares)
  };
}

async function fetchFreeChipBundle(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!isTaiwanSymbol(symbol)) {
    return {
      ok: false,
      provider: "FinMind Free datasets",
      message: "Free 籌碼資料目前只支援台股代號。"
    };
  }

  const startDate = dateDaysAgo(130);
  const endDate = isoDate(new Date());
  const [priceRows, instRows, marginRows, shareRows] = await Promise.all([
    fetchFinMindData("TaiwanStockPrice", symbol, startDate, endDate),
    fetchFinMindData("TaiwanStockInstitutionalInvestorsBuySell", symbol, startDate, endDate),
    fetchFinMindData("TaiwanStockMarginPurchaseShortSale", symbol, startDate, endDate),
    fetchFinMindData("TaiwanStockShareholding", symbol, startDate, endDate).catch(() => [])
  ]);

  const tradeDates = [...new Set(priceRows.map((row) => row.date).filter(Boolean))].sort().slice(-60);
  if (!tradeDates.length) throw new Error("無法取得最近交易日，Free 籌碼區間無法計算。");

  const windows = {};
  for (const days of CHIP_WINDOWS) {
    windows[String(days)] = buildFreeChipWindow(days, tradeDates, priceRows, instRows, marginRows, shareRows);
  }

  return {
    ok: true,
    provider: "FinMind Free datasets",
    sourceUrl: `${FINMIND_API}/data`,
    plan: "Free",
    tokenConfigured: Boolean(FINMIND_TOKEN),
    checkedAt: nowIso(),
    latestTradingDate: tradeDates.at(-1) || null,
    availableDates: tradeDates,
    datasets: [
      "TaiwanStockInstitutionalInvestorsBuySell",
      "TaiwanStockMarginPurchaseShortSale",
      "TaiwanStockShareholding",
      "TaiwanStockPrice"
    ],
    note: "Free 方案不含券商分點與分點均價；此區以三大法人、融資融券、外資持股與區間均價替代。",
    windows
  };
}

async function fetchFinMindTradingDailyReport(stockCode, date) {
  const url = new URL(`${FINMIND_API}/storage_objects`);
  url.searchParams.set("dataset", "TaiwanStockTradingDailyReport");
  url.searchParams.set("date", date);
  const cacheKey = `finmind:${stockCode}:${date}:${FINMIND_TOKEN ? "token" : "public"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < 6 * 60 * 60_000) return cached.data;

  const headers = {
    "user-agent": "Mozilla/5.0 stock-analysis-mvp",
    accept: "application/json"
  };
  if (FINMIND_TOKEN) headers.Authorization = `Bearer ${FINMIND_TOKEN}`;

  const response = await fetch(url, { headers });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.msg || json.message || `${response.status} ${response.statusText}`);
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const parquet = loadParquetModule();
  const buffer = Buffer.from(await response.arrayBuffer());
  const reader = await parquet.ParquetReader.openBuffer(buffer);
  const cursor = reader.getCursor();
  const data = [];
  try {
    let row;
    while ((row = await cursor.next())) {
      if (String(row.stock_id || "").trim() === stockCode) data.push(row);
    }
  } finally {
    await reader.close();
  }
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

function aggregateBrokerRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = String(row.securities_trader_id || "").trim();
    const name = String(row.securities_trader || "").trim();
    if (!id && !name) continue;
    const key = id || name;
    const buy = toNumber(row.buy) || 0;
    const sell = toNumber(row.sell) || 0;
    const price = toNumber(row.price);
    const current = map.get(key) || {
      brokerId: id,
      brokerName: name || id,
      buyShares: 0,
      sellShares: 0,
      netShares: 0,
      grossShares: 0,
      turnoverValue: 0,
      activeDays: new Set()
    };
    current.buyShares += buy;
    current.sellShares += sell;
    current.netShares += buy - sell;
    current.grossShares += buy + sell;
    if (Number.isFinite(price)) current.turnoverValue += (buy + sell) * price;
    if (row.date) current.activeDays.add(row.date);
    map.set(key, current);
  }

  return [...map.values()].map((item) => ({
    brokerId: item.brokerId,
    brokerName: item.brokerName,
    buyShares: Math.round(item.buyShares),
    sellShares: Math.round(item.sellShares),
    netShares: Math.round(item.netShares),
    netLots: round(item.netShares / 1000, 2),
    avgPrice: item.grossShares ? round(item.turnoverValue / item.grossShares, 2) : null,
    activeDays: item.activeDays.size
  }));
}

async function fetchBrokerChip(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!isTaiwanSymbol(symbol)) {
    return {
      ok: false,
      provider: "FinMind TaiwanStockTradingDailyReport",
      message: "券商分點籌碼目前只支援台股代號。"
    };
  }

  const startDate = dateDaysAgo(100);
  const stockUrl = new URL(`${FINMIND_API}/data`);
  stockUrl.searchParams.set("dataset", "TaiwanStockPrice");
  stockUrl.searchParams.set("data_id", symbol);
  stockUrl.searchParams.set("start_date", startDate);
  const priceJson = await fetchJson(stockUrl.toString(), 30 * 60_000);
  const priceRows = Array.isArray(priceJson.data) ? priceJson.data : [];
  const tradeDates = [...new Set(priceRows.map((row) => row.date).filter(Boolean))].sort().slice(-60);
  if (!tradeDates.length) throw new Error("無法取得最近 60 個交易日日期，籌碼區間無法計算。");

  const maxDates = tradeDates.slice(-60);
  const rowsByDate = [];
  const errors = [];
  for (const date of maxDates) {
    try {
      const rows = await fetchFinMindTradingDailyReport(symbol, date);
      rowsByDate.push({ date, rows });
    } catch (error) {
      errors.push(`${date}: ${error.message}`);
      if (errors.length >= 3 && rowsByDate.length === 0) break;
    }
  }

  if (!rowsByDate.length) {
    return {
      ok: false,
      provider: "FinMind TaiwanStockTradingDailyReport",
      sourceUrl: `${FINMIND_API}/storage_objects?dataset=TaiwanStockTradingDailyReport`,
      requiredPlan: "sponsor",
      tokenConfigured: Boolean(FINMIND_TOKEN),
      checkedAt: nowIso(),
      message: errors[0] || "無法取得券商分點資料。FinMind 分點資料集需要 sponsor 會員權限。",
      notes: [
        "TWSE/TPEx 官方分點查詢有驗證碼，不適合在 MVP 後端自動化繞過。",
        "若設定 FINMIND_TOKEN 且帳號有 sponsor 權限，即可回傳 5/20/60 交易日分點買賣超與均價。"
      ]
    };
  }

  const windows = {};
  for (const days of CHIP_WINDOWS) {
    const selected = rowsByDate.slice(-days);
    const rows = selected.flatMap((item) => item.rows);
    const aggregated = aggregateBrokerRows(rows);
    windows[String(days)] = {
      days,
      startDate: selected[0]?.date || null,
      endDate: selected.at(-1)?.date || null,
      rowCount: rows.length,
      topBuy: aggregated
        .filter((item) => item.netShares > 0)
        .sort((a, b) => b.netShares - a.netShares)
        .slice(0, 10),
      topSell: aggregated
        .filter((item) => item.netShares < 0)
        .sort((a, b) => a.netShares - b.netShares)
        .slice(0, 10)
    };
  }

  return {
    ok: true,
    provider: "FinMind TaiwanStockTradingDailyReport",
    sourceUrl: `${FINMIND_API}/storage_objects?dataset=TaiwanStockTradingDailyReport`,
    requiredPlan: "sponsor",
    tokenConfigured: Boolean(FINMIND_TOKEN),
    checkedAt: nowIso(),
    latestTradingDate: rowsByDate.at(-1)?.date || null,
    availableDates: rowsByDate.map((item) => item.date),
    errors: errors.slice(0, 5),
    windows
  };
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchYahooQuote(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  const ySymbol = yahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?range=6mo&interval=1d`;
  const json = await fetchJson(url, 60_000);
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(json.chart?.error?.description || "Yahoo returned no chart data");

  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const closes = (quote.close || []).filter((value) => Number.isFinite(value));
  const lastClose = closes.at(-1) ?? meta.regularMarketPrice;
  const previousClose = closes.at(-2) ?? meta.chartPreviousClose;

  return {
    ok: true,
    provider: "Yahoo Finance",
    url,
    symbol: ySymbol,
    name: meta.longName || meta.shortName || symbol,
    market: isTaiwanSymbol(symbol) ? "台股" : "美股",
    price: round(meta.regularMarketPrice ?? lastClose),
    changePct: previousClose ? round(((lastClose - previousClose) / previousClose) * 100, 2) : null,
    volume: quote.volume?.at(-1) || meta.regularMarketVolume || null,
    currency: meta.currency || null,
    priceUpdatedAt: toTaipeiTime(meta.regularMarketTime),
    fetchedAt: nowIso(),
    ma5: movingAverage(closes, 5),
    ma10: movingAverage(closes, 10),
    ma20: movingAverage(closes, 20),
    ma60: movingAverage(closes, 60),
    closeCount: closes.length
  };
}

async function fetchGoogleFinance(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  const url = googleFinanceUrl(symbol);
  const html = await fetchText(url);
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = stripHtml(
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1]
  );
  const priceText = stripHtml(html.match(/class=["'][^"']*YMlKec[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);

  return {
    ok: true,
    provider: "Google Finance",
    url,
    checkedAt: nowIso(),
    status: priceText ? "Google Finance page reachable; price parsed best-effort" : "Google Finance page reachable; stable price field not found",
    title: title || null,
    description: description || null,
    priceText: priceText || null,
    note: "Google Finance does not provide a stable official public API for this MVP; this adapter is for backend cross-checking and link verification."
  };
}

async function findTwseRow(endpoints, stockCode) {
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const rows = await fetchJson(`${TWSE_OPENAPI}/${endpoint}`);
      const row = Array.isArray(rows) ? rows.find((item) => item["公司代號"] === stockCode) : null;
      if (row) return { row, endpoint };
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  return { row: null, endpoint: null, errors };
}

async function fetchMonthlyRevenue(stockCode) {
  const { row, endpoint, errors } = await findTwseRow(REVENUE_ENDPOINTS, stockCode);
  if (!row) {
    return {
      ok: false,
      provider: "MOPS / TWSE OpenAPI",
      message: errors?.[0] || "No monthly revenue data found"
    };
  }

  return {
    ok: true,
    provider: "MOPS / TWSE OpenAPI",
    endpoint,
    sourceUrl: `${TWSE_OPENAPI}/${endpoint}`,
    companyName: row["公司名稱"],
    industry: row["產業別"],
    reportDate: formatRocDate(row["出表日期"]),
    revenueMonth: formatRocMonth(row["資料年月"]),
    revenue: toNumber(row["營業收入-當月營收"]),
    previousRevenue: toNumber(row["營業收入-上月營收"]),
    lastYearRevenue: toNumber(row["營業收入-去年當月營收"]),
    revenueMom: toNumber(row["營業收入-上月比較增減(%)"]),
    revenueYoy: toNumber(row["營業收入-去年同月增減(%)"]),
    cumulativeYoy: toNumber(row["累計營業收入-前期比較增減(%)"]),
    note: row["備註"] || "-"
  };
}

async function fetchFinancials(stockCode, price) {
  const startDate = dateDaysAgo(560);
  const endDate = isoDate(new Date());
  try {
    const [incomeRows, balanceRows, cashRows, perRows] = await Promise.all([
      fetchFinMindData("TaiwanStockFinancialStatements", stockCode, startDate, endDate),
      fetchFinMindData("TaiwanStockBalanceSheet", stockCode, startDate, endDate),
      fetchFinMindData("TaiwanStockCashFlowsStatement", stockCode, startDate, endDate).catch(() => []),
      fetchFinMindData("TaiwanStockPER", stockCode, dateDaysAgo(30), endDate).catch(() => [])
    ]);
    const incomeLatest = latestDateRows(incomeRows);
    const balanceLatest = latestDateRows(balanceRows);
    const cashLatest = latestDateRows(cashRows);
    if (!incomeLatest.rows.length && !balanceLatest.rows.length) {
      throw new Error("No latest quarterly financial statement row found from FinMind");
    }

    const eps = typeValue(incomeLatest.rows, "EPS");
    const revenue = typeValue(incomeLatest.rows, "Revenue");
    const grossProfit = typeValue(incomeLatest.rows, "GrossProfit");
    const netIncome = typeValue(incomeLatest.rows, "EquityAttributableToOwnersOfParent") || typeValue(incomeLatest.rows, "IncomeAfterTaxes");
    const equity = typeValue(balanceLatest.rows, "EquityAttributableToOwnersOfParent") || typeValue(balanceLatest.rows, "Equity");
    const liability = typeValue(balanceLatest.rows, "Liabilities");
    const assets = typeValue(balanceLatest.rows, "TotalAssets");
    const ordinaryShareCapital = typeValue(balanceLatest.rows, "OrdinaryShare");
    const shares = ordinaryShareCapital ? ordinaryShareCapital / 10 : null;
    const bookValue = equity && shares ? round(equity / shares, 2) : null;
    const operatingCashFlow = typeValue(cashLatest.rows, "NetCashInflowFromOperatingActivities") || typeValue(cashLatest.rows, "CashFlowsFromOperatingActivities");
    const capex = typeValue(cashLatest.rows, "PropertyAndPlantAndEquipment");
    const fcf = Number.isFinite(operatingCashFlow) && Number.isFinite(capex) ? operatingCashFlow + capex : null;
    const perLatest = latestRow(perRows);

    return {
      ok: true,
      provider: "FinMind Free datasets",
      incomeEndpoint: "TaiwanStockFinancialStatements",
      balanceEndpoint: "TaiwanStockBalanceSheet",
      cashFlowEndpoint: cashLatest.rows.length ? "TaiwanStockCashFlowsStatement" : null,
      sourceUrls: [
        `${FINMIND_API}/data?dataset=TaiwanStockFinancialStatements&data_id=${stockCode}`,
        `${FINMIND_API}/data?dataset=TaiwanStockBalanceSheet&data_id=${stockCode}`,
        `${FINMIND_API}/data?dataset=TaiwanStockCashFlowsStatement&data_id=${stockCode}`,
        `${FINMIND_API}/data?dataset=TaiwanStockPER&data_id=${stockCode}`
      ],
      fiscalQuarter: quarterLabelFromDate(incomeLatest.date || balanceLatest.date),
      reportDate: incomeLatest.date || balanceLatest.date,
      eps,
      annualizedPe: toNumber(perLatest?.PER) || (eps && price ? round(price / (eps * 4), 2) : null),
      bookValuePerShare: bookValue,
      pb: toNumber(perLatest?.PBR) || (bookValue && price ? round(price / bookValue, 2) : null),
      dividendYield: toNumber(perLatest?.dividend_yield),
      roe: netIncome && equity ? round((netIncome * 4 / equity) * 100, 2) : null,
      debtRatio: liability && assets ? round((liability / assets) * 100, 2) : null,
      grossMargin: grossProfit && revenue ? round((grossProfit / revenue) * 100, 2) : null,
      fcf,
      operatingCashFlow,
      capex,
      netIncome,
      equity,
      assets,
      liability
    };
  } catch (finMindError) {
    // Fallback keeps the old TWSE OpenAPI path available if FinMind is temporarily unavailable.
  }

  const incomeResult = await findTwseRow(INCOME_ENDPOINTS, stockCode);
  const balanceResult = await findTwseRow(BALANCE_ENDPOINTS, stockCode);
  const income = incomeResult.row;
  const balance = balanceResult.row;

  if (!income && !balance) {
    return {
      ok: false,
      provider: "MOPS / TWSE OpenAPI",
      message: "No latest quarterly financial statement row found"
    };
  }

  const epsKey = findKey(income, "基本每股");
  const netIncomeKey = findKey(income, "歸屬於母公司業主");
  const grossProfitKey = findKey(income, "毛利");
  const revenueKey = findKey(income, "營業收入");
  const equityKey = findKey(balance, "權益總計") || findKey(balance, "權益總額");
  const liabilityKey = findKey(balance, "負債總計") || findKey(balance, "負債總額");
  const assetKey = findKey(balance, "資產總計") || findKey(balance, "資產總額");
  const bookValueKey = findKey(balance, "每股參考淨值");

  const eps = toNumber(income?.[epsKey]);
  const netIncome = toNumber(income?.[netIncomeKey]);
  const equity = toNumber(balance?.[equityKey]);
  const liability = toNumber(balance?.[liabilityKey]);
  const assets = toNumber(balance?.[assetKey]);
  const bookValue = toNumber(balance?.[bookValueKey]);
  const revenue = toNumber(income?.[revenueKey]);
  const grossProfit = toNumber(income?.[grossProfitKey]);

  return {
    ok: true,
    provider: "MOPS / TWSE OpenAPI",
    incomeEndpoint: incomeResult.endpoint,
    balanceEndpoint: balanceResult.endpoint,
    sourceUrls: [incomeResult.endpoint, balanceResult.endpoint].filter(Boolean).map((endpoint) => `${TWSE_OPENAPI}/${endpoint}`),
    fiscalQuarter: quarterLabel(income || balance),
    reportDate: formatRocDate((income || balance)?.["出表日期"]),
    eps,
    annualizedPe: eps && price ? round(price / (eps * 4), 2) : null,
    bookValuePerShare: bookValue,
    pb: bookValue && price ? round(price / bookValue, 2) : null,
    roe: netIncome && equity ? round((netIncome * 4 / equity) * 100, 2) : null,
    debtRatio: liability && assets ? round((liability / assets) * 100, 2) : null,
    grossMargin: grossProfit && revenue ? round((grossProfit / revenue) * 100, 2) : null,
    netIncome,
    equity,
    assets,
    liability
  };
}

async function fetchMopsBundle(rawSymbol, price) {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!isTaiwanSymbol(symbol)) {
    return {
      ok: false,
      provider: "MOPS / TWSE OpenAPI",
      symbol,
      message: "MOPS / TWSE OpenAPI is only used for Taiwan stock symbols in this MVP."
    };
  }
  const [monthlyRevenue, financials] = await Promise.all([
    fetchMonthlyRevenue(symbol).catch((error) => ({ ok: false, provider: "MOPS / TWSE OpenAPI", message: error.message })),
    fetchFinancials(symbol, price).catch((error) => ({ ok: false, provider: "MOPS / TWSE OpenAPI", message: error.message }))
  ]);
  return {
    ok: monthlyRevenue.ok || financials.ok,
    provider: "MOPS / TWSE OpenAPI",
    symbol,
    priceUsedForRatios: price ?? null,
    monthlyRevenue,
    financials
  };
}

async function buildStockPayload(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  const [quote, googleFinance] = await Promise.all([
    fetchYahooQuote(symbol),
    fetchGoogleFinance(symbol).catch((error) => ({
      ok: false,
      provider: "Google Finance",
      url: googleFinanceUrl(symbol),
      checkedAt: nowIso(),
      status: "Google Finance backend check failed",
      message: error.message
    }))
  ]);
  const mops = await fetchMopsBundle(symbol, quote.price);
  const brokerChip = await fetchFreeChipBundle(symbol).catch((error) => ({
    ok: false,
    provider: "FinMind Free datasets",
    checkedAt: nowIso(),
    message: error.message
  }));
  return {
    symbol,
    name: quote.name,
    market: quote.market,
    quote,
    googleFinance,
    monthlyRevenue: mops.monthlyRevenue || null,
    financials: mops.financials || null,
    brokerChip,
    warnings: [
      ...(mops.monthlyRevenue?.ok === false ? [`月營收未取得：${mops.monthlyRevenue.message}`] : []),
      ...(mops.financials?.ok === false ? [`財報未取得：${mops.financials.message}`] : []),
      ...(brokerChip.ok === false ? [`Free 籌碼未取得：${brokerChip.message}`] : []),
      ...(googleFinance.ok === false ? [`Google Finance 查核失敗：${googleFinance.message}`] : [])
    ]
  };
}

function writeJson(response, data, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(data));
}

async function serveStatic(pathname, response) {
  const requestPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^[/\\]+/, "");
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = join(ROOT, safePath);
  if (!fullPath.startsWith(ROOT)) throw new Error("Invalid path");
  const data = await readFile(fullPath);
  response.writeHead(200, {
    "content-type": MIME[extname(fullPath)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  response.end(data);
}

export async function handleRequest(request, response, options = {}) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const symbol = decodeURIComponent(url.pathname.split("/").pop() || "").trim().toUpperCase();

    if (url.pathname.startsWith("/api/yahoo/")) {
      writeJson(response, await fetchYahooQuote(symbol));
      return;
    }

    if (url.pathname.startsWith("/api/google/")) {
      writeJson(response, await fetchGoogleFinance(symbol));
      return;
    }

    if (url.pathname.startsWith("/api/mops/")) {
      const price = url.searchParams.get("price") ? Number(url.searchParams.get("price")) : null;
      writeJson(response, await fetchMopsBundle(symbol, price));
      return;
    }

    if (url.pathname.startsWith("/api/chips/")) {
      writeJson(response, await fetchFreeChipBundle(symbol));
      return;
    }

    if (url.pathname.startsWith("/api/stock/")) {
      writeJson(response, await buildStockPayload(symbol));
      return;
    }

    if (options.apiOnly) {
      writeJson(response, { ok: false, error: "API route not found" }, 404);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    writeJson(response, { ok: false, error: error.message }, error.code === "ENOENT" ? 404 : 500);
  }
}

export {
  fetchYahooQuote,
  fetchGoogleFinance,
  fetchMopsBundle,
  fetchFreeChipBundle,
  buildStockPayload
};
