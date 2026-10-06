/* 訊號判讀:把指標翻成「現在適合做多 / 做空 / 中性網格」的參考建議
 *
 * 這是機率上的參考,不是預測。核心想法:
 *   1. 方向分數(-5 ~ +5):價格對 MA200、MA50 對 MA200、價格對 MA50、RSI 動能
 *   2. ADX 判斷「有沒有趨勢」:沒趨勢就算分數偏一邊,也建議中性(網格賺震盪,不賺方向)
 *   3. 資金費率、RSI 極端值、布林帶寬只用來加警語,不改分數
 * 建議區間 / 格數 / 槓桿給的是起手式,到派網自己填的時候可以再調。
 */
const Signal = {
  DIR_LABEL: { long: '做多網格', short: '做空網格', neutral: '中性網格' },

  median(a) { const s = a.filter(x => !isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; },

  analyze(cs, funding, fee) {
    const c = cs.map(k => k.c), price = Ind.last(c);
    const ma20 = Ind.last(Ind.sma(c, 20)), ma50 = Ind.last(Ind.sma(c, 50)), ma200 = Ind.last(Ind.sma(c, 200));
    const rsi = Ind.last(Ind.rsi(c, 14));
    const atrV = Ind.last(Ind.atr(cs, 14)), atrPct = atrV / price * 100;
    const A = Ind.adx(cs, 14), adx = Ind.last(A.adx);
    const B = Ind.boll(c, 20, 2), bwRank = Ind.pctRank(B.bw, 120);
    const atrPs = Ind.atr(cs, 14).map((v, i) => v / c[i] * 100), atrRank = Ind.pctRank(atrPs, 120), atrMed90 = this.median(atrPs.slice(-90));

    let score = 0;
    const reasons = [];   // {tone: up|down|flat|warn, text}
    const add = (pts, tone, text) => { score += pts; reasons.push({ tone, text }); };

    if (!isNaN(ma200)) {
      if (price > ma200) add(2, 'up', '價格在 MA200 之上,長線偏多');
      else add(-2, 'down', '價格在 MA200 之下,長線偏空');
      if (ma50 > ma200) add(1, 'up', 'MA50 在 MA200 之上(多頭排列)');
      else add(-1, 'down', 'MA50 在 MA200 之下(空頭排列)');
    } else {
      reasons.push({ tone: 'flat', text: 'K 線不足 200 根,長線判斷略過' });
    }
    if (price > ma50) add(1, 'up', '價格在 MA50 之上,中期偏多');
    else add(-1, 'down', '價格在 MA50 之下,中期偏空');

    if (rsi >= 55) add(1, 'up', `RSI ${rsi.toFixed(0)},動能偏強`);
    else if (rsi <= 45) add(-1, 'down', `RSI ${rsi.toFixed(0)},動能偏弱`);
    else reasons.push({ tone: 'flat', text: `RSI ${rsi.toFixed(0)},動能中性` });

    const trendy = adx >= 22;
    if (adx >= 35) reasons.push({ tone: 'warn', text: `ADX ${adx.toFixed(0)},強趨勢中:網格容易單邊被掃,資金要縮小、止損要設` });
    else if (trendy) reasons.push({ tone: 'flat', text: `ADX ${adx.toFixed(0)},有趨勢,順勢方向的網格較有利` });
    else reasons.push({ tone: 'flat', text: `ADX ${adx.toFixed(0)},趨勢弱、偏盤整,網格較適合` });

    if (rsi >= 75) reasons.push({ tone: 'warn', text: 'RSI 過熱(≥75),追多要小心回檔' });
    if (rsi <= 25) reasons.push({ tone: 'warn', text: 'RSI 超賣(≤25),追空要小心反彈' });
    if (funding >= 0.03) reasons.push({ tone: 'warn', text: `資金費率 ${funding.toFixed(3)}%/8h 偏高,多方擁擠:做多網格持倉成本高、留意多殺多` });
    else if (funding <= -0.01) reasons.push({ tone: 'warn', text: `資金費率 ${funding.toFixed(3)}%/8h 為負,空方擁擠:做空網格持倉成本高、留意軋空` });
    if (atrRank < 20) reasons.push({ tone: 'warn', text: `波動壓縮(ATR 在近 120 根的 ${atrRank.toFixed(0)} 百分位):實測之後常有突破,網格區間要用「正常波動」放寬` });
    else if (atrRank > 80) reasons.push({ tone: 'flat', text: `波動在高檔(ATR ${atrRank.toFixed(0)} 百分位):實測之後波動多半回落,這時開網格較不容易被打出區間` });
    if (bwRank <= 25) reasons.push({ tone: 'warn', text: `布林帶寬只有近期的 ${bwRank.toFixed(0)} 百分位(收窄):看起來在盤整,但收窄後常有突破` });

    /* 結論 */
    let dir = 'neutral', why = '';
    if (Math.abs(score) >= 3 && adx >= 20) {
      dir = score > 0 ? 'long' : 'short';
      why = score > 0 ? '多項訊號一致偏多且有趨勢' : '多項訊號一致偏空且有趨勢';
    } else if (adx < 20) {
      why = '趨勢弱、價格在區間內震盪';
    } else {
      why = '訊號分歧,方向不明確';
    }
    const strength = Math.abs(score) >= 4 ? '高' : Math.abs(score) >= 3 ? '中' : '低';

    const sug = this.suggest(cs, dir, atrPct, price, fee);
    return {
      price, ma20, ma50, ma200, rsi, adx, atrPct, atrRank, atrMed90, bwRank, funding,
      pdi: A.pdi, mdi: A.mdi, score, dir, why, strength, reasons, sug,
      ma: { ma20: Ind.sma(c, 20), ma50: Ind.sma(c, 50), ma200: Ind.sma(c, 200) },
    };
  },

  /* 依近 30 根 K 線高低點 + ATR 給起手區間 */
  suggest(cs, dir, atrPct, price, fee) {
    const w = cs.slice(-30);
    const hi = Math.max(...w.map(k => k.h)), lo = Math.min(...w.map(k => k.l));
    let lower = Math.max(lo, price * 0.85), upper = Math.min(hi, price * 1.15);
    if (dir === 'long') { lower = Math.max(lo * 0.98, price * 0.8); upper = Math.min(Math.max(hi, price * 1.03), price * 1.12); }
    if (dir === 'short') { upper = Math.min(hi * 1.02, price * 1.2); lower = Math.max(Math.min(lo, price * 0.97), price * 0.88); }
    if (upper <= lower) { lower = price * 0.9; upper = price * 1.1; }
    lower = Grid.nice(lower, price); upper = Grid.nice(upper, price);

    const widthPct = (upper / lower - 1) * 100;
    const minStep = 2 * fee + 0.25;                        // 每格至少要賺過來回手續費再多一點
    const stepPct = Math.max(minStep + 0.15, atrPct * 0.25);
    const n = Math.max(5, Math.min(100, Math.round(widthPct / stepPct)));
    const lev = Math.max(1, Math.min(3, Grid.safeLeverage(dir, lower, upper, 0.1, Store.settings.mmr / 100)));
    return { lower, upper, n, lev: Math.floor(lev), mode: 'arith', dir };
  },

  /* 單一指標的多空判斷:指標儀表與每日節點共用同一套門檻 */
  LEAN: {
    dmi: (pdi, mdi) => pdi - mdi > 3 ? 'up' : pdi - mdi < -3 ? 'down' : 'flat',
    ma: (p, m50, m200) => p > m50 && m50 > m200 ? 'up' : p < m50 && m50 < m200 ? 'down' : 'flat',
    macd: h => h > 0 ? 'up' : 'down',
    rsi: r => r >= 55 ? 'up' : r <= 45 ? 'down' : 'flat',
    pb: pb => pb >= 85 ? 'up' : pb <= 15 ? 'down' : 'flat',        // 實測幣圈貼軌多半延續,所以順勢投票
    kd: (k, d) => k - d > 1 ? 'up' : k - d < -1 ? 'down' : 'flat',
  },

  /* 轉折點的確認根數:前後各 w 根 */
  PIV_W: { '8h': 4, '1d': 4, '1w': 3 },

  /* ---------- 支撐 / 壓力區 ----------
   * 取最近 180 根的轉折高低點,價格相近(0.6 個 ATR 內)的合併成一個「區」;
   * 觸碰次數越多越有效,最近 30 根內碰過的再加分。只留碰過 2 次以上、或最近 40 根內出現的。
   * 回傳 [{lo, hi, mid, touches, ago, score}] 由低到高 */
  levels(cs, tf, upto = cs.length - 1) {
    const w = this.PIV_W[tf] || 4, from = Math.max(0, upto - 180), sub = cs.slice(from, upto + 1), n = sub.length;
    if (n < 30) return [];
    const P = Ind.pivots(sub, w), atr = Ind.last(Ind.atr(sub, 14)), tol = atr * 0.6;
    const pts = P.hi.map(i => ({ p: sub[i].h, i })).concat(P.lo.map(i => ({ p: sub[i].l, i }))).sort((a, b) => a.p - b.p);
    const zones = [];
    pts.forEach(q => {
      const z = zones[zones.length - 1];
      if (z && q.p - z.hi <= tol && q.p - z.lo <= tol * 2) { z.hi = q.p; z.pts.push(q); }
      else zones.push({ lo: q.p, hi: q.p, pts: [q] });
    });
    return zones.map(z => {
      const ago = n - 1 - Math.max(...z.pts.map(q => q.i));
      return { lo: z.lo, hi: z.hi, mid: z.pts.reduce((s, q) => s + q.p, 0) / z.pts.length, touches: z.pts.length, ago, score: z.pts.length + (ago < 30 ? 1 : 0) };
    }).filter(z => z.touches >= 2 || z.ago <= 40);
  },
  /* 現價下方最近的支撐、上方最近的壓力(各取最近 3 個) */
  nearSR(lv, price) {
    return {
      sup: lv.filter(z => z.mid < price).sort((a, b) => b.mid - a.mid).slice(0, 3),
      res: lv.filter(z => z.mid >= price).sort((a, b) => a.mid - b.mid).slice(0, 3),
    };
  },

  /* ---------- 市場結構:最近兩個轉折高點 / 低點 ----------
   * 高低點都墊高 = 上升結構;都降低 = 下降結構;跌破最近低點(或突破最近高點)= 結構被破壞 */
  structure(cs, tf, upto = cs.length - 1) {
    const w = this.PIV_W[tf] || 4, from = Math.max(0, upto - 120), sub = cs.slice(from, upto + 1), P = Ind.pivots(sub, w);
    if (P.hi.length < 2 || P.lo.length < 2) return { lean: 'flat', text: '轉折點不足', name: '—' };
    const [h1, h2] = P.hi.slice(-2).map(i => sub[i].h), [l1, l2] = P.lo.slice(-2).map(i => sub[i].l);
    const price = sub[sub.length - 1].c;
    let lean = 'flat', name, text;
    if (h2 > h1 && l2 > l1) { lean = 'up'; name = '上升結構'; text = '高點、低點都墊高'; }
    else if (h2 < h1 && l2 < l1) { lean = 'down'; name = '下降結構'; text = '高點、低點都降低'; }
    else if (h2 < h1 && l2 > l1) { name = '收斂'; text = '高點降低、低點墊高,三角收斂等突破'; }
    else { name = '擴張'; text = '高點墊高、低點降低,波動在放大'; }
    if (price < l2 && lean !== 'down') { lean = 'down'; name = '跌破低點'; text = `跌破最近轉折低點 ${fmt.n(l2, 0)},${name === '上升結構' ? '上升結構被破壞' : '偏空'}`; }
    else if (price > h2 && lean !== 'up') { lean = 'up'; name = '突破高點'; text = `突破最近轉折高點 ${fmt.n(h2, 0)},偏多`; }
    return { lean, name, text, h1, h2, l1, l2 };
  },

  /* ---------- 量價關係:近 10 根價格方向 vs OBV 方向,加上量比(近 5 根 ÷ 近 20 根,只算已收盤) ---------- */
  volume(cs, upto = cs.length - 1) {
    const s = cs.slice(Math.max(0, upto - 80), upto + 1), n = s.length;
    if (n < 25) return { lean: 'flat', text: 'K 線不足', vr: NaN };
    const avg = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += s[i].v; return t / (b - a); };
    const vr = avg(n - 6, n - 1) / avg(n - 21, n - 1), obv = Ind.obv(s);
    const pc = s[n - 1].c / s[n - 11].c - 1, oc = obv[n - 1] - obv[n - 11];
    let lean = 'flat', text;
    if (pc > 0 && oc > 0) { lean = 'up'; text = '價漲、OBV 同步上升:上漲有量支撐'; }
    else if (pc < 0 && oc < 0) { lean = 'down'; text = '價跌、OBV 同步下降:賣壓是真的'; }
    else if (pc > 0) text = '價漲但 OBV 沒跟上:漲勢缺量,可能只是反彈';
    else text = '價跌但 OBV 沒跟著破:下跌缺量,可能只是回檔';
    return { lean, text, vr, pc: pc * 100, obv };
  },

  /* ---------- 背離:最近兩個轉折高點(或低點),價格與指標方向相反 ----------
   * ser 是跟 cs 對齊的指標序列(RSI、MACD 柱);最近的轉折要在 3w+2 根內才算數 */
  divergence(cs, tf, ser, upto = cs.length - 1) {
    const w = this.PIV_W[tf] || 4, from = Math.max(0, upto - 80), sub = cs.slice(from, upto + 1), m = sub.length, P = Ind.pivots(sub, w);
    const chk = (arr, isHi) => {
      if (arr.length < 2) return null;
      const [a, b] = arr.slice(-2);
      if (m - 1 - b > w * 3 + 2) return null;
      const pa = isHi ? sub[a].h : sub[a].l, pb = isHi ? sub[b].h : sub[b].l, sa = ser[from + a], sb = ser[from + b];
      if (isHi && pb > pa && sb < sa) return { type: 'bear', ago: m - 1 - b, text: '頂背離:價格創高、指標沒創高,漲勢可能疲乏' };
      if (!isHi && pb < pa && sb > sa) return { type: 'bull', ago: m - 1 - b, text: '底背離:價格創低、指標沒創低,跌勢可能減緩' };
      return null;
    };
    const a = chk(P.hi, true), b = chk(P.lo, false);
    return a && b ? (a.ago <= b.ago ? a : b) : a || b;
  },

  /* ---------- K 線型態(看已收盤那根) ---------- */
  candle(cs, i) {
    const k = cs[i], p = cs[i - 1];
    if (!k || !p) return { lean: 'flat', name: '—', text: '' };
    const body = Math.abs(k.c - k.o), rng = (k.h - k.l) || 1e-9, pbody = Math.abs(p.c - p.o);
    const up = k.h - Math.max(k.o, k.c), dn = Math.min(k.o, k.c) - k.l;
    if (p.c < p.o && k.c > k.o && k.c >= p.o && k.o <= p.c && body > pbody) return { lean: 'up', name: '多頭吞噬', text: '陽線實體吞掉前一根陰線,買方反攻' };
    if (p.c > p.o && k.c < k.o && k.o >= p.c && k.c <= p.o && body > pbody) return { lean: 'down', name: '空頭吞噬', text: '陰線實體吞掉前一根陽線,賣方反攻' };
    if (dn >= body * 2 && up <= Math.max(body, rng * 0.1) && dn >= rng * 0.55) return { lean: 'up', name: '長下影(錘子)', text: '下方有買盤承接,出現在支撐附近時是止跌訊號' };
    if (up >= body * 2 && dn <= Math.max(body, rng * 0.1) && up >= rng * 0.55) return { lean: 'down', name: '長上影(流星)', text: '上方賣壓重,出現在壓力附近時是見頂訊號' };
    if (body <= rng * 0.1) return { lean: 'flat', name: '十字線', text: '開收盤接近,多空猶豫,常出現在轉折前' };
    return { lean: 'flat', name: k.c >= k.o ? '一般陽線' : '一般陰線', text: '沒有明顯的反轉型態' };
  },

  /* ---------- 歷史實測勝率 ----------
   * 用這個幣過去幾年的日線回放:每一天照「中風險」規則開網格,接下來 H 天會不會在「輸的那一邊」被打出區間
   *   區間半寬 = max(8%, 2.5 × max(ATR14, 90 天 ATR 中位數)),做多往下多留 25%、做空往上多留 25%
   *   中性:兩邊破都算輸;做多:只算跌破下限(往上破是獲利出場);做空:只算突破上限
   * 方向訊號跟 analyze() 同一套規則;波動狀態用 ATR 在近 120 天的百分位(< 20 壓縮、> 80 高檔)
   * 再挑出「波動狀態」和「方向訊號」都跟今天一樣的日子,算安全率(沒在輸的那邊被打出區間的比例) */
  gridOdds(cs, H = 14) {
    const c = cs.map(k => k.c), n = cs.length;
    const atrP = Ind.atr(cs, 14).map((v, i) => v / c[i] * 100);
    const ma50 = Ind.sma(c, 50), ma200 = Ind.sma(c, 200), rsi = Ind.rsi(c, 14), adx = Ind.adx(cs, 14).adx;
    const day = i => {
      const rank = Ind.pctRank(atrP.slice(i - 119, i + 1), 120);
      let sc = (c[i] > ma200[i] ? 2 : -2) + (ma50[i] > ma200[i] ? 1 : -1) + (c[i] > ma50[i] ? 1 : -1);
      sc += rsi[i] >= 55 ? 1 : rsi[i] <= 45 ? -1 : 0;
      return {
        rank, vol: rank < 20 ? 'low' : rank > 80 ? 'high' : 'mid',
        dir: Math.abs(sc) >= 3 && adx[i] >= 20 ? (sc > 0 ? 'long' : 'short') : 'neutral',
        w: Math.max(8, 2.5 * Math.max(atrP[i], this.median(atrP.slice(i - 89, i + 1)))),
      };
    };
    const rows = [];
    for (let i = 220; i < n - H; i++) {
      const d = day(i), p = c[i];
      let lo = Infinity, hi = -Infinity;
      for (let j = i + 1; j <= i + H; j++) { lo = Math.min(lo, cs[j].l); hi = Math.max(hi, cs[j].h); }
      const dn = (1 - lo / p) * 100, up = (hi / p - 1) * 100;
      rows.push({ vol: d.vol, dir: d.dir, neutral: dn < d.w && up < d.w, long: dn < d.w * 1.25, short: up < d.w * 1.25 });
    }
    const rate = r => {
      const pc = k => r.length ? r.filter(x => x[k]).length / r.length * 100 : NaN;
      return { n: r.length, neutral: pc('neutral'), long: pc('long'), short: pc('short') };
    };
    const now = day(n - 1);
    let match = rows.filter(r => r.vol === now.vol && r.dir === now.dir), basis = 'both';
    if (match.length < 40) { match = rows.filter(r => r.vol === now.vol); basis = 'vol'; }
    const m = rate(match), best = ['neutral', 'long', 'short'].sort((a, b) => m[b] - m[a])[0];
    const table = {};
    ['low', 'mid', 'high'].forEach(v => { table[v] = rate(rows.filter(r => r.vol === v)); });
    return { now, basis, match: m, best, all: rate(rows), table, H, from: cs[220].t, days: rows.length };
  },

  /* 技術面重要度排序(以「開合約網格」的角度,依 2021 ~ 2026 ETH / BTC 日線實測排序):
   * 網格勝率最受「波動狀態」與「方向」影響;教科書的反轉訊號(超買賣、背離、K 線型態)在幣圈實測幾乎沒有預測力
   * vote:false 的不參與指標儀表投票;test 是實測結論(14 天後的表現) */
  TECH: [
    { key: 'atr', name: '波動狀態(ATR 排名)', stars: 5, vote: false,
      role: '網格會不會被打出區間,最大的決定因素',
      why: '實測影響網格存活最大的就是波動狀態:ATR 在近期低檔(壓縮)時開的網格,最容易被接下來的突破打出區間;波動剛放大過後開的反而最安全。',
      what: 'ATR 是平均每根 K 線的真實波動幅度;ATR 排名是「現在的 ATR 在最近 120 根裡排第幾百分位」,0 = 最安靜、100 = 最激烈。',
      calc: '真實波幅 = max(高 − 低, |高 − 前收|, |低 − 前收|),取 14 期 Wilder 平均,除以價格;再算它在近 120 根的百分位。',
      read: ['排名 < 20:波動壓縮,行情安靜但隨時可能突破', '排名 20 ~ 80:正常', '排名 > 80:波動在高檔,之後多半慢慢回落', 'ATR 數字本身決定格距:每格間距至少要大於來回手續費'],
      grid: ['壓縮時:區間不要用「現在的 ATR」算,改用 90 天的正常波動放寬(建議參數已自動這樣做)', '壓縮時寧可順著方向開、或用低風險,不要開窄的中性高槓桿網格', '波動高檔時:是開網格相對安全的時機,格子可以放寬、每格賺多一點'],
      trap: '「行情很安靜、看起來在盤整」正是最危險的時候;安靜不代表會一直安靜。',
      test: '日線 ATR 排名最低的 1/5 時開中性網格,14 天內被打出區間的機率 63 ~ 73%;最高的 1/5 只有 30 ~ 35%。壓縮期把區間改用 90 天正常波動放寬後,ETH 70% → 54%、BTC 62% → 48%。' },
    { key: 'ma', name: '均線排列(MA50 / MA200)', stars: 5, vote: true,
      role: '定出長線方向,判讀分數 ±5 裡占了 ±4',
      why: '方向判讀主要來自均線;實測跟著方向開網格,「在輸的那邊被打出區間」的機率比開反方向低一半左右。',
      what: '價格、50 期均線(中期)、200 期均線(長線)三者的上下順序,以及價格離 MA200 多遠(乖離)。',
      calc: 'MA = 最近 N 根收盤價的簡單平均。乖離 = 價格 ÷ MA200 − 1。',
      read: ['價 > MA50 > MA200:多頭排列', '價 < MA50 < MA200:空頭排列', '其他順序:均線糾結 / 整理中', 'MA50 上穿 MA200 = 黃金交叉;下穿 = 死亡交叉'],
      grid: ['多頭排列 → 做多網格', '空頭排列 → 做空網格', '糾結 → 中性網格,資金放小', '方向不要逆著週線開'],
      trap: '均線最落後,轉折後要好幾天才翻;盤整時價格在均線上下來回穿,會一直給假訊號。',
      test: '方向訊號出現的日子,跟著方向開網格 14 天內在輸的那邊被打出區間 11 ~ 15%;開反方向 18 ~ 27%;開中性(兩邊都會輸)48 ~ 51%。多頭排列後 14 天平均漲幅 ETH +2.1%、BTC +1.7%。' },
    { key: 'dmi', name: 'ADX 趨勢強度(DMI)', stars: 4, vote: true,
      role: '看趨勢強不強、哪一方占優',
      why: '+DI / −DI 誰在上面有方向參考價值;但實測推翻了「ADX 低 = 盤整 = 網格最安全」的說法。',
      what: 'ADX 只量趨勢「強不強」,不分多空;+DI 是上漲力道、−DI 是下跌力道。',
      calc: '14 期,Wilder 平滑。DX = |+DI − −DI| ÷ (+DI + −DI) × 100,ADX 是 DX 再平滑一次。',
      read: ['ADX < 20:趨勢弱', 'ADX 20 ~ 35:有趨勢,看 +DI / −DI 哪條在上面', 'ADX > 35:強趨勢', '+DI 與 −DI 差距 3 以內視為中性'],
      grid: ['+DI 在上 → 偏向做多網格;−DI 在上 → 偏向做空網格', 'ADX 低不代表安全:常是突破前的安靜期,要搭配波動狀態看', 'ADX 很高時方向明確,順勢網格可以開,但不要開反方向'],
      trap: 'ADX 是落後指標;ADX 從高點回落不代表反轉,只代表趨勢變弱。',
      test: 'ADX 最低的 1/5 時開中性網格,14 天內被打出區間 58 ~ 65%;最高的 1/5 只有 43%(因為那時波動已經放大、區間跟著放寬)。+DI 在上的日子 14 天後平均 ETH +2.8%、BTC +1.4%。' },
    { key: 'pb', name: '布林位置 %B / 帶寬', stars: 4, vote: true,
      role: '看價格在通道哪裡、波動是不是被壓縮',
      why: '帶寬收窄跟 ATR 壓縮是同一件事:之後容易突破。%B 在幣圈是順勢指標,不是反轉指標。',
      what: '中軌是 20 期均線,上下軌是中軌 ± 2 倍標準差。%B = 價格在上下軌之間的位置;帶寬 = 通道寬 ÷ 中軌。',
      calc: '%B = (價格 − 下軌) ÷ (上軌 − 下軌) × 100;帶寬百分位 = 目前帶寬在最近 120 根裡的排名。',
      read: ['%B ≥ 85 貼近上軌:強勢', '%B ≤ 15 貼近下軌:弱勢', '帶寬百分位 ≤ 20:通道收窄,常醞釀突破', '帶寬百分位 ≥ 80:波動大'],
      grid: ['帶寬收窄時別開窄的高槓桿網格,突破後很快就出區間', '貼上軌不要急著做空網格:實測多半繼續漲', '帶寬大時格子可以放寬,每格賺多一點'],
      trap: '教科書說「碰上軌超買、碰下軌超賣」,在幣圈實測剛好相反,價格常貼著軌道一路走(騎軌)。',
      test: '貼上軌後 14 天平均 ETH +2.2%、BTC +1.2%,貼下軌後 ETH −0.1%、BTC +0.7%(所以這裡改成順勢投票)。帶寬最窄的 1/5 開網格,14 天內被打出區間 ETH 69%、BTC 60%;最寬的 1/5 只有 36%、40%。' },
    { key: 'rsi', name: 'RSI 相對強弱', stars: 3, vote: true,
      role: '動能方向;過熱不等於要跌',
      why: 'RSI 在 55 以上 / 45 以下有一點順勢的參考價值;但「70 以上過熱就會跌」在幣圈不成立。',
      what: '一段時間內漲幅占漲跌總幅度的比例,0 ~ 100。',
      calc: '14 期,Wilder 平滑:RSI = 100 − 100 ÷ (1 + 平均漲幅 ÷ 平均跌幅)。',
      read: ['50 是多空分界;≥ 55 偏強、≤ 45 偏弱', '≥ 70 過熱、≤ 30 超賣:代表動能很強,不代表馬上反轉', '強趨勢中 RSI 可以長時間停在 70 以上(鈍化)'],
      grid: ['RSI 偏強 → 偏向做多網格', '過熱時開做多網格可以,但區間下限留深一點,防短線回檔', '不要只因為 RSI 超賣就開做多網格抄底'],
      trap: 'RSI 背離在實測裡沒有用:底背離之後價格反而多半繼續跌。',
      test: 'RSI 偏強後 14 天平均 ETH +2.4%、BTC +1.6%;偏弱 ETH −0.4%、BTC +0.5%。RSI 底背離後 ETH −1.5%(只有 37% 上漲)、BTC −1.5%,跟教科書相反。' },
    { key: 'macd', name: 'MACD 動能', stars: 3, vote: true,
      role: '動能轉折的參考,預測力偏弱',
      why: 'MACD 柱在 0 之上 / 之下有些微順勢參考,但比均線、RSI 弱;金叉死叉在盤整時會來回假訊號。',
      what: 'DIF = 快慢兩條 EMA 的差;DEA = DIF 的平均;柱 = DIF − DEA,代表動能變化。',
      calc: 'DIF = EMA12 − EMA26,DEA = DIF 的 9 期 EMA,柱 = DIF − DEA。',
      read: ['柱由負翻正 = 金叉;由正翻負 = 死叉', '柱體連續變長 = 動能增強;連續縮短 = 動能減弱', '0 軸之上的金叉比 0 軸之下的可靠'],
      grid: ['當作輔助:跟均線同向時加分,不同向時資金放小', '不要只靠金叉死叉換方向'],
      trap: 'MACD 背離實測無效:底背離之後 ETH 反而平均 −2.8%。',
      test: '柱在 0 之上後 14 天平均 ETH +1.2%、BTC +1.3%;在 0 之下 ETH +0.7%、BTC +0.9%,差距小。' },
    { key: 'struct', name: '市場結構(高低點)', stars: 2, vote: false,
      role: '高點、低點有沒有墊高或降低',
      why: '文章常用「高點越墊越高 = 上升趨勢」判斷;實測在 ETH 有一點參考價值,BTC 沒有,所以只當參考、不投票。',
      what: '用最近兩個轉折高點、兩個轉折低點判斷:都墊高 = 上升結構;都降低 = 下降結構;一高一低 = 收斂或擴張。',
      calc: '轉折點 = 前後各 4 根(週線 3 根)都比它低的高點 / 都比它高的低點;跌破最近低點或突破最近高點視為結構改變。',
      read: ['上升結構:回檔不破前低就還在多頭', '下降結構:反彈不過前高就還在空頭', '收斂:高點降低、低點墊高,等突破方向'],
      grid: ['結構跟均線同向時,方向把握度較高', '結構被破壞(跌破前低)時,做多網格要特別小心'],
      trap: '轉折點要後面幾根 K 線才能確認,所以永遠慢幾根。',
      test: 'ETH 上升結構後 14 天平均 +2.3%、下降結構 −1.4%;BTC 三種結構都差不多(+0.9% ~ +1.2%)。' },
    { key: 'sr', name: '支撐 / 壓力區', stars: 2, vote: false,
      role: '看區間邊界附近有哪些價位常被碰到',
      why: '支撐壓力是文章最強調的工具,適合拿來理解價格位置;但實測「把區間邊界對齊支撐」並沒有比同寬度的區間更不容易被打穿,所以建議參數不刻意對齊。',
      what: '過去轉折高低點聚集的價格帶;是「一個區間帶」,不是一個精確價格,碰過越多次越有效。',
      calc: '取最近 180 根的轉折點,相距 0.6 個 ATR 內的合併成一區;碰過 2 次以上、或最近 40 根內出現的才留下。',
      read: ['支撐:跌下來容易有人接的價位', '壓力:漲上去容易有人賣的價位', '支撐被跌破後常變成壓力(反之亦然)'],
      grid: ['區間下限放在支撐上方容易被影線掃到,要放就放在支撐區下方', 'K 線圖上的 S1 / R1 線可以拿來檢查區間邊界附近有沒有關鍵價位'],
      trap: '支撐壓力看得到,市場上每個人也都看得到;假跌破、假突破很常見。',
      test: '區間下限對齊支撐區(往下留 0.3 ATR)被跌破的機率 ETH 14.8%、BTC 13.6%,跟同寬度但不對齊的完全一樣,好處只來自區間變寬。' },
    { key: 'vol', name: '量價關係(OBV)', stars: 1, vote: false,
      role: '上漲 / 下跌有沒有成交量支持',
      why: '「價漲量增才是真上漲」是文章的重點;實測在日線上對接下來 14 天幾乎沒有預測力,只當參考。',
      what: 'OBV 能量潮:收漲那根加上成交量、收跌那根減掉,看資金是流進還是流出;量比 = 近 5 根平均量 ÷ 近 20 根平均量。',
      calc: '比較近 10 根的價格方向和 OBV 方向:同向 = 量價配合;反向 = 量價背離。',
      read: ['價漲 + OBV 漲:上漲有量', '價跌 + OBV 跌:賣壓是真的', '價漲 + OBV 沒漲:漲勢缺量', '量比 > 1.5 放量、< 0.7 縮量'],
      grid: ['突破區間時看量:放量突破較可能是真的,這時網格應該出場', '縮量盤整時網格可以繼續跑'],
      trap: '幣圈成交量分散在很多交易所,單一交易所的量不一定代表全市場。',
      test: '量價配合後 14 天平均 ETH +1.9%、BTC +1.5%;量價背離 ETH +0.1%、BTC −0.2%;OBV 下降 ETH +0.5%、BTC +1.4%,看不出穩定的方向。' },
    { key: 'kd', name: 'KD 隨機指標', stars: 1, vote: false,
      role: '短線超買超賣;實測沒有預測力',
      why: 'KD 是台灣最常見的指標,文章也有教;但實測金叉 / 死叉之後的表現幾乎一樣,超買之後反而繼續漲,所以不投票。',
      what: 'RSV = 收盤價在最近 9 根高低區間的位置;K 是 RSV 的平滑、D 是 K 的平滑,0 ~ 100。',
      calc: 'RSV = (收 − 9 根最低) ÷ (9 根最高 − 9 根最低) × 100;K = ⅔ 前 K + ⅓ RSV;D = ⅔ 前 D + ⅓ K。',
      read: ['K > 80 超買、K < 20 超賣', 'K 上穿 D = 金叉、下穿 = 死叉', 'K 長時間在 80 以上叫高檔鈍化,代表很強'],
      grid: ['不要用 KD 決定網格方向', '可以當進場時機的微調:想開做多網格時,等 KD 從高檔回落再開'],
      trap: '「KD 80 以上要賣」在幣圈實測是錯的:超買之後 14 天平均 ETH +2.1%、BTC +2.5%。',
      test: '金叉後 14 天平均 ETH +1.1%、BTC +1.1%;死叉 ETH +0.9%、BTC +1.2%,沒有差別。' },
    { key: 'candle', name: 'K 線型態', stars: 1, vote: false,
      role: '錘子、流星、吞噬、十字線',
      why: '文章用 K 線型態判斷止跌或見頂;實測單根型態對接下來 14 天沒有預測力,只當盤感參考。',
      what: '看最近一根已收盤 K 線的實體與上下影線比例,以及跟前一根的關係。',
      calc: '錘子:下影線 ≥ 2 倍實體且占全長 55% 以上;流星:上影線同理;吞噬:實體完全包住前一根相反顏色的實體;十字:實體 ≤ 全長 10%。',
      read: ['長下影(錘子):下方有人接', '長上影(流星):上方有人賣', '多頭 / 空頭吞噬:一方反攻', '十字線:多空猶豫'],
      grid: ['出現在支撐 / 壓力附近才比較有意義', '不要只因為一根 K 線就換網格方向'],
      trap: '日線收盤前型態隨時會變,一定要等收盤。',
      test: '偏多型態後 14 天平均 ETH +1.7%、BTC +1.8%;偏空型態 ETH +1.2%、BTC +1.0%;無型態 ETH +0.8%、BTC +1.0%,差距在雜訊範圍內。' },
  ],

  /* 日線 / 週線操作建議:用方向判讀(an)加上技術面節點(N,techHistory 的結果)寫成白話
   * 回傳 {dir, strength, bullets:[{tone,text}], plan:[[項目,內容]], watch:[文字], note} */
  advice(tf, an, N, cs) {
    const last = N[N.length - 1], k = Math.min(7, N.length - 1), prev = N[N.length - 1 - k];
    const wk = tf === '1w', u = wk ? '週' : '天', devR = wk ? 80 : 40, L = last.lean;
    const b = [], add = (tone, text) => b.push({ tone, text });
    const n0 = x => fmt.n(x, 0);

    const peak = Math.max(...N.slice(-10).map(q => q.adx));
    const fall = last.adx >= 25 && last.adx <= peak - 3, rise = last.adx - prev.adx >= 3;
    const rk = last.atrRank;
    if (rk < 20) add('warn', `波動壓縮(ATR 排名 ${rk.toFixed(0)}):實測之後常有突破,中性網格最容易被打出區間`);
    else if (rk > 80) add('up', `波動在高檔(ATR 排名 ${rk.toFixed(0)}):實測之後多半回落,是開網格相對安全的時機`);
    else add('flat', `波動正常(ATR 排名 ${isNaN(rk) ? '—' : rk.toFixed(0)})`);

    if (last.adx < 20) add('flat', `ADX ${last.adx.toFixed(0)},趨勢弱(實測低 ADX 之後常突破,不代表網格安全)`);
    else {
      const side = { up: '多方占優', down: '空方占優', flat: '多空接近' }[L.dmi];
      add(L.dmi === 'flat' ? 'flat' : L.dmi, `ADX ${last.adx.toFixed(0)},${side}(+DI ${last.pdi.toFixed(0)} / −DI ${last.mdi.toFixed(0)})${fall ? ',已從高點回落,趨勢在退燒' : rise ? ',且還在加強' : ''}`);
    }
    if (last.adx >= 35) add('warn', '強趨勢:只開順著 DI 方向的網格,不要開反方向');

    if (L.ma === 'up') add('up', `價格 > MA50(${n0(last.ma50)})> MA200(${n0(last.ma200)}),多頭排列`);
    else if (L.ma === 'down') add('down', `價格 < MA50(${n0(last.ma50)})< MA200(${n0(last.ma200)}),空頭排列`);
    else add('flat', `均線糾結:價格在 MA200(${n0(last.ma200)})${last.price > last.ma200 ? '之上' : '之下'},中期方向未定`);

    const flip = N.slice(-4).some(q => q.lean.macd !== L.macd);
    add(L.macd, flip ? (L.macd === 'up' ? 'MACD 剛金叉,動能轉強' : 'MACD 剛死叉,動能轉弱')
      : (L.macd === 'up' ? 'MACD 柱在 0 軸之上,多方動能' : 'MACD 柱在 0 軸之下,空方動能') + (Math.abs(last.hist) < Math.abs(prev.hist) ? `,但近 ${k} ${u}柱體縮短、動能減弱` : `,近 ${k} ${u}柱體擴大、動能增強`));

    if (last.rsi >= 70) add('up', `RSI ${last.rsi.toFixed(0)} 過熱:代表動能強(實測過熱後多半續漲),做多網格下限留深一點`);
    else if (last.rsi <= 30) add('down', `RSI ${last.rsi.toFixed(0)} 超賣:代表動能弱(實測超賣後多半續弱),不要只因超賣就抄底`);
    else add(L.rsi, `RSI ${last.rsi.toFixed(0)},動能${L.rsi === 'up' ? '偏強' : L.rsi === 'down' ? '偏弱' : '中性'}`);
    if (last.pb >= 85) add('up', `%B ${last.pb.toFixed(0)},貼近布林上軌:強勢(實測多半延續)`);
    else if (last.pb <= 15) add('down', `%B ${last.pb.toFixed(0)},貼近布林下軌:弱勢(實測多半延續)`);
    if (!isNaN(last.bwRank) && last.bwRank <= 25) add('warn', `布林帶寬只有近期 ${last.bwRank.toFixed(0)} 百分位,收窄後常有突破`);
    if (Math.abs(last.dev) > devR * 0.6) add('warn', `離 MA200 ${fmt.pct(last.dev, 1)},離長均線很遠,回檔時幅度可能較大`);
    const st = last.x.struct;
    add(st.lean, `K 線結構:${st.name}(${st.text})`);

    const dir = an.dir, plan = [], watch = [];
    const counter = dir === 'long' ? (L.macd === 'down') + (st.lean === 'down') + (last.dev > devR * 0.6)
      : dir === 'short' ? (L.macd === 'up') + (st.lean === 'up') + (last.dev < -devR * 0.6) : 0;
    const sr = this.nearSR(this.levels(cs, tf), last.price), zt = z => `${n0(z.mid)}(${z.touches} 次)`;
    plan.push(['波動狀態', rk < 20 ? '壓縮:區間用 90 天正常波動放寬,避免窄區間高槓桿' : rk > 80 ? '高檔:開網格相對安全,格子可以放寬' : '正常']);
    const hi = Math.max(...N.map(q => q.price)), lo = Math.min(...N.map(q => q.price));
    const lvls = [{ n: 'MA50', v: last.ma50 }, { n: 'MA200', v: last.ma200 }].filter(x => !isNaN(x.v));
    if (dir === 'long') {
      plan.push(['建議方向', counter >= 2 ? '做多網格,但先等回檔再開,或資金縮小' : '做多網格']);
      plan.push(['風險等級', counter >= 2 || last.adx >= 35 ? '低風險(槓桿 ≤ 3x)' : '中風險(槓桿 ≤ 5x)']);
      const sup = lvls.filter(x => x.v < last.price).sort((a, c) => c.v - a.v), s1 = sup[0], s2 = sup[sup.length - 1];
      plan.push(['區間參考', s1 ? `下限放最近的支撐 ${s1.n} ${n0(s1.v)} 附近(回檔買得到)${s2 !== s1 ? `,最多不低於 ${s2.n} ${n0(s2.v)}` : ''}` : `價格在兩條均線之下,下限參考近期低點 ${n0(lo)}`]);
      plan.push(['止損參考', s2 ? `收盤跌破 ${s2.n}(${n0(s2.v)}),或跌破最近支撐且 MACD 死叉` : `收盤跌破近期低點 ${n0(lo)}`]);
      watch.push('MACD 死叉(柱體翻負)', s1 ? `收盤跌破 ${s1.n}(${n0(s1.v)})` : `收盤再創近期新低`, 'ADX 從高點回落且 −DI 上穿 +DI');
    } else if (dir === 'short') {
      plan.push(['建議方向', counter >= 2 ? '做空網格,但先等反彈再開,或資金縮小' : '做空網格']);
      plan.push(['風險等級', counter >= 2 || last.adx >= 35 ? '低風險(槓桿 ≤ 3x)' : '中風險(槓桿 ≤ 5x)']);
      const res = lvls.filter(x => x.v > last.price).sort((a, c) => a.v - c.v), r1 = res[0], r2 = res[res.length - 1];
      plan.push(['區間參考', r1 ? `上限放最近的壓力 ${r1.n} ${n0(r1.v)} 附近(反彈空得到)${r2 !== r1 ? `,最多不高於 ${r2.n} ${n0(r2.v)}` : ''}` : `價格在兩條均線之上,上限參考近期高點 ${n0(hi)}`]);
      plan.push(['止損參考', r2 ? `收盤站上 ${r2.n}(${n0(r2.v)}),或站上最近壓力且 MACD 金叉` : `收盤站上近期高點 ${n0(hi)}`]);
      watch.push('MACD 金叉(柱體翻正)', r1 ? `收盤站上 ${r1.n}(${n0(r1.v)})` : `收盤再創近期新高`, 'ADX 從高點回落且 +DI 上穿 −DI');
    } else {
      plan.push(['建議方向', last.adx < 20 ? '中性網格(盤整、趨勢弱)' : '中性網格,或觀望(訊號分歧、方向不明確)']);
      plan.push(['風險等級', '低 ~ 中風險(槓桿 ≤ 3 ~ 5x)']);
      plan.push(['區間參考', `近 ${N.length} ${u}高低 ${n0(lo)} ~ ${n0(hi)} 當外框,中間再依布林上下軌收窄`]);
      plan.push(['止損參考', '收盤突破或跌破區間 3% 以上,就停損並重新評估']);
      watch.push('ADX 上穿 25:趨勢出現,改順勢方向', '收盤突破區間:網格出場');
      if (!isNaN(last.bwRank) && last.bwRank <= 25) watch.push('帶寬收窄:突破隨時可能發生');
    }

    plan.push(['附近支撐 / 壓力', (sr.sup.length ? '支撐 ' + sr.sup.slice(0, 2).map(zt).join('、') : '下方無明確支撐') + ' / ' + (sr.res.length ? '壓力 ' + sr.res.slice(0, 2).map(zt).join('、') : '上方無明確壓力')]);
    const note = wk ? '週線一週才一個節點、變化慢:拿來定大方向與風險等級,進場時機請搭配日線 / 8 小時。'
      : '日線用來抓進場時機與調整區間;大方向以週線為準,兩者不同調時資金放小。';
    return { dir, strength: an.strength, score: an.score, bullets: b, plan, watch, note };
  },

  /* 技術面每日節點:每天取一個值看趨勢
   *   8 小時:每天最後一根 8h K(當天還沒收完就用最新一根)
   *   日線:每根一個節點;週線:每根(每週)一個節點
   * 回傳由舊到新 [{t, price, ma50, ma200, dev, dif, dea, hist, rsi, adx, pdi, mdi, pb, bwRank, atrPct, atrRank, k, d, obv, lean:{…}, cnt, net, x:{struct, vol, kd, candle}}] */
  techHistory(cs, tf, count) {
    const c = cs.map(k => k.c);
    const ma50 = Ind.sma(c, 50), ma200 = Ind.sma(c, 200), M = Ind.macd(c), rsi = Ind.rsi(c, 14);
    const A = Ind.adx(cs, 14), B = Ind.boll(c, 20, 2), atr = Ind.atr(cs, 14), KD = Ind.kd(cs), obv = Ind.obv(cs);
    const atrP = atr.map((v, i) => v / c[i] * 100), n = cs.length;
    let idx = cs.map((_, i) => i), tOf = i => cs[i].t;
    if (tf === '8h') {
      const day = i => new Date(cs[i].t + 288e5 - 1).toDateString();     // 用收盤時間分天
      idx = idx.filter(i => i === cs.length - 1 || day(i) !== day(i + 1));
      tOf = i => cs[i].t + 288e5 - 1;
    }
    return idx.slice(-(count || 30)).map(i => {
      const p = c[i], pb = (p - B.lo[i]) / (B.up[i] - B.lo[i]) * 100;
      const lean = {
        dmi: this.LEAN.dmi(A.pdiA[i], A.mdiA[i]), ma: this.LEAN.ma(p, ma50[i], ma200[i]),
        macd: this.LEAN.macd(M.hist[i]), rsi: this.LEAN.rsi(rsi[i]), pb: this.LEAN.pb(pb),
      };
      const cnt = { up: 0, down: 0, flat: 0 };
      Object.values(lean).forEach(l => cnt[l]++);
      return {
        t: tOf(i), price: p, ma50: ma50[i], ma200: ma200[i], dev: (p / ma200[i] - 1) * 100,
        dif: M.dif[i], dea: M.dea[i], hist: M.hist[i], rsi: rsi[i], adx: A.adx[i], pdi: A.pdiA[i], mdi: A.mdiA[i],
        pb, bwRank: Ind.pctRank(B.bw.slice(0, i + 1), 120), atrPct: atrP[i], atrRank: Ind.pctRank(atrP.slice(0, i + 1), 120),
        k: KD.k[i], d: KD.d[i], obv: obv[i], lean, cnt, net: cnt.up - cnt.down,
        // 不投票的參考指標(K 線型態看已收盤那根:最新一根還沒收完就看前一根)
        x: { struct: this.structure(cs, tf, i), vol: this.volume(cs, i), kd: this.LEAN.kd(KD.k[i], KD.d[i]), candle: this.candle(cs, i === n - 1 ? i - 1 : i) },
      };
    });
  },

  /* 指標儀表:每個指標給「偏多 / 偏空 / 中性」一票,最後統計
   *
   * 技術面(跟著判讀週期,依 TECH 的重要度排序):DMI(ADX、+DI / −DI)、均線排列、MACD、RSI、布林位置
   * 籌碼面(Binance 合約公開資料,8 小時看 4h 粒度、日線 / 週線看 1d 粒度):
   *   資金費率、散戶多空比 —— 反向指標,擁擠的那一邊容易被洗
   *   大戶持倉多空比、主動買賣比 —— 順向指標
   *   持倉量變化 —— 要搭配價格方向解讀
   * 回傳 {items:[{group, label, v, min, max, text, zones, ticks, lean, leanText, note}], cnt, net, verdict, vdir} */
  meters(an, cs, sent, funding, tf) {
    const c = cs.map(k => k.c), out = [];
    const devR = { '8h': 20, '1d': 40, '1w': 80 }[tf] || 40;

    /* 波動狀態(不投票,但對網格存活影響最大) */
    const rk = an.atrRank;
    out.push({ key: 'atr', vote: false, group: 'tech', label: '波動狀態(ATR 排名)', v: rk, min: 0, max: 100, text: isNaN(rk) ? '—' : rk.toFixed(0), ticks: [20, 80],
      lean: 'flat', leanText: rk < 20 ? '壓縮' : rk > 80 ? '高檔' : '正常',
      note: (rk < 20 ? '實測壓縮後常突破:區間用正常波動放寬,別開窄的高槓桿網格' : rk > 80 ? '實測波動高檔後多半回落:開網格相對安全' : '波動在正常範圍') + ` · ATR ${an.atrPct.toFixed(2)}%`,
      zones: [{ to: 20, cls: 'z-warn' }, { to: 80, cls: 'z-mid' }, { to: 100, cls: 'z-good' }] });

    /* DMI */
    out.push({ key: 'dmi', group: 'tech', label: 'ADX 趨勢強度(DMI)', v: an.adx, min: 0, max: 60, text: an.adx.toFixed(0), ticks: [20, 35],
      lean: this.LEAN.dmi(an.pdi, an.mdi), leanText: `+DI ${an.pdi.toFixed(0)} / −DI ${an.mdi.toFixed(0)}`,
      note: an.adx < 20 ? '趨勢弱;實測低 ADX 之後常突破,不代表網格安全' : an.adx < 35 ? '有趨勢 → 順著 DI 較強的一方做網格' : '強趨勢 → 只開順勢網格,不要開反方向',
      zones: [{ to: 20, cls: 'z-mid' }, { to: 35, cls: 'z-mid' }, { to: 60, cls: 'z-mid' }] });

    /* 均線排列 */
    const dev = isNaN(an.ma200) ? NaN : (an.price / an.ma200 - 1) * 100;
    const lean = this.LEAN.ma(an.price, an.ma50, an.ma200);
    let lt = { up: '多頭排列', down: '空頭排列', flat: '均線糾結' }[lean];
    if (lean === 'flat' && an.price > an.ma200) lt = '長線之上、中期整理';
    else if (lean === 'flat' && an.price < an.ma200) lt = '長線之下、中期反彈';
    out.push({ key: 'ma', group: 'tech', label: '均線(離 MA200)', v: dev, min: -devR, max: devR, text: fmt.pct(dev, 1), ticks: [0], lean, leanText: lt,
      note: isNaN(dev) ? 'K 線不足' : `價 ${fmt.n(an.price, 0)} · MA50 ${fmt.n(an.ma50, 0)} · MA200 ${fmt.n(an.ma200, 0)}${Math.abs(dev) > devR * 0.6 ? ' · 離長均線很遠,留意回歸' : ''}`,
      zones: [{ to: -devR * 0.6, cls: 'z-warn' }, { to: 0, cls: 'z-dn' }, { to: devR * 0.6, cls: 'z-up' }, { to: devR, cls: 'z-warn' }] });

    /* MACD */
    const M = Ind.macd(c), h = M.hist, n = h.length, hn = h[n - 1], hp = h[n - 2];
    const hmax = Math.max(...h.slice(-100).map(Math.abs)) || 1;
    const flip = [1, 2, 3].some(i => Math.sign(h[n - i]) !== Math.sign(h[n - i - 1]));
    let mn;
    if (flip) mn = hn > 0 ? '柱體剛翻正(金叉),動能轉強' : '柱體剛翻負(死叉),動能轉弱';
    else if (hn > 0) mn = hn >= hp ? '多方動能增強中' : '仍偏多,但動能在減弱';
    else mn = hn <= hp ? '空方動能增強中' : '仍偏空,但跌勢在減緩';
    out.push({ key: 'macd', group: 'tech', label: 'MACD 柱', v: hn / hmax, min: -1, max: 1, text: (hn > 0 ? '+' : '') + fmt.n(hn, 2), ticks: [0],
      lean: this.LEAN.macd(hn), leanText: hn > 0 ? 'DIF 在 DEA 之上' : 'DIF 在 DEA 之下', note: mn,
      zones: [{ to: 0, cls: 'z-dn' }, { to: 1, cls: 'z-up' }] });

    /* RSI */
    const r = an.rsi;
    out.push({ key: 'rsi', group: 'tech', label: 'RSI 動能', v: r, min: 0, max: 100, text: r.toFixed(0), ticks: [30, 50, 70],
      lean: this.LEAN.rsi(r), leanText: r >= 55 ? '動能偏強' : r <= 45 ? '動能偏弱' : '中性',
      note: r >= 70 ? '過熱:代表動能強,實測過熱後多半續漲' : r <= 30 ? '超賣:代表動能弱,實測超賣後多半續弱' : '55 以上偏強、45 以下偏弱',
      zones: [{ to: 30, cls: 'z-warn' }, { to: 45, cls: 'z-dn' }, { to: 55, cls: 'z-mid' }, { to: 70, cls: 'z-up' }, { to: 100, cls: 'z-warn' }] });

    /* 布林位置 %B */
    const B = Ind.boll(c, 20, 2), up = Ind.last(B.up), lo = Ind.last(B.lo);
    const pb = (an.price - lo) / (up - lo) * 100;
    out.push({ key: 'pb', group: 'tech', label: '布林位置 %B', v: pb, min: -20, max: 120, text: pb.toFixed(0), ticks: [0, 50, 100],
      lean: this.LEAN.pb(pb), leanText: pb >= 85 ? '貼近上軌(強勢)' : pb <= 15 ? '貼近下軌(弱勢)' : '通道中段',
      note: (pb >= 85 || pb <= 15 ? '實測貼軌後多半延續,不是反轉訊號;' : '') + `帶寬在近期 ${isNaN(an.bwRank) ? '—' : an.bwRank.toFixed(0)} 百分位${an.bwRank <= 25 ? '(收窄,常醞釀突破)' : ''}`,
      zones: [{ to: 15, cls: 'z-dn' }, { to: 85, cls: 'z-good' }, { to: 120, cls: 'z-up' }] });

    /* 技術面依 TECH 的重要度排序 */
    const rank = k => this.TECH.findIndex(d => d.key === k);
    out.sort((a, b) => rank(a.key) - rank(b.key));

    /* ---- 籌碼面 ---- */
    out.push({ group: 'chip', label: '資金費率 /8h', v: funding, min: -0.05, max: 0.1, text: funding.toFixed(4) + '%', ticks: [0, 0.03],
      lean: funding >= 0.03 ? 'down' : funding <= -0.01 ? 'up' : 'flat',
      leanText: funding >= 0.03 ? '多方擁擠(反向)' : funding <= -0.01 ? '空方擁擠(反向)' : '正常',
      note: '正值 = 多方付費給空方;太高代表做多的人太多,容易多殺多',
      zones: [{ to: -0.01, cls: 'z-warn' }, { to: 0.03, cls: 'z-good' }, { to: 0.1, cls: 'z-warn' }] });
    if (sent) {
      const span = sent.period === '4h' ? '近 5 天' : '近 30 天';
      const ls = Ind.last(sent.ls), lsAvg = sent.ls.reduce((a, b) => a + b, 0) / sent.ls.length;
      out.push({ group: 'chip', label: '散戶多空比(帳戶數)', v: ls, min: 0.5, max: 4, text: ls.toFixed(2), ticks: [1, 2.5],
        lean: ls >= 2.5 ? 'down' : ls <= 1 ? 'up' : 'flat', leanText: ls >= 2.5 ? '散戶大量做多(反向)' : ls <= 1 ? '散戶偏空(反向)' : '正常',
        note: `${span}平均 ${lsAvg.toFixed(2)};散戶一面倒時,市場常往反方向走`,
        zones: [{ to: 1, cls: 'z-up' }, { to: 2.5, cls: 'z-mid' }, { to: 4, cls: 'z-dn' }] });
      const tp = Ind.last(sent.top);
      out.push({ group: 'chip', label: '大戶多空比(持倉量)', v: tp, min: 0.5, max: 2.5, text: tp.toFixed(2), ticks: [0.9, 1.3],
        lean: tp >= 1.3 ? 'up' : tp <= 0.9 ? 'down' : 'flat', leanText: tp >= 1.3 ? '大戶偏多' : tp <= 0.9 ? '大戶偏空' : '大戶中性',
        note: '前 20% 大戶的多單 ÷ 空單部位,順著大戶方向比較安全',
        zones: [{ to: 0.9, cls: 'z-dn' }, { to: 1.3, cls: 'z-mid' }, { to: 2.5, cls: 'z-up' }] });
      const tk6 = sent.taker.slice(-6), tkr = tk6.reduce((a, b) => a + b, 0) / tk6.length;
      out.push({ group: 'chip', label: '主動買賣比', v: tkr, min: 0.8, max: 1.2, text: tkr.toFixed(3), ticks: [0.95, 1, 1.05],
        lean: tkr >= 1.05 ? 'up' : tkr <= 0.95 ? 'down' : 'flat', leanText: tkr >= 1.05 ? '買方較積極' : tkr <= 0.95 ? '賣方較積極' : '買賣均衡',
        note: `最近 6 期的主動買入量 ÷ 主動賣出量(每期 ${sent.period === '4h' ? '4 小時' : '1 天'})`,
        zones: [{ to: 0.95, cls: 'z-dn' }, { to: 1.05, cls: 'z-mid' }, { to: 1.2, cls: 'z-up' }] });
      const o0 = sent.oi[0], o1 = Ind.last(sent.oi);
      const oiChg = (o1.q / o0.q - 1) * 100, pxChg = (o1.v / o1.q) / (o0.v / o0.q) * 100 - 100;
      let ol = 'flat', ot;
      if (oiChg > 2 && pxChg > 0) { ol = 'up'; ot = '價漲、持倉增:新多單進場,上漲有支撐'; }
      else if (oiChg > 2) { ol = 'down'; ot = '價跌、持倉增:空單加碼,下跌有力'; }
      else if (oiChg < -2 && pxChg > 0) ot = '價漲、持倉減:多半是空單回補,上漲力道較弱';
      else if (oiChg < -2) ot = '價跌、持倉減:多單停損 / 平倉,賣壓可能接近尾聲';
      else ot = '持倉變化不大';
      out.push({ group: 'chip', label: `持倉量變化(${span})`, v: oiChg, min: -20, max: 20, text: fmt.pct(oiChg, 1), ticks: [0],
        lean: ol, leanText: `同期價格 ${fmt.pct(pxChg, 1)}`, note: ot,
        zones: [{ to: -2, cls: 'z-mid' }, { to: 2, cls: 'z-good' }, { to: 20, cls: 'z-mid' }] });
    }

    const cnt = { up: 0, down: 0, flat: 0 };
    out.forEach(m => { if (m.vote !== false) cnt[m.lean]++; });
    const net = cnt.up - cnt.down;
    let verdict, vdir = 'neutral';
    if (net >= 3) { vdir = 'long'; verdict = '指標面偏多 → 做多網格較有利'; }
    else if (net <= -3) { vdir = 'short'; verdict = '指標面偏空 → 做空網格較有利'; }
    else if (net > 0) verdict = '略偏多但不一致 → 中性網格,或做多但資金放小';
    else if (net < 0) verdict = '略偏空但不一致 → 中性網格,或做空但資金放小';
    else verdict = '多空打平 → 中性網格最適合';
    return { items: out, cnt, net, verdict, vdir };
  },

  /* 低 / 中 / 高風險三組建議
   *
   * 區間寬度用「日線波動」當尺 = max(日線 ATR14, 90 天 ATR 中位數):波動壓縮時 ATR14 會低估接下來的波動,
   * 實測改用正常波動放寬後,壓縮期中性網格 14 天被打出區間的機率 ETH 70% → 54%、BTC 62% → 48%。
   * 不同判讀週期都用同一把尺,週線才不會給出超寬區間;
   * 做多時區間往下多留一點(回檔買得到)、做空時往上多留一點。
   *   低風險:區間寬、每格賺得厚、槓桿 ≤ 3x,強平價離區間邊界 ≥ 20%;方向跟著判讀(實測順勢比中性少一半在輸的那邊被打穿)
   *   中風險:區間中等、槓桿 ≤ 5x,強平價離區間邊界 ≥ 10%
   *   高風險:區間窄、格子密(套利次數多)、槓桿 ≤ 10x,強平價離區間邊界 ≥ 4%
   * 槓桿不是用公式估,是用 Grid.calc(派網開法 + 開單底倉)從上限往下試,找第一個符合強平距離的。 */
  TIERS: [
    { key: 'low', name: '低風險', hw: [12, 4], buf: 0.20, levCap: 3, net: 0.5 },
    { key: 'mid', name: '中風險', hw: [8, 2.5], buf: 0.10, levCap: 5, net: 0.3 },
    { key: 'high', name: '高風險', hw: [4, 1.2], buf: 0.04, levCap: 10, net: 0.15 },
  ],
  profiles(an, price, atrD, fee, mmr) {
    const d = isNaN(atrD) ? 3.5 : atrD;
    return this.TIERS.map(t => {
      const dir = an.dir;
      const hw = Math.max(t.hw[0], t.hw[1] * d) / 100;
      const dn = dir === 'long' ? 1.25 : dir === 'short' ? 0.75 : 1;
      const up = dir === 'long' ? 0.75 : dir === 'short' ? 1.25 : 1;
      const lower = Grid.nice(price * (1 - hw * dn), price), upper = Grid.nice(price * (1 + hw * up), price);
      const width = (upper / lower - 1) * 100;
      const n = Math.max(5, Math.min(150, Math.round(width / (t.net + 2 * fee))));
      const base = { dir, mode: 'arith', lower, upper, n, capital: 1000, extra: 0 };
      let lev = 1, calc = null;
      for (let L = t.levCap; L >= 1; L--) {
        const r = Grid.calc(Object.assign({}, base, { lev: L }), { fee, mmr, price });
        const okDn = isNaN(r.liqDown) || r.liqDown <= lower * (1 - t.buf);
        const okUp = isNaN(r.liqUp) || r.liqUp >= upper * (1 + t.buf);
        if ((okDn && okUp) || L === 1) { lev = L; calc = r; break; }
      }
      return Object.assign(base, { lev, tier: t.key, tierName: t.name, width, calc });
    });
  },
};
