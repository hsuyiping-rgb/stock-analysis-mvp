// 每日三大法人（外資／投信／自營商）個股買賣超 + 當日成交均價快照。
// 上市：TWSE T86（法人買賣超）+ MI_INDEX（每日收盤行情，取均價與收盤價）。
// 用 MI_INDEX 收盤行情的代號清單當白名單，自動濾掉 T86 裡的權證/牛熊證。
// 輸出：data/institutional/{YYYY-MM-DD}/twse.json
//
// 用法：
//   node institutional_flows.mjs                # 抓今天
//   node institutional_flows.mjs --date 2026-07-17   # 回補指定交易日

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const __dirname = dirname(fileURLToPath(import.meta.url));

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json,text/plain,*/*",
  Referer: "https://www.twse.com.tw/",
};

// --- helpers ---
function parseNum(s) {
  if (s == null) return 0;
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function isoToYmd(iso) {
  return iso.replace(/-/g, ""); // 2026-07-17 -> 20260717
}

function todayIso() {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

async function fetchTwseJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const json = await res.json();
  return json;
}

// --- T86: 三大法人買賣超（全市場個股，含權證） ---
async function fetchT86(ymd) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd}&selectType=ALL&response=json`;
  const json = await fetchTwseJson(url);
  if (json.stat !== "OK" || !json.data) {
    throw new Error(`T86 no data (stat=${json.stat}) for ${ymd}`);
  }
  const fields = json.fields;
  const idx = (name) => fields.indexOf(name);
  const iCode = idx("證券代號");
  const iName = idx("證券名稱");
  const iForeign = idx("外陸資買賣超股數(不含外資自營商)");
  const iForeignDealer = idx("外資自營商買賣超股數");
  const iInvest = idx("投信買賣超股數");
  const iDealerSelf = idx("自營商買賣超股數(自行買賣)");
  const iDealerHedge = idx("自營商買賣超股數(避險)");
  const iTotal = idx("三大法人買賣超股數");

  const map = new Map();
  for (const row of json.data) {
    const code = String(row[iCode]).trim();
    map.set(code, {
      code,
      name: String(row[iName]).trim(),
      foreignNet: parseNum(row[iForeign]),            // 外資（不含外資自營商）
      foreignDealerNet: parseNum(row[iForeignDealer]), // 外資自營商
      investNet: parseNum(row[iInvest]),               // 投信
      dealerNet: parseNum(row[iDealerSelf]) + parseNum(row[iDealerHedge]), // 自營商合計
      threeNet: parseNum(row[iTotal]),                 // 三大法人合計
    });
  }
  return map;
}

// --- MI_INDEX: 每日收盤行情（取均價、收盤價；也當白名單濾權證） ---
async function fetchQuotes(ymd) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`;
  const json = await fetchTwseJson(url);
  if (json.stat !== "OK") throw new Error(`MI_INDEX no data (stat=${json.stat}) for ${ymd}`);

  const tables = json.tables || [];
  const quoteTable = tables.find(
    (t) => t.title && t.title.includes("每日收盤行情") && Array.isArray(t.fields)
  );
  if (!quoteTable) throw new Error("MI_INDEX: 每日收盤行情表未找到");

  const f = quoteTable.fields;
  const idx = (name) => f.indexOf(name);
  const iCode = idx("證券代號");
  const iVolShares = idx("成交股數");
  const iVolValue = idx("成交金額");
  const iClose = idx("收盤價");

  const map = new Map();
  for (const row of quoteTable.data) {
    const code = String(row[iCode]).trim();
    const shares = parseNum(row[iVolShares]);
    const value = parseNum(row[iVolValue]);
    const close = parseNum(row[iClose]);
    const avg = shares > 0 ? value / shares : 0; // 當日成交均價
    map.set(code, { shares, value, close, avg });
  }
  return map;
}

// 抓取單一交易日並存檔。回傳 rows 數；非交易日回傳 null。
async function fetchAndSaveDay(iso, { quiet = false } = {}) {
  const ymd = isoToYmd(iso);
  let t86, quotes;
  try {
    [t86, quotes] = await Promise.all([fetchT86(ymd), fetchQuotes(ymd)]);
  } catch (err) {
    // 非交易日 T86/MI_INDEX 無資料會 throw；視為跳過
    if (/no data/.test(err.message)) return null;
    throw err;
  }

  const rows = [];
  for (const [code, q] of quotes) {
    const inst = t86.get(code);
    if (!inst) continue;
    rows.push({
      code,
      name: inst.name,
      foreignNet: inst.foreignNet,
      foreignDealerNet: inst.foreignDealerNet,
      investNet: inst.investNet,
      dealerNet: inst.dealerNet,
      threeNet: inst.threeNet,
      close: q.close,
      avgPrice: Number(q.avg.toFixed(4)),
      volumeShares: q.shares,
      volumeValue: q.value,
    });
  }
  if (rows.length === 0) return null; // 有回應但無個股（非交易日備援判斷）

  const snapshot = {
    market: "TWSE",
    date: iso,
    source: "TWSE T86 + MI_INDEX",
    fetchedAt: new Date().toISOString(),
    unit: { net: "股", avgPrice: "元", volumeValue: "元" },
    count: rows.length,
    stocks: rows,
  };

  const outDir = join(__dirname, "data", "institutional", iso);
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "twse.json");
  await writeFile(outPath, JSON.stringify(snapshot, null, 2), "utf8");

  if (!quiet) {
    console.log(`T86 個股數: ${t86.size}（含權證）｜行情白名單: ${quotes.size}｜合併有效: ${rows.length} 檔`);
    console.log(`已存: ${outPath}`);
    const byForeign = [...rows].sort((a, b) => b.foreignNet - a.foreignNet).slice(0, 5);
    const byInvest = [...rows].sort((a, b) => b.investNet - a.investNet).slice(0, 5);
    console.log("\n外資買超 TOP5（張）:");
    for (const r of byForeign) console.log(`  ${r.code} ${r.name}  ${Math.round(r.foreignNet / 1000).toLocaleString()} 張  均價 ${r.avgPrice}`);
    console.log("投信買超 TOP5（張）:");
    for (const r of byInvest) console.log(`  ${r.code} ${r.name}  ${Math.round(r.investNet / 1000).toLocaleString()} 張  均價 ${r.avgPrice}`);
  }
  return rows.length;
}

function isWeekend(iso) {
  // 用本地日期判斷星期（iso+T00:00:00 解析為本地午夜），避免 UTC 偏移把週末算錯一天
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

async function run() {
  const args = process.argv.slice(2);
  const dateArg = args.includes("--date") ? args[args.indexOf("--date") + 1] : null;
  const backfillArg = args.includes("--backfill") ? Number(args[args.indexOf("--backfill") + 1]) : null;

  if (backfillArg) {
    // 回補模式：從今天往回 N 個日曆日，逐日抓
    console.log(`===== 回補模式：往回 ${backfillArg} 個日曆日 =====`);
    const start = new Date(todayIso() + "T00:00:00");
    let saved = 0, skipped = 0, existed = 0;
    for (let i = 0; i <= backfillArg; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);

      if (isWeekend(iso)) continue; // 週末不打 API

      const outPath = join(__dirname, "data", "institutional", iso, "twse.json");
      if (existsSync(outPath)) { existed++; continue; } // 已存在不重抓

      try {
        const n = await fetchAndSaveDay(iso, { quiet: true });
        if (n) { saved++; console.log(`  ${iso}  ✓ ${n} 檔`); }
        else { skipped++; console.log(`  ${iso}  – 非交易日`); }
      } catch (err) {
        console.log(`  ${iso}  ✗ ${err.message}`);
      }
      await sleep(900); // 防限流
    }
    console.log(`\n回補完成：新增 ${saved} 日｜已存在 ${existed} 日｜非交易日 ${skipped} 日`);
    return;
  }

  // 單日模式
  const iso = dateArg || todayIso();
  console.log(`===== 抓取三大法人買賣超 + 行情 ${iso} =====`);
  const n = await fetchAndSaveDay(iso);
  if (n === null) console.log(`${iso} 無資料（非交易日？）`);
}

run().catch((err) => {
  console.error(`抓取失敗: ${err.message}`);
  process.exit(1);
});
