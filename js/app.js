/* 主程式:行情與訊號單一頁面 + 技術面詳解 + 設定 */
const App = {
  tab: 'market',
  tf: '1d',                 // 行情頁用的 K 線週期
  data: null,               // {tk, cs, an} 最近一次載入的行情與分析
  loading: false,
  err: '',
  TFS: [['8h', '8 小時'], ['1d', '日線'], ['1w', '週線']],
  tier: 'mid',              // 建議參數目前看的風險等級

  sym() { return Market.SYMS[Store.settings.symbol]; },

  init() {
    Store.load();
    Theme.apply();
    hydrateIcons();
    document.addEventListener('click', e => this.onClick(e));
    this.go('market');
    this.load();
    setInterval(() => this.tick(), 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  },

  /* 重畫行情頁(換幣種、重新載入、設定改變後都走這裡) */
  go(tab, keepScroll) {
    $('#hdr-sub').textContent = this.sym().name + ' 永續合約';
    this.renderMarket();
    if (!keepScroll) window.scrollTo(0, 0);
  },

  /* ---------- 事件 ---------- */
  onClick(e) {
    const seg = e.target.closest('[data-seg]');
    if (seg) return this.onSeg(seg);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'refresh') { this.load(true); Toast.show('更新行情中…', 1200); }
    else if (a === 'settings') this.openSettings();
    else if (a === 'tf-pick') this.pickTf(b.dataset.v);
    else if (a === 'tier') { this.tier = b.dataset.v; const el = $('#sug-card'); if (el) el.outerHTML = this.sugCardHtml(); }
    else if (a === 'guide-done') { Store.settings.guideDone = true; Store.saveSettings(); this.renderMarket(); }
    else if (a === 'tech') this.openTech();
    else if (a === 'tk-jump') { const el = $('#tk-' + b.dataset.v); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  },

  onSeg(el) {
    const k = el.dataset.seg, v = el.dataset.v;
    if (k === 'tf') { this.pickTf(v); return; }
    if (k === 'tech-tf') { this.techTf = v; this.renderTech(); return; }
  },

  /* ---------- 小元件 ---------- */
  seg(name, opts, cur) {
    return `<div class="segmented">${opts.map(([v, t]) =>
      `<button type="button" data-seg="${name}" data-v="${v}" class="${String(v) === String(cur) ? 'active' : ''}">${t}</button>`).join('')}</div>`;
  },
  kpi(label, value, cls = '', sub = '') {
    return `<div class="kpi"><div class="k-l">${label}</div><div class="k-v ${cls}">${value}</div>${sub ? `<div class="k-s">${sub}</div>` : ''}</div>`;
  },
  errBox() {
    return `<div class="card err-card"><p>${esc(this.err)}</p><button class="btn" data-act="refresh">重試</button></div>`;
  },

  /* ---------- 載入行情:4 小時 / 日線 / 週線一起抓,切換週期不用重抓 ---------- */
  async load(force) {
    if (this.loading) return;
    if (force) Market._cache = {};
    this.loading = true; this.err = '';
    if (this.tab === 'market' && !this.data) this.renderMarket();
    try {
      const sym = Store.settings.symbol;
      const [tk, ...ks] = await Promise.all([Market.ticker(sym), ...this.TFS.map(([tf]) => Market.klines(sym, tf, 300))]);
      const tfs = {};
      this.TFS.forEach(([tf], i) => { tfs[tf] = { cs: ks[i], an: Signal.analyze(ks[i], tk.funding, Store.settings.fee) }; });
      const d1 = tfs['1d'].an, atrD = Math.max(d1.atrPct, isNaN(d1.atrMed90) ? 0 : d1.atrMed90);   // 波動壓縮時用 90 天正常波動當尺
      Object.values(tfs).forEach(t => {
        t.an.profiles = Signal.profiles(t.an, tk.price, atrD, Store.settings.fee, Store.settings.mmr);
        t.an.sug = t.an.profiles[1];
      });
      this.data = { tk, sym, tfs, atrD, at: Date.now(), klAt: Date.now(), h1: null };
      this.loadH1(sym);
      this.loadSent(sym);
      this.loadOdds(sym);
      this.pickTf(this.tf, true);
    } catch (e) {
      this.err = '連不上交易所行情(' + (e.message || e) + '),請檢查網路後重試';
    }
    this.loading = false;
    this.go(this.tab, true);
  },

  /* 三檔建議要用過去 30 天 1 小時 K 線回測,背景抓,抓到後只重畫建議卡 */
  async loadH1(sym) {
    try {
      const h1 = await Market.klines(sym, '1h', 720);
      if (!this.data || this.data.sym !== sym) return;
      this.data.h1 = h1;
      const el = $('#sug-card');
      if (el && this.tab === 'market') el.outerHTML = this.sugCardHtml();
    } catch (e) { /* 回測數字就不顯示 */ }
  },
  profBt(an) {
    if (!this.data.h1) return null;
    if (!an._bt) {
      const o = { fee: Store.settings.fee, mmr: Store.settings.mmr, funding: Store.settings.funding, candleMs: 36e5 };
      an._bt = an.profiles.map(p => Grid.backtest(p, this.data.h1, o));
    }
    return an._bt;
  },

  /* 歷史實測勝率:抓近 2,000 天日線在背景算,算完只重畫勝率卡 */
  async loadOdds(sym) {
    try {
      const cs = await Market.klines(sym, '1d', 2000);
      if (!this.data || this.data.sym !== sym) return;
      this.data.odds = Signal.gridOdds(cs);
    } catch (e) { if (this.data) this.data.oddsErr = true; }
    const el = $('#odds-card');
    if (el) el.outerHTML = this.oddsCardHtml();
  },

  ODDS_VOL: { low: '波動壓縮', mid: '波動正常', high: '波動高檔' },
  oddsCardHtml() {
    const O = this.data.odds;
    if (!O) return `<div class="card odds-card" id="odds-card"><div class="section-title in">網格勝率 · 歷史實測</div>
      <p class="fine in">${this.data.oddsErr ? '歷史日線暫時抓不到' : '回放過去約 5 年日線中…'}</p></div>`;
    const m = O.match, V = this.ODDS_VOL, names = { neutral: '中性', long: '做多', short: '做空' };
    const bar = k => `<div class="od-row${k === O.best ? ' best' : ''}"><span class="od-l">${names[k]}${k === O.best ? ' <em>最高</em>' : k === O.now.dir ? ' <em class="sig">訊號</em>' : ''}</span>
      <span class="od-track"><i style="width:${m[k].toFixed(0)}%"></i></span><b>${m[k].toFixed(0)}%</b></div>`;
    const tbl = ['low', 'mid', 'high'].map(v => `<tr class="${v === O.now.vol ? 'cur' : ''}"><td>${V[v]}</td><td>${O.table[v].neutral.toFixed(0)}%</td><td>${O.table[v].long.toFixed(0)}%</td><td>${O.table[v].short.toFixed(0)}%</td><td>${O.table[v].n}</td></tr>`).join('');
    return `<div class="card odds-card" id="odds-card">
      <div class="card-h"><span class="section-title in">網格勝率 · 歷史實測</span><span class="hint">${fmt.date(O.from, true)} 起 ${O.days} 天</span></div>
      <div class="od-now">今天:<b>${V[O.now.vol]}</b>(ATR 排名 ${O.now.rank.toFixed(0)})· 日線訊號 <b>${Signal.DIR_LABEL[O.now.dir]}</b></div>
      <p class="od-sub">過去${O.basis === 'both' ? '「波動狀態 + 方向訊號」都跟今天一樣' : '「波動狀態」跟今天一樣'}的 ${m.n} 天,照中風險規則開網格,${O.H} 天內<b>沒有在輸的那邊被打出區間</b>的比例:</p>
      ${['neutral', 'long', 'short'].map(bar).join('')}
      <p class="od-warn">樣本 ${m.n} 天,但相鄰天的 ${O.H} 天窗口互相重疊,實際只相當於約 ${Math.max(1, Math.round(m.n / O.H))} 組獨立行情${m.n < 150 ? ',樣本偏少,只看大方向' : ''}${O.best !== O.now.dir && O.now.dir !== 'neutral' && m[O.best] - m[O.now.dir] < 15 ? ';跟訊號方向的差距不大,不建議只憑這個反向操作' : ''}。</p>
      <details class="od-more"><summary>各波動狀態的安全率</summary>
        <table class="tbl od-tbl"><tr><th></th><th>中性</th><th>做多</th><th>做空</th><th>天數</th></tr>${tbl}</table>
      </details>
      <p class="fine in">中性兩邊破都算輸;做多只算跌破下限、做空只算突破上限(往有利的那邊破是獲利出場)。區間半寬 = max(8%, 2.5 × 日線正常波動)。這是過去的統計,不保證未來。</p>
    </div>`;
  },

  TIER_NOTE: {
    low: '區間寬、槓桿低,強平價離區間 20% 以上;單邊走勢也撐得住,賺得慢但穩。方向跟著判讀,沒有明確方向時才用中性。',
    mid: '兼顧套利次數與安全距離,強平價離區間 10% 以上;適合大多數情況的起手式。',
    high: '區間窄、格子密,套利次數最多;但價格很容易跑出區間,強平也近。只適合小資金、要常盯盤、一定要設止損。',
  },
  sugCardHtml() {
    const { tk, an } = this.data, tn = this.tfName(this.tf);
    const ps = an.profiles, bts = this.profBt(an);
    const i = Math.max(0, ps.findIndex(p => p.tier === this.tier));
    const p = ps[i], r = p.calc, bt = bts && bts[i];
    const k = this.risk(p.dir, r.liqDown, r.liqUp, tk.price, p.lower, p.upper);
    const tabs = ps.map((q, j) => `<button type="button" class="tier-btn t-${q.tier}${j === i ? ' cur' : ''}" data-act="tier" data-v="${q.tier}">
      <b>${q.tierName}</b><span>${q.lev}x · ${Signal.DIR_LABEL[q.dir].replace('網格', '')}</span>
      <em class="${bts ? fmt.cls(bts[j].ret) : ''}">${bts ? (bts[j].liquidated ? '回測強平' : '30 天 ' + fmt.pct(bts[j].ret, 1)) : '回測中…'}</em></button>`).join('');
    return `<div class="card sug-card" id="sug-card">
      <div class="card-h"><span class="section-title in">建議網格參數 · 依${tn}方向</span><span class="hint">選風險等級</span></div>
      <div class="tier-tabs">${tabs}</div>
      <div class="tier-body t-${p.tier}">
        <div class="sug-grid">
          <div><span>方向</span><b>${Signal.DIR_LABEL[p.dir]}</b></div>
          <div><span>區間(寬 ${p.width.toFixed(1)}%)</span><b>${fmt.n(p.lower, 0)} ~ ${fmt.n(p.upper, 0)}</b></div>
          <div><span>格數(每格淨利)</span><b>${p.n} 格 · ${r.netAvg.toFixed(2)}%</b></div>
          <div><span>槓桿(全成交實際)</span><b>${p.lev}x · ${r.effLev.toFixed(1)}x</b></div>
        </div>
        ${Viz.rangeBar({ lower: p.lower, upper: p.upper, price: tk.price, liqDown: p.dir !== 'short' ? r.liqDown : NaN, liqUp: p.dir !== 'long' ? r.liqUp : NaN })}
        <div class="kpi-grid mini">
          ${this.kpi('強平離區間', isNaN(k.edge) ? '—' : k.edge.toFixed(1) + '%', 'liq', '現價距強平 ' + (isNaN(k.dist) ? '—' : k.dist.toFixed(1) + '%'))}
          ${bt ? this.kpi('過去 30 天回測', bt.liquidated ? '強平' : fmt.pct(bt.ret, 1), bt.liquidated ? 'liq' : fmt.cls(bt.ret), '最大回撤 ' + bt.maxDD.toFixed(0) + '% · 每天套利 ' + (bt.closed / 30).toFixed(0) + ' 次')
            : this.kpi('過去 30 天回測', '計算中…', '', '1 小時 K 線')}
        </div>
        <p class="tier-note">${this.TIER_NOTE[p.tier]}</p>
      </div>
      <p class="fine in">回測以 1,000 USDT、無額外保證金計,報酬是百分比,換成你的金額比例相同。過去表現不代表未來。</p>
    </div>`;
  },

  /* 換判讀週期:資料已經在手上,直接換指標就好 */
  pickTf(tf, silent) {
    this.tf = tf;
    if (this.data) Object.assign(this.data, { tf, cs: this.data.tfs[tf].cs, an: this.data.tfs[tf].an });
    if (!silent) { this.renderMarket(); }
  },

  /* 每 15 秒更新報價(只換價格卡 / 機器人清單,不整頁重畫);K 線每 5 分鐘重抓一次 */
  async tick() {
    if (document.hidden || !this.data || this.loading) return;
    if (this.tab === 'market' && Date.now() - this.data.klAt > 300000) { this.load(true); return; }
    try {
      const tk = await Market.ticker(Store.settings.symbol);
      if (!this.data || this.data.sym !== Store.settings.symbol) return;
      this.data.tk = tk; this.data.at = Date.now();
      const pc = $('#price-card');
      if (pc && this.tab === 'market') pc.outerHTML = this.priceCardHtml();
    } catch (e) { /* 下次再試 */ }
  },

  lean(s) { return s >= 3 ? '偏多' : s <= -3 ? '偏空' : s > 0 ? '略偏多' : s < 0 ? '略偏空' : '中性'; },
  tfName(tf) { return (this.TFS.find(x => x[0] === tf) || [tf, tf])[1]; },

  /* 風險等級:取離現價最近那一側的強平價
   * 危險 = 距強平 < 10% 或強平價離區間邊界 < 3%;注意 = < 20% 或 < 10% */
  risk(dir, liqDown, liqUp, px, lower, upper) {
    const cand = [];
    if (liqDown > 0 && dir !== 'short') cand.push({ liq: liqDown, side: 'down', dist: (px - liqDown) / px * 100, edge: (lower - liqDown) / lower * 100 });
    if (liqUp > 0 && dir !== 'long') cand.push({ liq: liqUp, side: 'up', dist: (liqUp - px) / px * 100, edge: (liqUp - upper) / upper * 100 });
    if (!cand.length || !px) return { level: 'ok', label: '—', dist: NaN, edge: NaN, liq: NaN };
    const c = cand.sort((a, b) => a.dist - b.dist)[0];
    c.level = 'ok'; c.label = '安全';
    if (c.dist < 10 || c.edge < 3) { c.level = 'bad'; c.label = '危險'; }
    else if (c.dist < 20 || c.edge < 10) { c.level = 'warn'; c.label = '注意'; }
    return c;
  },

  /* ============ 行情頁元件 ============ */
  guideHtml() {
    if (Store.settings.guideDone) return '';
    return `<div class="card guide">
      <div class="guide-h">怎麼用這頁看行情</div>
      <ol>
        <li><b>看方向</b>:三個週期同方向最可靠;分歧時用中性網格或縮小資金</li>
        <li><b>看指標</b>:指標儀表統計多空投票,點「技術面詳解」看日線 / 週線建議與每日走勢</li>
        <li><b>挑參數</b>:低 / 中 / 高風險三檔建議,每檔附強平距離與過去 30 天回測,再到派網自己填</li>
      </ol>
      <button class="btn sm" data-act="guide-done">知道了</button>
    </div>`;
  },

  priceCardHtml() {
    const { tk, tfs } = this.data, name = this.sym().name;
    const d7 = tfs['8h'].cs.slice(-21).map(k => k.c);
    const rp = tk.high > tk.low ? Math.max(0, Math.min(100, (tk.price - tk.low) / (tk.high - tk.low) * 100)) : 50;
    const fund = tk.funding >= 0.03 || tk.funding <= -0.01 ? 'warnc' : '';
    return `<div class="card price-card" id="price-card">
      <div class="pc-top"><span class="pc-name">${name}/USDT 永續</span><span class="pc-src"><i class="live-dot"></i>${esc(Market.source)} · ${new Date(this.data.at).toTimeString().slice(0, 8)}</span></div>
      <div class="pc-mid">
        <div><div class="pc-price ${fmt.cls(tk.change)}">${fmt.price(tk.price)}</div>
          <span class="chg-pill ${fmt.cls(tk.change)}">${fmt.pct(tk.change)} · 24h</span></div>
        <div class="pc-spark ${fmt.cls(d7[d7.length - 1] - d7[0])}">${Viz.spark(d7)}<span>近 7 天</span></div>
      </div>
      <div class="day-range"><span>${fmt.price(tk.low)}</span><div class="dr-bar"><i style="left:${rp}%"></i></div><span>${fmt.price(tk.high)}</span></div>
      <div class="pc-foot"><span>24h 低</span><span>資金費率 <b class="${fund}">${tk.funding.toFixed(4)}%</b> /8h</span><span>24h 高</span></div>
    </div>`;
  },

  consensusHtml() {
    const T = this.data.tfs;
    const tiles = this.TFS.map(([tf, t]) => {
      const a = T[tf].an;
      return `<button type="button" class="tf-tile${tf === this.tf ? ' cur' : ''}" data-act="tf-pick" data-v="${tf}">
        <span class="tf-name">${t}</span>${Viz.gauge(a.score, 'sm')}
        <b class="tf-dir ${a.score >= 1 ? 'up' : a.score <= -1 ? 'down' : ''}">${this.lean(a.score)}</b>
        <span class="tf-sc">${a.score > 0 ? '+' : ''}${a.score} · ADX ${a.adx.toFixed(0)}</span></button>`;
    }).join('');
    const sc = this.TFS.map(([tf]) => T[tf].an.score), w = T['1w'].an.score;
    let cls = 'neutral', title = '週期分歧', text;
    if (sc.every(s => s >= 1)) { cls = 'long'; title = '三週期共振 · 偏多'; text = '長短線方向一致,做多網格較有利;RSI 過熱時別追高,區間放在回檔支撐區。'; }
    else if (sc.every(s => s <= -1)) { cls = 'short'; title = '三週期共振 · 偏空'; text = '長短線方向一致,做空網格較有利;超賣時小心反彈,區間放在反彈壓力區。'; }
    else if (w >= 1) text = '長線偏多、短線不同調:可等短線回穩再做多,或先用中性網格、縮小資金。';
    else if (w <= -1) text = '長線偏空、短線不同調:可等反彈結束再做空,或先用中性網格、縮小資金。';
    else text = '長線方向不明:中性網格較穩,資金與槓桿放小。';
    return `<div class="card consensus c-${cls}">
      <div class="cs-head"><span class="cs-title">${title}</span><span class="hint">點週期看細節</span></div>
      <div class="tf-tiles">${tiles}</div>
      <p class="cs-text">${text}</p></div>`;
  },

  /* 指標儀表卡:週期切換放在卡片最上面,下面是投票結果、技術面、籌碼面 */
  indCardHtml() {
    const { tk, cs, an } = this.data, tn = this.tfName(this.tf);
    const sent = this.sentFor(this.tf);
    const R = Signal.meters(an, cs, sent, tk.funding, this.tf);
    const tot = R.items.filter(m => m.vote !== false).length, pct = k => (R.cnt[k] / tot * 100).toFixed(1);
    const L = { up: '偏多', down: '偏空', flat: '中性' };
    const row = m => Viz.meter(Object.assign({}, m, { lean: m.lean, leanText: (m.vote === false ? '不投票' : L[m.lean]) + ' · ' + m.leanText }));
    const tech = R.items.filter(m => m.group === 'tech'), chip = R.items.filter(m => m.group === 'chip');
    const chipNote = sent ? `Binance 合約 · ${sent.period === '4h' ? '4 小時粒度,近 5 天' : '日粒度,近 30 天'}`
      : (this.data.sentErr ? '籌碼資料暫時抓不到' : '籌碼資料載入中…');
    return `<div class="card ind-card" id="ind-card">
      <div class="card-h"><span class="section-title in">指標儀表</span><span class="hint">切換週期 ↓</span></div>
      ${this.seg('tf', this.TFS, this.tf)}
      <div class="vote v-${R.vdir}">
        <div class="vote-bar"><i class="vb-up" style="width:${pct('up')}%"></i><i class="vb-flat" style="width:${pct('flat')}%"></i><i class="vb-dn" style="width:${pct('down')}%"></i></div>
        <div class="vote-cnt"><span class="up">偏多 ${R.cnt.up}</span><span>中性 ${R.cnt.flat}</span><span class="down">偏空 ${R.cnt.down}</span></div>
        <div class="vote-v">${tn}:<b>${R.verdict}</b></div>
      </div>
      <div class="ind-group"><span>技術面</span><small>${tn} K 線 · 依重要度排序</small></div>
      ${tech.map(row).join('')}
      <button type="button" class="tech-more" data-act="tech"><span><b>技術面詳解</b><small>重要度排名 · 每日節點走勢 · 詳細說明</small></span><i>›</i></button>
      <div class="ind-group"><span>籌碼面</span><small>${chipNote}</small></div>
      ${chip.map(row).join('')}
      <p class="fine in">反向指標(資金費率、散戶多空比)擁擠的一邊容易被洗;投票只是整理,不是預測,要搭配上面的三週期共振一起看。</p>
    </div>`;
  },

  /* ============ 技術面詳解(整頁彈出,不放主頁) ============ */
  openTech() {
    if (!this.data) return;
    this.techTf = this.tf;
    Modal.open(`<div class="sheet-top"><div><h3>技術面詳解</h3><span class="hint">${this.sym().name} · 依重要度排序 · 每日節點</span></div>
      <button type="button" class="icon-btn" data-close="1" aria-label="關閉">✕</button></div>
      <div id="tech-body"></div>`, null, 'full');
    this.renderTech();
  },

  /* 每個指標的圖、數值格式、tooltip
   *   ln:不投票的指標也有多空傾向時,用它畫節點列;txt:數值欄改顯示文字;hl(last, SR):圖上的水平參考線
   *   noTrend:沒有「近 7 天從多少到多少」這種數值趨勢;noAxis:數值本身沒意義,不顯示刻度 */
  TECH_VIEW: {
    atr: { v: q => q.atrRank, f: v => isNaN(v) ? '—' : v.toFixed(0), txt: q => (q.atrRank < 20 ? '壓縮 ' : q.atrRank > 80 ? '高檔 ' : '正常 ') + q.atrRank.toFixed(0), lean: q => `ATR ${q.atrPct.toFixed(2)}% · ${q.atrRank < 20 ? '壓縮' : q.atrRank > 80 ? '高檔' : '正常'}`,
      series: N => [{ d: N.map(q => q.atrRank), cls: 'ch-eq' }], lines: [20, 80], legend: '<i class="lg lg-eq"></i>ATR 在近 120 根的百分位(< 20 壓縮、> 80 高檔)',
      tip: q => `<span>ATR ${q.atrPct.toFixed(2)}% · 排名 ${q.atrRank.toFixed(0)}</span>` },
    ma: { v: q => q.dev, f: v => fmt.pct(v, 1), lean: q => '離 MA200 ' + fmt.pct(q.dev, 1),
      series: N => [{ d: N.map(q => q.price), cls: 'ch-price' }, { d: N.map(q => q.ma50), cls: 'ch-ma50' }, { d: N.map(q => q.ma200), cls: 'ch-ma200' }],
      lines: [], legend: '<i class="lg lg-price"></i>價格 <i class="lg lg-ma50"></i>MA50 <i class="lg lg-ma200"></i>MA200',
      tip: q => `<span>MA50 ${fmt.n(q.ma50, 0)} · MA200 ${fmt.n(q.ma200, 0)}</span><span>離 MA200 ${fmt.pct(q.dev, 1)}</span>` },
    dmi: { v: q => q.adx, f: v => v.toFixed(0), lean: q => `+DI ${q.pdi.toFixed(0)} / −DI ${q.mdi.toFixed(0)}`,
      series: N => [{ d: N.map(q => q.adx), cls: 'ch-eq' }, { d: N.map(q => q.pdi), cls: 'ch-pdi' }, { d: N.map(q => q.mdi), cls: 'ch-mdi' }],
      lines: [20, 35], legend: '<i class="lg lg-eq"></i>ADX <i class="lg lg-pdi"></i>+DI <i class="lg lg-mdi"></i>−DI',
      tip: q => `<span>ADX ${q.adx.toFixed(1)}</span><span>+DI ${q.pdi.toFixed(1)} · −DI ${q.mdi.toFixed(1)}</span>` },
    pb: { v: q => q.pb, f: v => v.toFixed(0), lean: q => `帶寬 ${isNaN(q.bwRank) ? '—' : q.bwRank.toFixed(0)} 百分位`,
      series: N => [{ d: N.map(q => q.pb), cls: 'ch-eq' }], lines: [0, 50, 100], legend: '<i class="lg lg-eq"></i>%B(0 = 下軌、100 = 上軌)',
      tip: q => `<span>%B ${q.pb.toFixed(0)}</span><span>帶寬 ${isNaN(q.bwRank) ? '—' : q.bwRank.toFixed(0)} 百分位</span>` },
    rsi: { v: q => q.rsi, f: v => v.toFixed(0), lean: q => q.rsi >= 70 ? '過熱(動能強)' : q.rsi <= 30 ? '超賣(動能弱)' : q.rsi >= 55 ? '動能偏強' : q.rsi <= 45 ? '動能偏弱' : '中性',
      series: N => [{ d: N.map(q => q.rsi), cls: 'ch-eq' }], lines: [30, 50, 70], legend: '<i class="lg lg-eq"></i>RSI(14)',
      tip: q => `<span>RSI ${q.rsi.toFixed(1)}</span>` },
    macd: { v: q => q.hist, f: v => (v > 0 ? '+' : '') + fmt.n(v, 2), lean: q => q.hist > 0 ? 'DIF 在 DEA 之上' : 'DIF 在 DEA 之下',
      series: N => [{ d: N.map(q => q.dif), cls: 'ch-dif' }, { d: N.map(q => q.dea), cls: 'ch-dea' }],
      lines: [0], legend: '<i class="lg lg-dif"></i>DIF <i class="lg lg-dea"></i>DEA(交叉 = 柱翻正 / 翻負)',
      tip: q => `<span>DIF ${fmt.n(q.dif, 2)} · DEA ${fmt.n(q.dea, 2)}</span><span>柱 ${(q.hist > 0 ? '+' : '') + fmt.n(q.hist, 2)}</span>` },
    struct: { v: q => q.price, f: v => fmt.n(v, 0), txt: q => q.x.struct.name, ln: q => q.x.struct.lean, noTrend: true, lean: q => q.x.struct.text,
      series: N => [{ d: N.map(q => q.price), cls: 'ch-price' }], lines: [],
      hl: last => [{ y: last.x.struct.h2, cls: 'ch-res', label: '前高' }, { y: last.x.struct.l2, cls: 'ch-sup', label: '前低' }].filter(l => l.y > 0),
      legend: '<i class="lg lg-price"></i>價格 <i class="lg lg-res"></i>最近轉折高點 <i class="lg lg-sup"></i>最近轉折低點',
      tip: q => `<span>${q.x.struct.name}</span>` },
    sr: { v: q => q.price, f: v => fmt.n(v, 0), noTrend: true,
      txt: (q, SR) => SR.sup[0] ? fmt.pct((SR.sup[0].mid / q.price - 1) * 100, 1) : '—',
      lean: (q, SR) => `最近支撐 ${SR.sup[0] ? fmt.n(SR.sup[0].mid, 0) + '(' + SR.sup[0].touches + ' 次)' : '—'} · 壓力 ${SR.res[0] ? fmt.n(SR.res[0].mid, 0) + '(' + SR.res[0].touches + ' 次)' : '—'}`,
      series: N => [{ d: N.map(q => q.price), cls: 'ch-price' }], lines: [],
      hl: (last, SR) => SR.sup.slice(0, 2).map((z, i) => ({ y: z.mid, cls: 'ch-sup', label: 'S' + (i + 1) }))
        .concat(SR.res.slice(0, 2).map((z, i) => ({ y: z.mid, cls: 'ch-res', label: 'R' + (i + 1) }))),
      legend: '<i class="lg lg-price"></i>價格 <i class="lg lg-sup"></i>支撐區 <i class="lg lg-res"></i>壓力區(數值 = 離最近支撐多遠)',
      tip: q => '' },
    vol: { v: q => q.x.vol.vr, f: v => isNaN(v) ? '—' : v.toFixed(2) + 'x', ln: q => q.x.vol.lean, lean: q => q.x.vol.text, noAxis: true,
      series: N => [{ d: N.map(q => q.obv), cls: 'ch-eq' }], lines: [], legend: '<i class="lg lg-eq"></i>OBV 能量潮(看方向,數字本身沒意義;右上是量比)',
      tip: q => `<span>量比 ${isNaN(q.x.vol.vr) ? '—' : q.x.vol.vr.toFixed(2)}x</span><span>${q.x.vol.text}</span>` },
    kd: { v: q => q.k, f: v => v.toFixed(0), ln: q => q.x.kd, lean: q => `K ${q.k.toFixed(0)} / D ${q.d.toFixed(0)}${q.k >= 80 ? ' · 超買區' : q.k <= 20 ? ' · 超賣區' : ''}`,
      series: N => [{ d: N.map(q => q.k), cls: 'ch-eq' }, { d: N.map(q => q.d), cls: 'ch-dea' }], lines: [20, 50, 80],
      legend: '<i class="lg lg-eq"></i>K <i class="lg lg-dea"></i>D(9, 3, 3)', tip: q => `<span>K ${q.k.toFixed(1)} · D ${q.d.toFixed(1)}</span>` },
    candle: { v: q => q.price, f: v => fmt.n(v, 0), txt: q => q.x.candle.name, ln: q => q.x.candle.lean, noTrend: true, lean: q => q.x.candle.text,
      series: N => [{ d: N.map(q => q.price), cls: 'ch-price' }], lines: [], legend: '<i class="lg lg-price"></i>價格(下方節點列 = 每天收盤 K 線型態)',
      tip: q => `<span>${q.x.candle.name}</span>`,
      trend: (N, k, unit) => {
        const c = {};
        N.slice(-k).forEach(q => { const nm = q.x.candle.name; if (!/一般/.test(nm)) c[nm] = (c[nm] || 0) + 1; });
        const s = Object.entries(c).map(([nm, x]) => `${nm} ×${x}`).join('、');
        return [`近 ${k} ${unit}出現:${s || '沒有特殊型態'}`];
      } },
  },

  renderTech() {
    const root = $('#tech-body');
    if (!root || !this.data) return;
    const tf = this.techTf, wk = tf === '1w', unit = wk ? '週' : '天', cs = this.data.tfs[tf].cs;
    const N = Signal.techHistory(cs, tf, wk ? 26 : 30), last = N[N.length - 1];
    const SR = Signal.nearSR(Signal.levels(cs, tf), last.price);
    const lbl = q => (wk ? '週 ' : '') + fmt.date(q.t);
    const L = { up: '偏多', down: '偏空', flat: '中性' }, lc = l => l === 'up' ? 'up' : l === 'down' ? 'down' : '';
    const k = Math.min(7, N.length - 1), prev = N[N.length - 1 - k];
    const sgn = v => (v > 0 ? '+' : '') + v;
    const lnOf = d => d.vote ? (q => q.lean[d.key]) : this.TECH_VIEW[d.key].ln;

    /* 每日投票淨值 */
    const dn = last.net - prev.net;
    const voteCard = `<div class="card">
      <div class="card-h"><span class="section-title in">技術面每日投票</span><span class="hint">按住滑動看每${unit}</span></div>
      ${Viz.cols({ vals: N.map(q => q.net), max: 5, x: [lbl(N[0]), lbl(last)] }, i => {
        const q = N[i];
        return `<b>${lbl(q)}</b><span>價格 ${fmt.price(q.price)}</span><span><em class="up">偏多 ${q.cnt.up}</em> · 中性 ${q.cnt.flat} · <em class="down">偏空 ${q.cnt.down}</em></span><span>淨值 ${sgn(q.net)}</span>`;
      })}
      <p class="tk-sum">最新 <b class="${fmt.cls(last.net)}">${sgn(last.net)}</b>(偏多 ${last.cnt.up} · 中性 ${last.cnt.flat} · 偏空 ${last.cnt.down});
        ${k} ${unit}前 ${sgn(prev.net)} → <b>${dn >= 2 ? '技術面轉強' : dn <= -2 ? '技術面轉弱' : '大致持平'}</b></p>
      <p class="fine in">每${unit}一個節點,均線、ADX、布林、RSI、MACD 5 項各投一票(實測有順勢參考價值的才投),淨值 = 偏多票 − 偏空票。</p>
    </div>`;

    /* 重要度排名總覽 */
    const stars = s => '★'.repeat(s) + '<span class="st-off">' + '★'.repeat(5 - s) + '</span>';
    const rank = `<div class="card">
      <div class="section-title in">重要度排名(依 5 年 ETH / BTC 日線實測)</div>
      <p class="tk-logic">先看<b>波動狀態</b>(會不會被打出區間)→ 再看<b>方向</b>(均線、ADX、布林、RSI、MACD)→ 文章常見的<b>結構、支撐壓力、量價、KD、K 線型態</b>只當參考:實測對接下來 14 天幾乎沒有預測力</p>
      ${Signal.TECH.map((d, i) => {
        const ln = lnOf(d), l = ln ? ln(last) : null, V = this.TECH_VIEW[d.key];
        const val = V.txt ? V.txt(last, SR) : V.f(V.v(last));
        return `<button type="button" class="tk-row${d.vote ? '' : ' nv'}" data-act="tk-jump" data-v="${d.key}">
          <i class="tk-rank">${i + 1}</i><span class="tk-rn"><b>${d.name}</b><small>${d.role}</small></span>
          <span class="tk-rr"><span class="stars">${stars(d.stars)}</span>${l ? `<span class="lean-chip ln-${l}">${L[l]}</span>` : `<span class="lean-chip">${val}</span>`}</span></button>`;
      }).join('')}
      <p class="fine in">星等 = 對合約網格勝率的實測影響;灰底的不參與投票。每個指標的「實測」寫在各自卡片上。</p>
    </div>`;

    /* 各指標 */
    const cards = Signal.TECH.map((d, r) => {
      const V = this.TECH_VIEW[d.key], ln = lnOf(d), vals = N.map(V.v), ok = vals.filter(v => !isNaN(v));
      const a = V.v(prev), b = V.v(last), rng = (Math.max(...ok) - Math.min(...ok)) || 1;
      const lines = [];
      if (!V.noTrend) lines.push(`近 ${k} ${unit}:${V.f(a)} → <b>${V.f(b)}</b>,${Math.abs(b - a) < rng * 0.1 ? '持平' : b > a ? '上升' : '下降'}`);
      if (V.trend) lines.push(...V.trend(N, k, unit));
      let strip = '';
      if (ln) {
        const ls = N.map(ln), cur = ls[ls.length - 1];
        let st = 1; while (st < ls.length && ls[ls.length - 1 - st] === cur) st++;
        let fj = -1; for (let j = ls.length - 1; j > 0; j--) if (ls[j] !== ls[j - 1]) { fj = j; break; }
        const c7 = { up: 0, down: 0, flat: 0 }; ls.slice(-k).forEach(l => c7[l]++);
        lines.push(`已連續 <b class="${lc(cur)}">${st} ${unit}${L[cur]}</b>${fj > 0 ? `;最近一次轉向:${lbl(N[fj])} 由${L[ls[fj - 1]]}轉${L[ls[fj]]}` : `;${N.length} ${unit}內都沒有轉向`}`);
        lines.push(`近 ${k} ${unit}:偏多 ${c7.up} · 中性 ${c7.flat} · 偏空 ${c7.down}`);
        strip = `${Viz.nodes(ls, N.map(q => lbl(q) + ' ' + L[ln(q)]))}
          <div class="nd-x"><span>${lbl(N[0])}</span><span>每格 = 1 ${unit}</span><span>${lbl(last)}</span></div>`;
      }
      const cl = ln ? ln(last) : 'flat';
      const hl = V.hl ? V.hl(last, SR).map(l => Object.assign({ range: false }, l)) : [];
      return `<div class="card tk-card${d.vote ? '' : ' nv'}" id="tk-${d.key}">
        <div class="tk-head"><i class="tk-rank">${r + 1}</i><span class="tk-rn"><b>${d.name}</b><span class="stars">${stars(d.stars)}</span></span><b class="tk-val">${V.txt ? V.txt(last, SR) : V.f(b)}</b></div>
        <div class="tk-lean"><span class="lean-chip ln-${cl}">${d.vote ? L[cl] + ' · ' : ln ? '參考 · ' : ''}${V.lean(last, SR)}</span>${d.vote ? '' : '<span class="nv-tag">不投票</span>'}<span class="tk-role">${d.role}</span></div>
        <div class="legend">${V.legend}</div>
        ${Viz.line({ series: V.series(N), lines: V.lines.map(y => ({ y, cls: 'ch-th', label: String(y) })).concat(hl), h: 150, x: [lbl(N[0]), lbl(last)],
          yfmt: V.lines.length || V.noAxis ? () => '' : undefined },
          i => { const q = N[i], l = ln ? ln(q) : null; return `<b>${lbl(q)}</b><span>價格 ${fmt.price(q.price)}</span>${V.tip(q)}${l ? `<span class="${lc(l)}">${L[l]}</span>` : ''}`; })}
        ${strip}
        <ul class="tk-trend">${lines.map(t => `<li>${t}</li>`).join('')}</ul>
        <p class="tk-test"><b>實測</b>${d.test}</p>
        <details class="tk-doc"><summary>詳細說明</summary>
          <h4>為什麼排第 ${r + 1}</h4><p>${d.why}</p>
          <h4>它是什麼</h4><p>${d.what}</p>
          <h4>怎麼算</h4><p>${d.calc}</p>
          <h4>怎麼看</h4><ul>${d.read.map(t => `<li>${t}</li>`).join('')}</ul>
          <h4>開網格怎麼用</h4><ul>${d.grid.map(t => `<li>${t}</li>`).join('')}</ul>
          <h4>要注意</h4><p class="tk-trap">${d.trap}</p>
        </details>
      </div>`;
    }).join('');

    /* 日線 / 週線操作建議(不跟著下面的週期切換) */
    const T = this.data.tfs, advOf = t => {
      const cs = T[t].cs, A = Signal.advice(t, T[t].an, Signal.techHistory(cs, t, t === '1w' ? 26 : 30), cs);
      return Object.assign(A, { tn: this.tfName(t) });
    };
    const aD = advOf('1d'), aW = advOf('1w');
    let sync;
    if (aD.dir !== 'neutral' && aD.dir === aW.dir) sync = { cls: aD.dir, text: `日線與週線同向(${Signal.DIR_LABEL[aD.dir]}),方向把握度較高。` };
    else if (aD.dir !== 'neutral' && aW.dir !== 'neutral') sync = { cls: 'neutral', text: '日線與週線方向相反:短線逆著長線,資金放小,或先用中性網格。' };
    else if (aW.dir !== 'neutral') sync = { cls: aW.dir, text: `週線${Signal.DIR_LABEL[aW.dir]}、日線方向不明:等日線回穩再順著週線方向進場,或先用中性網格。` };
    else if (aD.dir !== 'neutral') sync = { cls: 'neutral', text: `日線${Signal.DIR_LABEL[aD.dir]}、週線方向不明:屬短線機會,槓桿與資金放小。` };
    else sync = { cls: 'neutral', text: '日線與週線都沒有明確方向:中性網格較穩,資金與槓桿放小。' };
    const advCard = A => `<div class="card adv v-${A.dir}">
      <div class="v-head"><span class="v-tf">${A.tn}建議</span><span class="v-conf">把握度 ${A.strength} · 分數 ${sgn(A.score)}</span></div>
      <div class="adv-dir">${Signal.DIR_LABEL[A.dir]}</div>
      <ul class="reasons">${A.bullets.map(r => `<li class="r-${r.tone}">${esc(r.text)}</li>`).join('')}</ul>
      <table class="tbl">${A.plan.map(([a, v]) => `<tr><td>${a}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>
      <div class="adv-watch"><b>轉弱 / 改看法的訊號</b><ul>${A.watch.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <p class="fine in">${A.note}</p></div>`;
    const advHtml = `<div class="section-title">日線 · 週線操作建議</div>
      <div class="adv-sync s-${sync.cls}">${sync.text}</div>${advCard(aD)}${advCard(aW)}
      <div class="section-title">指標走勢與節點(切換週期)</div>`;

    root.innerHTML = `${advHtml}${this.seg('tech-tf', this.TFS, tf)}
      <p class="fine in">${wk ? '週線每個節點是一週' : tf === '8h' ? '8 小時指標,每天取當天最後收盤的一根' : '日線每根 K 線一個節點'};今天還沒收完的節點會隨行情變動。</p>
      ${voteCard}${rank}${cards}
      <p class="fine">指標是過去價格算出來的,只能描述現在的狀態,不能預測。排名是「對開合約網格的參考價值」,不是準確度排名。</p>`;
    Viz.bind(root);
  },

  /* 籌碼面資料:8 小時看 4h 粒度,日線 / 週線看 1d 粒度(Binance 最多保留 30 天) */
  sentFor(tf) { const S = this.data && this.data.sent; return S ? S[tf === '8h' ? '4h' : '1d'] || null : null; },
  async loadSent(sym) {
    try {
      const [a, b] = await Promise.all([Market.sentiment(sym, '4h'), Market.sentiment(sym, '1d')]);
      if (!this.data || this.data.sym !== sym) return;
      this.data.sent = { '4h': a, '1d': b };
    } catch (e) { if (this.data) this.data.sentErr = true; }
    const el = $('#ind-card');
    if (el && this.tab === 'market') el.outerHTML = this.indCardHtml();
  },

  /* K 線圖上的支撐 / 壓力線:上下各取最近 2 個區(不拉大圖的價格範圍) */
  srLines(cs, tf, price) {
    const sr = Signal.nearSR(Signal.levels(cs, tf), price), out = [];
    sr.sup.slice(0, 2).forEach((z, i) => out.push({ y: z.mid, cls: 'ch-sup', label: 'S' + (i + 1) + ' ' + fmt.n(z.mid, 0), range: false }));
    sr.res.slice(0, 2).forEach((z, i) => out.push({ y: z.mid, cls: 'ch-res', label: 'R' + (i + 1) + ' ' + fmt.n(z.mid, 0), range: false }));
    return out;
  },

  /* ============ 行情頁 ============ */
  renderMarket() {
    const root = $('#page-market');
    if (this.err && !this.data) { root.innerHTML = this.errBox(); return; }
    if (!this.data) { root.innerHTML = '<div class="card skeleton"><div class="spin"></div>載入 8 小時 / 日線 / 週線行情中…</div>'; return; }
    const { tk, cs, an } = this.data, name = this.sym().name, tn = this.tfName(this.tf);
    const view = cs.slice(-90), off = cs.length - view.length, sug = an.sug;
    const ma = k => an.ma[k].slice(off);
    root.innerHTML = `
      ${this.guideHtml()}
      ${this.priceCardHtml()}
      ${this.err ? this.errBox() : ''}
      ${this.consensusHtml()}
      ${this.oddsCardHtml()}
      ${this.indCardHtml()}
      <div class="card verdict v-${an.dir}">
        <div class="v-head"><span class="v-tf">${tn} 判讀</span><span class="v-conf">把握度 ${an.strength}</span></div>
        <div class="v-body">${Viz.gauge(an.score)}
          <div class="v-side"><div class="v-score">${an.score > 0 ? '+' : ''}${an.score}<small>/ ±5</small></div>
          <div class="v-title">${name} ${this.lean(an.score)}</div><span class="v-badge">${Signal.DIR_LABEL[an.dir]}</span></div></div>
        <div class="v-why">${esc(an.why)}</div>
        <details class="reasons-d" open><summary>判讀依據(${an.reasons.length} 項)</summary>
          <ul class="reasons">${an.reasons.map(r => `<li class="r-${r.tone}">${esc(r.text)}</li>`).join('')}</ul></details>
      </div>
      ${this.sugCardHtml()}
      <div class="card">
        <div class="card-h"><span class="section-title in">K 線 · ${tn}</span><span class="hint">按住圖左右滑動看數值</span></div>
        ${this.seg('tf', this.TFS, this.tf)}
        <div class="legend"><i class="lg lg-ma20"></i>MA20 <i class="lg lg-ma50"></i>MA50 <i class="lg lg-ma200"></i>MA200 <i class="lg lg-band"></i>建議區間 <i class="lg lg-sup"></i>支撐 <i class="lg lg-res"></i>壓力</div>
        ${Viz.candles({
          cs: view, h: 260, year: this.tf === '1w', intraday: this.tf === '8h',
          overlays: [{ d: ma('ma20'), cls: 'ch-ma20' }, { d: ma('ma50'), cls: 'ch-ma50' }, { d: ma('ma200'), cls: 'ch-ma200' }],
          band: { lo: sug.lower, hi: sug.upper },
          lines: [{ y: tk.price, cls: 'ch-now', label: fmt.n(tk.price, 0) }].concat(this.srLines(cs, this.tf, tk.price)),
          tipExtra: i => `<span class="tip-ma">MA50 ${fmt.n(ma('ma50')[i], 0)} · MA200 ${fmt.n(ma('ma200')[i], 0)}</span>`,
        })}
      </div>
      <p class="fine">訊號只是機率上的參考,不是預測。網格賺的是震盪,方向選錯或趨勢強時會累積虧損倉位,務必控制槓桿與止損。</p>`;
    Viz.bind(root);
  },

  /* ============ 設定 ============ */
  openSettings() {
    const s = Store.settings;
    const seg = (k, opts) => `<div class="segmented">${opts.map(([v, t]) =>
      `<button type="button" data-set="${k}" data-v="${v}" class="${String(s[k]) === String(v) ? 'active' : ''}">${t}</button>`).join('')}</div>`;
    Modal.open(`<h3>設定</h3>
      <label class="lbl">幣種</label>${seg('symbol', [['ETHUSDT', 'ETH'], ['BTCUSDT', 'BTC']])}
      <label class="lbl">外觀</label>${seg('theme', [['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']])}
      <label class="lbl">漲跌顏色</label>${seg('upColor', [['red', '紅漲綠跌'], ['green', '綠漲紅跌']])}
      <div class="f-row">
        <div class="f"><label class="lbl" for="st-fee">單邊手續費 %</label><input id="st-fee" data-set-n="fee" type="number" step="0.001" inputmode="decimal" value="${s.fee}"></div>
        <div class="f"><label class="lbl" for="st-fund">資金費率假設 %/8h</label><input id="st-fund" data-set-n="funding" type="number" step="0.001" inputmode="decimal" value="${s.funding}"></div>
        <div class="f"><label class="lbl" for="st-mmr">維持保證金率 %</label><input id="st-mmr" data-set-n="mmr" type="number" step="0.1" inputmode="decimal" value="${s.mmr}"></div>
      </div>
      <p class="fine in">手續費:預設以派網 0.05% 估算,請對照派網 App 裡實際的費率調整。資金費率正值 = 多方付給空方。</p>
      <div class="row-btns"><button class="btn primary" data-close="1">完成</button></div>`, m => {
      m.addEventListener('click', e => {
        const b = e.target.closest('[data-set]');
        if (!b) return;
        const k = b.dataset.set, v = b.dataset.v;
        $$(`[data-set="${k}"]`, m).forEach(x => x.classList.toggle('active', x === b));
        if (s[k] === v) return;
        s[k] = v; Store.saveSettings(); Theme.apply();
        if (k === 'symbol') { Market._cache = {}; this.data = null; this.load(); }
        else this.go(this.tab);
      });
      m.addEventListener('input', e => {
        const k = e.target.dataset.setN;
        if (k && e.target.value !== '' && !isNaN(+e.target.value)) { s[k] = +e.target.value; Store.saveSettings(); }
      });
      $('.sheet-bg', m).addEventListener('click', () => this.go(this.tab));
      $$('[data-close]', m).forEach(x => x.addEventListener('click', () => this.go(this.tab)));
    });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
