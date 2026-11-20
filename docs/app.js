/* 波浪下跌段圖鑑 — 讀 data/*.json 畫圖。資料由 build.py 產生。 */
const IDS = ["TWII", "SOX", "NDX", "GSPC"];
const SHORT = { TWII: "台股", SOX: "費半", NDX: "NDX", GSPC: "S&P 500" };
const S = { data: {}, notes: null, ix: "TWII", ep: null, mode: null, charts: {} };

const $ = (s) => document.querySelector(s);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (v, d = 0) => v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v, d = 1) => v == null ? "—" : (v * 100).toFixed(d) + "%";
const spct = (v, d = 1) => (v > 0 ? "+" : "") + (v * 100).toFixed(d) + "%";
const decOf = (v) => v < 1000 ? 1 : 0;
const addDays = (iso, n) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayDiff = (a, b) => (new Date(b) - new Date(a)) / 864e5;
const KIND = { abc: "A-B-C", impulse: "五波" };

function theme() {
  return {
    ink: css("--ink"), muted: css("--muted"), line: css("--line"), grid: css("--grid"),
    accent: css("--accent"), p1: css("--p1"), p2: css("--p2"), low: css("--low"),
    area: css("--area"), surface: css("--surface"), mono: "JetBrains Mono, monospace", ui: "Noto Sans TC, sans-serif",
  };
}

function chart(id) {
  const el = typeof id === "string" ? document.getElementById(id) : id;
  let c = echarts.getInstanceByDom(el);
  if (!c) c = echarts.init(el, null, { renderer: "canvas" });
  return c;
}

function baseAxis(T) {
  return {
    axisLine: { lineStyle: { color: T.line } },
    axisLabel: { color: T.muted, fontFamily: T.mono, fontSize: 11 },
    splitLine: { lineStyle: { color: T.grid } },
  };
}

function tooltip(T) {
  return {
    trigger: "axis", backgroundColor: T.surface, borderColor: T.line,
    textStyle: { color: T.ink, fontFamily: T.ui, fontSize: 12 },
    axisPointer: { lineStyle: { color: T.muted } },
  };
}

/* ------------------------------------------------------------ load */
async function load() {
  const [idx, notes, ...rest] = await Promise.all([
    fetch("data/index.json").then((r) => r.json()),
    fetch("data/notes.json").then((r) => r.json()),
    ...IDS.map((id) => fetch(`data/${id}.json`).then((r) => r.json())),
  ]);
  IDS.forEach((id, i) => (S.data[id] = rest[i]));
  S.notes = notes;
  const last = IDS.map((id) => S.data[id].last_date).sort().pop();
  $("#asof").textContent = last.slice(0, 4);
  $("#built").textContent = `資料更新：${idx.built.replace("T", " ")} UTC · 最後交易日 ${last}`;
  $("#notes-asof").textContent = `人工判讀日 ${notes.as_of}；價位由程式依最新收盤重算`;
  $("#headline").textContent = notes.headline;
  buildTabs();
  renderAll();
  const cur = S.data[S.ix].current;
  selectEpisode(cur ? "current" : S.data[S.ix].episodes.length - 1, false);
}

function epOf(ix, key) {
  const d = S.data[ix];
  return key === "current" ? d.current : d.episodes[key];
}

/* ------------------------------------------------------------ cards */
function renderCards() {
  const T = theme();
  const box = $("#now-cards");
  box.innerHTML = "";
  IDS.forEach((id) => {
    const d = S.data[id], cur = d.current, n = S.notes.indices[id] || {};
    const el = document.createElement("div");
    el.className = "card"; el.tabIndex = 0;
    const dd = cur ? 1 - d.last / cur.peak : 0;
    el.innerHTML = `
      <div class="top"><span class="nm">${d.name}</span><span class="dd">${cur ? "−" + pct(dd) : "—"}</span></div>
      <span class="verdict">${n.verdict || "—"}</span>
      <div class="spark"></div>
      <div class="zone">關注區 <b>${n.zone || "—"}</b></div>
      <p>${d.last_date} 收 ${fmt(d.last, decOf(d.last))}${cur ? `｜高點 ${cur.peak_date.slice(5)} ${fmt(cur.peak)}` : ""}</p>`;
    el.addEventListener("click", () => { setIx(id); selectEpisode("current", true); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") el.click(); });
    box.appendChild(el);
    const sd = d.series.d, sc = d.series.c, k0 = Math.max(0, sd.length - 160);
    const pts = sd.slice(k0).map((x, i) => [x, sc[k0 + i]]);
    const marks = cur ? (cur.waves[cur.primary]?.points || []).filter((p) => p[0] >= sd[k0]) : [];
    const c = chart(el.querySelector(".spark"));
    c.setOption({
      animation: false, grid: { left: 0, right: 0, top: 6, bottom: 2 },
      xAxis: { type: "time", show: false }, yAxis: { type: "value", show: false, scale: true },
      series: [
        { type: "line", data: pts, showSymbol: false, lineStyle: { width: 1.4, color: T.ink }, silent: true },
        { type: "line", data: marks.map((p) => [p[0], valAt(d, p[0])]), symbol: "circle", symbolSize: 4,
          lineStyle: { width: 1.2, color: T.accent }, itemStyle: { color: T.accent }, silent: true },
      ],
    }, true);
  });
}

function valAt(d, date) {
  const i = binIdx(d.series.d, date);
  return d.series.c[i];
}
function binIdx(arr, x) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

/* ------------------------------------------------------------ tabs + overview */
function buildTabs() {
  const box = $("#tabs");
  IDS.forEach((id) => {
    const b = document.createElement("button");
    b.textContent = SHORT[id]; b.dataset.id = id; b.setAttribute("role", "tab");
    b.addEventListener("click", () => { setIx(id); selectEpisode(S.data[id].current ? "current" : S.data[id].episodes.length - 1, false); });
    box.appendChild(b);
  });
}

function setIx(id) {
  S.ix = id;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.id === id));
  renderOverview();
  renderTable();
}

function renderOverview() {
  const T = theme(), d = S.data[S.ix];
  $("#ix-desc").textContent = `${d.en}｜門檻：收盤跌 ${pct(d.threshold, 0)} 以上｜共 ${d.episodes.length} 段（2000 年起）。點色塊或下表可看細節。`;
  const pts = d.series.d.map((x, i) => [x, d.series.c[i]]);
  const areas = d.episodes.map((e, i) => [
    { name: String(i), xAxis: e.peak_date, itemStyle: { color: T.area } },
    { xAxis: e.trough_date },
  ]);
  if (d.current && d.current.below_threshold) {
    areas.push([{ name: "current", xAxis: d.current.peak_date, itemStyle: { color: T.area } }, { xAxis: d.current.trough_date }]);
  }
  const c = chart("overview");
  c.setOption({
    animation: false,
    grid: { left: 56, right: 16, top: 16, bottom: 56 },
    tooltip: { ...tooltip(T), valueFormatter: (v) => fmt(v, decOf(v)) },
    xAxis: { type: "time", ...baseAxis(T), splitLine: { show: false } },
    yAxis: { type: "log", ...baseAxis(T), axisLabel: { ...baseAxis(T).axisLabel, formatter: (v) => fmt(v) } },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 20, bottom: 12, borderColor: T.line, textStyle: { color: T.muted },
      fillerColor: T.area, dataBackground: { lineStyle: { color: T.muted }, areaStyle: { color: T.grid } } }],
    series: [{
      type: "line", name: d.name, data: pts, showSymbol: false, lineStyle: { width: 1.2, color: T.ink },
      markArea: { silent: false, data: areas, label: { show: false }, emphasis: { label: { show: false }, itemStyle: { color: T.accent, opacity: .25 } } },
    }],
  }, true);
  c.off("click");
  c.on("click", (p) => {
    if (p.componentType === "markArea" && p.name != null) {
      selectEpisode(p.name === "current" ? "current" : Number(p.name), true);
    }
  });
}

function keyRatio(e) {
  const w = e.waves[e.primary];
  if (!w) return "—";
  if (w.kind === "abc") return `C/A ${w.stats.ratio_CA.toFixed(2)}×`;
  return `3/1 ${w.stats.ratio_31.toFixed(2)}×、5/1 ${w.stats.ratio_51.toFixed(2)}×`;
}

function renderTable() {
  const d = S.data[S.ix], tb = $("#eps-table tbody");
  const rows = d.episodes.map((e, i) => [i, e]);
  if (d.current && d.current.below_threshold) rows.push(["current", d.current]);
  const maxDepth = Math.max(...rows.map(([, e]) => e.depth));
  tb.innerHTML = rows.slice().reverse().map(([k, e]) => `
    <tr data-k="${k}">
      <td class="mono">${e.peak_date}<br><span class="muted">${fmt(e.peak, decOf(e.peak))}</span></td>
      <td class="mono">${e.trough_date}${e.ongoing ? '<span class="tag live">進行中</span>' : ""}${e.below_threshold ? '<span class="tag">未達門檻</span>' : ""}<br><span class="muted">${fmt(e.trough, decOf(e.trough))}</span></td>
      <td class="r"><span class="bar" style="width:${(e.depth / maxDepth) * 60}px"></span>−${pct(e.depth)}</td>
      <td class="r">${e.days}</td>
      <td>${KIND[e.primary] || "—"}</td>
      <td class="r"><span class="bar" style="width:${e.score * 40}px;opacity:${0.35 + e.score * 0.65}"></span>${e.score.toFixed(2)}</td>
      <td class="mono">${keyRatio(e)}</td>
      <td class="r">${e.retrace != null ? pct(e.retrace, 0) : "—"}${e.retrace_fib ? `<span class="tag">≈${(e.retrace_fib * 100).toFixed(1)}%</span>` : ""}</td>
    </tr>`).join("");
  tb.querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => {
    const k = tr.dataset.k;
    selectEpisode(k === "current" ? "current" : Number(k), true);
  }));
  markSelectedRow();
}

function markSelectedRow() {
  document.querySelectorAll("#eps-table tbody tr").forEach((tr) => {
    const k = tr.dataset.k;
    const cur = S.ep === "current" ? (S.data[S.ix].current?.below_threshold ? "current" : String(S.data[S.ix].episodes.length - 1)) : String(S.ep);
    tr.classList.toggle("sel", k === cur);
  });
}

/* ------------------------------------------------------------ detail */
function selectEpisode(key, scroll) {
  const d = S.data[S.ix];
  if (key === "current" && !d.current) key = d.episodes.length - 1;
  S.ep = key;
  const e = epOf(S.ix, key);
  S.mode = e.primary || "abc";
  renderDetail();
  markSelectedRow();
  if (scroll) $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDetail() {
  const T = theme(), d = S.data[S.ix], e = epOf(S.ix, S.ep), w = e.waves[S.mode];
  const isCur = e === d.current;
  $("#d-title").textContent = `${d.name}｜${e.peak_date.slice(0, 7)} 下跌段`;
  $("#d-sub").innerHTML = `${fmt(e.peak, decOf(e.peak))} → ${fmt(e.trough, decOf(e.trough))}（−${pct(e.depth)}，${e.days} 天）`
    + (e.ongoing ? "｜<b>進行中</b>，低點暫定" : `｜${e.recover_date ? "收復於 " + e.recover_date : ""}`)
    + (e.retrace != null ? `｜回檔前波漲幅 ${pct(e.retrace, 0)}` : "");

  document.querySelectorAll("#d-mode button").forEach((b) => {
    b.disabled = !e.waves[b.dataset.k];
    b.classList.toggle("on", b.dataset.k === S.mode);
    b.textContent = KIND[b.dataset.k] + (e.waves[b.dataset.k] ? ` ${e.waves[b.dataset.k].score.toFixed(2)}` : "");
  });

  // notes for current
  let nd = $("#d-notes");
  if (!nd) { nd = document.createElement("div"); nd.id = "d-notes"; $("#d-sub").after(nd); }
  const n = S.notes.indices[S.ix];
  if (isCur && n) {
    nd.className = "now-detail";
    nd.innerHTML = `<p>${n.summary}</p><p class="muted small">關注區 <b>${n.zone}</b>：${n.zone_note}</p>
      <ul class="scen">${n.scenarios.map((s) => `<li><b>${s.name}</b>${s.text}</li>`).join("")}</ul>
      <p class="small">${n.trigger}</p>`;
  } else { nd.className = ""; nd.innerHTML = ""; }

  // chart range
  const dur = Math.max(30, dayDiff(e.peak_date, e.trough_date));
  const from = addDays(e.peak_date, -Math.round(dur * 0.35));
  let to = e.recover_date || d.last_date;
  if (e.recover_date) to = addDays(e.trough_date, Math.max(dayDiff(e.trough_date, e.recover_date) > dur * 1.5 ? dur * 0.6 : dayDiff(e.trough_date, e.recover_date) + 10, 20));
  if (to > d.last_date) to = d.last_date;
  const i0 = binIdx(d.series.d, from), i1 = binIdx(d.series.d, to);
  const pts = d.series.d.slice(i0, i1 + 1).map((x, i) => [x, d.series.c[i0 + i]]);
  const endDate = pts[pts.length - 1][0];

  const series = [{ type: "line", name: "收盤", data: pts, showSymbol: false, lineStyle: { width: 1.3, color: T.ink }, z: 2 }];
  if (w) {
    const wp = w.points.map(([dt, lab]) => ({ value: [dt, valAt(d, dt)], lab }));
    series.push({
      type: "line", name: "波浪", lineStyle: { width: 2, color: T.accent }, symbol: "circle",
      symbolSize: 7, itemStyle: { color: T.accent }, z: 4, tooltip: { show: false },
      data: wp.map((p) => ({ value: p.value, label: { position: ["0", "B", "2", "4"].includes(p.lab) ? "top" : "bottom" } })),
      label: { show: true, distance: 8, fontFamily: T.mono, fontWeight: 700, fontSize: 14, color: T.accent,
        formatter: (p) => wp[p.dataIndex].lab,
      },
    });
  }
  // 即時推算線段
  const cps = e.checkpoints || [];
  const seg = (key, color, name) => {
    const data = [];
    cps.forEach((cp) => {
      const end = cp.date > e.trough_date ? endDate : (e.ongoing ? endDate : e.trough_date);
      data.push([cp.date, cp[key]], [end, cp[key]], [null, null]);
    });
    series.push({ type: "line", name, data, connectNulls: false, showSymbol: false,
      lineStyle: { width: 1.2, type: "dashed", color }, z: 3, tooltip: { show: false } });
  };
  seg("proj_1", T.p1, "推算 C=A");
  seg("proj_1618", T.p2, "推算 C=1.618A");
  series.push({
    type: "scatter", name: "推算日", data: cps.map((cp) => [cp.date, cp.price]), symbol: "diamond", symbolSize: 9,
    itemStyle: { color: T.surface, borderColor: T.p1, borderWidth: 1.5 }, z: 5,
    tooltip: { trigger: "item", formatter: (p) => { const cp = cps[p.dataIndex];
      return `${cp.date} 確認 B 高點 ${fmt(cp.b, decOf(cp.b))}<br>推算 C=A：${fmt(cp.proj_1, decOf(cp.proj_1))}（${spct(cp.err_1)}）<br>推算 C=1.618A：${fmt(cp.proj_1618, decOf(cp.proj_1618))}（${spct(cp.err_1618)}）`; } },
  });
  // 實際低點、未到的目標
  const mk = [{ yAxis: e.trough, lineStyle: { color: T.low, type: "dotted", width: 1.2 },
    label: { formatter: (e.ongoing ? "目前低點 " : "實際低點 ") + fmt(e.trough, decOf(e.trough)), color: T.ink, position: "insideEndTop", fontFamily: T.mono } }];
  if (e.ongoing) {
    const seen = new Set();
    e.targets.filter((t) => !t.reached).slice(0, 5).forEach((t) => {
      const v = Math.round(t.value);
      if (seen.has(v)) return; seen.add(v);
      mk.push({ yAxis: t.value, lineStyle: { color: T.accent, type: "solid", width: 0.8, opacity: .55 },
        label: { formatter: `${t.label} ${fmt(t.value, decOf(t.value))}`, color: T.accent, position: "insideEndBottom", fontSize: 11 } });
    });
  }
  series[0].markLine = { silent: true, symbol: "none", data: mk };

  const lows = [e.trough, ...cps.map((c) => c.proj_1618), ...(e.ongoing ? e.targets.filter((t) => !t.reached).slice(0, 5).map((t) => t.value) : [])];
  let ymin = Math.min(...lows.filter((v) => v > 0)) * 0.96;
  ymin = Math.max(ymin, e.trough * 0.55);
  const useLog = e.depth > 0.4;
  chart("d-chart").setOption({
    animation: false,
    grid: { left: 60, right: 16, top: 24, bottom: 40 },
    tooltip: { ...tooltip(T), valueFormatter: (v) => fmt(v, decOf(v)) },
    xAxis: { type: "time", ...baseAxis(T), splitLine: { show: false } },
    yAxis: { type: useLog ? "log" : "value", min: ymin, scale: true, ...baseAxis(T),
      axisLabel: { ...baseAxis(T).axisLabel, formatter: (v) => fmt(v) } },
    dataZoom: [{ type: "inside" }],
    series,
  }, true);

  // checks
  $("#d-checks").innerHTML = w ? w.checks.map((c) => `<li class="${c.ok ? "" : "no"}">${c.text}</li>`).join("")
    + `<li class="no">轉折門檻 ${pct(w.swing_th, 0)}｜符合度 ${w.score.toFixed(2)}</li>` : "<li class='no'>找不到符合規則的數法</li>";
  $("#d-targets").innerHTML = e.ongoing && e.targets.length ? `<h3>下方目標價</h3><table class="targets">${e.targets.map((t) =>
    `<tr><td class="${t.reached ? "reached" : ""}">${t.label}</td><td class="r ${t.reached ? "reached" : ""}">${fmt(t.value, decOf(t.value))}</td></tr>`).join("")}</table>
    <p class="muted small">劃線＝已經跌破（到達過）的價位。</p>` : "";

  // checkpoints table
  const tb = $("#d-cps tbody");
  tb.innerHTML = cps.length ? cps.map((cp) => {
    const h1 = Math.abs(cp.err_1) <= 0.05 ? "hit" : "", h2 = Math.abs(cp.err_1618) <= 0.05 ? "hit" : "";
    return `<tr><td class="mono">${cp.date}${cp.before_low ? "" : '<span class="tag">低點後</span>'}</td>
      <td class="r">${fmt(cp.b, decOf(cp.b))}</td>
      <td class="r">${fmt(cp.proj_1, decOf(cp.proj_1))}</td><td class="r ${h1}">${spct(cp.err_1)}</td>
      <td class="r">${fmt(cp.proj_1618, decOf(cp.proj_1618))}</td><td class="r ${h2}">${spct(cp.err_1618)}</td></tr>`;
  }).join("") : `<tr><td colspan="6" class="muted">這段下跌過程中沒有夠大的反彈，無法即時推算。</td></tr>`;
}

/* ------------------------------------------------------------ backtest */
function renderBacktest() {
  const T = theme();
  let tot = 0, hit = 0, hit1 = 0;
  $("#bt-stats").innerHTML = IDS.map((id) => {
    const b = S.data[id].backtest; tot += b.n; hit += b.hit_any; hit1 += b.hit_1;
    return `<div class="stat"><div class="l">${S.data[id].name}</div><div class="n">${b.hit_any}/${b.n}</div>
      <div class="l">任一推算落在 ±5%（C = A 單獨：${b.hit_1}）</div></div>`;
  }).join("");
  const pts1 = [], pts2 = [];
  IDS.forEach((id, xi) => {
    let k = 0;
    S.data[id].episodes.forEach((e) => {
      if (e.ongoing) return;
      e.checkpoints.filter((c) => c.before_low).forEach((c) => {
        const jit = ((k++ * 0.618034) % 1 - 0.5) * 0.5;
        const clamp = (v) => Math.max(-0.6, Math.min(0.6, v));
        pts1.push({ value: [xi + jit - 0.12, clamp(c.err_1) * 100], cp: c, e, id });
        pts2.push({ value: [xi + jit + 0.12, clamp(c.err_1618) * 100], cp: c, e, id });
      });
    });
  });
  $("#bt-note").innerHTML = `四個指數合計 ${tot} 次推算，只有 <b>${hit} 次（${pct(hit / tot, 0)}）</b>有任一個目標落在實際低點 ±5% 以內，`
    + `單看 C = A 是 ${hit1} 次（${pct(hit1 / tot, 0)}）。而且有 ${pts1.filter((p) => p.cp.err_1 > 0).length} 次 C = A 推算的低點比實際還高，也就是太早喊底；下跌段常常一段接一段延伸，`
    + `所以「C = A」比較適合當成<b>第一個觀察區</b>，不適合拿來抄底；真正有用的是跌破之後下一個目標在哪。`;
  const tip = (p) => {
    const { cp, e, id } = p.data;
    return `${S.data[id].name} ${e.peak_date.slice(0, 7)} 下跌段<br>${cp.date} 推算<br>C=A ${fmt(cp.proj_1, decOf(cp.proj_1))}（${spct(cp.err_1)}）<br>C=1.618A ${fmt(cp.proj_1618, decOf(cp.proj_1618))}（${spct(cp.err_1618)}）<br>實際低點 ${fmt(e.trough, decOf(e.trough))}`;
  };
  const c = chart("bt-chart");
  c.setOption({
    animation: false,
    grid: { left: 56, right: 16, top: 48, bottom: 32 },
    tooltip: { trigger: "item", backgroundColor: T.surface, borderColor: T.line, textStyle: { color: T.ink, fontSize: 12 }, formatter: tip },
    legend: { top: 0, right: 0, textStyle: { color: T.muted }, data: ["C = A", "C = 1.618×A"] },
    xAxis: { type: "value", min: -0.5, max: 3.5, interval: 1, ...baseAxis(T), splitLine: { show: false },
      axisLabel: { ...baseAxis(T).axisLabel, formatter: (v) => SHORT[IDS[v]] || "" } },
    yAxis: { type: "value", min: -60, max: 60, ...baseAxis(T), name: "推算 vs 實際低點", nameTextStyle: { color: T.muted },
      axisLabel: { ...baseAxis(T).axisLabel, formatter: (v) => (v > 0 ? "+" : "") + v + "%" } },
    series: [
      { type: "scatter", name: "C = A", data: pts1, symbolSize: 8, itemStyle: { color: T.p1, opacity: .85 },
        markArea: { silent: true, data: [[{ yAxis: -5, itemStyle: { color: T.area } }, { yAxis: 5 }]] } },
      { type: "scatter", name: "C = 1.618×A", data: pts2, symbolSize: 7, symbol: "rect", itemStyle: { color: T.p2, opacity: .8 } },
    ],
  }, true);
  c.off("click");
  c.on("click", (p) => {
    const { e, id } = p.data;
    setIx(id);
    selectEpisode(S.data[id].episodes.indexOf(e), true);
  });
}

/* ------------------------------------------------------------ wiring */
function renderAll() {
  renderCards();
  setIx(S.ix);
  renderBacktest();
  if (S.ep != null) renderDetail();
}

document.querySelectorAll("#d-mode button").forEach((b) => b.addEventListener("click", () => {
  if (b.disabled) return;
  S.mode = b.dataset.k; renderDetail();
}));
window.addEventListener("resize", () => document.querySelectorAll(".chart, .spark").forEach((el) => echarts.getInstanceByDom(el)?.resize()));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
load().catch((err) => { document.body.insertAdjacentHTML("afterbegin", `<p style="padding:16px;color:red">資料載入失敗：${err}</p>`); });
