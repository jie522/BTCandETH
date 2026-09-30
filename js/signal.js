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
};
