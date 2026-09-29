/* 網格計算與回測(純運算,不碰畫面)
 *
 * 名詞:
 *   格線 levels   n 格 = n+1 條價格線,cell i 介於 levels[i] 和 levels[i+1]
 *   保證金 capital  投入的 USDT;名目 = 保證金 × 槓桿,平均分給 n 格
 *   做多:價格跌到格線就買、漲一格就賣;做空:反過來;
 *   中性:現價以下的格子做多、以上的格子做空
 */
const Grid = {
  /* 取整到好記的數字(ETH 約 10、BTC 約 1000) */
  nice(x, ref) {
    const step = Math.pow(10, Math.floor(Math.log10(ref)) - 2);
    return Math.round(x / step) * step;
  },

  levels(lower, upper, n, mode) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      out.push(mode === 'geo' ? lower * Math.pow(upper / lower, i / n) : lower + (upper - lower) * i / n);
    }
    return out;
  },

  /* 參數檢查,回傳錯誤字串;沒問題回傳 '' */
  validate(p) {
    if (!(p.lower > 0) || !(p.upper > 0)) return '請填上下界價格';
    if (p.upper <= p.lower) return '上界要大於下界';
    if (!(p.n >= 2) || p.n > 300) return '格數要在 2 ~ 300';
    if (!(p.capital > 0)) return '請填投入保證金';
    if (!(p.lev >= 1) || p.lev > 50) return '槓桿要在 1 ~ 50';
    return '';
  },

  /* 多單全部成交後的強平價:權益 = 保證金 + 損益 = mmr × 名義 → P = avg(1 − 1/L)/(1 − mmr) */
  liqLong(avg, L, mmr) { return avg * (1 - 1 / L) / (1 - mmr); },
  liqShort(avg, L, mmr) { return avg * (1 + 1 / L) / (1 + mmr); },

  /* 用「最多能承受多遠」反推安全槓桿:強平價離區間邊界至少 buffer(預設 10%) */
  safeLeverage(dir, lower, upper, buffer, mmr) {
    const avg = (lower + upper) / 2;
    let L = 1;
    if (dir === 'short') {
      const t = upper * (1 + buffer) * (1 + mmr) / avg;       // 強平價目標 / avg = 1 + 1/L
      L = t > 1 ? 1 / (t - 1) : 50;
    } else {
      const t = lower * (1 - buffer) * (1 - mmr) / avg;       // 強平價目標 / avg = 1 - 1/L
      L = t < 1 ? 1 / (1 - t) : 50;
    }
    return Math.max(1, Math.min(50, L));
  },

  /* 試算:格距、每格淨利、強平價、警語 */
  calc(p, opt) {
    const { fee, mmr, price } = opt;            // fee、mmr 都是 %
    const lv = this.levels(p.lower, p.upper, p.n, p.mode);
    const notional = p.capital * p.lev, cellN = notional / p.n;
    const gaps = lv.slice(1).map((x, i) => (x / lv[i] - 1) * 100);      // 每格漲幅 %
    const gapMin = Math.min(...gaps), gapMax = Math.max(...gaps);
    const gapAvg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const feeRt = 2 * fee;                                              // 一買一賣的手續費 %
    const netAvg = gapAvg - feeRt, netMin = gapMin - feeRt;
    const perCellUsd = cellN * netAvg / 100;

    const m = mmr / 100;
    /* 極端情境的持倉:做多 = 所有格子都買進;做空 = 所有格子都賣出;
       中性 = 現價以下的格子做多、以上的格子做空(各自算單邊) */
    const longCells = [], shortCells = [];
    for (let i = 0; i < p.n; i++) {
      const isLong = p.dir === 'long' || (p.dir === 'neutral' && lv[i + 1] <= price);
      const isShort = p.dir === 'short' || (p.dir === 'neutral' && !isLong);
      if (isLong) longCells.push(lv[i]);          // 在下緣買進
      if (isShort) shortCells.push(lv[i + 1]);    // 在上緣賣出
    }
    const avgOf = cells => cells.length / cells.reduce((s, x) => s + 1 / x, 0);   // 等名目 → 調和平均
    let liqDown = NaN, liqUp = NaN;
    if (longCells.length) {
      const avg = avgOf(longCells), L = cellN * longCells.length / p.capital;
      liqDown = this.liqLong(avg, L, m);
    }
    if (shortCells.length) {
      const avg = avgOf(shortCells), L = cellN * shortCells.length / p.capital;
      liqUp = this.liqShort(avg, L, m);
    }

    const warns = [];
    if (netAvg <= 0) warns.push({ level: 'bad', text: `每格漲幅 ${gapAvg.toFixed(2)}% 還不夠付來回手續費 ${feeRt.toFixed(2)}%,這樣跑是賠錢的,請減少格數` });
    else if (netMin < 0.1) warns.push({ level: 'warn', text: `最窄的一格扣完手續費只剩 ${netMin.toFixed(2)}%,太薄,建議減少格數` });
    if (cellN < 5) warns.push({ level: 'warn', text: `每格只有約 ${cellN.toFixed(1)} USDT,可能低於交易所最小下單額(多半要 ≥ 5 USDT)` });
    if (!isNaN(liqDown)) {
      const gap = (p.lower - liqDown) / p.lower * 100;
      if (liqDown >= p.lower) warns.push({ level: 'bad', text: `估計強平價 ${liqDown.toFixed(0)} 在區間內(≥ 下界),價格還沒跌出區間就可能被強平,降低槓桿` });
      else if (gap < 8) warns.push({ level: 'warn', text: `強平價只在下界下方 ${gap.toFixed(1)}%,跌破下界後很快就出事,建議降槓桿並設止損` });
    }
    if (!isNaN(liqUp)) {
      const gap = (liqUp - p.upper) / p.upper * 100;
      if (liqUp <= p.upper) warns.push({ level: 'bad', text: `估計強平價 ${liqUp.toFixed(0)} 在區間內(≤ 上界),價格還沒漲出區間就可能被強平,降低槓桿` });
      else if (gap < 8) warns.push({ level: 'warn', text: `強平價只在上界上方 ${gap.toFixed(1)}%,突破上界後很快就出事,建議降槓桿並設止損` });
    }
    if (p.lev > 5) warns.push({ level: 'warn', text: `槓桿 ${p.lev}x 偏高,網格常常會累積單邊倉位,建議 2~3x` });
    if (price && (price < p.lower || price > p.upper)) warns.push({ level: 'warn', text: '現價在區間之外,網格啟動後不會立刻成交' });

    return { levels: lv, notional, cellN, gapMin, gapMax, gapAvg, feeRt, netAvg, netMin, perCellUsd, liqDown, liqUp, warns };
  },

  /* 回測:用歷史 K 線逐根走一遍
   *
   * 假設(比較保守,但仍是理想化):
   *  - 一根 K 線的走法:陽線 開→低→高→收,陰線 開→高→低→收;價格穿過格線就成交,成交在格線價(無滑價)
   *  - 掛單手續費 = fee%,每筆成交各收一次
   *  - 資金費率固定 funding %/8h,依當下淨持倉計(多方付、空方收;負值相反)
   *  - 權益 <= 維持保證金 就視為被強平,回測結束
   * 不含:滑價、爆量時掛單來不及成交、交易所最小下單量、真實歷史資金費率。
   */
  backtest(p, cs, opt) {
    const lv = this.levels(p.lower, p.upper, p.n, p.mode), n = p.n;
    const fee = opt.fee / 100, m = opt.mmr / 100, fund = opt.funding / 100;
    const hours = opt.candleMs / 36e5;
    const notional = p.capital * p.lev, cellN = notional / n;
    const p0 = cs[0].o;

    /* 每格的類型:做多 / 做空;狀態:flat(空手等進場) / held(持倉等出場) */
    const cells = [];
    for (let i = 0; i < n; i++) {
      const type = p.dir === 'long' ? 'L' : p.dir === 'short' ? 'S' : (lv[i + 1] <= p0 ? 'L' : 'S');
      cells.push({ type, held: false, entry: 0, qty: 0 });
    }

    let cash = 0, fees = 0, fundingPaid = 0, closed = 0, liquidated = false;
    let netQty = 0, maxDD = 0, peak = p.capital, inRange = 0;
    const eq = [], liqAt = { i: -1 };

    const fill = (cell, price, open) => {
      // open = 進場;否則出場並結算這一格的價差
      const qty = open ? cellN / price : cell.qty;
      fees += qty * price * fee;
      if (open) {
        cell.held = true; cell.entry = price; cell.qty = qty;
        netQty += cell.type === 'L' ? qty : -qty;
      } else {
        const pnl = (cell.type === 'L' ? price - cell.entry : cell.entry - price) * cell.qty;
        cash += pnl;
        netQty -= cell.type === 'L' ? cell.qty : -cell.qty;
        cell.held = false; closed++;
      }
    };

    const step = (a, b) => {
      // 價格從 a 走到 b,依走向依序處理穿過的格線
      for (let k = 0; k < n; k++) {
        const c = cells[k], lo = lv[k], hi = lv[k + 1];
        if (b < a) {                                    // 下跌
          if (c.type === 'L' && !c.held && a > lo && b <= lo) fill(c, lo, true);
          else if (c.type === 'S' && c.held && a > lo && b <= lo) fill(c, lo, false);
        } else if (b > a) {                             // 上漲
          if (c.type === 'L' && c.held && a < hi && b >= hi) fill(c, hi, false);
          else if (c.type === 'S' && !c.held && a < hi && b >= hi) fill(c, hi, true);
        }
      }
    };

    const markEquity = px => {
      let unreal = 0, exposure = 0;
      for (const c of cells) if (c.held) {
        unreal += (c.type === 'L' ? px - c.entry : c.entry - px) * c.qty;
        exposure += c.qty * px;
      }
      return { equity: p.capital + cash + unreal - fees - fundingPaid, unreal, exposure };
    };

    for (let i = 0; i < cs.length; i++) {
      const k = cs[i];
      const path = k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c];
      for (let j = 0; j < 3; j++) {
        step(path[j], path[j + 1]);
        const q = markEquity(path[j + 1]);
        if (q.exposure > 0 && q.equity <= q.exposure * m) { liquidated = true; liqAt.i = i; break; }
      }
      if (liquidated) {
        eq.push(0);
        break;
      }
      fundingPaid += netQty * k.c * fund * hours / 8;
      const q = markEquity(k.c);
      eq.push(q.equity);
      if (q.equity > peak) peak = q.equity;
      const dd = (peak - q.equity) / peak;
      if (dd > maxDD) maxDD = dd;
      if (k.c >= p.lower && k.c <= p.upper) inRange++;
    }

    const lastC = cs[Math.min(cs.length - 1, liqAt.i >= 0 ? liqAt.i : cs.length - 1)].c;
    const q = markEquity(lastC);
    const finalEq = liquidated ? 0 : q.equity;
    const realized = cash - fees - fundingPaid;
    return {
      liquidated, liqIndex: liqAt.i, eq, closed,
      finalEq, ret: (finalEq / p.capital - 1) * 100,
      realized, unreal: liquidated ? 0 : q.unreal, fees, funding: fundingPaid,
      maxDD: maxDD * 100, inRange: cs.length ? inRange / cs.length * 100 : 0,
      priceChg: (cs[cs.length - 1].c / cs[0].o - 1) * 100,
      held: cells.filter(c => c.held).length,
      levels: lv,
    };
  },
};
