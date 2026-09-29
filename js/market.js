/* 行情資料 + 技術指標
 *
 * 資料直接從手機瀏覽器抓交易所的公開 API(不需要金鑰、不需要自己的伺服器):
 *   主要 Binance 合約 fapi,失敗自動改用 OKX 永續。
 * K 線統一成 {t, o, h, l, c, v},時間由舊到新。
 */
const Market = {
  SYMS: {
    ETHUSDT: { name: 'ETH', okx: 'ETH-USDT-SWAP' },
    BTCUSDT: { name: 'BTC', okx: 'BTC-USDT-SWAP' },
  },
  TF_MS: { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 },
  OKX_BAR: { '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W' },
  source: '',            // 最後一次成功用的是哪個交易所,顯示在畫面上
  _cache: {},

  async getJSON(url, timeout = 9000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  },

  /* 同一組請求 30 秒內不重抓 */
  async cached(key, ttl, fn) {
    const hit = this._cache[key];
    if (hit && Date.now() - hit.at < ttl) return hit.val;
    const val = await fn();
    this._cache[key] = { at: Date.now(), val };
    return val;
  },

  /* ---------- 即時報價 ---------- */
  async ticker(sym) {
    return this.cached('tk' + sym, 15000, async () => {
      try {
        const [t, p] = await Promise.all([
          this.getJSON('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=' + sym),
          this.getJSON('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + sym),
        ]);
        this.source = 'Binance';
        return {
          price: +t.lastPrice, change: +t.priceChangePercent, high: +t.highPrice, low: +t.lowPrice,
          funding: +p.lastFundingRate * 100, mark: +p.markPrice, nextFunding: +p.nextFundingTime,
        };
      } catch (e) {
        const id = this.SYMS[sym].okx;
        const [t, f] = await Promise.all([
          this.getJSON('https://www.okx.com/api/v5/market/ticker?instId=' + id),
          this.getJSON('https://www.okx.com/api/v5/public/funding-rate?instId=' + id),
        ]);
        const d = t.data[0], fr = f.data[0];
        this.source = 'OKX';
        return {
          price: +d.last, change: (+d.last / +d.open24h - 1) * 100, high: +d.high24h, low: +d.low24h,
          funding: +fr.fundingRate * 100, mark: +d.last, nextFunding: +fr.nextFundingTime,
        };
      }
    });
  },

  /* ---------- K 線(超過單次上限會自動分頁往前抓) ---------- */
  async klines(sym, tf, limit) {
    return this.cached('kl' + sym + tf + limit, 60000, async () => {
      try {
        const out = await this.binanceKlines(sym, tf, limit);
        this.source = 'Binance';
        return out;
      } catch (e) {
        const out = await this.okxKlines(sym, tf, limit);
        this.source = 'OKX';
        return out;
      }
    });
  },

  async binanceKlines(sym, tf, limit) {
    let out = [], end = '';
    while (out.length < limit) {
      const n = Math.min(1500, limit - out.length);
      const rows = await this.getJSON(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=${n}` + (end ? '&endTime=' + end : ''));
      if (!rows.length) break;
      const part = rows.map(r => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
      out = part.concat(out);
      end = rows[0][0] - 1;
      if (rows.length < n) break;
    }
    return out;
  },

  async okxKlines(sym, tf, limit) {
    const id = this.SYMS[sym].okx, bar = this.OKX_BAR[tf];
    let out = [], after = '';
    while (out.length < limit) {
      const path = out.length < 300 && !after ? 'candles' : 'history-candles';
      const res = await this.getJSON(
        `https://www.okx.com/api/v5/market/${path}?instId=${id}&bar=${bar}&limit=${path === 'candles' ? 300 : 100}` +
        (after ? '&after=' + after : ''));
      const rows = res.data || [];
      if (!rows.length) break;
      // OKX 是新到舊,轉成舊到新
      const part = rows.slice().reverse().map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
      out = part.concat(out);
      after = rows[rows.length - 1][0];
    }
    return out.slice(-limit);
  },
};

/* ---------- 技術指標(輸入 / 輸出都是普通陣列,不足的地方補 NaN) ---------- */
const Ind = {
  last(a) { return a[a.length - 1]; },

  sma(a, p) {
    const out = new Array(a.length).fill(NaN);
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      s += a[i];
      if (i >= p) s -= a[i - p];
      if (i >= p - 1) out[i] = s / p;
    }
    return out;
  },

  /* RSI(Wilder 平滑) */
  rsi(c, p = 14) {
    const out = new Array(c.length).fill(NaN);
    if (c.length <= p) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= p; l /= p;
    out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = p + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
      l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  },

  /* ATR(Wilder) */
  atr(cs, p = 14) {
    const out = new Array(cs.length).fill(NaN);
    if (cs.length <= p) return out;
    const tr = cs.map((k, i) => i === 0 ? k.h - k.l :
      Math.max(k.h - k.l, Math.abs(k.h - cs[i - 1].c), Math.abs(k.l - cs[i - 1].c)));
    let a = 0;
    for (let i = 1; i <= p; i++) a += tr[i];
    a /= p;
    out[p] = a;
    for (let i = p + 1; i < cs.length; i++) { a = (a * (p - 1) + tr[i]) / p; out[i] = a; }
    return out;
  },

  /* ADX:趨勢強度,不分多空。< 20 偏盤整,> 25 有趨勢 */
  adx(cs, p = 14) {
    const n = cs.length, adx = new Array(n).fill(NaN);
    let pdi = NaN, mdi = NaN;
    if (n < p * 2 + 1) return { adx, pdi, mdi };
    const tr = [], pd = [], md = [];
    for (let i = 1; i < n; i++) {
      const up = cs[i].h - cs[i - 1].h, dn = cs[i - 1].l - cs[i].l;
      pd.push(up > dn && up > 0 ? up : 0);
      md.push(dn > up && dn > 0 ? dn : 0);
      tr.push(Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i - 1].c), Math.abs(cs[i].l - cs[i - 1].c)));
    }
    let sTr = 0, sP = 0, sM = 0;
    for (let i = 0; i < p; i++) { sTr += tr[i]; sP += pd[i]; sM += md[i]; }
    const dx = [];
    for (let i = p; i <= tr.length; i++) {
      if (i > p) {
        sTr = sTr - sTr / p + tr[i - 1];
        sP = sP - sP / p + pd[i - 1];
        sM = sM - sM / p + md[i - 1];
      }
      pdi = 100 * sP / sTr; mdi = 100 * sM / sTr;
      dx.push(pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi));
    }
    let a = 0;
    for (let i = 0; i < p; i++) a += dx[i];
    a /= p;
    adx[2 * p] = a;
    for (let i = p; i < dx.length; i++) { a = (a * (p - 1) + dx[i]) / p; adx[i + p] = a; }
    return { adx, pdi, mdi };
  },

  /* 布林通道 + 帶寬(上軌 − 下軌)/ 中軌 */
  boll(c, p = 20, k = 2) {
    const mid = this.sma(c, p), up = [], lo = [], bw = [];
    for (let i = 0; i < c.length; i++) {
      if (isNaN(mid[i])) { up.push(NaN); lo.push(NaN); bw.push(NaN); continue; }
      let v = 0;
      for (let j = i - p + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / p);
      up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd);
      bw.push(2 * k * sd / mid[i]);
    }
    return { mid, up, lo, bw };
  },

  /* 最新一筆在最近 n 筆裡排第幾百分位(0 = 最低,100 = 最高) */
  pctRank(a, n) {
    const w = a.slice(-n).filter(x => !isNaN(x));
    if (w.length < 5) return NaN;
    const v = w[w.length - 1];
    return 100 * w.filter(x => x <= v).length / w.length;
  },
};
