import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const OPTIONS = parseArgs(process.argv.slice(2));
const HOLDINGS_PATH = resolve(ROOT, OPTIONS.holdingsPath);
const REPORT_DIR = resolve(ROOT, "reports");
const TODAY = taipeiDate(new Date());
const REPORT_SLUG = OPTIONS.market ? `daily-${OPTIONS.market}` : "daily";
const LATEST_SLUG = OPTIONS.market ? `latest-${OPTIONS.market}` : "latest";
const REPORT_LABEL = OPTIONS.market === "tw" ? "台股每日股票投資秘書" : OPTIONS.market === "us" ? "美股每日股票投資秘書" : "每日股票投資秘書";
const REPORT_PATH = join(REPORT_DIR, `${REPORT_SLUG}-${TODAY}.html`);
const INDEX_PATH = join(REPORT_DIR, `${LATEST_SLUG}.html`);
const MAIL_PATH = join(REPORT_DIR, `${LATEST_SLUG}-mail.html`);
const FINMIND_API = "https://api.finmindtrade.com/api/v4/data";
const LOCAL_CONFIG = readJsonSafe(resolve(ROOT, "config.local.json"));
const FINMIND_TOKEN = process.env.FINMIND_TOKEN || LOCAL_CONFIG.FINMIND_TOKEN || "";
const RULES = {
  rsi_period: 14, rsi_overbought: 75, rsi_oversold: 30, ma20_bias_hot_pct: 15,
  take_profit_pct: 100, stop_loss_pct: -15, max_weight_pct: 20, add_score: 2, trim_score: -2,
  ...readJsonSafe(resolve(ROOT, "secretary_rules.json"))
};
// 非交易日時以此結束碼離開，讓排程腳本略過寄信但不當成失敗
const EXIT_NOT_TRADING_DAY = 10;
const FETCH_TIMEOUT_MS = 20000;
// NYSE 休市日（遇週末的國定假日已換成實際休市日）；每年底補下一年
const US_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"
]);

const SOURCE_NOTE = [
  "價格與 K 線：Yahoo Finance chart endpoint，台股依序嘗試 .TW / .TWO。",
  "台股籌碼：FinMind 免費資料集，包含三大法人與融資融券；部分 ETF 或資料源暫缺時會明確標示。",
  "新聞：Google News RSS 搜尋各股票名稱與代號，摘要以標題聚合與關鍵字判讀，不等同投資建議。"
];

main().catch(async (error) => {
  await mkdir(REPORT_DIR, { recursive: true });
  const html = renderFailure(error);
  await writeFile(REPORT_PATH, html, "utf8");
  await writeFile(INDEX_PATH, html, "utf8");
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (OPTIONS.tradingDayOnly) {
    const reason = await nonTradingReason();
    if (reason) {
      console.log(`${TODAY} ${reason}，略過產生報告。`);
      process.exitCode = EXIT_NOT_TRADING_DAY;
      return;
    }
  }
  if (!existsSync(HOLDINGS_PATH)) {
    throw new Error(`找不到持股清單：${HOLDINGS_PATH}`);
  }
  await mkdir(REPORT_DIR, { recursive: true });
  const holdings = aggregateHoldings(parseCsv(await readFile(HOLDINGS_PATH, "utf8"))).filter(marketMatches);
  if (!holdings.length) {
    throw new Error(`持股清單沒有符合 ${OPTIONS.market || "全部"} 市場的資料。`);
  }
  const cards = [];

  for (const holding of holdings) {
    cards.push(await buildCard(holding));
  }
  applyRuleSignals(cards);

  const html = renderReport(cards);
  await writeFile(REPORT_PATH, html, "utf8");
  await writeFile(INDEX_PATH, html, "utf8");
  await writeFile(MAIL_PATH, renderMailBody(cards), "utf8");
  console.log(`晨報已產生：${REPORT_PATH}`);
}

// 回傳非交易日的原因；是交易日回傳空字串。台股休市日查證交所 OpenAPI，查不到時只看週末。
async function nonTradingReason() {
  const weekday = new Date(`${TODAY}T12:00:00+08:00`).getUTCDay();
  if (weekday === 0 || weekday === 6) return "週末休市";
  if (OPTIONS.market === "us") return US_HOLIDAYS.has(TODAY) ? "美股休市" : "";
  if (OPTIONS.market !== "tw") return "";
  try {
    const rows = await fetchJson("https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule");
    const rocDate = `${Number(TODAY.slice(0, 4)) - 1911}${TODAY.slice(5, 7)}${TODAY.slice(8, 10)}`;
    // 清單也列「開始交易日／最後交易日」，那些日子照常交易
    const hit = rows.find((row) => row.Date === rocDate && !/交易日/.test(row.Name || ""));
    return hit ? `台股休市（${hit.Name}）` : "";
  } catch (error) {
    console.error(`休市日查詢失敗，視為交易日：${error.message}`);
    return "";
  }
}

// 依 secretary_rules.json 的門檻為每檔計分，產生「可考慮加碼／續抱觀察／留意減碼」與理由
function applyRuleSignals(cards) {
  const totalValue = cards.reduce((total, card) => total + (card.quote.ok ? card.holding.quantity * card.quote.latest.close : 0), 0);
  for (const card of cards) {
    const { holding, quote } = card;
    const rule = { score: 0, reasons: [], verdict: "資料不足", pnlPct: null, weightPct: null, rsi: null };
    card.rule = rule;
    if (!quote.ok) continue;
    const close = quote.latest.close;
    const cost = toNumber(holding.cost_basis);
    const closes = quote.candles.map((row) => row.close);
    const prevMa20 = movingAverage(quote.candles.slice(0, -1), 20);
    const prevMa60 = movingAverage(quote.candles.slice(0, -1), 60);
    const prevClose = quote.previous?.close;
    rule.rsi = rsi(closes, RULES.rsi_period);
    rule.pnlPct = cost ? ((close - cost) / cost) * 100 : null;
    rule.weightPct = totalValue ? (holding.quantity * close / totalValue) * 100 : null;
    const add = (points, text) => { rule.score += points; rule.reasons.push(text); };

    if (quote.ma20 && quote.ma60) {
      if (close > quote.ma20 && quote.ma20 > quote.ma60) add(1, "均線多頭排列（收盤 > 20 日 > 60 日）");
      if (close < quote.ma20 && quote.ma20 < quote.ma60) add(-1, "均線空頭排列（收盤 < 20 日 < 60 日）");
    }
    if (prevMa60 && prevClose >= prevMa60 && close < quote.ma60) add(-1, "今日跌破 60 日均線");
    if (prevMa20 && prevClose <= prevMa20 && close > quote.ma20) add(1, "今日站回 20 日均線");
    if (rule.rsi !== null && rule.rsi >= RULES.rsi_overbought) add(-1, `RSI ${rule.rsi.toFixed(0)} 過熱（≥ ${RULES.rsi_overbought}）`);
    if (rule.rsi !== null && rule.rsi <= RULES.rsi_oversold) add(1, `RSI ${rule.rsi.toFixed(0)} 超賣（≤ ${RULES.rsi_oversold}）`);
    if (quote.ma20) {
      const bias = ((close - quote.ma20) / quote.ma20) * 100;
      if (bias >= RULES.ma20_bias_hot_pct) add(-1, `20 日乖離 ${fmtPct(bias)}，短線漲多`);
    }
    if (rule.pnlPct !== null && rule.pnlPct <= RULES.stop_loss_pct) add(-2, `虧損 ${fmtPct(rule.pnlPct)} 達停損門檻（${RULES.stop_loss_pct}%）`);
    if (rule.pnlPct !== null && rule.pnlPct >= RULES.take_profit_pct && (close < (quote.ma20 ?? 0) || (rule.rsi ?? 0) >= RULES.rsi_overbought)) {
      add(-1, `獲利 ${fmtPct(rule.pnlPct)} 已達停利門檻且動能轉弱，可考慮分批停利`);
    }
    if (rule.weightPct !== null && rule.weightPct >= RULES.max_weight_pct) add(-1, `占${OPTIONS.market === "us" ? "美股" : OPTIONS.market === "tw" ? "台股" : ""}市值 ${rule.weightPct.toFixed(1)}%，超過單檔上限 ${RULES.max_weight_pct}%`);

    rule.verdict = rule.score >= RULES.add_score ? "可考慮加碼" : rule.score <= RULES.trim_score ? "留意減碼" : "續抱觀察";
  }
}

function rsi(closes, period) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  gain /= period;
  loss /= period;
  // Wilder 平滑
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

const VERDICT_ORDER = { "留意減碼": 0, "可考慮加碼": 1, "續抱觀察": 2, "資料不足": 3 };
const VERDICT_COLOR = { "留意減碼": "#b42318", "可考慮加碼": "#027a48", "續抱觀察": "#475467", "資料不足": "#9a3412" };

function sortedBySignal(cards) {
  return [...cards].sort((a, b) => VERDICT_ORDER[a.rule.verdict] - VERDICT_ORDER[b.rule.verdict] || a.rule.score - b.rule.score);
}

function renderSignalTable(cards, inline = false) {
  const cell = inline ? ' style="border:1px solid #d9e0ea;padding:4px 8px;"' : "";
  const num = inline ? ' style="border:1px solid #d9e0ea;padding:4px 8px;text-align:right;"' : ' class="num"';
  const rows = sortedBySignal(cards).map(({ holding, quote, rule }) => {
    const color = quote.ok && quote.change >= 0 ? "#b42318" : "#027a48";
    return `<tr>
      <td${cell}>${escapeHtml(holding.symbol)} ${escapeHtml(holding.name)}</td>
      <td${num}>${quote.ok ? fmtNumber(quote.latest.close) : "-"}</td>
      <td${num}><span style="color:${color}">${quote.ok ? fmtPct(quote.changePct) : "-"}</span></td>
      <td${num}>${rule.pnlPct === null ? "-" : fmtPct(rule.pnlPct)}</td>
      <td${num}>${rule.weightPct === null ? "-" : `${rule.weightPct.toFixed(1)}%`}</td>
      <td${num}>${rule.rsi === null ? "-" : rule.rsi.toFixed(0)}</td>
      <td${cell}><strong style="color:${VERDICT_COLOR[rule.verdict]}">${rule.verdict}</strong></td>
      <td${cell}>${escapeHtml(rule.reasons.join("；") || "無觸發規則")}</td>
    </tr>`;
  }).join("");
  const th = inline ? ' style="border:1px solid #d9e0ea;padding:4px 8px;background:#1f4e78;color:#fff;"' : "";
  const heads = ["股票", "收盤", "漲跌", "損益", "占比", "RSI", "規則訊號", "觸發理由"];
  return `<table${inline ? ' style="border-collapse:collapse;font-size:13px;"' : ' class="signals"'}><thead><tr>${heads.map((h) => `<th${th}>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

function verdictCounts(cards) {
  const counts = { "可考慮加碼": 0, "續抱觀察": 0, "留意減碼": 0, "資料不足": 0 };
  for (const card of cards) counts[card.rule.verdict] += 1;
  return counts;
}

function renderMailBody(cards) {
  const c = verdictCounts(cards);
  const dataDate = cards.find((card) => card.quote.ok)?.quote.latest.date || "-";
  return `<div style="font-family:'Microsoft JhengHei',Arial,sans-serif;line-height:1.6;color:#172033;">
  <p><strong>${escapeHtml(REPORT_LABEL)}</strong>｜報告日 ${escapeHtml(TODAY)}｜價格資料日 ${escapeHtml(dataDate)}</p>
  <p>留意減碼 <strong style="color:#b42318">${c["留意減碼"]}</strong> 檔｜可考慮加碼 <strong style="color:#027a48">${c["可考慮加碼"]}</strong> 檔｜續抱觀察 ${c["續抱觀察"]} 檔${c["資料不足"] ? `｜資料不足 ${c["資料不足"]} 檔` : ""}</p>
  ${renderSignalTable(cards, true)}
  <p style="color:#667085;font-size:12px;">規則訊號依 secretary_rules.json 門檻機械式計算（均線排列、RSI、20 日乖離、停利停損、單檔占比），不構成投資建議；完整個股卡片、K 線與新聞見附件。</p>
</div>`;
}

function readJsonSafe(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) : {};
  } catch {
    return {};
  }
}

function parseArgs(args) {
  const options = { holdingsPath: "holdings.csv", market: "", tradingDayOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--market") {
      options.market = normalizeMarket(args[index + 1] || "");
      index += 1;
    } else if (arg === "--trading-day-only") {
      options.tradingDayOnly = true;
    } else if (arg.startsWith("--market=")) {
      options.market = normalizeMarket(arg.slice("--market=".length));
    } else if (!arg.startsWith("--")) {
      options.holdingsPath = arg;
    }
  }
  return options;
}

function normalizeMarket(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["tw", "taiwan", "台股"].includes(text)) return "tw";
  if (["us", "usa", "美股", "美國"].includes(text)) return "us";
  return "";
}

function marketMatches(holding) {
  if (!OPTIONS.market) return true;
  if (OPTIONS.market === "tw") return holding.market.includes("台");
  if (OPTIONS.market === "us") return holding.market.includes("美");
  return true;
}

async function buildCard(holding) {
  const [quote, chips, news] = await Promise.all([
    fetchQuote(holding).catch((error) => ({ ok: false, error: error.message, candles: [] })),
    fetchChips(holding).catch((error) => ({ ok: false, error: error.message })),
    fetchNews(holding).catch((error) => ({ ok: false, error: error.message, items: [] }))
  ]);
  return {
    holding,
    quote,
    chips,
    news,
    signals: buildSignals(holding, quote, chips, news)
  };
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines.shift()).map((item) => item.trim());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function aggregateHoldings(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!row.symbol) continue;
    const key = `${row.market}:${row.symbol.toUpperCase()}`;
    const quantity = toNumber(row.quantity) || 0;
    const cost = toNumber(row.cost_basis);
    const current = byKey.get(key) || { ...row, symbol: row.symbol.toUpperCase(), quantity: 0, costValue: 0, costQty: 0 };
    current.quantity += quantity;
    if (Number.isFinite(cost) && quantity > 0) {
      current.costValue += cost * quantity;
      current.costQty += quantity;
    }
    byKey.set(key, current);
  }
  return [...byKey.values()].map((row) => ({
    ...row,
    quantity: round(row.quantity, 4),
    cost_basis: row.costQty ? round(row.costValue / row.costQty, 4) : row.cost_basis
  }));
}

async function fetchQuote(holding) {
  const candidates = yahooCandidates(holding);
  const errors = [];
  for (const symbol of candidates) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
      const json = await fetchJson(url);
      const result = json.chart?.result?.[0];
      if (!result) throw new Error(json.chart?.error?.description || "Yahoo 無資料");
      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const candles = timestamps.map((ts, index) => ({
        date: taipeiDate(new Date(ts * 1000)),
        open: quote.open?.[index],
        high: quote.high?.[index],
        low: quote.low?.[index],
        close: quote.close?.[index],
        volume: quote.volume?.[index]
      })).filter((row) => Number.isFinite(row.close));
      if (!candles.length) throw new Error("Yahoo K 線為空");
      const latest = candles.at(-1);
      const prev = candles.at(-2);
      const change = prev ? latest.close - prev.close : null;
      return {
        ok: true,
        yahooSymbol: symbol,
        currency: result.meta?.currency || "",
        exchange: result.meta?.exchangeName || "",
        latest,
        previous: prev,
        change,
        changePct: prev?.close ? (change / prev.close) * 100 : null,
        ma20: movingAverage(candles, 20),
        ma60: movingAverage(candles, 60),
        candles
      };
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
  }
  throw new Error(errors.join("；"));
}

function yahooCandidates(holding) {
  if (holding.market.includes("台")) return [`${holding.symbol}.TW`, `${holding.symbol}.TWO`];
  return [holding.symbol];
}

async function fetchChips(holding) {
  if (!holding.market.includes("台")) {
    return { ok: false, skipped: true, message: "美股暫無台股籌碼欄位。" };
  }
  const end = TODAY;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);
  const start = taipeiDate(startDate);
  const [priceRows, instRows, marginRows] = await Promise.all([
    finmind("TaiwanStockPrice", holding.symbol, start, end),
    finmind("TaiwanStockInstitutionalInvestorsBuySell", holding.symbol, start, end),
    finmind("TaiwanStockMarginPurchaseShortSale", holding.symbol, start, end)
  ]);
  const dates = [...new Set(priceRows.map((row) => row.date).filter(Boolean))].sort();
  const latestDate = dates.at(-1);
  const latestInst = instRows.filter((row) => row.date === latestDate);
  const instNet = sum(latestInst, "buy") - sum(latestInst, "sell");
  const latestMargin = marginRows.filter((row) => row.date === latestDate).at(-1);
  return {
    ok: true,
    latestDate,
    institutionalNetShares: instNet,
    marginBalance: num(latestMargin?.MarginPurchaseTodayBalance),
    marginChange: num(latestMargin?.MarginPurchaseTodayBalance) - num(latestMargin?.MarginPurchaseYesterdayBalance),
    shortBalance: num(latestMargin?.ShortSaleTodayBalance),
    shortChange: num(latestMargin?.ShortSaleTodayBalance) - num(latestMargin?.ShortSaleYesterdayBalance)
  };
}

async function finmind(dataset, symbol, startDate, endDate) {
  const url = new URL(FINMIND_API);
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("data_id", symbol);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  const headers = { accept: "application/json" };
  if (FINMIND_TOKEN) headers.Authorization = `Bearer ${FINMIND_TOKEN}`;
  const json = await fetchJson(url, headers);
  if (!Array.isArray(json.data)) throw new Error(json.msg || `${dataset} 無資料`);
  return json.data;
}

async function fetchNews(holding) {
  const query = `${holding.symbol} ${holding.name} 股票`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const text = await fetchText(url);
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map((match) => {
    const block = match[1];
    return {
      title: decodeXml(extractTag(block, "title")),
      link: decodeXml(extractTag(block, "link")),
      pubDate: decodeXml(extractTag(block, "pubDate")),
      source: decodeXml(extractTag(block, "source"))
    };
  });
  return { ok: true, items };
}

function buildSignals(holding, quote, chips, news) {
  const signals = [];
  if (quote.ok) {
    if (quote.changePct >= 2) signals.push(`前一交易日上漲 ${fmtPct(quote.changePct)}，短線轉強，留意是否為新聞或籌碼推動。`);
    if (quote.changePct <= -2) signals.push(`前一交易日下跌 ${fmtPct(Math.abs(quote.changePct))}，需確認是否有基本面或產業消息。`);
    if (quote.ma20 && quote.latest.close > quote.ma20) signals.push("收盤價站上 20 日均線，短線趨勢偏正向。");
    if (quote.ma20 && quote.latest.close < quote.ma20) signals.push("收盤價低於 20 日均線，短線仍需觀察。");
    if (Number.isFinite(toNumber(holding.cost_basis))) {
      const pnl = ((quote.latest.close - toNumber(holding.cost_basis)) / toNumber(holding.cost_basis)) * 100;
      signals.push(`相對持有成本約 ${fmtPct(pnl)}。`);
    }
  }
  if (chips.ok && Number.isFinite(chips.institutionalNetShares)) {
    const lots = chips.institutionalNetShares / 1000;
    signals.push(`三大法人前一交易日${lots >= 0 ? "買超" : "賣超"}約 ${fmtNumber(Math.abs(lots))} 張。`);
  }
  const titles = news.items?.map((item) => item.title).join(" ") || "";
  if (/法說|財報|營收|獲利|股利|配息|AI|伺服器|晶片|降息|匯率/.test(titles)) {
    signals.push("新聞標題出現財報、營收、股利、AI 或總經關鍵字，建議人工點開確認細節。");
  }
  return signals.slice(0, 5);
}

function renderReport(cards) {
  const generatedAt = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  const okQuotes = cards.filter((card) => card.quote.ok).length;
  const up = cards.filter((card) => card.quote.ok && card.quote.change > 0).length;
  const down = cards.filter((card) => card.quote.ok && card.quote.change < 0).length;
  const counts = verdictCounts(cards);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(REPORT_LABEL)} ${escapeHtml(TODAY)}</title>
  <style>
    :root { color-scheme: light; --ink:#172033; --muted:#667085; --line:#d9e0ea; --bg:#f6f8fb; --panel:#fff; --up:#b42318; --down:#027a48; --accent:#255e9c; }
    body { margin:0; font-family:"Microsoft JhengHei","Noto Sans TC",Arial,sans-serif; background:var(--bg); color:var(--ink); }
    header { padding:28px 32px 20px; background:#fff; border-bottom:1px solid var(--line); }
    h1 { margin:0 0 8px; font-size:28px; letter-spacing:0; }
    h2 { margin:0 0 14px; font-size:20px; }
    .meta { color:var(--muted); font-size:14px; }
    .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; padding:18px 32px; }
    .metric { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    .metric strong { display:block; font-size:24px; }
    main { padding:0 32px 32px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(360px,1fr)); gap:16px; }
    article { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    .top { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
    .name { font-size:18px; font-weight:700; }
    .tags { color:var(--muted); font-size:13px; margin-top:4px; }
    .price { text-align:right; white-space:nowrap; }
    .price strong { font-size:22px; }
    .up { color:var(--up); } .down { color:var(--down); }
    .chart { width:100%; height:126px; margin:12px 0; border:1px solid var(--line); border-radius:6px; background:#fbfcfe; }
    dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 14px; margin:12px 0; }
    dt { color:var(--muted); font-size:12px; } dd { margin:2px 0 0; font-weight:600; }
    ul { margin:10px 0 0 20px; padding:0; }
    li { margin:5px 0; line-height:1.45; }
    a { color:var(--accent); text-decoration:none; }
    .warn { color:#9a3412; }
    .signal-wrap { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:16px; overflow-x:auto; }
    table.signals { border-collapse:collapse; width:100%; font-size:14px; }
    table.signals th, table.signals td { border-bottom:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; }
    table.signals th { color:var(--muted); font-weight:600; white-space:nowrap; }
    table.signals td.num { text-align:right; white-space:nowrap; }
    .verdict { font-weight:700; }
    footer { padding:20px 32px 32px; color:var(--muted); font-size:13px; }
    @media (max-width: 640px) { header, main, footer { padding-left:16px; padding-right:16px; } .summary { padding:16px; } .grid { grid-template-columns:1fr; } .top { display:block; } .price { text-align:left; margin-top:8px; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(REPORT_LABEL)}</h1>
    <div class="meta">產生時間：${escapeHtml(generatedAt)}｜報告日期：${escapeHtml(TODAY)}｜持股數：${cards.length}</div>
  </header>
  <section class="summary">
    <div class="metric"><span>成功取得報價</span><strong>${okQuotes}</strong></div>
    <div class="metric"><span>前一交易日上漲</span><strong class="up">${up}</strong></div>
    <div class="metric"><span>前一交易日下跌</span><strong class="down">${down}</strong></div>
    <div class="metric"><span>需人工確認</span><strong>${cards.length - okQuotes}</strong></div>
    <div class="metric"><span>留意減碼</span><strong class="up">${counts["留意減碼"]}</strong></div>
    <div class="metric"><span>可考慮加碼</span><strong class="down">${counts["可考慮加碼"]}</strong></div>
  </section>
  <main>
  <section class="signal-wrap"><h2>規則訊號總覽</h2>${renderSignalTable(cards)}</section>
  <div class="grid">${cards.map(renderCard).join("")}</div></main>
  <footer>
    <p>${SOURCE_NOTE.map(escapeHtml).join("<br>")}</p>
    <p>規則訊號門檻（secretary_rules.json）：RSI ${RULES.rsi_period} 日，過熱 ≥ ${RULES.rsi_overbought}、超賣 ≤ ${RULES.rsi_oversold}；20 日乖離 ≥ ${RULES.ma20_bias_hot_pct}%；停利 ${RULES.take_profit_pct}%、停損 ${RULES.stop_loss_pct}%；單檔占比上限 ${RULES.max_weight_pct}%；總分 ≥ ${RULES.add_score} 為「可考慮加碼」、≤ ${RULES.trim_score} 為「留意減碼」。</p>
    <p>此晨報是個人研究輔助，不構成買賣建議；重大決策請回到公司公告、交易所資料與你的投資紀律。</p>
  </footer>
</body>
</html>`;
}

function renderCard(card) {
  const { holding, quote, chips, news, signals, rule } = card;
  const cls = quote.ok && quote.change >= 0 ? "up" : "down";
  return `<article>
    <div class="top">
      <div>
        <div class="name">${escapeHtml(holding.symbol)} ${escapeHtml(holding.name)}</div>
        <div class="tags">${escapeHtml(holding.market)}｜庫存 ${fmtNumber(holding.quantity)}｜成本 ${fmtMaybe(holding.cost_basis)}｜${escapeHtml(holding.watch_tags || "")}</div>
      </div>
      <div class="price">${quote.ok ? `<strong>${fmtNumber(quote.latest.close)}</strong><br><span class="${cls}">${fmtSigned(quote.change)} (${fmtPct(quote.changePct)})</span><br><span class="meta">${escapeHtml(quote.latest.date)} ${escapeHtml(quote.currency)}</span>` : `<strong class="warn">報價失敗</strong><br><span class="meta">${escapeHtml(quote.error || "")}</span>`}</div>
    </div>
    ${quote.ok ? renderSvgChart(quote.candles.slice(-60)) : ""}
    <dl>
      <div><dt>20 日均線</dt><dd>${quote.ok ? fmtMaybe(quote.ma20) : "-"}</dd></div>
      <div><dt>60 日均線</dt><dd>${quote.ok ? fmtMaybe(quote.ma60) : "-"}</dd></div>
      <div><dt>成交量</dt><dd>${quote.ok ? fmtNumber(quote.latest.volume) : "-"}</dd></div>
      <div><dt>資料代號</dt><dd>${quote.ok ? escapeHtml(quote.yahooSymbol) : "-"}</dd></div>
      <div><dt>法人買賣超</dt><dd>${chips.ok ? `${fmtSigned(chips.institutionalNetShares / 1000)} 張` : escapeHtml(chips.message || chips.error || "-")}</dd></div>
      <div><dt>融資變化</dt><dd>${chips.ok ? `${fmtSigned(chips.marginChange)} 張` : "-"}</dd></div>
    </dl>
    <h2>規則訊號：<span class="verdict" style="color:${VERDICT_COLOR[rule.verdict]}">${rule.verdict}</span></h2>
    <ul>${(rule.reasons.length ? rule.reasons : ["無觸發規則"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <h2>今日重點</h2>
    <ul>${(signals.length ? signals : ["目前只取得基礎資料，建議人工查看新聞與公司公告。"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <h2>相關新聞</h2>
    <ul>${news.items?.length ? news.items.map((item) => `<li><a href="${escapeHtml(item.link)}">${escapeHtml(item.title)}</a></li>`).join("") : `<li class="warn">${escapeHtml(news.error || "未取得新聞")}</li>`}</ul>
  </article>`;
}

function renderSvgChart(candles) {
  const w = 640;
  const h = 126;
  const pad = 10;
  const closes = candles.map((row) => row.close).filter(Number.isFinite);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const step = (w - pad * 2) / Math.max(candles.length - 1, 1);
  const points = candles.map((row, index) => {
    const x = pad + index * step;
    const y = h - pad - ((row.close - min) / span) * (h - pad * 2);
    return `${round(x, 1)},${round(y, 1)}`;
  }).join(" ");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="近 60 日收盤線圖">
    <polyline fill="none" stroke="#255e9c" stroke-width="3" points="${points}"></polyline>
    <text x="12" y="22" font-size="13" fill="#667085">高 ${fmtNumber(max)}｜低 ${fmtNumber(min)}</text>
  </svg>`;
}

function renderFailure(error) {
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>每日股票投資秘書失敗</title><body><h1>晨報產生失敗</h1><p>${escapeHtml(error.message)}</p></body></html>`;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers: { "user-agent": "stock-secretary/1.0", accept: "application/json", ...headers }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "stock-secretary/1.0", accept: "application/rss+xml,text/xml,text/plain,*/*" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function extractTag(block, tag) {
  return block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "") || "";
}

function decodeXml(text) {
  return String(text).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function movingAverage(candles, days) {
  const closes = candles.map((row) => row.close).filter(Number.isFinite);
  if (closes.length < days) return null;
  return round(closes.slice(-days).reduce((total, value) => total + value, 0) / days, 2);
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + num(row[key]), 0);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtMaybe(value) {
  return Number.isFinite(toNumber(value)) ? fmtNumber(toNumber(value)) : "-";
}

function fmtNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return parsed.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function fmtSigned(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return `${parsed >= 0 ? "+" : ""}${fmtNumber(parsed)}`;
}

function fmtPct(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return `${parsed >= 0 ? "+" : "-"}${Math.abs(parsed).toFixed(2)}%`;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function taipeiDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}-${parts.find((p) => p.type === "day").value}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
