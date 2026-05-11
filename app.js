const FALLBACKS = {
  "2357": { symbol: "2357", name: "ASUSTeK Computer Inc.", market: "台股", price: 640, changePct: 1.6, pb: 1.9, pe: 16.8, roe: 13.4, yield: 3.7, fcf: 28400, ma5: 648, ma10: 632, ma20: 606, ma60: 572, revenueYoy: 14.2, debtRatio: 52.5, industry: "品牌電腦與 AI PC" },
  "2454": { symbol: "2454", name: "MediaTek Inc.", market: "台股", price: 1395, changePct: -0.7, pb: 5.6, pe: 21.4, roe: 26.1, yield: 4.9, fcf: 92500, ma5: 1382, ma10: 1368, ma20: 1322, ma60: 1265, revenueYoy: 18.8, debtRatio: 31.4, industry: "IC 設計" },
  AAPL: { symbol: "AAPL", name: "Apple Inc.", market: "美股", price: 202.8, changePct: 0.9, pb: 37.2, pe: 29.6, roe: 151.3, yield: 0.5, fcf: 97200, ma5: 201.2, ma10: 199.4, ma20: 196.5, ma60: 190.2, revenueYoy: 5.4, debtRatio: 78.1, industry: "Consumer Electronics" },
  NVDA: { symbol: "NVDA", name: "NVIDIA Corp.", market: "美股", price: 128.4, changePct: 2.2, pb: 42.8, pe: 34.2, roe: 113.7, yield: 0.03, fcf: 60800, ma5: 125.8, ma10: 122.4, ma20: 117.6, ma60: 110.3, revenueYoy: 63.5, debtRatio: 35.6, industry: "AI GPU" }
};

const FIELDS = ["price", "pb", "pe", "roe", "yield", "fcf", "ma5", "ma10", "ma20", "ma60", "revenueYoy", "debtRatio"];
const $ = (id) => document.getElementById(id);
const API_ORIGIN = window.location.protocol === "file:" ? "http://127.0.0.1:8787" : "";
let currentStock = structuredClone(FALLBACKS["2357"]);
let currentMeta = {};
let selectedChipWindow = "5";
let chipImageDataUrl = "";
let ocrReadyPromise = null;

function n(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "--";
  return Number(value).toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function numberFromInput(id) {
  const value = Number($(id)?.value);
  return Number.isFinite(value) ? value : null;
}

function selectedChipInputMode() {
  return document.querySelector("input[name='chip-input-mode']:checked")?.value || "none";
}

function getPositionContext(stock) {
  const enabled = Boolean($("use-position")?.checked);
  const shares = numberFromInput("holding-shares");
  const cost = numberFromInput("holding-cost");
  const price = Number(stock.price);
  if (!enabled || !shares || !cost || !Number.isFinite(price)) {
    return { enabled, valid: false, shares, cost, price };
  }
  const marketValue = shares * price;
  const costValue = shares * cost;
  const pnl = marketValue - costValue;
  const pnlPct = cost ? ((price - cost) / cost) * 100 : null;
  return { enabled, valid: true, shares, cost, price, marketValue, costValue, pnl, pnlPct };
}

function getManualChipContext() {
  const mode = selectedChipInputMode();
  const text = $("manual-chip-text")?.value.trim() || "";
  return {
    mode,
    text,
    hasImage: Boolean(chipImageDataUrl),
    enabled: mode !== "none" && (Boolean(text) || Boolean(chipImageDataUrl))
  };
}

function setStatus(loading) {
  $("analyze-btn").textContent = loading ? "抓取中" : "分析";
  $("analyze-btn").disabled = loading;
}

function normalizePayload(payload, symbol) {
  const base = FALLBACKS[symbol] || { ...FALLBACKS["2357"], symbol, name: symbol, market: /^\d+$/.test(symbol) ? "台股" : "美股" };
  const q = payload?.quote || {};
  const f = payload?.financials?.ok ? payload.financials : {};
  const r = payload?.monthlyRevenue?.ok ? payload.monthlyRevenue : {};
  return {
    symbol,
    name: payload?.name || r.companyName || q.name || base.name,
    market: payload?.market || base.market,
    industry: r.industry || base.industry || "待補產業",
    price: q.price ?? base.price,
    changePct: q.changePct ?? base.changePct,
    pb: f.pb ?? base.pb,
    pe: f.annualizedPe ?? base.pe,
    roe: f.roe ?? base.roe,
    yield: f.dividendYield ?? base.yield,
    fcf: f.fcf ?? base.fcf,
    ma5: q.ma5 ?? base.ma5,
    ma10: q.ma10 ?? base.ma10,
    ma20: q.ma20 ?? base.ma20,
    ma60: q.ma60 ?? base.ma60,
    revenueYoy: r.revenueYoy ?? base.revenueYoy,
    debtRatio: f.debtRatio ?? base.debtRatio,
    revenue: r.revenue,
    revenueMom: r.revenueMom,
    grossMargin: f.grossMargin,
    eps: f.eps,
    bookValuePerShare: f.bookValuePerShare
  };
}

function renderInputs(stock) {
  FIELDS.forEach((field) => {
    $(field).value = stock[field] ?? "";
  });
}

function readInputs() {
  FIELDS.forEach((field) => {
    currentStock[field] = n($(field).value, currentStock[field]);
  });
}

function classifyPB(stock) {
  if (stock.industry?.includes("IC") || stock.pb > 8) {
    const status = stock.pe <= 25 ? "合理" : stock.pe <= 40 ? "偏貴" : "昂貴";
    return { status, tone: status === "合理" ? "good" : status === "偏貴" ? "warn" : "bad", note: "輕資產或 IC 設計股，P/B 參考性低，改以 P/E、ROE、FCF 與護城河判斷。" };
  }
  if (stock.pb < 1.5) return { status: "低估", tone: "good", note: "P/B 低於 1.5，位於價值觀察區。" };
  if (stock.pb <= 2.5) return { status: "合理", tone: "good", note: "P/B 位於合理成長區間。" };
  return { status: "偏貴", tone: "warn", note: "P/B 高於合理成長區，需由獲利與營收成長支撐。" };
}

function classifyROE(roe) {
  if (roe < 5) return { status: "轉弱", tone: "bad", note: "ROE 低於 5%，體質轉弱或處於景氣谷底。" };
  if (roe < 10) return { status: "待觀察", tone: "warn", note: "ROE 未達穩健門檻，需觀察是否回升。" };
  if (roe <= 15) return { status: "穩健", tone: "good", note: "ROE 位於 10% 至 15%，體質穩健。" };
  return { status: "優秀", tone: "good", note: "ROE 高於 15%，資本效率佳。" };
}

function classifyFCF(stock) {
  if (stock.fcf < 0 && stock.revenueYoy > 15) return { status: "良性擴張", tone: "warn", note: "FCF 為負但營收成長強，可能與擴張投資有關。" };
  if (stock.fcf < 0) return { status: "警戒", tone: "bad", note: "EPS 若好看但 FCF 長期為負，照妖鏡會照出獲利品質風險。" };
  return { status: "正常", tone: "good", note: "自由現金流為正，獲利品質暫無明顯失真。" };
}

function classifyTrend(stock) {
  const bull = stock.ma5 > stock.ma20 && stock.ma20 > stock.ma60;
  const bear = stock.ma5 < stock.ma20 && stock.ma20 < stock.ma60;
  if (bull && stock.price >= stock.ma20) return { status: "多頭排列", tone: "good", note: "5MA > 20MA > 60MA，股價仍站上月線。" };
  if (bear || stock.price < stock.ma60) return { status: "空頭警戒", tone: "bad", note: "跌破生命線或均線轉空，先控管風險。" };
  if (stock.price < stock.ma20) return { status: "整理", tone: "warn", note: "跌破月線，短線整理，等待重新站回。" };
  return { status: "偏多整理", tone: "warn", note: "仍守季線，但均線排列尚未完全轉強。" };
}

function buildStrategies(stock, pbView, roeView, fcfView, trendView) {
  const buy = Math.min(stock.ma20, stock.price * 0.97);
  const stop = Math.min(stock.ma60, stock.price * 0.92);
  let cash = `不追高，等待回測月線 ${fmt(stock.ma20)} 附近且量縮守穩；積極者可在 ${fmt(buy)} 左右分批觀察。`;
  let holder = `續抱條件是收盤守住 10MA ${fmt(stock.ma10)} 與 20MA ${fmt(stock.ma20)}；跌破 10MA 減碼，跌破月線提高現金。`;
  let risk = `停損線先看 60MA 生命線 ${fmt(stock.ma60)}；若季線下彎且 ROE/營收同步轉弱，視為避雷訊號。`;
  if (trendView.tone === "bad") {
    cash = `目前不急著接刀，等股價重新站回 60MA ${fmt(stock.ma60)} 且季線走平再評估。`;
    holder = `持有者先降低部位，反彈無法站回 20MA ${fmt(stock.ma20)} 時不宜攤平。`;
  }
  if (roeView.tone === "bad" || fcfView.tone === "bad") risk = `基本面照妖鏡已出現警訊，若股價再跌破 ${fmt(stop)}，優先保護本金。`;
  return { cash, holder, risk };
}

function verdictOf(...views) {
  const bad = views.filter((v) => v.tone === "bad").length;
  const warn = views.filter((v) => v.tone === "warn").length;
  if (bad || warn >= 3) return { text: "不建議", tone: "bad" };
  if (warn) return { text: "可小幅配置", tone: "warn" };
  return { text: "適合觀察配置", tone: "good" };
}

function renderSources(meta) {
  const q = meta.quote || {};
  const f = meta.financials || {};
  const r = meta.monthlyRevenue || {};
  $("quote-time").textContent = `股價更新時間：${q.priceUpdatedAt || "--"}；抓取：${q.fetchedAt ? new Date(q.fetchedAt).toLocaleString("zh-TW", { hour12: false }) : "--"}`;
  $("financial-time").textContent = f.ok ? `財報季度：${f.fiscalQuarter || "--"}；出表日：${f.reportDate || "--"}` : `財報季度：未取得；${f.message || ""}`;
  $("revenue-time").textContent = r.ok ? `月營收月份：${r.revenueMonth || "--"}；出表日：${r.reportDate || "--"}` : `月營收月份：未取得；${r.message || ""}`;
  $("google-link").href = meta.googleFinance?.url || "#";
  $("data-stamp").textContent = `股價更新時間：${q.priceUpdatedAt || "--"} | 財報季度：${f.fiscalQuarter || "--"} | 月營收月份：${r.revenueMonth || "--"}`;
}

function brokerRow(item, side) {
  return `<div class="chip-row ${side}">
    <div>
      <strong>${item.brokerName || item.brokerId || "--"}</strong>
      <span>${item.brokerId || ""}</span>
    </div>
    <em>${fmt(item.netLots, 2)} 張</em>
    <small>均價 ${fmt(item.avgPrice)}，買 ${fmt(item.buyShares / 1000, 1)} 張 / 賣 ${fmt(item.sellShares / 1000, 1)} 張，出現 ${item.activeDays || 0} 日</small>
  </div>`;
}

function renderBrokerChips(meta) {
  const chip = meta.brokerChip || {};
  const source = $("chip-source");
  const status = $("chip-status");
  const buyList = $("chip-buy-list");
  const sellList = $("chip-sell-list");
  if (!source || !status || !buyList || !sellList) return;

  source.textContent = `資料來源：${chip.provider || "FinMind Free datasets"}`;
  document.querySelectorAll("[data-chip-window]").forEach((button) => {
    button.classList.toggle("active", button.dataset.chipWindow === selectedChipWindow);
  });

  if (!chip.ok) {
    status.className = "chip-status warn";
    status.textContent = `Free 籌碼未取得：${chip.message || "尚未取得資料"}。此區只使用 Free 方案可用資料：三大法人、融資融券、外資持股。`;
    buyList.innerHTML = `<div class="chip-row"><strong>尚無偏多籌碼</strong><small>請確認 FinMind token 可用，或稍後再查詢。</small></div>`;
    sellList.innerHTML = `<div class="chip-row"><strong>尚無偏空籌碼</strong><small>Free 方案不包含券商分點與分點均價。</small></div>`;
    return;
  }

  const current = chip.windows?.[selectedChipWindow] || chip.windows?.["5"];
  status.className = "chip-status good";
  status.textContent = `已取得 ${current.days} 交易日 Free 籌碼：${current.startDate || "--"} 至 ${current.endDate || "--"}；最新交易日 ${chip.latestTradingDate || "--"}；${chip.note || ""}`;
  buyList.innerHTML = current.topBuy?.length ? current.topBuy.map((item) => brokerRow(item, "buy")).join("") : `<div class="chip-row"><strong>無明顯偏多籌碼</strong></div>`;
  sellList.innerHTML = current.topSell?.length ? current.topSell.map((item) => brokerRow(item, "sell")).join("") : `<div class="chip-row"><strong>無明顯偏空籌碼</strong></div>`;
}

function renderUserInputPanels(stock) {
  const positionFields = $("position-fields");
  const manualBody = $("manual-chip-body");
  const pasteZone = $("chip-paste-zone");
  const positionSummary = $("position-summary");
  const position = getPositionContext(stock);
  const chipMode = selectedChipInputMode();

  positionFields?.classList.toggle("hidden", !position.enabled);
  manualBody?.classList.toggle("hidden", chipMode === "none");
  pasteZone?.classList.toggle("hidden", chipMode !== "screenshot");

  if (positionSummary) {
    positionSummary.className = "position-summary";
    if (!position.enabled) {
      positionSummary.textContent = "啟用後會計算未實現損益與成本壓力。";
    } else if (!position.valid) {
      positionSummary.textContent = "請輸入持股數量與持股成本。";
    } else {
      positionSummary.classList.add(position.pnl >= 0 ? "good" : "bad");
      positionSummary.textContent = `市值 ${fmt(position.marketValue, 0)}，成本 ${fmt(position.costValue, 0)}，未實現損益 ${position.pnl >= 0 ? "+" : ""}${fmt(position.pnl, 0)}（${position.pnlPct >= 0 ? "+" : ""}${fmt(position.pnlPct)}%）`;
    }
  }
}

function applyUserContextToStrategies(strategies, stock) {
  const position = getPositionContext(stock);
  const manualChip = getManualChipContext();
  const next = { ...strategies };
  if (position.valid) {
    const costLine = position.pnl >= 0
      ? `持股成本 ${fmt(position.cost)}，目前浮盈 ${fmt(position.pnlPct)}%；可用 10MA / 20MA 分批移動停利，避免獲利回吐。`
      : `持股成本 ${fmt(position.cost)}，目前浮虧 ${fmt(Math.abs(position.pnlPct))}%；若跌破 20MA 且籌碼轉弱，應先降低部位。`;
    next.holder = `${next.holder}\n${costLine}`;
  }
  if (manualChip.enabled) {
    const modeText = manualChip.mode === "screenshot" ? "使用者貼入分點截圖/備註" : "使用者手動輸入分點資料";
    next.risk = `${next.risk}\n${modeText}已納入籌碼判讀；若 5/10/20 日分點均價落在現價上方且賣超集中，視為上檔反壓。`;
  }
  return next;
}

function renderChart(stock) {
  const rows = [["股價", stock.price, "price"], ["5MA", stock.ma5], ["10MA", stock.ma10], ["20MA", stock.ma20], ["60MA", stock.ma60]];
  const nums = rows.map((row) => row[1]).filter(Number.isFinite);
  const max = Math.max(...nums) * 1.04;
  const min = Math.min(...nums) * 0.94;
  $("ma-chart").innerHTML = rows.map(([label, value, type]) => {
    const width = max === min ? 50 : Math.max(8, ((value - min) / (max - min)) * 100);
    return `<div class="ma-row"><span>${label}</span><div class="bar-track"><div class="bar-fill ${type || ""}" style="width:${width}%"></div></div><strong>${fmt(value)}</strong></div>`;
  }).join("");
}

function chipTableSummary() {
  const chip = currentMeta.brokerChip || {};
  const current = chip.windows?.[selectedChipWindow] || chip.windows?.["5"];
  const manualChip = getManualChipContext();
  if (chip.ok && current) {
    const topBuy = current.topBuy?.[0];
    const topSell = current.topSell?.[0];
    const focus = [
      topBuy ? `偏多：${topBuy.brokerName} ${fmt(topBuy.netLots, 0)} 張` : "偏多：無明顯買超",
      topSell ? `偏空：${topSell.brokerName} ${fmt(Math.abs(topSell.netLots), 0)} 張` : "偏空：無明顯賣壓"
    ].join("；");
    const manual = manualChip.enabled ? `；另納入使用者分點補充：${manualChip.text || "已貼截圖，待補文字摘要"}` : "";
    return {
      observe: `Free 籌碼 ${current.days} 日；資料集：三大法人、融資融券、外資持股`,
      summary: `${current.startDate || "--"} 至 ${current.endDate || "--"}，區間均價約 ${fmt(topBuy?.avgPrice ?? topSell?.avgPrice)}。${focus}${manual}`,
      diagnosis: `<span class="tag good">已串接</span> 使用 FinMind Free 方案資料；券商分點與分點均價可由手動輸入或截圖補充。`
    };
  }
  if (manualChip.enabled) {
    return {
      observe: "使用者補充分點資料",
      summary: manualChip.text || "已貼入截圖，尚未補文字摘要。",
      diagnosis: `<span class="tag warn">人工補充</span> Free API 暫未回傳籌碼資料，先以使用者輸入融入分析。`
    };
  }
  return {
    observe: "三大法人、融資融券、外資持股",
    summary: chip.message || "Free 籌碼資料尚未取得。",
    diagnosis: `<span class="tag warn">待重試</span> 請確認本機資料服務與 FinMind token 狀態。`
  };
}

function renderTable(stock, pbView, roeView, fcfView, trendView) {
  const meta = currentMeta;
  const financialNote = meta.financials?.ok ? `EPS ${fmt(stock.eps)}、每股淨值 ${fmt(stock.bookValuePerShare)}、毛利率 ${fmt(stock.grossMargin)}%。` : "財報資料未取得，使用可覆寫欄位或範例值。";
  const revenueNote = meta.monthlyRevenue?.ok ? `當月營收 ${fmt(stock.revenue, 0)} 仟元，MoM ${fmt(stock.revenueMom)}%，YoY ${fmt(stock.revenueYoy)}%。` : "月營收資料未取得。";
  const chipNote = chipTableSummary();
  const rows = [
    ["基本面", `P/B ${fmt(stock.pb)}、P/E ${fmt(stock.pe)}、ROE ${fmt(stock.roe)}%`, financialNote, `<span class="tag ${pbView.tone}">${pbView.status}</span> ${pbView.note}`],
    ["產業", `產業：${stock.industry}；營收 YoY ${fmt(stock.revenueYoy)}%`, revenueNote, stock.revenueYoy > 10 ? `<span class="tag good">順風</span> 營收動能仍在。` : `<span class="tag warn">待觀察</span> 成長力道偏弱。`],
    ["籌碼", chipNote.observe, chipNote.summary, chipNote.diagnosis],
    ["風險分散", `殖利率 ${fmt(stock.yield)}%、負債比 ${fmt(stock.debtRatio)}%`, stock.debtRatio > 70 ? "負債比偏高，需確認現金流與利息負擔。" : "財務槓桿未見立即壓力。", `<span class="tag ${fcfView.tone}">${fcfView.status}</span> ${fcfView.note}`],
    ["技術型態", `5MA ${fmt(stock.ma5)}、20MA ${fmt(stock.ma20)}、60MA ${fmt(stock.ma60)}`, `目前股價 ${fmt(stock.price)}，${trendView.note}`, `<span class="tag ${trendView.tone}">${trendView.status}</span>`]
  ];
  $("fundamental-table").innerHTML = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
}

function renderReport(stock, pbView, roeView, fcfView, trendView, strategies, verdict) {
  const q = currentMeta.quote || {};
  const f = currentMeta.financials || {};
  const r = currentMeta.monthlyRevenue || {};
  const chipNote = chipTableSummary();
  const position = getPositionContext(stock);
  const manualChip = getManualChipContext();
  const positionText = position.valid
    ? `使用者持股：${fmt(position.shares, 0)} 股，成本 ${fmt(position.cost)}，目前未實現損益 ${position.pnl >= 0 ? "+" : ""}${fmt(position.pnl, 0)}（${position.pnlPct >= 0 ? "+" : ""}${fmt(position.pnlPct)}%）。`
    : position.enabled
      ? "使用者持股：已啟用，但持股數量或成本尚未完整。"
      : "使用者持股：未輸入。";
  const manualChipText = manualChip.enabled
    ? `使用者補充分點資訊（${manualChip.mode === "screenshot" ? "截圖/備註" : "手動輸入"}）：${manualChip.text || "已貼入截圖，尚未補文字摘要。"}${manualChip.hasImage ? "（本頁已保留截圖預覽）" : ""}`
    : "使用者補充分點資訊：未使用。";
  $("ai-report").textContent = `【${stock.symbol} ${stock.name} 投資分析摘要】

一、查詢股票現況
市場：${stock.market}
產業：${stock.industry}
目前股價：${fmt(stock.price)}
股價更新時間：${q.priceUpdatedAt || "--"}
財報季度：${f.fiscalQuarter || "--"}
月營收月份：${r.revenueMonth || "--"}
Google Finance 查核：${currentMeta.googleFinance?.url || "--"}
${positionText}
${manualChipText}

二、基本面健檢
P/B ${fmt(stock.pb)}，診斷為「${pbView.status}」：${pbView.note}
ROE ${fmt(stock.roe)}%，診斷為「${roeView.status}」：${roeView.note}
FCF ${fmt(stock.fcf, 0)}，照妖鏡診斷為「${fcfView.status}」：${fcfView.note}
營收 YoY ${fmt(stock.revenueYoy)}%，負債比 ${fmt(stock.debtRatio)}%。資料來源狀態：${f.ok ? "財報已取得" : f.message || "財報未取得"}；${r.ok ? "月營收已取得" : r.message || "月營收未取得"}。
籌碼資料：${chipNote.observe}。${chipNote.summary}

三、技術面判斷
5MA ${fmt(stock.ma5)}、10MA ${fmt(stock.ma10)}、20MA ${fmt(stock.ma20)}、60MA ${fmt(stock.ma60)}
均線診斷：${trendView.status}。${trendView.note}

四、操作劇本
空手者：${strategies.cash}
持有者：${strategies.holder}
避雷針：${strategies.risk}

五、5 行內結論
結論：${verdict.text}
主因：${pbView.status}估值、${roeView.status}ROE、${fcfView.status}現金流與${trendView.status}技術型態共同判斷。
若要進場，採分批而非一次押注。
若跌破 60MA 生命線且基本面同步轉弱，優先停損。
此報告為研究輔助，不構成個人化投資建議。`;
}

function render() {
  readInputs();
  const stock = currentStock;
  const pbView = classifyPB(stock);
  const roeView = classifyROE(stock.roe);
  const fcfView = classifyFCF(stock);
  const trendView = classifyTrend(stock);
  let strategies = buildStrategies(stock, pbView, roeView, fcfView, trendView);
  strategies = applyUserContextToStrategies(strategies, stock);
  const verdict = verdictOf(pbView, roeView, fcfView, trendView);

  $("market-label").textContent = stock.market;
  $("stock-name").textContent = `${stock.symbol} ${stock.name}`;
  $("last-price").textContent = fmt(stock.price);
  $("price-change").textContent = Number.isFinite(stock.changePct) ? `${stock.changePct >= 0 ? "+" : ""}${fmt(stock.changePct)}%` : "--";
  $("price-change").classList.toggle("negative", stock.changePct < 0);
  $("top-verdict").textContent = verdict.text;
  $("top-verdict").className = `verdict ${verdict.tone === "good" ? "good" : verdict.tone === "bad" ? "bad" : ""}`;
  $("pb-score").textContent = pbView.status;
  $("pb-note").textContent = pbView.note;
  $("roe-score").textContent = roeView.status;
  $("roe-note").textContent = roeView.note;
  $("fcf-score").textContent = fcfView.status;
  $("fcf-note").textContent = fcfView.note;
  $("trend-score").textContent = trendView.status;
  $("trend-note").textContent = trendView.note;
  $("cash-strategy").textContent = strategies.cash;
  $("holder-strategy").textContent = strategies.holder;
  $("risk-strategy").textContent = strategies.risk;
  renderUserInputPanels(stock);
  renderSources(currentMeta);
  renderBrokerChips(currentMeta);
  renderChart(stock);
  renderTable(stock, pbView, roeView, fcfView, trendView);
  renderReport(stock, pbView, roeView, fcfView, trendView, strategies, verdict);
}

async function loadStock(symbol) {
  const key = (symbol || "2357").trim().toUpperCase();
  setStatus(true);
  try {
    const response = await fetch(`${API_ORIGIN}/api/stock/${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error(`資料服務回應 ${response.status}`);
    currentMeta = await response.json();
    currentStock = normalizePayload(currentMeta, key);
  } catch (error) {
    currentMeta = {
      quote: { provider: "Fallback", priceUpdatedAt: `資料服務未連線：${error.message}`, fetchedAt: new Date().toISOString() },
      financials: { ok: false, message: error.message },
      monthlyRevenue: { ok: false, message: error.message },
      brokerChip: { ok: false, provider: "FinMind Free datasets", message: error.message },
      googleFinance: { url: /^\d+$/.test(key) ? `https://www.google.com/finance/quote/${key}:TPE` : `https://www.google.com/finance/quote/${key}:NASDAQ` }
    };
    currentStock = structuredClone(FALLBACKS[key] || { ...FALLBACKS["2357"], symbol: key, name: "自訂股票", market: /^\d+$/.test(key) ? "台股" : "美股" });
  } finally {
    $("ticker-input").value = key;
    renderInputs(currentStock);
    render();
    setStatus(false);
  }
}

function renderChipImagePreview() {
  const preview = $("chip-image-preview");
  if (!preview) return;
  preview.innerHTML = chipImageDataUrl
    ? `<img src="${chipImageDataUrl}" alt="分點截圖預覽" /><small>截圖已貼入。若要讓報告判讀內容，請在文字框補上分點、買賣超與均價重點。</small>`
    : "";
}

function handleChipImageFile(file) {
  if (!file || !file.type?.startsWith("image/")) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    chipImageDataUrl = String(reader.result || "");
    renderChipImagePreview();
    recognizeChipImage(chipImageDataUrl);
    render();
  });
  reader.readAsDataURL(file);
}

function setOcrStatus(message, tone = "") {
  const status = $("chip-ocr-status");
  if (!status) return;
  status.className = `ocr-status ${tone}`.trim();
  status.textContent = message;
}

function loadOcrLibrary() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (ocrReadyPromise) return ocrReadyPromise;
  ocrReadyPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("OCR library not available"));
    script.onerror = () => reject(new Error("無法載入 OCR 套件，請確認網路連線。"));
    document.head.appendChild(script);
  });
  return ocrReadyPromise;
}

async function recognizeChipImage(imageDataUrl) {
  if (!imageDataUrl) return;
  setOcrStatus("OCR 辨識中，第一次載入會比較久...", "warn");
  try {
    const Tesseract = await loadOcrLibrary();
    const result = await Tesseract.recognize(imageDataUrl, "chi_tra+eng", {
      logger: (message) => {
        if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
          setOcrStatus(`OCR 辨識中 ${Math.round(message.progress * 100)}%...`, "warn");
        }
      }
    });
    const text = result?.data?.text?.trim() || "";
    if (!text) {
      setOcrStatus("OCR 完成，但未辨識到文字。請改用手動輸入重點。", "warn");
      return;
    }
    const input = $("manual-chip-text");
    if (input) {
      const prefix = input.value.trim() ? `${input.value.trim()}\n\n` : "";
      input.value = `${prefix}[OCR 截圖辨識]\n${text}`;
    }
    setOcrStatus("OCR 已完成，辨識文字已填入上方文字框。請快速檢查數字與券商名稱是否正確。", "good");
    render();
  } catch (error) {
    setOcrStatus(`OCR 無法完成：${error.message}。請改用手動輸入分點重點。`, "warn");
  }
}

$("stock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  loadStock($("ticker-input").value);
});
document.querySelectorAll("[data-symbol]").forEach((button) => button.addEventListener("click", () => loadStock(button.dataset.symbol)));
document.querySelectorAll("[data-chip-window]").forEach((button) => button.addEventListener("click", () => {
  selectedChipWindow = button.dataset.chipWindow;
  renderBrokerChips(currentMeta);
}));
document.querySelectorAll("input[name='chip-input-mode']").forEach((input) => input.addEventListener("change", render));
["use-position", "holding-shares", "holding-cost", "manual-chip-text"].forEach((id) => {
  $(id)?.addEventListener("input", render);
  $(id)?.addEventListener("change", render);
});
$("chip-image-input")?.addEventListener("change", (event) => handleChipImageFile(event.target.files?.[0]));
$("chip-paste-zone")?.addEventListener("paste", (event) => {
  const image = [...(event.clipboardData?.files || [])].find((file) => file.type.startsWith("image/"));
  if (image) {
    event.preventDefault();
    handleChipImageFile(image);
  }
});
FIELDS.forEach((field) => $(field).addEventListener("input", render));
$("reset-btn").addEventListener("click", () => loadStock(currentStock.symbol));
$("copy-report").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("ai-report").textContent);
  $("copy-report").textContent = "已複製";
  setTimeout(() => { $("copy-report").textContent = "複製報告"; }, 1200);
});
loadStock("2357");
