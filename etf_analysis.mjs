import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

// 分析已收集的 ETF 持股快照，產生三張表：
//   1. 共識持股排行 —— 純台股主動式 ETF 中，最多檔同時持有、合計權重最高的個股
//   2. 增減碼追蹤   —— 各主動式 ETF 最新兩個交易日的股數變化，跨 ETF 匯總買賣家數
//   3. 超配／低配   —— 主動式群體平均權重相對被動式 0050（大盤市值）的偏離
//
// 用法：node etf_analysis.mjs
// 產出：console 摘要 + reports/etf-analysis-{最新日}.html 與 reports/etf-analysis-latest.html

const ROOT = process.cwd();
const DATA_DIR = resolve(ROOT, "data", "etf_holdings");
const REPORT_DIR = resolve(ROOT, "reports");

// 象徵性部位門檻：權重低於此值視為經理人的觀察／建倉試單，不計入實質共識。
const SYMBOLIC_WEIGHT = 0.1;
// 增減碼顯著門檻：股數變化超過此比例才算一次有意義的加／減碼。
const REBALANCE_THRESHOLD = 0.05;

// 分類 fallback：舊快照若無 category 欄位，用代號反查。
const CATEGORY_BY_CODE = {
  "0050": "tw-passive", "0056": "tw-passive",
  "00983A": "global-active", "00990A": "global-active"
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const snapshots = await loadSnapshots();
  if (!snapshots.length) throw new Error(`找不到任何快照，請先執行 etf_holdings.mjs（${DATA_DIR}）`);

  const byEtf = groupByEtf(snapshots);
  const latestDate = snapshots.map((s) => s.tranDate).sort().at(-1);

  const consensus = buildConsensus(byEtf);
  const rebalance = buildRebalance(byEtf);
  const overweight = buildOverweight(byEtf);

  const summaryText = buildSummaryText({ latestDate, byEtf, consensus, rebalance, overweight });
  console.log(summaryText);

  await mkdir(REPORT_DIR, { recursive: true });
  const html = renderHtml({ latestDate, byEtf, consensus, rebalance, overweight });
  const datedPath = join(REPORT_DIR, `etf-analysis-${latestDate}.html`);
  const latestPath = join(REPORT_DIR, "etf-analysis-latest.html");
  await writeFile(datedPath, html, "utf8");
  await writeFile(latestPath, html, "utf8");
  // 純文字摘要，供每日 email 內文使用（send_etf_report.ps1 讀取）。
  await writeFile(join(REPORT_DIR, "etf-analysis-summary.txt"), summaryText, "utf8");
  console.log(`\n報告已產生：${datedPath}`);
}

// ---- 載入 ----

async function loadSnapshots() {
  const snapshots = [];
  let dateDirs = [];
  try {
    dateDirs = (await readdir(DATA_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  for (const date of dateDirs) {
    const dir = join(DATA_DIR, date);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    for (const file of files) {
      try {
        const snap = JSON.parse(await readFile(join(dir, file), "utf8"));
        if (!snap.stocks?.length) continue;
        snap.category = snap.category || CATEGORY_BY_CODE[snap.stockNo] || "tw-active";
        snap.folderDate = date;
        snapshots.push(snap);
      } catch {
        // 略過壞檔
      }
    }
  }
  return snapshots;
}

// 依 ETF 代號分組，每組內按資料日排序（最新在最後）。
function groupByEtf(snapshots) {
  const map = new Map();
  for (const snap of snapshots) {
    if (!map.has(snap.stockNo)) map.set(snap.stockNo, []);
    map.get(snap.stockNo).push(snap);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.tranDate.localeCompare(b.tranDate));
    // 同日去重（保留後寫入者）
    const seen = new Map();
    for (const snap of list) seen.set(snap.tranDate, snap);
    map.set(list[0].stockNo, [...seen.values()].sort((a, b) => a.tranDate.localeCompare(b.tranDate)));
  }
  return map;
}

function latestOf(list) {
  return list[list.length - 1];
}

function activeEtfs(byEtf) {
  return [...byEtf.entries()].filter(([, list]) => latestOf(list).category === "tw-active");
}

// ---- 1. 共識持股 ----

function buildConsensus(byEtf) {
  const actives = activeEtfs(byEtf);
  const totalActive = actives.length;
  const agg = new Map();
  for (const [, list] of actives) {
    const snap = latestOf(list);
    for (const stock of snap.stocks) {
      if (stock.weight < SYMBOLIC_WEIGHT) continue;
      const row = agg.get(stock.code) || { code: stock.code, name: stock.name, holders: 0, weightSum: 0, weights: [] };
      row.holders += 1;
      row.weightSum += stock.weight;
      row.weights.push(stock.weight);
      row.name = stock.name || row.name;
      agg.set(stock.code, row);
    }
  }
  const rows = [...agg.values()].map((row) => ({
    ...row,
    avgWeight: row.weightSum / row.holders,
    coverage: row.holders / totalActive
  }));
  rows.sort((a, b) => b.holders - a.holders || b.weightSum - a.weightSum);
  return { totalActive, rows };
}

// ---- 2. 增減碼 ----

function buildRebalance(byEtf) {
  const perEtf = [];
  const stockAgg = new Map();
  for (const [stockNo, list] of activeEtfs(byEtf)) {
    if (list.length < 2) continue;
    const curr = latestOf(list);
    const prev = list[list.length - 2];
    const prevMap = new Map(prev.stocks.map((s) => [s.code, s]));
    const currMap = new Map(curr.stocks.map((s) => [s.code, s]));
    const changes = [];
    const codes = new Set([...prevMap.keys(), ...currMap.keys()]);
    for (const code of codes) {
      const before = prevMap.get(code)?.shares || 0;
      const after = currMap.get(code)?.shares || 0;
      if (before === after) continue;
      const name = (currMap.get(code) || prevMap.get(code)).name;
      const beforeW = prevMap.get(code)?.weight || 0;
      const afterW = currMap.get(code)?.weight || 0;
      let action;
      if (beforeW < SYMBOLIC_WEIGHT && afterW >= SYMBOLIC_WEIGHT) action = "new";        // 建倉
      else if (beforeW >= SYMBOLIC_WEIGHT && afterW < SYMBOLIC_WEIGHT) action = "exit";   // 出清
      else if (after > before) action = "add";
      else action = "trim";
      const changePct = before > 0 ? (after - before) / before : Infinity;
      if (action === "add" || action === "trim") {
        if (Math.abs(changePct) < REBALANCE_THRESHOLD) continue; // 過濾雜訊
      }
      changes.push({ code, name, before, after, changePct, action });
      // 跨 ETF 匯總
      const s = stockAgg.get(code) || { code, name, add: 0, trim: 0, new: 0, exit: 0 };
      s[action] += 1;
      s.name = name || s.name;
      stockAgg.set(code, s);
    }
    changes.sort((a, b) => rankAction(a.action) - rankAction(b.action) || Math.abs(b.changePct) - Math.abs(a.changePct));
    perEtf.push({ stockNo, name: curr.name, from: prev.tranDate, to: curr.tranDate, changes });
  }
  const consensusMoves = [...stockAgg.values()]
    .map((s) => ({ ...s, buyers: s.add + s.new, sellers: s.trim + s.exit, net: s.add + s.new - s.trim - s.exit }))
    .filter((s) => s.buyers + s.sellers >= 2) // 至少兩檔 ETF 有動作
    .sort((a, b) => b.net - a.net || (b.buyers + b.sellers) - (a.buyers + a.sellers));
  return { perEtf, consensusMoves };
}

function rankAction(action) {
  return { new: 0, add: 1, trim: 2, exit: 3 }[action] ?? 4;
}

// ---- 3. 超配／低配 ----

function buildOverweight(byEtf) {
  const actives = activeEtfs(byEtf);
  const benchmark = byEtf.get("0050") ? latestOf(byEtf.get("0050")) : null;
  if (!benchmark) return { benchmarkMissing: true, rows: [] };
  const benchWeight = new Map(benchmark.stocks.map((s) => [s.code, s.weight]));

  const agg = new Map();
  for (const [, list] of actives) {
    for (const stock of latestOf(list).stocks) {
      if (stock.weight < SYMBOLIC_WEIGHT) continue;
      const row = agg.get(stock.code) || { code: stock.code, name: stock.name, weightSum: 0, holders: 0 };
      row.weightSum += stock.weight;
      row.holders += 1;
      row.name = stock.name || row.name;
      agg.set(stock.code, row);
    }
  }
  const totalActive = actives.length;
  const rows = [...agg.values()].map((row) => {
    const activeAvg = row.weightSum / totalActive; // 分母用全體主動式檔數，未持有者以 0 計
    const bench = benchWeight.get(row.code) || 0;
    return { code: row.code, name: row.name, activeAvg, bench, diff: activeAvg - bench, holders: row.holders };
  });
  const overweight = [...rows].sort((a, b) => b.diff - a.diff).slice(0, 15);
  const underweight = [...rows].filter((r) => r.bench > 0).sort((a, b) => a.diff - b.diff).slice(0, 10);
  return { benchmarkDate: benchmark.tranDate, totalActive, overweight, underweight };
}

// ---- 輸出：純文字摘要（console 與 email 內文共用）----

function buildSummaryText({ latestDate, byEtf, consensus, rebalance, overweight }) {
  const actives = activeEtfs(byEtf).length;
  const lines = [];
  lines.push(`===== ETF 持股分析（最新資料日 ${latestDate}）=====`);
  lines.push(`納入純台股主動式 ETF：${actives} 檔`);
  lines.push("");

  lines.push("── 共識持股 TOP 10（被最多檔主動式 ETF 持有）──");
  for (const row of consensus.rows.slice(0, 10)) {
    lines.push(`  ${row.code} ${trunc(row.name, 6)}  ${row.holders}/${consensus.totalActive} 檔  平均權重 ${row.avgWeight.toFixed(2)}%`);
  }

  lines.push("");
  lines.push("── 共識加碼（最新兩交易日，最多檔同向買進）──");
  const buys = rebalance.consensusMoves.filter((m) => m.net > 0).slice(0, 8);
  if (!buys.length) lines.push("  （尚無足夠歷史，或無明顯共識加碼）");
  for (const m of buys) {
    lines.push(`  ${m.code} ${trunc(m.name, 6)}  買進 ${m.buyers} 檔${m.new ? `（含建倉 ${m.new}）` : ""}｜賣出 ${m.sellers} 檔`);
  }

  lines.push("");
  lines.push("── 共識減碼 ──");
  const sells = rebalance.consensusMoves.filter((m) => m.net < 0).slice(0, 6);
  if (!sells.length) lines.push("  （無明顯共識減碼）");
  for (const m of sells) {
    lines.push(`  ${m.code} ${trunc(m.name, 6)}  賣出 ${m.sellers} 檔${m.exit ? `（含出清 ${m.exit}）` : ""}｜買進 ${m.buyers} 檔`);
  }

  if (!overweight.benchmarkMissing) {
    lines.push("");
    lines.push("── 主動經理人超配 TOP 8（相對 0050 大盤加碼）──");
    for (const row of overweight.overweight.slice(0, 8)) {
      lines.push(`  ${row.code} ${trunc(row.name, 6)}  主動均 ${row.activeAvg.toFixed(2)}%  vs 0050 ${row.bench.toFixed(2)}%  →  +${row.diff.toFixed(2)}%`);
    }
  }
  return lines.join("\n");
}

// ---- 輸出：HTML ----

function renderHtml({ latestDate, byEtf, consensus, rebalance, overweight }) {
  const actives = activeEtfs(byEtf);
  const activeCount = actives.length;
  const etfListHtml = actives
    .map(([code, list]) => `<span class="tag">${code} ${trunc(latestOf(list).name, 8)}（${latestOf(list).tranDate}）</span>`)
    .join(" ");

  const consensusRows = consensus.rows.slice(0, 25).map((row, i) => `
    <tr>
      <td>${i + 1}</td><td class="mono">${row.code}</td><td>${esc(row.name)}</td>
      <td class="num">${row.holders}/${consensus.totalActive}</td>
      <td class="num">${row.avgWeight.toFixed(2)}%</td>
      <td class="num">${row.weightSum.toFixed(1)}</td>
    </tr>`).join("");

  const buyRows = rebalance.consensusMoves.filter((m) => m.net > 0).slice(0, 15).map((m) => `
    <tr>
      <td class="mono">${m.code}</td><td>${esc(m.name)}</td>
      <td class="num pos">${m.buyers}${m.new ? ` <small>(建倉${m.new})</small>` : ""}</td>
      <td class="num neg">${m.sellers}${m.exit ? ` <small>(出清${m.exit})</small>` : ""}</td>
      <td class="num">${m.net > 0 ? "+" : ""}${m.net}</td>
    </tr>`).join("");

  const sellRows = rebalance.consensusMoves.filter((m) => m.net < 0).slice(0, 12).map((m) => `
    <tr>
      <td class="mono">${m.code}</td><td>${esc(m.name)}</td>
      <td class="num pos">${m.buyers}</td>
      <td class="num neg">${m.sellers}${m.exit ? ` <small>(出清${m.exit})</small>` : ""}</td>
      <td class="num">${m.net}</td>
    </tr>`).join("");

  const owRows = (overweight.overweight || []).map((row) => `
    <tr>
      <td class="mono">${row.code}</td><td>${esc(row.name)}</td>
      <td class="num">${row.activeAvg.toFixed(2)}%</td>
      <td class="num">${row.bench.toFixed(2)}%</td>
      <td class="num pos">+${row.diff.toFixed(2)}%</td>
    </tr>`).join("");

  const uwRows = (overweight.underweight || []).map((row) => `
    <tr>
      <td class="mono">${row.code}</td><td>${esc(row.name)}</td>
      <td class="num">${row.activeAvg.toFixed(2)}%</td>
      <td class="num">${row.bench.toFixed(2)}%</td>
      <td class="num neg">${row.diff.toFixed(2)}%</td>
    </tr>`).join("");

  const hasRebalance = rebalance.consensusMoves.length > 0;

  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ETF 持股分析 ${latestDate}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, "Microsoft JhengHei", sans-serif; margin: 0; padding: 24px; line-height: 1.6; background: #f7f7f9; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16171a; color: #e8e8ea; } .card { background: #1f2024 !important; } th { background: #2a2b30 !important; } }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .sub { color: #888; font-size: .85rem; margin-bottom: 20px; }
  .card { background: #fff; border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card h2 { font-size: 1.1rem; margin: 0 0 4px; }
  .card .desc { color: #888; font-size: .8rem; margin-bottom: 12px; }
  .tag { display: inline-block; background: #eef; color: #445; border-radius: 6px; padding: 2px 8px; margin: 2px; font-size: .75rem; }
  @media (prefers-color-scheme: dark) { .tag { background: #2a2b45; color: #aab; } }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #eee; }
  @media (prefers-color-scheme: dark) { th, td { border-color: #2c2d33; } }
  th { background: #f0f0f3; font-weight: 600; position: sticky; top: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, monospace; }
  .pos { color: #c0392b; } .neg { color: #27ae60; }
  small { color: #999; font-weight: normal; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
  .note { font-size: .75rem; color: #999; margin-top: 24px; }
</style></head>
<body>
  <h1>ETF 持股共識與資金流向分析</h1>
  <div class="sub">最新資料日 ${latestDate}　｜　純台股主動式 ETF ${activeCount} 檔　｜　產生時間 ${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</div>

  <div class="card">
    <h2>納入分析的主動式 ETF</h2>
    <div class="desc">海外持股型（00983A、00990A）與被動式（0050、0056）不列入共識，僅 0050 作為超配基準。</div>
    ${etfListHtml}
  </div>

  <div class="card">
    <h2>① 共識持股排行</h2>
    <div class="desc">被最多檔主動式 ETF 同時持有（權重 ≥ ${SYMBOLIC_WEIGHT}%）的個股，排除象徵性試單部位。</div>
    <table>
      <thead><tr><th>#</th><th>代號</th><th>名稱</th><th class="num">持有檔數</th><th class="num">平均權重</th><th class="num">權重合計</th></tr></thead>
      <tbody>${consensusRows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>② 增減碼追蹤（最新兩交易日）</h2>
    <div class="desc">跨 ETF 統計同向買賣家數。「建倉」＝從象徵性部位轉為實質持有；「出清」＝實質部位歸零。至少 2 檔 ETF 有動作才列入。</div>
    ${hasRebalance ? `<div class="cols">
      <div>
        <h3 style="font-size:.9rem;margin:0 0 6px;color:#c0392b;">共識加碼</h3>
        <table><thead><tr><th>代號</th><th>名稱</th><th class="num">買進</th><th class="num">賣出</th><th class="num">淨</th></tr></thead><tbody>${buyRows || '<tr><td colspan="5">無</td></tr>'}</tbody></table>
      </div>
      <div>
        <h3 style="font-size:.9rem;margin:0 0 6px;color:#27ae60;">共識減碼</h3>
        <table><thead><tr><th>代號</th><th>名稱</th><th class="num">買進</th><th class="num">賣出</th><th class="num">淨</th></tr></thead><tbody>${sellRows || '<tr><td colspan="5">無</td></tr>'}</tbody></table>
      </div>
    </div>` : '<p style="color:#999;">尚無足夠歷史快照可比對（需同一 ETF 至少兩個交易日）。持續每日累積後即會顯示。</p>'}
  </div>

  <div class="card">
    <h2>③ 超配／低配（相對 0050 大盤）</h2>
    <div class="desc">主動式群體平均權重（分母為全體主動式檔數）減去該股在 0050 的市值權重。正值＝經理人集體加碼、負值＝集體看淡。</div>
    ${overweight.benchmarkMissing ? '<p style="color:#999;">缺少 0050 快照，無法計算。</p>' : `<div class="cols">
      <div>
        <h3 style="font-size:.9rem;margin:0 0 6px;color:#c0392b;">超配 TOP 15</h3>
        <table><thead><tr><th>代號</th><th>名稱</th><th class="num">主動均</th><th class="num">0050</th><th class="num">差</th></tr></thead><tbody>${owRows}</tbody></table>
      </div>
      <div>
        <h3 style="font-size:.9rem;margin:0 0 6px;color:#27ae60;">低配 TOP 10（0050 有、主動輕）</h3>
        <table><thead><tr><th>代號</th><th>名稱</th><th class="num">主動均</th><th class="num">0050</th><th class="num">差</th></tr></thead><tbody>${uwRows}</tbody></table>
      </div>
    </div>`}
  </div>

  <p class="note">資料來源：各投信官網每日申購買回清單（PCF），經逆向整理。本報告僅供研究參考，不構成投資建議。象徵性部位門檻 ${SYMBOLIC_WEIGHT}%、增減碼門檻 ${(REBALANCE_THRESHOLD * 100).toFixed(0)}%。</p>
</body></html>`;
}

// ---- 小工具 ----

function trunc(text, len) {
  const str = String(text || "");
  return str.length > len ? str.slice(0, len) : str;
}

function esc(text) {
  return String(text || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
