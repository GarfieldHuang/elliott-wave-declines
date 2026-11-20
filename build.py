"""抓指數日線 → 找出 2000 年以來的主要下跌段 → 用演算法套艾略特波浪（ABC 與五波）→ 輸出 docs/data/*.json

用法：
    python build.py            # 下載最新資料再分析
    python build.py --offline  # 只用 data_raw/ 裡的快取
"""
import datetime as dt
import json
import math
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
RAW = ROOT / "data_raw"
OUT = ROOT / "docs" / "data"

# th：判定「主要下跌段」的最小跌幅（收盤價）。SOX 波動大，門檻拉高才不會一年十幾段。
INDICES = [
    dict(id="TWII", sym="^TWII", name="台股加權指數", en="TAIEX", th=0.15),
    dict(id="SOX", sym="^SOX", name="費城半導體指數", en="PHLX Semiconductor (SOX)", th=0.25),
    dict(id="NDX", sym="^NDX", name="那斯達克 100", en="Nasdaq-100 (NDX)", th=0.15),
    dict(id="GSPC", sym="^GSPC", name="標普 500", en="S&P 500", th=0.15),
]
FETCH_FROM = int(dt.datetime(1995, 1, 1, tzinfo=dt.timezone.utc).timestamp())
LIST_FROM = "2000-01-01"   # 只列出峰值在這天之後的下跌段
SHIP_FROM = "1998-01-01"   # 網頁圖表的資料起點（保留一點 2000 年前的上漲脈絡）

RETRACE_FIBS = [0.236, 0.382, 0.5, 0.618, 0.786]


# ---------------------------------------------------------------- data
def fetch(sym, path):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
           f"?period1={FETCH_FROM}&period2={int(time.time()) + 86400}&interval=1d")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    res = json.loads(data)["chart"]["result"][0]
    if len(res["timestamp"]) < 1000:
        raise RuntimeError(f"{sym}: only {len(res['timestamp'])} rows")
    path.write_bytes(data)


def load(path):
    d = json.loads(path.read_text(encoding="utf-8"))["chart"]["result"][0]
    off = d["meta"].get("gmtoffset", 0)
    closes = d["indicators"]["quote"][0]["close"]
    dates, c = [], []
    for t, v in zip(d["timestamp"], closes):
        if v is None:
            continue
        day = dt.datetime.fromtimestamp(t + off, dt.timezone.utc).date().isoformat()
        if dates and dates[-1] == day:
            c[-1] = v
            continue
        dates.append(day)
        c.append(v)
    return dates, c


# ---------------------------------------------------------------- swings
def zigzag(c, th, a=0, b=None):
    """收盤價轉折點，反向走超過 th 才確認。回傳 [(idx, 'H'|'L'), ...]，最後一點是暫定極值。"""
    b = len(c) - 1 if b is None else b
    piv, trend, hi, lo, ext = [], 0, a, a, a
    for i in range(a + 1, b + 1):
        if trend == 0:
            if c[i] > c[hi]:
                hi = i
            if c[i] < c[lo]:
                lo = i
            if lo < hi and c[hi] >= c[lo] * (1 + th):
                piv.append((lo, "L")); trend, ext = 1, hi
            elif hi < lo and c[lo] <= c[hi] * (1 - th):
                piv.append((hi, "H")); trend, ext = -1, lo
        elif trend == 1:
            if c[i] > c[ext]:
                ext = i
            elif c[i] <= c[ext] * (1 - th):
                piv.append((ext, "H")); trend, ext = -1, i
        else:
            if c[i] < c[ext]:
                ext = i
            elif c[i] >= c[ext] * (1 + th):
                piv.append((ext, "L")); trend, ext = 1, i
    if trend:
        piv.append((ext, "H" if trend == 1 else "L"))
    return piv


def zigzag_conf(c, th, a, b):
    """同 zigzag，但多記錄每個轉折「被確認的那一天」——只用到那天為止的資料，沒有偷看未來。"""
    piv, trend, ext = [], -1, a          # 從高點 a 開始，預設在跌勢中
    for i in range(a + 1, b + 1):
        if trend == 1:
            if c[i] > c[ext]:
                ext = i
            elif c[i] <= c[ext] * (1 - th):
                piv.append((ext, "H", i)); trend, ext = -1, i
        else:
            if c[i] < c[ext]:
                ext = i
            elif c[i] >= c[ext] * (1 + th):
                piv.append((ext, "L", i)); trend, ext = 1, i
    return piv


def checkpoints(dates, c, p, t, end, th):
    """即時預測：跌勢中每確認一個反彈高點 B，就用『到那天為止』的資料推 C 波目標。"""
    out = []
    for idx, typ, conf in zigzag_conf(c, th, p, end):
        if typ != "H":
            continue
        a = min(range(p, idx + 1), key=lambda i: c[i])
        # 用對數（百分比）算：長空頭跌 60% 以上時，點數等長會算出負數
        logA = math.log(c[p] / c[a])
        if logA <= 0 or math.log(c[idx] / c[a]) / logA < 0.3:   # B 要反彈 A 的三成以上才算數
            continue
        p1, p2 = c[idx] * math.exp(-logA), c[idx] * math.exp(-1.618 * logA)
        actual = c[t]
        e1, e2 = p1 / actual - 1, p2 / actual - 1
        best = "1.0" if abs(e1) <= abs(e2) else "1.618"
        out.append(dict(
            date=dates[conf], price=round(c[conf], 2),
            a_date=dates[a], a=round(c[a], 2), b_date=dates[idx], b=round(c[idx], 2),
            proj_1=round(p1, 2), proj_1618=round(p2, 2),
            err_1=round(e1, 4), err_1618=round(e2, 4), best=best,
            before_low=conf <= t,
        ))
    return out


def find_episodes(dates, c, th):
    """主要下跌段：zigzag 高點 → 收復該高點之前的最低收盤。高點落在前一段內部的不重複列。"""
    eps, last_t = [], -1
    for idx, typ in zigzag(c, th):
        if typ != "H" or idx <= last_t:
            continue
        j, t = idx + 1, idx
        while j < len(c) and c[j] <= c[idx]:
            if c[j] < c[t]:
                t = j
            if c[j] >= c[t] * 2:   # 低點後已翻倍＝新多頭，就算還沒收復前高也切開（例：SOX 2000–2008）
                break
            j += 1
        if t == idx or 1 - c[t] / c[idx] < th:
            continue
        last_t = t
        eps.append(dict(p=idx, t=t, rec=j if j < len(c) else None,
                        rec_kind="double" if j < len(c) and c[j] <= c[idx] else "high"))
    return eps


# ---------------------------------------------------------------- fib helpers
def near(x, targets):
    """最接近的費波南希比率與對數誤差（0.10 ≈ 差 10%）。"""
    if x <= 0:
        return None, 9.9
    f = min(targets, key=lambda v: abs(math.log(x / v)))
    return f, abs(math.log(x / f))


def s_err(err, tol):
    return max(0.0, 1 - err / tol)


def s_range(x, lo, hi, soft=0.25):
    if lo <= x <= hi:
        return 1.0
    d = (lo - x) if x < lo else (x - hi)
    return max(0.0, 1 - d / soft)


# ---------------------------------------------------------------- wave fitting
def internal_pivots(c, p, t, th):
    piv = zigzag(c, th, p, t)
    if not piv or piv[0][0] != p:
        piv = [(p, "H")] + [x for x in piv if x[0] > p]
    piv = [x for x in piv if x[0] < t] + [(t, "L")]
    # 確保 H/L 交錯
    clean = []
    for x in piv:
        if clean and clean[-1][1] == x[1]:
            better = (c[x[0]] > c[clean[-1][0]]) if x[1] == "H" else (c[x[0]] < c[clean[-1][0]])
            if better or x[0] == t:
                clean[-1] = x
            continue
        clean.append(x)
    return clean


def fit_abc(c, piv):
    p, t = piv[0][0], piv[-1][0]
    S, T = c[p], c[t]
    lows = [i for i, k in piv[1:-1] if k == "L"]
    highs = [i for i, k in piv[1:-1] if k == "H"]
    best = None
    for a in lows:
        if c[a] != min(c[p:a + 1]):
            continue
        for b in highs:
            if b <= a or c[b] != max(c[a:t + 1]) or c[a] != min(c[p:b + 1]):
                continue
            lenA, lenB, lenC = S - c[a], c[b] - c[a], c[b] - T
            rB = lenB / lenA
            if rB < 0.2 or lenA < 0.15 * (S - T) or lenB < 0.05 * (S - T):
                continue
            fCA, eCA = near(lenC / lenA, [0.618, 1.0, 1.618, 2.618])
            s1 = s_err(eCA, 0.12)
            s2 = s_range(rB, 0.382, 0.786)
            score = 0.6 * s1 + 0.4 * s2
            if best is None or score > best["score"]:
                best = dict(
                    kind="abc", score=round(score, 3),
                    points=[[p, "0"], [a, "A"], [b, "B"], [t, "C"]],
                    stats=dict(ratio_CA=round(lenC / lenA, 3), fib_CA=fCA,
                               retrace_B=round(rB, 3)),
                    checks=[
                        dict(text=f"C 波 ≈ {fCA}× A 波（實際 {lenC / lenA:.2f}×）", ok=eCA < 0.06),
                        dict(text=f"B 波反彈 A 波的 {rB:.0%}（典型 38.2%–78.6%）", ok=0.382 <= rB <= 0.786),
                        dict(text="C 波跌破 A 波低點（鋸齒形）" if T < c[a] else "C 波未破 A 波低點（平台形特徵）", ok=True),
                    ])
    return best


def fit_impulse(c, piv):
    p, t = piv[0][0], piv[-1][0]
    S, T = c[p], c[t]
    lows = [i for i, k in piv[1:-1] if k == "L"]
    highs = [i for i, k in piv[1:-1] if k == "H"]
    best = None
    for l1 in lows:
        if c[l1] != min(c[p:l1 + 1]):
            continue
        for h2 in highs:
            if h2 <= l1 or c[l1] != min(c[p:h2 + 1]):
                continue
            for l3 in lows:
                if l3 <= h2 or c[l3] >= c[l1] or c[h2] != max(c[l1:l3 + 1]):
                    continue
                for h4 in highs:
                    if h4 <= l3 or c[l3] != min(c[h2:h4 + 1]) or c[h4] != max(c[l3:t + 1]):
                        continue
                    if c[h4] >= c[l1]:          # 規則：第 4 波不能進入第 1 波範圍
                        continue
                    w1, w3, w5 = S - c[l1], c[h2] - c[l3], c[h4] - T
                    if w3 < min(w1, w5):        # 規則：第 3 波不能最短
                        continue
                    tot = S - T                 # 每一波都要夠大，避免兩天的小抖動被當成一整波
                    if min(w1, w5) < 0.1 * tot or min(c[h2] - c[l1], c[h4] - c[l3]) < 0.06 * tot:
                        continue
                    r2 = (c[h2] - c[l1]) / w1
                    r4 = (c[h4] - c[l3]) / w3
                    f3, e3 = near(w3 / w1, [1.0, 1.618, 2.618])
                    f5, e5 = near(w5 / w1, [0.618, 1.0, 1.618])
                    score = (0.35 * s_err(e3, 0.15) + 0.25 * s_err(e5, 0.15)
                             + 0.2 * s_range(r2, 0.382, 0.786) + 0.2 * s_range(r4, 0.236, 0.5))
                    if best is None or score > best["score"]:
                        best = dict(
                            kind="impulse", score=round(score, 3),
                            points=[[p, "0"], [l1, "1"], [h2, "2"], [l3, "3"], [h4, "4"], [t, "5"]],
                            stats=dict(ratio_31=round(w3 / w1, 3), fib_31=f3,
                                       ratio_51=round(w5 / w1, 3), fib_51=f5,
                                       retrace_2=round(r2, 3), retrace_4=round(r4, 3)),
                            checks=[
                                dict(text="第 2 波沒有漲回起點", ok=True),
                                dict(text="第 3 波不是最短的一波", ok=True),
                                dict(text="第 4 波沒有碰到第 1 波低點（無重疊）", ok=True),
                                dict(text=f"第 3 波 ≈ {f3}× 第 1 波（實際 {w3 / w1:.2f}×）", ok=e3 < 0.08),
                                dict(text=f"第 5 波 ≈ {f5}× 第 1 波（實際 {w5 / w1:.2f}×）", ok=e5 < 0.08),
                                dict(text=f"第 2 波反彈 {r2:.0%}、第 4 波反彈 {r4:.0%}",
                                     ok=0.382 <= r2 <= 0.786 and 0.236 <= r4 <= 0.5),
                            ])
    return best


def fit_wave(c, p, t):
    depth = 1 - c[t] / c[p]
    results = {}
    # 由粗到細找轉折；越粗的轉折越有意義，粗的已經夠好就不再往細找（避免硬湊）
    for th in [0.12, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02]:
        if th > depth * 0.45:
            continue
        piv = internal_pivots(c, p, t, th)
        if len(piv) > 34:
            break
        for fn in (fit_abc, fit_impulse):
            r = fn(c, piv)
            if not r:
                continue
            r["swing_th"] = th
            k = r["kind"]
            # 細門檻要贏粗門檻得分數明顯較高
            if k not in results or r["score"] > results[k]["score"] + 0.08:
                results[k] = r
        if all(k in results and results[k]["score"] >= 0.8 for k in ("abc", "impulse")):
            break
    return results


# ---------------------------------------------------------------- main
def prior_low_of(dates, c, p, prev_t):
    """前一段漲幅的起點：高點前三年內的最低收盤。"""
    three_y = (dt.date.fromisoformat(dates[p]) - dt.timedelta(days=3 * 365)).isoformat()
    start = next(i for i, d in enumerate(dates) if d >= three_y)
    return min(range(start, p + 1), key=lambda i: c[i])


def projections(dates, c, p, t, adv, waves):
    """還在跌的下跌段：列出下方的波浪／費波南希目標價。"""
    out = []
    for frac in (0.382, 0.5, 0.618):
        lvl = c[p] - adv * frac
        out.append(dict(label=f"前波漲幅 {frac * 100:.1f}% 回檔", value=round(lvl, 1), reached=lvl >= c[t]))
    ab = waves.get("abc")
    if ab:
        ia = dates.index(ab["points"][1][0]); ib = dates.index(ab["points"][2][0])
        lenA = c[p] - c[ia]
        for f in (1.0, 1.618):
            for lvl, how in ((c[ib] - lenA * f, "點數"), (c[ib] * (c[ia] / c[p]) ** f, "幅度%")):
                out.append(dict(label=f"C = {f}× A（{how}）", value=round(lvl, 1), reached=lvl >= c[t]))
    im = waves.get("impulse")
    if im:
        i1 = dates.index(im["points"][1][0])
        i3 = dates.index(im["points"][3][0]); i4 = dates.index(im["points"][4][0])
        for lvl, lab in ((c[i4] - (c[p] - c[i1]), "第 5 波 = 第 1 波"),
                         (c[i4] - 0.618 * (c[p] - c[i3]), "第 5 波 = 0.618×(第 1→3 波)"),
                         (c[i4] - (c[p] - c[i3]), "第 5 波 = 1×(第 1→3 波)")):
            out.append(dict(label=lab, value=round(lvl, 1), reached=lvl >= c[t]))
    out.sort(key=lambda x: -x["value"])
    return out


def build_episode(ix, dates, c, p, t, rec, prior_low, ongoing):
    depth = 1 - c[t] / c[p]
    adv = c[p] - c[prior_low]
    retr = (c[p] - c[t]) / adv if adv > 0 and prior_low != p else None
    fib_r, err_r = near(retr, RETRACE_FIBS) if retr else (None, 9)
    waves = fit_wave(c, p, t)
    primary = max(waves.values(), key=lambda r: r["score"]) if waves else None
    for r in waves.values():
        for pt in r["points"]:
            pt[0] = dates[pt[0]]
    end = rec if rec is not None else len(c) - 1
    return dict(
        peak_date=dates[p], peak=round(c[p], 2),
        trough_date=dates[t], trough=round(c[t], 2),
        recover_date=dates[rec] if rec is not None else None,
        ongoing=ongoing,
        depth=round(depth, 4),
        days=(dt.date.fromisoformat(dates[t]) - dt.date.fromisoformat(dates[p])).days,
        prior_low_date=dates[prior_low], prior_low=round(c[prior_low], 2),
        retrace=round(retr, 4) if retr else None,
        retrace_fib=fib_r if err_r < 0.06 else None,
        primary=primary["kind"] if primary else None,
        score=primary["score"] if primary else 0,
        waves=waves,
        targets=projections(dates, c, p, t, adv, waves) if ongoing else [],
        checkpoints=checkpoints(dates, c, p, t, end, ix["th"] * 0.35),
    )


def analyse(ix, dates, c):
    eps_out = []
    prev_t = None
    for e in find_episodes(dates, c, ix["th"]):
        p, t = e["p"], e["t"]
        prior_low = prior_low_of(dates, c, p, prev_t)
        prev_t = t
        if dates[p] < LIST_FROM:
            continue
        eps_out.append(build_episode(ix, dates, c, p, t, e["rec"], prior_low, e["rec"] is None))

    # 目前這一段：最後一段還沒收復就用它；否則取近一年高點以來的回檔（跌幅不到門檻也分析）
    if eps_out and eps_out[-1]["ongoing"]:
        current = eps_out[-1]
    else:
        n = len(c)
        p = max(range(n - 260, n), key=lambda i: c[i])
        t = min(range(p, n), key=lambda i: c[i])
        current = None
        if t > p and 1 - c[t] / c[p] >= 0.05:
            current = build_episode(ix, dates, c, p, t, None, prior_low_of(dates, c, p, prev_t), True)
            current["below_threshold"] = True
    return eps_out, current


def main():
    offline = "--offline" in sys.argv
    RAW.mkdir(exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    index_meta = []
    for ix in INDICES:
        raw = RAW / f"{ix['id']}.json"
        if not offline:
            try:
                fetch(ix["sym"], raw)
            except Exception as ex:  # 抓不到就沿用快取
                print(f"[warn] fetch {ix['sym']} failed: {ex}", file=sys.stderr)
        dates, c = load(raw)
        eps, current = analyse(ix, dates, c)
        k0 = next(i for i, d in enumerate(dates) if d >= SHIP_FROM)
        # 回測：低點出現「之前」發出的預測，有幾次離實際低點 5% 以內
        pre = [cp for e in eps if not e["ongoing"] for cp in e["checkpoints"] if cp["before_low"]]
        hit = [cp for cp in pre if min(abs(cp["err_1"]), abs(cp["err_1618"])) <= 0.05]
        hit1 = [cp for cp in pre if abs(cp["err_1"]) <= 0.05]
        payload = dict(
            id=ix["id"], name=ix["name"], en=ix["en"], threshold=ix["th"],
            last_date=dates[-1], last=round(c[-1], 2),
            series=dict(d=dates[k0:], c=[round(v, 2) for v in c[k0:]]),
            episodes=eps,
            current=current,
            backtest=dict(n=len(pre), hit_any=len(hit), hit_1=len(hit1)),
        )
        (OUT / f"{ix['id']}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index_meta.append(dict(id=ix["id"], name=ix["name"], en=ix["en"], last_date=dates[-1], last=round(c[-1], 2),
                               episodes=len(eps)))
        print(f"{ix['id']}: {len(eps)} episodes, last {dates[-1]} {c[-1]:.1f}")
        for e in eps:
            print(f"  {e['peak_date']} {e['peak']:>9.1f} -> {e['trough_date']} {e['trough']:>9.1f} "
                  f"{-e['depth']:6.1%} {e['days']:4d}d retr={e['retrace'] or 0:.2f}({e['retrace_fib']}) "
                  f"{e['primary']} {e['score']:.2f} "
                  + " | ".join(f"{k}:{v['score']:.2f}@{v['swing_th']}" for k, v in e['waves'].items())
                  + (" ONGOING" if e["ongoing"] else ""))
        print(f"  backtest {payload['backtest']}")
        if current:
            print(f"  CURRENT {current['peak_date']} {current['peak']} -> {current['trough_date']} {current['trough']} "
                  f"{-current['depth']:.1%} primary={current['primary']} {current['score']}")
            for k, w in current["waves"].items():
                print(f"    {k} {w['score']} {[(d, l) for d, l in w['points']]}")
            for tg in current["targets"]:
                print(f"    target {tg['label']}: {tg['value']}")
    (OUT / "index.json").write_text(json.dumps(dict(
        built=dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"), indices=index_meta),
        ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
