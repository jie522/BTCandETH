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

  /* 單一指標的多空判斷:指標儀表與每日節點共用同一套門檻 */
  LEAN: {
    dmi: (pdi, mdi) => pdi - mdi > 3 ? 'up' : pdi - mdi < -3 ? 'down' : 'flat',
    ma: (p, m50, m200) => p > m50 && m50 > m200 ? 'up' : p < m50 && m50 < m200 ? 'down' : 'flat',
    macd: h => h > 0 ? 'up' : 'down',
    rsi: r => r >= 55 ? 'up' : r <= 45 ? 'down' : 'flat',
    pb: pb => pb >= 85 ? 'down' : pb <= 15 ? 'up' : 'flat',
  },

  /* 技術面重要度排序(以「開合約網格」的角度):
   * 先問能不能開(ADX)→ 往哪開(均線)→ 動能有沒有在轉(MACD)→ 進場時機(RSI、布林)→ 格子尺寸(ATR)
   * vote:false 的不參與指標儀表投票 */
  TECH: [
    { key: 'dmi', name: 'ADX 趨勢強度(DMI)', stars: 5, vote: true,
      role: '決定「現在適不適合開網格」,比方向更優先',
      why: '網格賺的是來回震盪,最怕單邊趨勢。ADX 直接告訴你現在是盤整還是趨勢,方向判讀也以 ADX ≥ 20 當門檻:ADX 太低時,就算其他指標偏多偏空也建議中性。',
      what: 'ADX 只量趨勢「強不強」,不分多空;+DI 是上漲力道、−DI 是下跌力道,兩條線誰在上面就是誰占優。',
      calc: '14 期,Wilder 平滑。DX = |+DI − −DI| ÷ (+DI + −DI) × 100,ADX 是 DX 再平滑一次。',
      read: ['ADX < 20:趨勢弱、盤整,網格最舒服', 'ADX 20 ~ 35:有趨勢,看 +DI / −DI 哪條在上面', 'ADX > 35:強趨勢,單邊行情', 'ADX 往上走 = 趨勢在加強;從高點往下彎 = 趨勢在退燒', '+DI 與 −DI 差距 3 以內視為中性'],
      grid: ['ADX < 20 → 開中性網格最划算', 'ADX 上穿 25 且 +DI 在上 → 做多網格;−DI 在上 → 做空網格', 'ADX > 35 → 資金縮小、槓桿降低、一定要設止損', 'ADX 從 35 以上回落 → 趨勢衰退,網格重新變得適合'],
      trap: 'ADX 是落後指標,通常慢好幾根 K 線才反應;ADX 從高點回落不代表反轉,只代表趨勢變弱。' },
    { key: 'ma', name: '均線排列(MA50 / MA200)', stars: 5, vote: true,
      role: '定出長線方向,判讀分數 ±5 裡占了 ±4',
      why: 'MA200 是市場公認的多空分界線,判讀分數裡「價格對 MA200」±2、「MA50 對 MA200」±1、「價格對 MA50」±1,方向幾乎由它決定。',
      what: '價格、50 期均線(中期)、200 期均線(長線)三者的上下順序,以及價格離 MA200 多遠(乖離)。',
      calc: 'MA = 最近 N 根收盤價的簡單平均。乖離 = 價格 ÷ MA200 − 1。',
      read: ['價 > MA50 > MA200:多頭排列', '價 < MA50 < MA200:空頭排列', '其他順序:均線糾結 / 整理中', 'MA50 上穿 MA200 = 黃金交叉;下穿 = 死亡交叉', '乖離太大(日線超過 ±24%)容易往均線回歸'],
      grid: ['多頭排列 → 做多網格,區間下限可以放在 MA50 附近', '空頭排列 → 做空網格,區間上限可以放在 MA50 附近', '糾結 → 中性網格', 'MA200 常是強支撐 / 壓力,區間邊界附近有 MA200 時價格容易在那裡反應'],
      trap: '均線最落後,轉折後要好幾天才翻;盤整時價格在均線上下來回穿,會一直給假訊號,所以要搭配 ADX 看。' },
    { key: 'macd', name: 'MACD 動能', stars: 4, vote: true,
      role: '比均線早一步看到動能轉折',
      why: 'MACD 柱體縮短通常比價格轉折早出現,適合用來判斷「趨勢還有沒有力」,補均線反應慢的缺點。',
      what: 'DIF = 快慢兩條 EMA 的差;DEA = DIF 的平均;柱 = DIF − DEA,代表動能變化。',
      calc: 'DIF = EMA12 − EMA26,DEA = DIF 的 9 期 EMA,柱 = DIF − DEA。',
      read: ['柱由負翻正 = 金叉,動能轉強;由正翻負 = 死叉', '柱體連續變長 = 動能增強;連續縮短 = 動能減弱', '0 軸之上的金叉比 0 軸之下的可靠', '背離:價格創新高但 DIF 沒創新高 → 漲勢疲乏(反之亦然)'],
      grid: ['剛金叉 + 均線多頭 → 做多網格把握度高', '柱體連續縮短 → 先別追方向,用中性網格', '死叉 + 均線空頭 → 做空網格'],
      trap: '盤整時柱體正負來回翻,會連續出現假金叉 / 假死叉;背離可以持續很久才發生作用。' },
    { key: 'rsi', name: 'RSI 相對強弱', stars: 3, vote: true,
      role: '判斷進場時機:現在追會不會追在高點',
      why: 'RSI 不太適合決定方向,但很適合決定「什麼時候開」:過熱時開做多網格,區間容易一開就全部套在高點。',
      what: '一段時間內漲幅占漲跌總幅度的比例,0 ~ 100。',
      calc: '14 期,Wilder 平滑:RSI = 100 − 100 ÷ (1 + 平均漲幅 ÷ 平均跌幅)。',
      read: ['50 是多空分界;≥ 55 偏強、≤ 45 偏弱', '≥ 70 過熱,≥ 75 很熱', '≤ 30 超賣,≤ 25 很冷', '強趨勢中 RSI 可以長時間停在 70 以上(鈍化)'],
      grid: ['想開做多網格但 RSI 過熱 → 等回落到 50 ~ 60 再開', '想開做空網格但 RSI 超賣 → 等反彈到 40 ~ 50 再開', 'RSI 在 40 ~ 60 來回 → 震盪格局,中性網格適合'],
      trap: '超賣可以更超賣、過熱可以更過熱;只看 RSI 去抄底摸頭很危險。' },
    { key: 'pb', name: '布林位置 %B / 帶寬', stars: 3, vote: true,
      role: '看價格在通道的哪裡,以及波動是不是快爆發',
      why: '%B 告訴你現價在短線區間的高低位置,帶寬告訴你波動是否被壓縮;兩者主要影響區間怎麼放、格子密不密。',
      what: '中軌是 20 期均線,上下軌是中軌 ± 2 倍標準差。%B = 價格在上下軌之間的位置;帶寬 = 通道寬 ÷ 中軌。',
      calc: '%B = (價格 − 下軌) ÷ (上軌 − 下軌) × 100;帶寬百分位 = 目前帶寬在最近 120 根裡的排名。',
      read: ['%B > 100 突破上軌、< 0 跌破下軌、50 在中軌', '%B ≥ 85 貼近上軌(短線偏貴)、≤ 15 貼近下軌(短線偏便宜)', '帶寬百分位 ≤ 25 = 通道收窄,常醞釀突破', '帶寬百分位 ≥ 85 = 波動大'],
      grid: ['網格上下限可以參考布林上下軌', '帶寬收窄時別開太窄、高槓桿的網格,突破後很快就出區間', '帶寬大時格子可以放寬,每格賺多一點', '%B 貼上軌時開做多網格,等回檔較好'],
      trap: '強趨勢中價格會貼著上軌(或下軌)一路走,叫「騎軌」;貼上軌不代表一定會跌。' },
    { key: 'atr', name: 'ATR 波動率', stars: 2, vote: false,
      role: '不看方向,決定格子與區間的尺寸',
      why: 'ATR 不分多空所以不參與投票,但網格的格距、區間寬度、強平距離「夠不夠」都靠它來衡量。',
      what: '平均每根 K 線的真實波動幅度,這裡換算成價格的百分比。',
      calc: '真實波幅 = max(高 − 低, |高 − 前收|, |低 − 前收|),取 14 期 Wilder 平均,再除以價格。',
      read: ['數字越大 = 每根 K 線擺動越大', 'ATR 突然放大 = 行情變激烈,常出現在突破或急跌', 'ATR 持續縮小 = 行情變安靜'],
      grid: ['建議參數的區間寬度是用日線 ATR 當尺', '每格間距至少要大於來回手續費,約 ATR 的 1/4 成交機會較好', '強平距離 ÷ 日線 ATR = 「幾天的日均波動」,試算頁的「約 X 天」就是這個', 'ATR 放大時降低槓桿、放寬區間'],
      trap: 'ATR 是過去的波動,不保證未來;消息面(例如 CPI、ETF)可以讓單日波動遠超 ATR。' },
  ],

  /* 日線 / 週線操作建議:用方向判讀(an)加上技術面節點(N,techHistory 的結果)寫成白話
   * 回傳 {dir, strength, bullets:[{tone,text}], plan:[[項目,內容]], watch:[文字], note} */
  advice(tf, an, N) {
    const last = N[N.length - 1], k = Math.min(7, N.length - 1), prev = N[N.length - 1 - k];
    const wk = tf === '1w', u = wk ? '週' : '天', devR = wk ? 80 : 40, L = last.lean;
    const b = [], add = (tone, text) => b.push({ tone, text });
    const n0 = x => fmt.n(x, 0);

    const peak = Math.max(...N.slice(-10).map(q => q.adx));
    const fall = last.adx >= 25 && last.adx <= peak - 3, rise = last.adx - prev.adx >= 3;
    if (last.adx < 20) add('flat', `ADX ${last.adx.toFixed(0)},趨勢弱、盤整格局,網格最適合`);
    else {
      const side = { up: '多方占優', down: '空方占優', flat: '多空接近' }[L.dmi];
      add(L.dmi === 'flat' ? 'flat' : L.dmi, `ADX ${last.adx.toFixed(0)},${side}(+DI ${last.pdi.toFixed(0)} / −DI ${last.mdi.toFixed(0)})${fall ? ',已從高點回落,趨勢在退燒' : rise ? ',且還在加強' : ''}`);
    }
    if (last.adx >= 35) add('warn', '強趨勢中,網格容易單邊被掃,資金縮小、止損要設');

    if (L.ma === 'up') add('up', `價格 > MA50(${n0(last.ma50)})> MA200(${n0(last.ma200)}),多頭排列`);
    else if (L.ma === 'down') add('down', `價格 < MA50(${n0(last.ma50)})< MA200(${n0(last.ma200)}),空頭排列`);
    else add('flat', `均線糾結:價格在 MA200(${n0(last.ma200)})${last.price > last.ma200 ? '之上' : '之下'},中期方向未定`);

    const flip = N.slice(-4).some(q => q.lean.macd !== L.macd);
    add(L.macd, flip ? (L.macd === 'up' ? 'MACD 剛金叉,動能轉強' : 'MACD 剛死叉,動能轉弱')
      : (L.macd === 'up' ? 'MACD 柱在 0 軸之上,多方動能' : 'MACD 柱在 0 軸之下,空方動能') + (Math.abs(last.hist) < Math.abs(prev.hist) ? `,但近 ${k} ${u}柱體縮短、動能減弱` : `,近 ${k} ${u}柱體擴大、動能增強`));

    if (last.rsi >= 70) add('warn', `RSI ${last.rsi.toFixed(0)} 過熱,追多容易買在高點`);
    else if (last.rsi <= 30) add('warn', `RSI ${last.rsi.toFixed(0)} 超賣,追空容易賣在低點`);
    else add(L.rsi, `RSI ${last.rsi.toFixed(0)},動能${L.rsi === 'up' ? '偏強' : L.rsi === 'down' ? '偏弱' : '中性'}`);
    if (last.pb >= 85) add('warn', `%B ${last.pb.toFixed(0)},貼近布林上軌,短線偏貴`);
    else if (last.pb <= 15) add('warn', `%B ${last.pb.toFixed(0)},貼近布林下軌,短線偏便宜`);
    if (!isNaN(last.bwRank) && last.bwRank <= 25) add('warn', `布林帶寬只有近期 ${last.bwRank.toFixed(0)} 百分位,收窄後常有突破`);
    if (Math.abs(last.dev) > devR * 0.6) add('warn', `離 MA200 ${fmt.pct(last.dev, 1)},離長均線很遠,留意回歸`);

    const dir = an.dir, plan = [], watch = [];
    const counter = dir === 'long' ? (L.macd === 'down') + (last.rsi >= 70) + (last.pb >= 85) + (last.dev > devR * 0.6)
      : dir === 'short' ? (L.macd === 'up') + (last.rsi <= 30) + (last.pb <= 15) + (last.dev < -devR * 0.6) : 0;
    const hi = Math.max(...N.map(q => q.price)), lo = Math.min(...N.map(q => q.price));
    const lvls = [{ n: 'MA50', v: last.ma50 }, { n: 'MA200', v: last.ma200 }].filter(x => !isNaN(x.v));
    if (dir === 'long') {
      plan.push(['建議方向', counter >= 2 ? '做多網格,但先等回檔再開,或資金縮小' : '做多網格']);
      plan.push(['風險等級', counter >= 2 || last.adx >= 35 ? '低風險(槓桿 ≤ 3x)' : '中風險(槓桿 ≤ 5x)']);
      const sup = lvls.filter(x => x.v < last.price).sort((a, c) => c.v - a.v), s1 = sup[0], s2 = sup[sup.length - 1];
      plan.push(['區間參考', s1 ? `下限放最近的支撐 ${s1.n} ${n0(s1.v)} 附近(回檔買得到)${s2 !== s1 ? `,最多不低於 ${s2.n} ${n0(s2.v)}` : ''}` : `價格在兩條均線之下,下限參考近期低點 ${n0(lo)}`]);
      plan.push(['止損參考', s2 ? `收盤跌破 ${s2.n}(${n0(s2.v)}),或跌破最近支撐且 MACD 死叉` : `收盤跌破近期低點 ${n0(lo)}`]);
      watch.push('MACD 死叉(柱體翻負)', s1 ? `收盤跌破 ${s1.n}(${n0(s1.v)})` : `收盤再創近期新低`, 'ADX 從高點回落且 −DI 上穿 +DI');
      if (last.rsi >= 70) watch.push('RSI 回落到 60 以下再進場較安全');
    } else if (dir === 'short') {
      plan.push(['建議方向', counter >= 2 ? '做空網格,但先等反彈再開,或資金縮小' : '做空網格']);
      plan.push(['風險等級', counter >= 2 || last.adx >= 35 ? '低風險(槓桿 ≤ 3x)' : '中風險(槓桿 ≤ 5x)']);
      const res = lvls.filter(x => x.v > last.price).sort((a, c) => a.v - c.v), r1 = res[0], r2 = res[res.length - 1];
      plan.push(['區間參考', r1 ? `上限放最近的壓力 ${r1.n} ${n0(r1.v)} 附近(反彈空得到)${r2 !== r1 ? `,最多不高於 ${r2.n} ${n0(r2.v)}` : ''}` : `價格在兩條均線之上,上限參考近期高點 ${n0(hi)}`]);
      plan.push(['止損參考', r2 ? `收盤站上 ${r2.n}(${n0(r2.v)}),或站上最近壓力且 MACD 金叉` : `收盤站上近期高點 ${n0(hi)}`]);
      watch.push('MACD 金叉(柱體翻正)', r1 ? `收盤站上 ${r1.n}(${n0(r1.v)})` : `收盤再創近期新高`, 'ADX 從高點回落且 +DI 上穿 −DI');
      if (last.rsi <= 30) watch.push('RSI 反彈到 40 以上再進場較安全');
    } else {
      plan.push(['建議方向', last.adx < 20 ? '中性網格(盤整、趨勢弱)' : '中性網格,或觀望(訊號分歧、方向不明確)']);
      plan.push(['風險等級', '低 ~ 中風險(槓桿 ≤ 3 ~ 5x)']);
      plan.push(['區間參考', `近 ${N.length} ${u}高低 ${n0(lo)} ~ ${n0(hi)} 當外框,中間再依布林上下軌收窄`]);
      plan.push(['止損參考', '收盤突破或跌破區間 3% 以上,就停損並重新評估']);
      watch.push('ADX 上穿 25:趨勢出現,改順勢方向', '收盤突破區間:網格出場');
      if (!isNaN(last.bwRank) && last.bwRank <= 25) watch.push('帶寬收窄:突破隨時可能發生');
    }

    const note = wk ? '週線一週才一個節點、變化慢:拿來定大方向與風險等級,進場時機請搭配日線 / 8 小時。'
      : '日線用來抓進場時機與調整區間;大方向以週線為準,兩者不同調時資金放小。';
    return { dir, strength: an.strength, score: an.score, bullets: b, plan, watch, note };
  },

  /* 技術面每日節點:每天取一個值看趨勢
   *   8 小時:每天最後一根 8h K(當天還沒收完就用最新一根)
   *   日線:每根一個節點;週線:每根(每週)一個節點
   * 回傳由舊到新 [{t, price, ma50, ma200, dev, dif, dea, hist, rsi, adx, pdi, mdi, pb, bwRank, atrPct, lean:{…}, cnt, net}] */
  techHistory(cs, tf, count) {
    const c = cs.map(k => k.c);
    const ma50 = Ind.sma(c, 50), ma200 = Ind.sma(c, 200), M = Ind.macd(c), rsi = Ind.rsi(c, 14);
    const A = Ind.adx(cs, 14), B = Ind.boll(c, 20, 2), atr = Ind.atr(cs, 14);
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
        pb, bwRank: Ind.pctRank(B.bw.slice(0, i + 1), 120), atrPct: atr[i] / p * 100,
        lean, cnt, net: cnt.up - cnt.down,
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

    /* DMI */
    out.push({ group: 'tech', label: 'ADX 趨勢強度(DMI)', v: an.adx, min: 0, max: 60, text: an.adx.toFixed(0), ticks: [20, 35],
      lean: this.LEAN.dmi(an.pdi, an.mdi), leanText: `+DI ${an.pdi.toFixed(0)} / −DI ${an.mdi.toFixed(0)}`,
      note: an.adx < 20 ? '趨勢弱、偏盤整 → 最適合網格(中性)' : an.adx < 35 ? '有趨勢 → 順著 DI 較強的一方做網格' : '強趨勢 → 網格容易單邊被掃,資金縮小、止損要設',
      zones: [{ to: 20, cls: 'z-good' }, { to: 35, cls: 'z-mid' }, { to: 60, cls: 'z-warn' }] });

    /* 均線排列 */
    const dev = isNaN(an.ma200) ? NaN : (an.price / an.ma200 - 1) * 100;
    const lean = this.LEAN.ma(an.price, an.ma50, an.ma200);
    let lt = { up: '多頭排列', down: '空頭排列', flat: '均線糾結' }[lean];
    if (lean === 'flat' && an.price > an.ma200) lt = '長線之上、中期整理';
    else if (lean === 'flat' && an.price < an.ma200) lt = '長線之下、中期反彈';
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
      lean: this.LEAN.macd(hn), leanText: hn > 0 ? 'DIF 在 DEA 之上' : 'DIF 在 DEA 之下', note: mn,
      zones: [{ to: 0, cls: 'z-dn' }, { to: 1, cls: 'z-up' }] });

    /* RSI */
    const r = an.rsi;
    out.push({ group: 'tech', label: 'RSI 動能', v: r, min: 0, max: 100, text: r.toFixed(0), ticks: [30, 50, 70],
      lean: this.LEAN.rsi(r), leanText: r >= 55 ? '動能偏強' : r <= 45 ? '動能偏弱' : '中性',
      note: r >= 75 ? '過熱(≥75):追多容易買在短線高點' : r <= 25 ? '超賣(≤25):追空容易賣在短線低點' : '30 以下超賣、70 以上過熱',
      zones: [{ to: 30, cls: 'z-warn' }, { to: 45, cls: 'z-dn' }, { to: 55, cls: 'z-mid' }, { to: 70, cls: 'z-up' }, { to: 100, cls: 'z-warn' }] });

    /* 布林位置 %B */
    const B = Ind.boll(c, 20, 2), up = Ind.last(B.up), lo = Ind.last(B.lo);
    const pb = (an.price - lo) / (up - lo) * 100;
    out.push({ group: 'tech', label: '布林位置 %B', v: pb, min: -20, max: 120, text: pb.toFixed(0), ticks: [0, 50, 100],
      lean: this.LEAN.pb(pb), leanText: pb >= 85 ? '貼近上軌' : pb <= 15 ? '貼近下軌' : '通道中段',
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
