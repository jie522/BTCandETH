/* 訊號判讀:把指標翻成「現在適合做多 / 做空 / 中性網格」的參考建議
 *
 * 這是機率上的參考,不是預測。核心想法:
 *   1. 方向分數(-5 ~ +5):價格對 MA200、MA50 對 MA200、價格對 MA50、RSI 動能
 *   2. ADX 判斷「有沒有趨勢」:沒趨勢就算分數偏一邊,也建議中性(網格賺震盪,不賺方向)
 *   3. 資金費率、RSI 極端值、布林帶寬只用來加警語,不改分數
 * 建議區間 / 格數 / 槓桿給的是起手式,使用者可以在「試算」頁再調。
 */
const Signal = {
  DIR_LABEL: { long: '做多網格', short: '做空網格', neutral: '中性網格' },

  analyze(cs, funding, fee) {
    const c = cs.map(k => k.c), price = Ind.last(c);
    const ma20 = Ind.last(Ind.sma(c, 20)), ma50 = Ind.last(Ind.sma(c, 50)), ma200 = Ind.last(Ind.sma(c, 200));
    const rsi = Ind.last(Ind.rsi(c, 14));
    const atrV = Ind.last(Ind.atr(cs, 14)), atrPct = atrV / price * 100;
    const A = Ind.adx(cs, 14), adx = Ind.last(A.adx);
    const B = Ind.boll(c, 20, 2), bwRank = Ind.pctRank(B.bw, 120);

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
    if (bwRank <= 25) reasons.push({ tone: 'warn', text: `布林帶寬只有近期的 ${bwRank.toFixed(0)} 百分位(收窄):盤整中,但收窄後常有突破` });
    else if (bwRank >= 85) reasons.push({ tone: 'flat', text: `布林帶寬在近期 ${bwRank.toFixed(0)} 百分位(波動大),格子可以放寬` });

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
      price, ma20, ma50, ma200, rsi, adx, atrPct, bwRank, funding,
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

  /* 指標儀表:每個指標給「偏多 / 偏空 / 中性」一票,最後統計
   *
   * 技術面(跟著判讀週期):均線排列、MACD、RSI、DMI(+DI / −DI)、布林位置
   * 籌碼面(Binance 合約公開資料,8 小時看 4h 粒度、日線 / 週線看 1d 粒度):
   *   資金費率、散戶多空比 —— 反向指標,擁擠的那一邊容易被洗
   *   大戶持倉多空比、主動買賣比 —— 順向指標
   *   持倉量變化 —— 要搭配價格方向解讀
   * 回傳 {items:[{group, label, v, min, max, text, zones, ticks, lean, leanText, note}], cnt, net, verdict, vdir} */
  meters(an, cs, sent, funding, tf) {
    const c = cs.map(k => k.c), out = [];
    const devR = { '8h': 20, '1d': 40, '1w': 80 }[tf] || 40;

    /* 均線排列 */
    const dev = isNaN(an.ma200) ? NaN : (an.price / an.ma200 - 1) * 100;
    let lean = 'flat', lt = '均線糾結';
    if (an.price > an.ma50 && an.ma50 > an.ma200) { lean = 'up'; lt = '多頭排列'; }
    else if (an.price < an.ma50 && an.ma50 < an.ma200) { lean = 'down'; lt = '空頭排列'; }
    else if (an.price > an.ma200) lt = '長線之上、中期整理';
    else if (an.price < an.ma200) lt = '長線之下、中期反彈';
    out.push({ group: 'tech', label: '均線(離 MA200)', v: dev, min: -devR, max: devR, text: fmt.pct(dev, 1), ticks: [0], lean, leanText: lt,
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
    out.push({ group: 'tech', label: 'MACD 柱', v: hn / hmax, min: -1, max: 1, text: (hn > 0 ? '+' : '') + fmt.n(hn, 2), ticks: [0],
      lean: hn > 0 ? 'up' : 'down', leanText: hn > 0 ? 'DIF 在 DEA 之上' : 'DIF 在 DEA 之下', note: mn,
      zones: [{ to: 0, cls: 'z-dn' }, { to: 1, cls: 'z-up' }] });

    /* RSI */
    const r = an.rsi;
    out.push({ group: 'tech', label: 'RSI 動能', v: r, min: 0, max: 100, text: r.toFixed(0), ticks: [30, 50, 70],
      lean: r >= 55 ? 'up' : r <= 45 ? 'down' : 'flat', leanText: r >= 55 ? '動能偏強' : r <= 45 ? '動能偏弱' : '中性',
      note: r >= 75 ? '過熱(≥75):追多容易買在短線高點' : r <= 25 ? '超賣(≤25):追空容易賣在短線低點' : '30 以下超賣、70 以上過熱',
      zones: [{ to: 30, cls: 'z-warn' }, { to: 45, cls: 'z-dn' }, { to: 55, cls: 'z-mid' }, { to: 70, cls: 'z-up' }, { to: 100, cls: 'z-warn' }] });

    /* DMI */
    const di = an.pdi - an.mdi;
    out.push({ group: 'tech', label: 'ADX 趨勢強度(DMI)', v: an.adx, min: 0, max: 60, text: an.adx.toFixed(0), ticks: [20, 35],
      lean: di > 3 ? 'up' : di < -3 ? 'down' : 'flat', leanText: `+DI ${an.pdi.toFixed(0)} / −DI ${an.mdi.toFixed(0)}`,
      note: an.adx < 20 ? '趨勢弱、偏盤整 → 最適合網格(中性)' : an.adx < 35 ? '有趨勢 → 順著 DI 較強的一方做網格' : '強趨勢 → 網格容易單邊被掃,資金縮小、止損要設',
      zones: [{ to: 20, cls: 'z-good' }, { to: 35, cls: 'z-mid' }, { to: 60, cls: 'z-warn' }] });

    /* 布林位置 %B */
    const B = Ind.boll(c, 20, 2), up = Ind.last(B.up), lo = Ind.last(B.lo);
    const pb = (an.price - lo) / (up - lo) * 100;
    out.push({ group: 'tech', label: '布林位置 %B', v: pb, min: -20, max: 120, text: pb.toFixed(0), ticks: [0, 50, 100],
      lean: pb >= 85 ? 'down' : pb <= 15 ? 'up' : 'flat', leanText: pb >= 85 ? '貼近上軌' : pb <= 15 ? '貼近下軌' : '通道中段',
      note: (pb >= 85 ? '短線偏貴,開多網格等回檔較好;' : pb <= 15 ? '短線偏便宜,開空網格等反彈較好;' : '') + `帶寬在近期 ${isNaN(an.bwRank) ? '—' : an.bwRank.toFixed(0)} 百分位${an.bwRank <= 25 ? '(收窄,常醞釀突破)' : ''}`,
      zones: [{ to: 15, cls: 'z-up' }, { to: 85, cls: 'z-good' }, { to: 120, cls: 'z-dn' }] });

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
    out.forEach(m => cnt[m.lean]++);
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
   * 區間寬度用「日線 ATR」當尺(不同判讀週期都用同一把尺,週線才不會給出超寬區間),
   * 做多時區間往下多留一點(回檔買得到)、做空時往上多留一點。
   *   低風險:區間寬、每格賺得厚、槓桿 ≤ 3x,強平價離區間邊界 ≥ 20%;方向不夠明確就用中性
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
      const dir = t.key === 'low' && an.strength !== '高' ? 'neutral' : an.dir;
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
