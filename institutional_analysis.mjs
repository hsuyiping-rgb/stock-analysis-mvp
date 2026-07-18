// 三大法人熱門股 + 5/20/60 日成本線分析。
// 成本 = 窗口內「淨買賣超加權平均價」：Σ(每日淨買賣超股數 × 當日成交均價) / Σ(每日淨買賣超股數)。
// 含穩定性防護：淨賣超 / 淨額太小 / 落在價格區間外 一律標「—」（該法人無可信的淨部位成本）。
// 產出：console + reports/institutional-analysis-summary.txt + reports/institutional-analysis-latest.html
//
// 用法：node institutional_analysis.mjs

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "institutional");
const REPORTS_DIR = join(__dirname, "reports");
const TOP_N = 10;
const NET_RATIO_MIN = 0.15;

async function loadSnapshots() {
  const dates = (await readdir(DATA_DIR)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const snaps = [];
  for (const date of dates) {
    try {
      const json = JSON.parse(await readFile(join(DATA_DIR, date, "twse.json"), "utf8"));
      snaps.push({ date, stocks: json.stocks });
    } catch { /* skip */ }
  }
  return snaps;
}

function buildSeries(snaps) {
  const series = new Map();
  for (const snap of snaps) {
    for (const s of snap.stocks) {
      if (!series.has(s.code)) series.set(s.code, []);
      series.get(s.code).push({
        date: snap.date, name: s.name,
        foreignNet: s.foreignNet, investNet: s.investNet,
        avgPrice: s.avgPrice, close: s.close,
      });
    }
  }
  return series;
}

// 窗口淨買賣超加權成本 + 穩定性防護
function costLine(rows, netKey, n) {
  const w = rows.slice(-n);
  let sumNet = 0, sumW = 0, sumAbs = 0, minA = Infinity, maxA = -Infinity;
  for (const r of w) {
    sumNet += r[netKey]; sumW += r[netKey] * r.avgPrice; sumAbs += Math.abs(r[netKey]);
    if (r.avgPrice > 0) { minA = Math.min(minA, r.avgPrice); maxA = Math.max(maxA, r.avgPrice); }
  }
  if (sumNet <= 0) return null;
  if (sumAbs > 0 && sumNet / sumAbs < NET_RATIO_MIN) return null;
  const cost = sumW / sumNet;
  if (cost < minA * 0.95 || cost > maxA * 1.05) return null;
  return cost;
}

// 窗口累計淨買賣超（張）
function cumNetLots(rows, netKey, n) {
  const w = rows.slice(-n);
  let s = 0; for (const r of w) s += r[netKey];
  return Math.round(s / 1000);
}

const cleanName = (s) => s.replace(/\s+/g, "");
function biasPct(close, cost) {
  if (cost == null || !cost) return null;
  return ((close - cost) / cost) * 100;
}

// 熱門股清單：最新日某法人買超(side=buy)或賣超(side=sell)，依成交金額規模排序
function hotList(series, latestDate, netKey, side) {
  const arr = [];
  for (const [code, rows] of series) {
    const last = rows[rows.length - 1];
    if (last.date !== latestDate) continue;
    const net = last[netKey];
    if (side === "buy" && net <= 0) continue;
    if (side === "sell" && net >= 0) continue;
    arr.push({ code, rows, last, net, value: Math.abs(net) * last.avgPrice });
  }
  arr.sort((a, b) => b.value - a.value);
  return arr.slice(0, TOP_N);
}

// 外資投信同買
function consensusBuy(series, latestDate) {
  const arr = [];
  for (const [code, rows] of series) {
    const last = rows[rows.length - 1];
    if (last.date !== latestDate) continue;
    if (last.foreignNet <= 0 || last.investNet <= 0) continue;
    const value = (last.foreignNet + last.investNet) * last.avgPrice;
    arr.push({ code, rows, last, value });
  }
  arr.sort((a, b) => b.value - a.value);
  return arr.slice(0, TOP_N);
}

// ---------- 純文字報告 ----------
function fmtNum(n, d = 2) { return n == null ? "  —  " : n.toFixed(d); }
function fmtBias(b) { return b == null ? "  —  " : (b >= 0 ? "+" : "") + b.toFixed(1) + "%"; }

function textBuySection(list, netKey, label, lines) {
  lines.push(`\n── ${label}買超熱門 TOP${TOP_N}（依買超金額）──`);
  lines.push(`代號   名稱        現價    當日買超   5日成本  20日成本  60日成本  現價vs60日`);
  for (const h of list) {
    const c5 = costLine(h.rows, netKey, 5), c20 = costLine(h.rows, netKey, 20), c60 = costLine(h.rows, netKey, 60);
    lines.push(
      `${h.code.padEnd(6)} ${cleanName(h.last.name).slice(0, 5).padEnd(6, "　")} ` +
      `${fmtNum(h.last.close).padStart(7)} ${(Math.round(h.net / 1000).toLocaleString() + "張").padStart(9)}  ` +
      `${fmtNum(c5).padStart(7)}  ${fmtNum(c20).padStart(7)}  ${fmtNum(c60).padStart(7)}  ${fmtBias(biasPct(h.last.close, c60)).padStart(8)}`
    );
  }
}

function textSellSection(list, netKey, label, lines) {
  lines.push(`\n── ${label}賣超熱門 TOP${TOP_N}（依賣超金額，看賣壓持續性）──`);
  lines.push(`代號   名稱        現價    當日賣超   5日累計  20日累計  60日累計`);
  for (const h of list) {
    lines.push(
      `${h.code.padEnd(6)} ${cleanName(h.last.name).slice(0, 5).padEnd(6, "　")} ` +
      `${fmtNum(h.last.close).padStart(7)} ${(Math.round(h.net / 1000).toLocaleString() + "張").padStart(9)}  ` +
      `${(cumNetLots(h.rows, netKey, 5).toLocaleString() + "張").padStart(9)} ${(cumNetLots(h.rows, netKey, 20).toLocaleString() + "張").padStart(9)} ${(cumNetLots(h.rows, netKey, 60).toLocaleString() + "張").padStart(9)}`
    );
  }
}

function textConsensusSection(list, lines) {
  lines.push(`\n── 外資投信同買 TOP${TOP_N}（最新日兩者皆買超，訊號最強）──`);
  lines.push(`代號   名稱        現價    外資買超  投信買超  外資60成本  投信60成本`);
  for (const h of list) {
    const fc = costLine(h.rows, "foreignNet", 60), ic = costLine(h.rows, "investNet", 60);
    lines.push(
      `${h.code.padEnd(6)} ${cleanName(h.last.name).slice(0, 5).padEnd(6, "　")} ` +
      `${fmtNum(h.last.close).padStart(7)} ${(Math.round(h.last.foreignNet / 1000).toLocaleString() + "張").padStart(8)} ${(Math.round(h.last.investNet / 1000).toLocaleString() + "張").padStart(8)}  ` +
      `${fmtNum(fc).padStart(8)}  ${fmtNum(ic).padStart(8)}`
    );
  }
}

// ---------- HTML 報告 ----------
function htmlBuyTable(list, netKey, label) {
  const rows = list.map((h) => {
    const c5 = costLine(h.rows, netKey, 5), c20 = costLine(h.rows, netKey, 20), c60 = costLine(h.rows, netKey, 60);
    const b = biasPct(h.last.close, c60);
    const bColor = b == null ? "#999" : b >= 0 ? "#c0392b" : "#27ae60";
    return `<tr><td>${h.code}</td><td>${cleanName(h.last.name)}</td><td class="num">${fmtNum(h.last.close)}</td>` +
      `<td class="num">${Math.round(h.net / 1000).toLocaleString()}</td>` +
      `<td class="num">${fmtNum(c5)}</td><td class="num">${fmtNum(c20)}</td><td class="num">${fmtNum(c60)}</td>` +
      `<td class="num" style="color:${bColor};font-weight:600">${fmtBias(b)}</td></tr>`;
  }).join("");
  return `<h3>${label}買超熱門 TOP${TOP_N}</h3>
<table><thead><tr><th>代號</th><th>名稱</th><th>現價</th><th>當日買超(張)</th><th>5日成本</th><th>20日成本</th><th>60日成本</th><th>現價vs60日</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function htmlSellTable(list, netKey, label) {
  const rows = list.map((h) =>
    `<tr><td>${h.code}</td><td>${cleanName(h.last.name)}</td><td class="num">${fmtNum(h.last.close)}</td>` +
    `<td class="num">${Math.round(h.net / 1000).toLocaleString()}</td>` +
    `<td class="num">${cumNetLots(h.rows, netKey, 5).toLocaleString()}</td><td class="num">${cumNetLots(h.rows, netKey, 20).toLocaleString()}</td><td class="num">${cumNetLots(h.rows, netKey, 60).toLocaleString()}</td></tr>`
  ).join("");
  return `<h3>${label}賣超熱門 TOP${TOP_N}</h3>
<table><thead><tr><th>代號</th><th>名稱</th><th>現價</th><th>當日賣超(張)</th><th>5日累計</th><th>20日累計</th><th>60日累計</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function htmlConsensusTable(list) {
  const rows = list.map((h) => {
    const fc = costLine(h.rows, "foreignNet", 60), ic = costLine(h.rows, "investNet", 60);
    return `<tr><td>${h.code}</td><td>${cleanName(h.last.name)}</td><td class="num">${fmtNum(h.last.close)}</td>` +
      `<td class="num">${Math.round(h.last.foreignNet / 1000).toLocaleString()}</td><td class="num">${Math.round(h.last.investNet / 1000).toLocaleString()}</td>` +
      `<td class="num">${fmtNum(fc)}</td><td class="num">${fmtNum(ic)}</td></tr>`;
  }).join("");
  return `<h3>外資投信同買 TOP${TOP_N}（訊號最強）</h3>
<table><thead><tr><th>代號</th><th>名稱</th><th>現價</th><th>外資買超(張)</th><th>投信買超(張)</th><th>外資60成本</th><th>投信60成本</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderHtml(ctx) {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>三大法人熱門股 + 成本線分析 ${ctx.latestDate}</title>
<style>
body{font-family:system-ui,'Microsoft JhengHei',sans-serif;color:#222;max-width:1000px;margin:0 auto;padding:16px;line-height:1.5}
h2{border-bottom:2px solid #333;padding-bottom:6px}
h3{margin-top:28px;color:#1a5276}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
th,td{border:1px solid #ddd;padding:5px 8px;text-align:left}
th{background:#f2f4f6}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.note{color:#888;font-size:12px;margin-top:24px}
.legend{background:#f8f9fa;padding:10px 14px;border-radius:8px;font-size:13px;margin:12px 0}
</style></head><body>
<h2>三大法人熱門股 + 5/20/60 日成本線</h2>
<p>資料範圍：${ctx.firstDate} ~ ${ctx.latestDate}（${ctx.days} 個交易日）</p>
<div class="legend">
<b>成本</b> = 窗口內淨買賣超加權均價；<b>現價 vs 60日</b> 正值=法人獲利區、負值=套牢區。<br>
標「—」代表該法人在該窗口為淨賣超或買賣反覆抵銷，無可信的淨部位成本（外資短線進出多，故常見）。
</div>
${htmlBuyTable(ctx.foreignBuy, "foreignNet", "外資")}
${htmlBuyTable(ctx.investBuy, "investNet", "投信")}
${htmlConsensusTable(ctx.consensus)}
${htmlSellTable(ctx.foreignSell, "foreignNet", "外資")}
${htmlSellTable(ctx.investSell, "investNet", "投信")}
<p class="note">資料來源：TWSE T86（三大法人買賣超）+ MI_INDEX（每日成交均價）。成本為公開買賣超估算，非法人真實成本，僅供研究參考，不構成買賣建議。</p>
</body></html>`;
}

async function run() {
  const snaps = await loadSnapshots();
  if (snaps.length === 0) { console.log("無快照資料，請先執行 institutional_flows.mjs"); return; }
  const latestDate = snaps[snaps.length - 1].date;
  const series = buildSeries(snaps);

  const ctx = {
    firstDate: snaps[0].date, latestDate, days: snaps.length,
    foreignBuy: hotList(series, latestDate, "foreignNet", "buy"),
    investBuy: hotList(series, latestDate, "investNet", "buy"),
    foreignSell: hotList(series, latestDate, "foreignNet", "sell"),
    investSell: hotList(series, latestDate, "investNet", "sell"),
    consensus: consensusBuy(series, latestDate),
  };

  const lines = [];
  lines.push(`===== 三大法人熱門股 + 成本線分析 =====`);
  lines.push(`資料範圍: ${ctx.firstDate} ~ ${latestDate}（${ctx.days} 個交易日）`);
  lines.push(`成本=淨買賣超加權均價；「—」=淨賣超或買賣抵銷無可信成本（外資短線多故常見）`);
  textBuySection(ctx.foreignBuy, "foreignNet", "外資", lines);
  textBuySection(ctx.investBuy, "investNet", "投信", lines);
  textConsensusSection(ctx.consensus, lines);
  textSellSection(ctx.foreignSell, "foreignNet", "外資", lines);
  textSellSection(ctx.investSell, "investNet", "投信", lines);
  const text = lines.join("\n");
  console.log(text);

  await writeFile(join(REPORTS_DIR, "institutional-analysis-summary.txt"), text, "utf8");
  await writeFile(join(REPORTS_DIR, "institutional-analysis-latest.html"), renderHtml(ctx), "utf8");
  console.log(`\n報告已存: reports/institutional-analysis-summary.txt + institutional-analysis-latest.html`);
}

run().catch((err) => { console.error(`分析失敗: ${err.message}`); process.exit(1); });
