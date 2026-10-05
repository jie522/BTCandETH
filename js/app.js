/* 主程式:四個分頁(行情 / 試算 / 回測 / 我的網格)+ 設定 */
const App = {
  tab: 'market',
  tf: '1d',                 // 行情頁用的 K 線週期
  data: null,               // {tk, cs, an} 最近一次載入的行情與分析
  loading: false,
  err: '',
  bt: { tf: '1h', days: 30, res: null, busy: false },
  TFS: [['8h', '8 小時'], ['1d', '日線'], ['1w', '週線']],
  tier: 'mid',              // 建議參數目前看的風險等級

  sym() { return Market.SYMS[Store.settings.symbol]; },
  opt() { const s = Store.settings; return { fee: s.fee, mmr: s.mmr, price: this.data ? this.data.tk.price : 0 }; },

  init() {
    Store.load();
    Theme.apply();
    hydrateIcons();
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('input', e => this.onInput(e));
    this.go('market');
    this.load();
    setInterval(() => this.tick(), 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  },

  /* ---------- 分頁切換 ---------- */
  go(tab, keepScroll) {
    this.tab = tab;
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $('#hdr-title').textContent = { market: '行情與訊號', calc: '網格試算', backtest: '歷史回測', saved: '我的網格' }[tab];
    $('#hdr-sub').textContent = this.sym().name + ' 永續合約';
    if (tab === 'market') this.renderMarket();
    if (tab === 'calc') this.renderCalc();
    if (tab === 'backtest') this.renderBacktest();
    if (tab === 'saved') this.renderSaved();
    if (!keepScroll) window.scrollTo(0, 0);
  },

  /* 其他頁需要現價時用:沒有就補抓 */
  async ensureData() {
    if (this.data && this.data.sym === Store.settings.symbol) return;
    await this.load();
  },

  /* ---------- 事件 ---------- */
  onClick(e) {
    const seg = e.target.closest('[data-seg]');
    if (seg) return this.onSeg(seg);
    const tab = e.target.closest('.tab');
    if (tab) return this.go(tab.dataset.tab);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act, id = b.dataset.id;
    if (a === 'refresh') { this.load(true); Toast.show('更新行情中…', 1200); }
    else if (a === 'settings') this.openSettings();
    else if (a === 'apply') this.applySuggestion();
    else if (a === 'quick') this.quickRange(+b.dataset.v);
    else if (a === 'save') this.openSave();
    else if (a === 'copy-pionex') this.copyPionex();
    else if (a === 'to-bt') this.go('backtest');
    else if (a === 'to-calc') this.go('calc');
    else if (a === 'run-bt') this.runBacktest();
    else if (a === 'load-grid') this.loadGrid(id);
    else if (a === 'bt-grid') { this.loadGrid(id, 'backtest'); }
    else if (a === 'del-grid') this.deleteGrid(id);
    else if (a === 'edit-grid') this.openEditGrid(id);
    else if (a === 'export') this.exportData();
    else if (a === 'import') this.openImport();
    else if (a === 'add-live') this.openLive();
    else if (a === 'tf-pick') this.pickTf(b.dataset.v);
    else if (a === 'tier') { this.tier = b.dataset.v; const el = $('#sug-card'); if (el) el.outerHTML = this.sugCardHtml(); }
    else if (a === 'guide-done') { Store.settings.guideDone = true; Store.saveSettings(); this.renderMarket(); }
    else if (a === 'go-saved') this.go('saved');
    else if (a === 'fill-safe') this.fillSafe();
    else if (a === 'bt-dir') { Store.params.dir = b.dataset.v; Store.saveParams(); if (this.bt.res) this.bt.res.P.dir = b.dataset.v; this.renderBacktest(); }
    else if (a === 'edit-live') this.openLive(id);
    else if (a === 'tech') this.openTech();
    else if (a === 'tk-jump') { const el = $('#tk-' + b.dataset.v); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  },

  onSeg(el) {
    const k = el.dataset.seg, v = el.dataset.v;
    const P = Store.params;
    if (k === 'tf') { this.pickTf(v); return; }
    if (k === 'tech-tf') { this.techTf = v; this.renderTech(); return; }
    if (k === 'dir' || k === 'mode') { P[k] = v; Store.saveParams(); $$(`[data-seg="${k}"]`).forEach(x => x.classList.toggle('active', x === el)); if (this.bt.res) this.bt.res = null; this.updateCalc(); return; }
    if (k === 'bt-tf') { this.bt.tf = v; this.renderBacktest(); return; }
    if (k === 'bt-days') { this.bt.days = +v; this.renderBacktest(); return; }
  },

  onInput(e) {
    const el = e.target;
    if (el.dataset.p) {
      Store.params[el.dataset.p] = el.value === '' ? '' : +el.value;
      Store.saveParams();
      this.syncInputs(el);
      this.bt.res = null;
      this.updateCalc();
    }
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
      const atrD = tfs['1d'].an.atrPct;
      Object.values(tfs).forEach(t => {
        t.an.profiles = Signal.profiles(t.an, tk.price, atrD, Store.settings.fee, Store.settings.mmr);
        t.an.sug = t.an.profiles[1];
      });
      this.data = { tk, sym, tfs, atrD, at: Date.now(), klAt: Date.now(), h1: null };
      this.loadH1(sym);
      this.loadSent(sym);
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

  TIER_NOTE: {
    low: '區間寬、槓桿低,強平價離區間 20% 以上;單邊走勢也撐得住,賺得慢但穩。方向不夠明確時會自動用中性。',
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
      <button class="btn primary block big" data-act="apply">帶入試算(${p.tierName})→</button>
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
      if (this.tab === 'saved' && !$('#modal')) this.renderSaved();
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

  /* 建議止損:區間外 3%,但一定留在強平價內側(離強平至少 2%),不然止損還沒觸發就先被強平 */
  stops(P, r) {
    let down = NaN, up = NaN;
    if (P.dir !== 'short') {
      let v = P.lower * 0.97;
      if (!isNaN(r.liqDown)) v = Math.max(v, r.liqDown * 1.02);
      if (v < P.lower) down = Grid.nice(v, P.lower);
    }
    if (P.dir !== 'long') {
      let v = P.upper * 1.03;
      if (!isNaN(r.liqUp)) v = Math.min(v, r.liqUp * 0.98);
      if (v > P.upper) up = Grid.nice(v, P.upper);
    }
    return { down, up };
  },

  /* ============ 行情頁元件 ============ */
  guideHtml() {
    if (Store.settings.guideDone) return '';
    return `<div class="card guide">
      <div class="guide-h">三步驟開一組派網網格</div>
      <ol>
        <li><b>看方向</b>:三個週期同方向最可靠;分歧時用中性網格或縮小資金</li>
        <li><b>帶入試算</b>:按「一鍵帶入試算」,用拉桿微調,看風險階梯離強平多遠</li>
        <li><b>回測再下單</b>:比較做多 / 中性 / 做空,照「派網設定對照」填進派網</li>
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

  liveStripHtml() {
    const px = this.data.tk.price;
    const live = Store.grids.filter(g => g.live && g.symbol === Store.settings.symbol);
    if (!live.length) return '';
    return `<button type="button" class="card live-strip" data-act="go-saved">
      <div class="ls-h"><span>我的派網機器人</span><span class="hint">查看 ›</span></div>
      ${live.map(g => {
        const h = this.liveCheck(g, px);
        return `<div class="ls-row"><span class="badge h-${h.level}">${h.label}</span><span class="ls-n">${esc(g.name)}</span>
          <span class="ls-d">距強平 <b class="${h.level === 'bad' ? 'liq' : h.level === 'warn' ? 'warnc' : ''}">${isNaN(h.dist) ? '—' : h.dist.toFixed(1) + '%'}</b></span></div>`;
      }).join('')}</button>`;
  },

  /* 指標儀表卡:週期切換放在卡片最上面,下面是投票結果、技術面、籌碼面 */
  indCardHtml() {
    const { tk, cs, an } = this.data, tn = this.tfName(this.tf);
    const sent = this.sentFor(this.tf);
    const R = Signal.meters(an, cs, sent, tk.funding, this.tf);
    const tot = R.items.length, pct = k => (R.cnt[k] / tot * 100).toFixed(1);
    const L = { up: '偏多', down: '偏空', flat: '中性' };
    const row = m => Viz.meter(Object.assign({}, m, { lean: m.lean, leanText: L[m.lean] + ' · ' + m.leanText }));
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

  /* 每個指標的圖、數值格式、tooltip */
  TECH_VIEW: {
    dmi: { v: q => q.adx, f: v => v.toFixed(0), lean: q => `+DI ${q.pdi.toFixed(0)} / −DI ${q.mdi.toFixed(0)}`,
      series: N => [{ d: N.map(q => q.adx), cls: 'ch-eq' }, { d: N.map(q => q.pdi), cls: 'ch-pdi' }, { d: N.map(q => q.mdi), cls: 'ch-mdi' }],
      lines: [20, 35], legend: '<i class="lg lg-eq"></i>ADX <i class="lg lg-pdi"></i>+DI <i class="lg lg-mdi"></i>−DI',
      tip: q => `<span>ADX ${q.adx.toFixed(1)}</span><span>+DI ${q.pdi.toFixed(1)} · −DI ${q.mdi.toFixed(1)}</span>` },
    ma: { v: q => q.dev, f: v => fmt.pct(v, 1), lean: q => '離 MA200 ' + fmt.pct(q.dev, 1),
      series: N => [{ d: N.map(q => q.price), cls: 'ch-price' }, { d: N.map(q => q.ma50), cls: 'ch-ma50' }, { d: N.map(q => q.ma200), cls: 'ch-ma200' }],
      lines: [], legend: '<i class="lg lg-price"></i>價格 <i class="lg lg-ma50"></i>MA50 <i class="lg lg-ma200"></i>MA200',
      tip: q => `<span>MA50 ${fmt.n(q.ma50, 0)} · MA200 ${fmt.n(q.ma200, 0)}</span><span>離 MA200 ${fmt.pct(q.dev, 1)}</span>` },
    macd: { v: q => q.hist, f: v => (v > 0 ? '+' : '') + fmt.n(v, 2), lean: q => q.hist > 0 ? 'DIF 在 DEA 之上' : 'DIF 在 DEA 之下',
      series: N => [{ d: N.map(q => q.dif), cls: 'ch-dif' }, { d: N.map(q => q.dea), cls: 'ch-dea' }],
      lines: [0], legend: '<i class="lg lg-dif"></i>DIF <i class="lg lg-dea"></i>DEA(交叉 = 柱翻正 / 翻負)',
      tip: q => `<span>DIF ${fmt.n(q.dif, 2)} · DEA ${fmt.n(q.dea, 2)}</span><span>柱 ${(q.hist > 0 ? '+' : '') + fmt.n(q.hist, 2)}</span>` },
    rsi: { v: q => q.rsi, f: v => v.toFixed(0), lean: q => q.rsi >= 70 ? '過熱' : q.rsi <= 30 ? '超賣' : q.rsi >= 55 ? '動能偏強' : q.rsi <= 45 ? '動能偏弱' : '中性',
      series: N => [{ d: N.map(q => q.rsi), cls: 'ch-eq' }], lines: [30, 50, 70], legend: '<i class="lg lg-eq"></i>RSI(14)',
      tip: q => `<span>RSI ${q.rsi.toFixed(1)}</span>` },
    pb: { v: q => q.pb, f: v => v.toFixed(0), lean: q => `帶寬 ${isNaN(q.bwRank) ? '—' : q.bwRank.toFixed(0)} 百分位`,
      series: N => [{ d: N.map(q => q.pb), cls: 'ch-eq' }], lines: [0, 50, 100], legend: '<i class="lg lg-eq"></i>%B(0 = 下軌、100 = 上軌)',
      tip: q => `<span>%B ${q.pb.toFixed(0)}</span><span>帶寬 ${isNaN(q.bwRank) ? '—' : q.bwRank.toFixed(0)} 百分位</span>` },
    atr: { v: q => q.atrPct, f: v => v.toFixed(2) + '%', lean: () => '不參與投票',
      series: N => [{ d: N.map(q => q.atrPct), cls: 'ch-eq' }], lines: [], legend: '<i class="lg lg-eq"></i>ATR(14)÷ 價格',
      tip: q => `<span>ATR ${q.atrPct.toFixed(2)}%</span>` },
  },

  renderTech() {
    const root = $('#tech-body');
    if (!root || !this.data) return;
    const tf = this.techTf, wk = tf === '1w', unit = wk ? '週' : '天';
    const N = Signal.techHistory(this.data.tfs[tf].cs, tf, wk ? 26 : 30), last = N[N.length - 1];
    const lbl = q => (wk ? '週 ' : '') + fmt.date(q.t);
    const L = { up: '偏多', down: '偏空', flat: '中性' }, lc = l => l === 'up' ? 'up' : l === 'down' ? 'down' : '';
    const k = Math.min(7, N.length - 1), prev = N[N.length - 1 - k];
    const sgn = v => (v > 0 ? '+' : '') + v;

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
      <p class="fine in">每${unit}一個節點,5 項技術指標各投一票(ATR 不投),淨值 = 偏多票 − 偏空票。籌碼面 Binance 只保留 30 天且粒度不同,不列入。</p>
    </div>`;

    /* 重要度排名總覽 */
    const stars = s => '★'.repeat(s) + '<span class="st-off">' + '★'.repeat(5 - s) + '</span>';
    const rank = `<div class="card">
      <div class="section-title in">重要度排名(以開合約網格的角度)</div>
      <p class="tk-logic">先問<b>能不能開</b>(ADX)→ <b>往哪開</b>(均線)→ <b>動能有沒有在轉</b>(MACD)→ <b>進場時機</b>(RSI、布林)→ <b>格子尺寸</b>(ATR)</p>
      ${Signal.TECH.map((d, i) => {
        const l = d.vote ? last.lean[d.key] : null, V = this.TECH_VIEW[d.key];
        return `<button type="button" class="tk-row" data-act="tk-jump" data-v="${d.key}">
          <i class="tk-rank">${i + 1}</i><span class="tk-rn"><b>${d.name}</b><small>${d.role}</small></span>
          <span class="tk-rr"><span class="stars">${stars(d.stars)}</span>${l ? `<span class="lean-chip ln-${l}">${L[l]}</span>` : `<span class="lean-chip">${V.f(V.v(last))}</span>`}</span></button>`;
      }).join('')}
    </div>`;

    /* 各指標 */
    const cards = Signal.TECH.map((d, r) => {
      const V = this.TECH_VIEW[d.key], vals = N.map(V.v), ok = vals.filter(v => !isNaN(v));
      const a = V.v(prev), b = V.v(last), rng = (Math.max(...ok) - Math.min(...ok)) || 1;
      const dir = Math.abs(b - a) < rng * 0.1 ? '持平' : b > a ? '上升' : '下降';
      const lines = [`近 ${k} ${unit}:${V.f(a)} → <b>${V.f(b)}</b>,${dir}`];
      let strip = '';
      if (d.vote) {
        const ls = N.map(q => q.lean[d.key]), cur = ls[ls.length - 1];
        let st = 1; while (st < ls.length && ls[ls.length - 1 - st] === cur) st++;
        let fj = -1; for (let j = ls.length - 1; j > 0; j--) if (ls[j] !== ls[j - 1]) { fj = j; break; }
        const c7 = { up: 0, down: 0, flat: 0 }; ls.slice(-k).forEach(l => c7[l]++);
        lines.push(`已連續 <b class="${lc(cur)}">${st} ${unit}${L[cur]}</b>${fj > 0 ? `;最近一次轉向:${lbl(N[fj])} 由${L[ls[fj - 1]]}轉${L[ls[fj]]}` : `;${N.length} ${unit}內都沒有轉向`}`);
        lines.push(`近 ${k} ${unit}:偏多 ${c7.up} · 中性 ${c7.flat} · 偏空 ${c7.down}`);
        strip = `${Viz.nodes(ls, N.map(q => lbl(q) + ' ' + L[q.lean[d.key]]))}
          <div class="nd-x"><span>${lbl(N[0])}</span><span>每格 = 1 ${unit}</span><span>${lbl(last)}</span></div>`;
      }
      const cl = d.vote ? last.lean[d.key] : 'flat';
      return `<div class="card tk-card" id="tk-${d.key}">
        <div class="tk-head"><i class="tk-rank">${r + 1}</i><span class="tk-rn"><b>${d.name}</b><span class="stars">${stars(d.stars)}</span></span><b class="tk-val">${V.f(b)}</b></div>
        <div class="tk-lean"><span class="lean-chip ln-${cl}">${d.vote ? L[cl] + ' · ' : ''}${V.lean(last)}</span><span class="tk-role">${d.role}</span></div>
        <div class="legend">${V.legend}</div>
        ${Viz.line({ series: V.series(N), lines: V.lines.map(y => ({ y, cls: 'ch-th', label: String(y) })), h: 150, x: [lbl(N[0]), lbl(last)],
          yfmt: V.lines.length ? () => '' : undefined },
          i => { const q = N[i], l = q.lean[d.key]; return `<b>${lbl(q)}</b><span>價格 ${fmt.price(q.price)}</span>${V.tip(q)}${d.vote ? `<span class="${lc(l)}">${L[l]}</span>` : ''}`; })}
        ${strip}
        <ul class="tk-trend">${lines.map(t => `<li>${t}</li>`).join('')}</ul>
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
      const cs = T[t].cs, A = Signal.advice(t, T[t].an, Signal.techHistory(cs, t, t === '1w' ? 26 : 30));
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
      ${this.liveStripHtml()}
      ${this.consensusHtml()}
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
        <div class="legend"><i class="lg lg-ma20"></i>MA20 <i class="lg lg-ma50"></i>MA50 <i class="lg lg-ma200"></i>MA200 <i class="lg lg-band"></i>建議區間</div>
        ${Viz.candles({
          cs: view, h: 260, year: this.tf === '1w', intraday: this.tf === '8h',
          overlays: [{ d: ma('ma20'), cls: 'ch-ma20' }, { d: ma('ma50'), cls: 'ch-ma50' }, { d: ma('ma200'), cls: 'ch-ma200' }],
          band: { lo: sug.lower, hi: sug.upper },
          lines: [{ y: tk.price, cls: 'ch-now', label: fmt.n(tk.price, 0) }],
          tipExtra: i => `<span class="tip-ma">MA50 ${fmt.n(ma('ma50')[i], 0)} · MA200 ${fmt.n(ma('ma200')[i], 0)}</span>`,
        })}
      </div>
      <p class="fine">訊號只是機率上的參考,不是預測。網格賺的是震盪,方向選錯或趨勢強時會累積虧損倉位,務必控制槓桿與止損。</p>`;
    Viz.bind(root);
  },

  /* ============ 試算頁 ============ */
  renderCalc() {
    const P = Store.params;
    const px = this.data ? this.data.tk.price : ((+P.lower + +P.upper) / 2 || 0);
    const pr = px ? { min: Grid.nice(px * 0.5, px), max: Grid.nice(px * 1.5, px), step: Math.pow(10, Math.floor(Math.log10(px)) - 3) } : null;
    const sl = (k, min, max, step) => `<input type="range" class="slider" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${P[k]}" aria-label="${k}">`;
    const dirBtn = (d, t, sub) => `<button type="button" data-seg="dir" data-v="${d}" class="dir-btn d-${d}${P.dir === d ? ' active' : ''}"><b>${t}</b><small>${sub}</small></button>`;
    $('#page-calc').innerHTML = `
      <div class="card step">
        <div class="step-h"><i>1</i>方向</div>
        <div class="dir-seg">${dirBtn('long', '做多', '緩漲 / 回檔')}${dirBtn('neutral', '中性', '區間震盪')}${dirBtn('short', '做空', '緩跌 / 反彈')}</div>
      </div>
      <div class="card step">
        <div class="step-h"><i>2</i>價格區間<span class="step-v" id="v-range"></span></div>
        <div class="f-row">
          <div class="f"><label class="lbl" for="p-lower">下限</label><input id="p-lower" data-p="lower" type="number" inputmode="decimal" value="${P.lower}"></div>
          <div class="f"><label class="lbl" for="p-upper">上限</label><input id="p-upper" data-p="upper" type="number" inputmode="decimal" value="${P.upper}"></div>
        </div>
        ${pr ? `<div class="sl-pair"><span>下限</span>${sl('lower', pr.min, pr.max, pr.step)}</div><div class="sl-pair"><span>上限</span>${sl('upper', pr.min, pr.max, pr.step)}</div>` : ''}
        <div class="chips">
          ${this.data ? `<button class="chip accent-chip" data-act="apply">用建議參數(${(Signal.TIERS.find(t => t.key === this.tier) || {}).name})</button>` : ''}
          <button class="chip" data-act="quick" data-v="5">現價 ±5%</button>
          <button class="chip" data-act="quick" data-v="10">±10%</button>
          <button class="chip" data-act="quick" data-v="15">±15%</button>
          <button class="chip" data-act="quick" data-v="25">±25%</button>
        </div>
        <label class="lbl">格線間距</label>
        ${this.seg('mode', [['arith', '等差(價差相同)'], ['geo', '等比(漲幅相同)']], P.mode)}
      </div>
      <div class="card step">
        <div class="step-h"><i>3</i>格數與槓桿</div>
        <div class="sl-row"><span>格數</span>${sl('n', 2, 200, 1)}<input class="num" data-p="n" type="number" inputmode="numeric" value="${P.n}" aria-label="格數"></div>
        <div class="sl-row"><span>槓桿</span>${sl('lev', 1, 100, 1)}<input class="num" data-p="lev" type="number" inputmode="decimal" value="${P.lev}" aria-label="槓桿"></div>
      </div>
      <div class="card step">
        <div class="step-h"><i>4</i>資金</div>
        <div class="f-row">
          <div class="f"><label class="lbl" for="p-cap">投資額 USDT</label><input id="p-cap" data-p="capital" type="number" inputmode="decimal" value="${P.capital}"></div>
          <div class="f"><label class="lbl" for="p-extra">額外保證金 USDT</label><input id="p-extra" data-p="extra" type="number" inputmode="decimal" value="${P.extra || 0}"></div>
        </div>
        <div class="chips" id="safe-chip"></div>
      </div>
      <div id="calc-out"></div>
      <div id="calc-sticky" class="sticky-sum"></div>`;
    this.updateCalc();
    if (!this.data) this.ensureData().then(() => this.tab === 'calc' && this.renderCalc());
  },

  quickRange(pct) {
    const px = this.data ? this.data.tk.price : 0;
    if (!px) { Toast.show('還沒有現價,請稍候再試'); return; }
    const P = Store.params;
    P.lower = Grid.nice(px * (1 - pct / 100), px);
    P.upper = Grid.nice(px * (1 + pct / 100), px);
    Store.saveParams();
    this.syncInputs();
    this.updateCalc();
  },

  /* 拉桿與數字框是同一個參數:改一個,另一個跟著變 */
  syncInputs(except) {
    const P = Store.params;
    $$('[data-p]').forEach(x => { if (x !== except && P[x.dataset.p] !== undefined) x.value = P[x.dataset.p]; });
  },

  fillSafe() {
    const P = Store.params, r = Grid.calc(P, this.opt());
    if (!(r.topUp > 0.5)) return;
    P.extra = Math.ceil((+P.extra || 0) + r.topUp);
    Store.saveParams(); this.syncInputs(); this.updateCalc();
    Toast.show('額外保證金已補到 ' + P.extra + ' USDT');
  },

  updateCalc() {
    const out = $('#calc-out'), st = $('#calc-sticky');
    if (!out) return;
    const P = Store.params, err = Grid.validate(P);
    const vr = $('#v-range');
    if (vr) vr.textContent = err ? '' : '寬 ' + ((P.upper / P.lower - 1) * 100).toFixed(1) + '%';
    if (err) {
      out.innerHTML = `<div class="card muted-card">${esc(err)}</div>`;
      st.innerHTML = `<span class="warn-t">${esc(err)}</span>`;
      $('#safe-chip').innerHTML = '';
      return;
    }
    const o = this.opt(), r = Grid.calc(P, o), px = o.price;
    const k = this.risk(P.dir, r.liqDown, r.liqUp, px, P.lower, P.upper);
    const sp = this.stops(P, r);
    $('#safe-chip').innerHTML = r.topUp > 0.5
      ? `<button class="chip warn-chip" data-act="fill-safe">強平離區間不到 10%:一鍵補額外保證金 +${fmt.n(Math.ceil(r.topUp), 0)}</button>` : '<span class="ok-t">保證金足夠,強平價離區間 10% 以上</span>';

    const rows = [
      { y: P.upper, label: '上限', cls: 'l-edge' }, { y: P.lower, label: '下限', cls: 'l-edge' },
      { y: px, label: '現價', cls: 'l-now', now: true },
      { y: sp.down, label: '建議止損', cls: 'l-stop' }, { y: sp.up, label: '建議止損', cls: 'l-stop' },
      { y: r.liqDown, label: '強平', cls: 'l-liq' }, { y: r.liqUp, label: '強平', cls: 'l-liq' },
    ];
    const zoneOf = (a, b) => {
      const m = (a.y + b.y) / 2;
      if (m >= P.lower && m <= P.upper) return 'z-grid';
      if ((r.liqDown > 0 && m < r.liqDown) || (r.liqUp > 0 && m > r.liqUp)) return 'z-dead';
      if (m < P.lower || m > P.upper) return 'z-risk';
      return '';
    };
    const src = this.data ? this.data.tfs['8h'].cs.slice(-90) : [];
    const lvStep = Math.ceil(r.levels.length / 60);
    const lines = r.levels.filter((y, i) => i % lvStep === 0).map(y => ({ y, cls: 'ch-lvl', range: true }));
    lines.push({ y: P.lower, cls: 'ch-edge', label: fmt.n(P.lower, 0) }, { y: P.upper, cls: 'ch-edge', label: fmt.n(P.upper, 0) });
    if (!isNaN(r.liqDown)) lines.push({ y: r.liqDown, cls: 'ch-liq', label: fmt.n(r.liqDown, 0) });
    if (!isNaN(r.liqUp)) lines.push({ y: r.liqUp, cls: 'ch-liq', label: fmt.n(r.liqUp, 0) });
    if (px) lines.push({ y: px, cls: 'ch-now', label: fmt.n(px, 0) });

    out.innerHTML = `
      <div class="card risk-card r-${k.level}">
        <div class="rc-head"><b>風險階梯</b><span class="badge h-${k.level}">${k.label}</span></div>
        <div class="rc-sum">${isNaN(k.dist) ? '' : `現價離強平 <b class="${k.level === 'bad' ? 'liq' : k.level === 'warn' ? 'warnc' : ''}">${k.dist.toFixed(1)}%</b>${this.data && this.data.atrD ? `,約 ${(k.dist / this.data.atrD).toFixed(1)} 天的日均波動` : ''}`}</div>
        ${Viz.ladder(rows, px, zoneOf)}
        <div class="ld-legend"><span><i class="z-grid"></i>網格區間</span><span><i class="z-risk"></i>出區間、還沒強平</span><span><i class="z-dead"></i>強平</span></div>
      </div>
      ${r.warns.map(w => `<div class="warn w-${w.level}">${esc(w.text)}</div>`).join('')}
      <div class="kpi-grid">
        ${this.kpi('每格淨利(扣手續費)', r.netAvg.toFixed(2) + '%', fmt.cls(r.netAvg), '≈ ' + fmt.usd(r.perCellUsd, 2) + ' USDT / 次')}
        ${this.kpi('每格漲幅', P.mode === 'geo' || r.gapMin === r.gapMax ? r.gapAvg.toFixed(2) + '%' : r.gapMin.toFixed(2) + '~' + r.gapMax.toFixed(2) + '%', '', '兩條格線的價差')}
        ${this.kpi('實際槓桿', r.effLev.toFixed(1) + 'x', r.effLev > 5 ? 'warnc' : '', '全部成交時 · 名目 ' + fmt.n(r.notional, 0) + ' U')}
        ${this.kpi('總保證金', fmt.n(r.M, 0) + ' U', '', '投資額 + 額外保證金')}
      </div>
      <div class="card">
        <div class="card-h"><span class="section-title in">格線 · 近 30 天 8 小時 K</span><span class="hint">按住滑動</span></div>
        <div class="legend"><i class="lg lg-lvl"></i>格線 <i class="lg lg-edge"></i>上下限 <i class="lg lg-liq"></i>強平 <i class="lg lg-now"></i>現價</div>
        ${src.length ? Viz.candles({ cs: src, lines, band: { lo: P.lower, hi: P.upper }, h: 260, intraday: true }) : ''}
        <details class="lv"><summary>全部 ${r.levels.length} 條格線價</summary>
          <div class="lv-grid">${r.levels.map((y, i) => `<span class="${px && y <= px ? 'below' : ''}">${i}. ${fmt.n(y, 2)}</span>`).join('')}</div>
        </details>
      </div>
      ${this.pionexHtml(P, r)}
      <div class="row-btns">
        <button class="btn" data-act="save">儲存這組</button>
        <button class="btn primary" data-act="to-bt">去回測 →</button>
      </div>
      <p class="fine">強平價為簡化估算(逐倉、最壞情況、維持保證金率 ${Store.settings.mmr}%),通常比派網顯示高 1~3%,實際以派網為準。</p>`;
    st.innerHTML = `<span class="badge h-${k.level}">${k.label}</span>
      <span>每格 <b class="${fmt.cls(r.netAvg)}">${r.netAvg.toFixed(2)}%</b></span>
      <span>強平 <b class="liq">${isNaN(k.liq) ? '—' : fmt.n(k.liq, 0)}</b></span>
      <span>距離 <b>${isNaN(k.dist) ? '—' : k.dist.toFixed(1) + '%'}</b></span>`;
    Viz.bind(out);
  },

  pionexRows(P, r) {
    const dirT = { long: '做多', short: '做空', neutral: '中性' }[P.dir];
    const s = this.stops(P, r);
    const sl = [!isNaN(s.down) && `跌破 ${fmt.n(s.down, 0)}`, !isNaN(s.up) && `漲破 ${fmt.n(s.up, 0)}`].filter(Boolean).join(' / ') || '降低槓桿後再設';
    return [
      ['交易對', this.sym().name + '/USDT 永續'],
      ['策略', '合約網格 · ' + dirT],
      ['價格區間 下限', fmt.n(P.lower, 2)],
      ['價格區間 上限', fmt.n(P.upper, 2)],
      ['網格數量', P.n],
      ['網格模式', P.mode === 'geo' ? '等比' : '等差'],
      ['槓桿', P.lev + 'x'],
      ['投資額', fmt.n(P.capital, 2) + ' USDT'],
      ['額外保證金', fmt.n(+P.extra || 0, 2) + ' USDT' + (r.topUp > 0.5 ? `(建議 ≥ ${fmt.n((+P.extra || 0) + r.topUp, 0)})` : '')],
      ['止損價(建議)', sl],
    ];
  },

  /* ============ 回測頁 ============ */
  renderBacktest() {
    const P = Store.params, root = $('#page-backtest'), b = this.bt;
    const err = Grid.validate(P);
    root.innerHTML = `
      <div class="card">
        <div class="bt-sum"><span>${err ? `<span class="warn-t">${esc(err)}</span>` :
          `<span class="badge b-${P.dir}">${Signal.DIR_LABEL[P.dir]}</span> ${fmt.n(P.lower, 0)}~${fmt.n(P.upper, 0)} · ${P.n} 格 · ${fmt.n(P.capital, 0)}U × ${P.lev}x${+P.extra ? ' + 額外 ' + fmt.n(+P.extra, 0) + 'U' : ''}`}</span>
          <button class="chip" data-act="to-calc">改參數</button></div>
        <label class="lbl">回測天數</label>
        ${this.seg('bt-days', [[7, '7 天'], [14, '14 天'], [30, '30 天'], [60, '60 天'], [90, '90 天']], b.days)}
        <label class="lbl">K 線週期(越細越接近真實成交)</label>
        ${this.seg('bt-tf', [['15m', '15 分'], ['1h', '1 小時'], ['4h', '4 小時']], b.tf)}
        <button class="btn primary block big" data-act="run-bt" ${b.busy || err ? 'disabled' : ''}>${b.busy ? '回測中…' : '開始回測'}</button>
      </div>
      <div id="bt-out">${b.res ? this.btHtml(b.res) : '<div class="card muted-card">按「開始回測」,會用過去真實 K 線,<br>同時跑做多 / 中性 / 做空三種方向給你比較。</div>'}</div>`;
    Viz.bind(root);
  },

  btHtml(B) {
    const { res, cs, P } = B, r = res[P.dir], M = Grid.margin(P);
    const dirs = [['long', '做多'], ['neutral', '中性'], ['short', '做空']];
    const best = dirs.map(d => d[0]).sort((a, b) => res[b].ret - res[a].ret)[0];
    const view = Viz.aggregate(cs, 120);
    const lvStep = Math.ceil(r.levels.length / 60);
    const lines = r.levels.filter((y, i) => i % lvStep === 0).map(y => ({ y, cls: 'ch-lvl' }));
    lines.push({ y: P.lower, cls: 'ch-edge', label: fmt.n(P.lower, 0) }, { y: P.upper, cls: 'ch-edge', label: fmt.n(P.upper, 0) });
    const grid = r.realized + r.fees + r.funding;
    const intr = B.tf !== '1d';
    return `
      ${r.liquidated ? `<div class="warn w-bad">這組參數用「${Signal.DIR_LABEL[P.dir]}」在回測期間被強平(約第 ${r.liqIndex + 1} / ${cs.length} 根 K 線),保證金歸零。</div>` : ''}
      <div class="card">
        <div class="card-h"><span class="section-title in">三種方向比較 · 過去 ${B.days} 天</span><span class="hint">點一列切換</span></div>
        ${Viz.bars(dirs.map(([d, t]) => ({
          label: t + (d === best ? ' <span class="crown">最佳</span>' : ''), v: res[d].ret, text: fmt.pct(res[d].ret, 1),
          sub: '回撤 ' + res[d].maxDD.toFixed(0) + '%' + (res[d].liquidated ? ' · 強平' : ''),
          act: `data-act="bt-dir" data-v="${d}"`, cur: d === P.dir,
        })))}
        <p class="fine in">期間價格 ${fmt.pct(r.priceChg, 1)}。上漲段做多占優、下跌段做空占優是必然,不代表下一段也是;中性通常最穩。</p>
      </div>
      <div class="kpi-grid">
        ${this.kpi('總利潤', fmt.pct(r.ret), fmt.cls(r.ret), fmt.usd(r.pnl, 2, true) + ' USDT(以投資額計)')}
        ${this.kpi('最大回撤', r.maxDD.toFixed(1) + '%', r.maxDD > 20 ? 'liq' : '', '權益從高點回落')}
        ${this.kpi('套利次數', r.closed + ' 次', '', '平均每天 ' + (r.closed / B.days).toFixed(1) + ' 次')}
        ${this.kpi('價格在區間內', r.inRange.toFixed(0) + '%', r.inRange < 70 ? 'warnc' : '', '時間比例')}
      </div>
      <div class="card">
        <div class="section-title in">盈虧構成(跟派網報告同一種拆法)</div>
        ${Viz.bars([
          { label: '網格利潤', v: grid, text: fmt.usd(grid, 2, true) },
          { label: '手續費', v: -r.fees, text: fmt.usd(-r.fees, 2, true) },
          { label: '資金費', v: -r.funding, text: fmt.usd(-r.funding, 2, true), sub: Store.settings.funding + '%/8h 假設' },
          { label: '趨勢盈虧', v: r.unreal, text: fmt.usd(r.unreal, 2, true), sub: r.held + ' 格持倉 · 底倉 ' + r.baseCells + ' 格' },
          { label: '<b>總利潤</b>', v: r.pnl, text: fmt.usd(r.pnl, 2, true), cur: true },
        ])}
      </div>
      <div class="card">
        <div class="card-h"><span class="section-title in">權益曲線</span><span class="hint">按住滑動</span></div>
        ${Viz.line({ series: [{ d: r.eq, cls: 'ch-eq' }], lines: [{ y: M, cls: 'ch-now', label: '本金' }], h: 170,
          yfmt: v => fmt.n(v, 0), x: [fmt.date(cs[0].t), fmt.date(cs[cs.length - 1].t)] },
          i => `<b>${fmt.date(cs[i].t, true)}${intr ? ' ' + new Date(cs[i].t).toTimeString().slice(0, 5) : ''}</b><span>權益 ${fmt.n(r.eq[i], 2)}</span><span class="${fmt.cls(r.eq[i] - M)}">${fmt.usd(r.eq[i] - M, 2, true)} U</span><span>價格 ${fmt.price(cs[i].c)}</span>`)}
      </div>
      <div class="card">
        <div class="card-h"><span class="section-title in">回測期間 K 線與格線</span><span class="hint">按住滑動</span></div>
        ${Viz.candles({ cs: view, lines, band: { lo: P.lower, hi: P.upper }, h: 240, intraday: intr })}
      </div>
      <p class="fine">回測為理想化:成交價 = 格線價、無滑價、資金費率用固定假設、假設掛單都排得到隊。實盤通常會比回測差一些。</p>`;
  },

  gridCard(g, px) {
    if (g.live) return this.liveCard(g, px);
    const same = px && g.symbol === Store.settings.symbol;
    const cal = Grid.calc(g, { fee: Store.settings.fee, mmr: Store.settings.mmr, price: px || g.lower });
    return `<div class="card g-card">
      <div class="g-head"><b>${esc(g.name)}</b><span class="badge b-${g.dir}">${Signal.DIR_LABEL[g.dir]} ${g.lev}x</span></div>
      <div class="g-meta">${Market.SYMS[g.symbol] ? Market.SYMS[g.symbol].name : g.symbol} · 試算方案 · ${g.mode === 'geo' ? '等比' : '等差'} · ${g.n} 格 · 投資 ${fmt.n(g.capital, 0)}U${+g.extra ? ' + 額外 ' + fmt.n(+g.extra, 0) + 'U' : ''} · 每格 ${cal.netAvg.toFixed(2)}%</div>
      ${same ? Viz.rangeBar({ lower: g.lower, upper: g.upper, price: px, liqDown: g.dir !== 'short' ? cal.liqDown : NaN, liqUp: g.dir !== 'long' ? cal.liqUp : NaN }) : ''}
      ${g.note ? `<div class="g-note">${esc(g.note)}</div>` : ''}
      <div class="row-btns tight">
        <button class="btn sm" data-act="load-grid" data-id="${g.id}">試算</button>
        <button class="btn sm" data-act="bt-grid" data-id="${g.id}">回測</button>
        <button class="btn sm ghost" data-act="edit-grid" data-id="${g.id}">備註</button>
        <button class="btn sm ghost danger-t" data-act="del-grid" data-id="${g.id}">刪除</button>
      </div>
    </div>`;
  },

  /* 健康檢查:強平距離、強平價離區間多遠、要補多少保證金
   * 有填派網顯示的強平價就用派網的(最準),沒填才用自己的估算 */
  liveCheck(g, px) {
    const r = Grid.calc(g, { fee: Store.settings.fee, mmr: Store.settings.mmr, price: px, start: g.open });
    let ld = g.dir === 'short' ? NaN : r.liqDown, lu = g.dir === 'long' ? NaN : r.liqUp;
    if (g.pxLiq > 0) {
      if (g.dir === 'long' || (g.dir === 'neutral' && g.pxLiq < px)) ld = g.pxLiq; else lu = g.pxLiq;
    }
    const k = this.risk(g.dir, ld, lu, px, g.lower, g.upper);
    const days = this.data && this.data.atrD && !isNaN(k.dist) ? k.dist / this.data.atrD : NaN;
    const tips = [];
    if (k.edge < 10) tips.push(`強平價只在區間${k.side === 'up' ? '上限上方' : '下限下方'} ${k.edge.toFixed(1)}%:價格一跑出區間很快就會被強平,網格來不及「等回來」`);
    if (k.dist < 20) tips.push(`現價離強平 ${k.dist.toFixed(1)}%${isNaN(days) ? '' : `,約 ${days.toFixed(1)} 天的日均波動`}`);
    if (r.topUp > 0.5) tips.push(`要讓強平價離區間 10%,額外保證金約需再補 ${fmt.n(r.topUp, 0)} USDT;不想補的話,可以用較低槓桿重開`);
    if (r.effLev > 5) tips.push(`全部格子成交時實際槓桿約 ${r.effLev.toFixed(1)}x(已算額外保證金)`);
    if (px < g.lower || px > g.upper) tips.push('現價已經在區間外,網格停止套利,只剩趨勢盈虧在跑');
    if (!tips.length) tips.push('強平距離充足,區間與保證金配置合理');
    return { r, liq: k.liq, dist: k.dist, edgeGap: k.edge, days, level: k.level, label: k.label, tips, ld, lu };
  },

  liveCard(g, px) {
    const same = g.symbol === Store.settings.symbol;
    const h = same && px ? this.liveCheck(g, px) : null;
    return `<div class="card g-card live-${h ? h.level : 'ok'}">
      <div class="g-head"><b>${esc(g.name)}</b><span><span class="badge b-${g.dir}">${Signal.DIR_LABEL[g.dir]} ${g.lev}x</span>${h ? ` <span class="badge h-${h.level}">${h.label}</span>` : ''}</span></div>
      <div class="g-meta">派網運行中 · ${g.n} 格 · 投資 ${fmt.n(g.capital, 2)}U + 額外 ${fmt.n(+g.extra || 0, 2)}U · 開單 ${fmt.n(g.open, 2)}</div>
      ${h ? `${Viz.rangeBar({ lower: g.lower, upper: g.upper, price: px, liqDown: h.ld, liqUp: h.lu })}
      <div class="kpi-grid mini">
        ${this.kpi('強平價' + (g.pxLiq > 0 ? '(派網)' : '(估算)'), fmt.n(h.liq, 0), 'liq')}
        ${this.kpi('現價距強平', isNaN(h.dist) ? '—' : h.dist.toFixed(1) + '%', h.dist < 10 ? 'liq' : h.dist < 20 ? 'warnc' : '', isNaN(h.days) ? '' : '≈ ' + h.days.toFixed(1) + ' 天日均波動')}
      </div>
      <ul class="reasons tips">${h.tips.map(t => `<li class="r-${h.level === 'ok' ? 'up' : 'warn'}">${esc(t)}</li>`).join('')}</ul>` :
        `<div class="g-meta">切到 ${Market.SYMS[g.symbol] ? Market.SYMS[g.symbol].name : g.symbol} 才能做健康檢查</div>`}
      ${g.note ? `<div class="g-note">${esc(g.note)}</div>` : ''}
      <div class="row-btns tight">
        <button class="btn sm" data-act="edit-live" data-id="${g.id}">更新</button>
        <button class="btn sm" data-act="load-grid" data-id="${g.id}">試算</button>
        <button class="btn sm" data-act="bt-grid" data-id="${g.id}">回測</button>
        <button class="btn sm ghost danger-t" data-act="del-grid" data-id="${g.id}">刪除</button>
      </div>
    </div>`;
  },

  applySuggestion() {
    const s = this.data.an.profiles.find(p => p.tier === this.tier) || this.data.an.sug;
    Object.assign(Store.params, { dir: s.dir, mode: s.mode, lower: s.lower, upper: s.upper, n: s.n, lev: s.lev });
    Store.saveParams();
    this.bt.res = null;
    Toast.show('已帶入' + (s.tierName || '建議') + '參數');
    this.go('calc');
  },

  pionexHtml(P, r) {
    const rows = this.pionexRows(P, r);
    return `<div class="card">
      <div class="section-title in">派網 Pionex 設定對照(合約網格 → 手動設定)</div>
      <table class="tbl">${rows.map(([k, v]) => `<tr><td>${k}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>
      <button class="btn block" data-act="copy-pionex">複製這組設定</button>
      <p class="fine in">派網顯示的「每格利潤」應接近上方的每格淨利 ${r.netAvg.toFixed(2)}%;差很多代表手續費設定不同,可到右上設定調整。強平價以派網建立前顯示的為準。</p>
    </div>`;
  },
  copyPionex() {
    const P = Store.params;
    if (Grid.validate(P)) return;
    const r = Grid.calc(P, this.opt());
    const text = this.pionexRows(P, r).map(([k, v]) => k + ':' + v).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => Toast.show('已複製,切到派網照著填'), () => Toast.show('複製失敗,請手動抄'));
    else Toast.show('這個瀏覽器不支援複製');
  },

  async runBacktest() {
    const P = Store.params, b = this.bt;
    if (Grid.validate(P)) return;
    const ms = Market.TF_MS[b.tf];
    let days = b.days;
    const maxC = 3000;
    if (days * 864e5 / ms > maxC) { days = Math.floor(maxC * ms / 864e5); Toast.show(`${b.tf} 最多回測 ${days} 天,已自動縮短`); }
    b.busy = true; this.renderBacktest();
    try {
      const need = Math.round(days * 864e5 / ms);
      const cs = await Market.klines(Store.settings.symbol, b.tf, need);
      if (cs.length < 20) throw new Error('K 線太少');
      const o = { fee: Store.settings.fee, mmr: Store.settings.mmr, funding: Store.settings.funding, candleMs: ms };
      const res = {};
      ['long', 'neutral', 'short'].forEach(d => { res[d] = Grid.backtest(Object.assign({}, P, { dir: d }), cs, o); });
      b.res = { res, cs, P: Object.assign({}, P), tf: b.tf, days };
    } catch (e) {
      b.res = null; Toast.show('回測失敗:' + (e.message || e), 3500);
    }
    b.busy = false;
    if (this.tab === 'backtest') this.renderBacktest();
  },

  /* ============ 我的網格 ============ */
  async renderSaved() {
    const root = $('#page-saved');
    const px = this.data ? this.data.tk.price : 0;
    const list = Store.grids;
    root.innerHTML = `
      ${list.length ? list.map(g => this.gridCard(g, px)).join('') :
        '<div class="card muted-card">還沒有儲存的網格。<br>在「試算」頁調好參數後按「儲存這組」,<br>或把派網上正在跑的機器人登錄進來做健康檢查。</div>'}
      <button class="btn primary block" data-act="add-live">＋ 登錄派網上正在跑的機器人</button>
      <div class="row-btns">
        <button class="btn" data-act="export">匯出備份</button>
        <button class="btn" data-act="import">匯入</button>
      </div>
      <p class="fine">資料只存在這支手機的瀏覽器裡。換手機或清除瀏覽資料前,請先「匯出備份」。</p>`;
    if (!px) this.ensureData().then(() => this.tab === 'saved' && this.renderSaved());
  },

  /* ---------- 派網機器人健康檢查 ---------- */
  LIVE_FIELDS: [
    ['lev', '槓桿 x'], ['n', '網格數量'], ['lower', '價格區間 下限'], ['upper', '價格區間 上限'],
    ['capital', '實際投資額 USDT'], ['extra', '額外保證金 USDT'],
    ['open', '開單時價格'], ['pxLiq', '派網預估強平價(選填)'],
  ],
  openLive(id) {
    const g = id ? Store.grids.find(x => x.id === id) : null;
    const v = g || { dir: 'long', mode: 'arith', lev: '', lower: '', upper: '', n: '', capital: '', extra: 0, open: '', pxLiq: '' };
    const inputs = this.LIVE_FIELDS.map(([k, t]) =>
      `<div class="f"><label class="lbl" for="lv-${k}">${t}</label><input id="lv-${k}" type="number" inputmode="decimal" value="${v[k] == null ? '' : v[k]}"></div>`).join('');
    const segBtns = (opts, cur) => opts.map(([d, t]) => `<button type="button" data-v="${d}" class="${cur === d ? 'active' : ''}">${t}</button>`).join('');
    Modal.open(`<h3>${g ? '更新' : '登錄'}派網機器人</h3>
      <p class="fine in">照派網「機器人 → 訂單詳情 → 報告」上的數字填。</p>
      <label class="lbl">方向</label>
      <div class="segmented" id="lv-dir">${segBtns([['long', '做多'], ['neutral', '中性'], ['short', '做空']], v.dir)}</div>
      <label class="lbl">網格模式</label>
      <div class="segmented" id="lv-mode">${segBtns([['arith', '等差'], ['geo', '等比']], v.mode || 'arith')}</div>
      <div class="f-wrap">${inputs}</div>
      <label class="lbl" for="lv-name">名稱</label><input id="lv-name" value="${esc(g ? g.name : '')}" placeholder="例如:ETH 做多 10x">
      <div class="row-btns"><button class="btn ghost" data-close="1">取消</button><button class="btn primary" id="lv-ok">儲存</button></div>`, m => {
      ['#lv-dir', '#lv-mode'].forEach(sel => $(sel, m).addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        $('button', $(sel, m)).forEach(x => x.classList.toggle('active', x === b));
      }));
      $('#lv-ok', m).onclick = () => {
        const rec = {
          live: true, symbol: g ? g.symbol : Store.settings.symbol,
          dir: $('#lv-dir .active', m).dataset.v, mode: $('#lv-mode .active', m).dataset.v,
        };
        this.LIVE_FIELDS.forEach(([k]) => { const x = $('#lv-' + k, m).value; rec[k] = x === '' ? '' : +x; });
        if (rec.extra === '') rec.extra = 0;
        const err = Grid.validate(rec) || (!(rec.open > 0) ? '請填開單時價格' : '');
        if (err) { Toast.show(err); return; }
        rec.name = $('#lv-name', m).value.trim() || `${this.sym().name} ${Signal.DIR_LABEL[rec.dir]} ${rec.lev}x`;
        rec.note = g ? g.note : '';
        if (g) Store.updateGrid(g.id, rec); else Store.addGrid(rec);
        Modal.close(); this.renderSaved();
      };
    });
  },

  openSave() {
    const P = Store.params;
    if (Grid.validate(P)) { Toast.show('參數還不完整'); return; }
    const def = `${this.sym().name} ${Signal.DIR_LABEL[P.dir]} ${fmt.n(P.lower, 0)}-${fmt.n(P.upper, 0)}`;
    Modal.open(`<h3>儲存這組網格</h3>
      <label class="lbl" for="sv-name">名稱</label><input id="sv-name" value="${esc(def)}">
      <label class="lbl" for="sv-note">備註(選填,例如進場理由、止損價)</label><textarea id="sv-note" rows="3"></textarea>
      <div class="row-btns"><button class="btn ghost" data-close="1">取消</button><button class="btn primary" id="sv-ok">儲存</button></div>`, m => {
      $('#sv-ok', m).onclick = () => {
        Store.addGrid(Object.assign({ symbol: Store.settings.symbol, name: $('#sv-name', m).value.trim() || def, note: $('#sv-note', m).value.trim() },
          ['dir', 'mode', 'lower', 'upper', 'n', 'capital', 'extra', 'lev'].reduce((o, k) => (o[k] = P[k], o), {})));
        Modal.close(); Toast.show('已儲存');
      };
    });
  },

  loadGrid(id, goto = 'calc') {
    const g = Store.grids.find(x => x.id === id);
    if (!g) return;
    if (g.symbol !== Store.settings.symbol) { Store.settings.symbol = g.symbol; Store.saveSettings(); Market._cache = {}; this.data = null; this.load(); }
    ['dir', 'mode', 'lower', 'upper', 'n', 'capital', 'extra', 'lev'].forEach(k => { Store.params[k] = g[k] == null ? (k === 'extra' ? 0 : '') : g[k]; });
    Store.saveParams();
    this.bt.res = null;
    this.go(goto);
  },

  async deleteGrid(id) {
    if (await ask('確定要刪除這組網格?', '刪除')) { Store.removeGrid(id); this.renderSaved(); }
  },

  openEditGrid(id) {
    const g = Store.grids.find(x => x.id === id);
    if (!g) return;
    Modal.open(`<h3>編輯</h3>
      <label class="lbl" for="ed-name">名稱</label><input id="ed-name" value="${esc(g.name)}">
      <label class="lbl" for="ed-note">備註</label><textarea id="ed-note" rows="4">${esc(g.note)}</textarea>
      <div class="row-btns"><button class="btn ghost" data-close="1">取消</button><button class="btn primary" id="ed-ok">儲存</button></div>`, m => {
      $('#ed-ok', m).onclick = () => {
        Store.updateGrid(id, { name: $('#ed-name', m).value.trim() || g.name, note: $('#ed-note', m).value.trim() });
        Modal.close(); this.renderSaved();
      };
    });
  },

  exportData() {
    const text = Store.exportJson();
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = 'ethgrid-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* 下載不成就只複製 */ }
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    Toast.show('已下載備份檔,內容也複製到剪貼簿', 3000);
  },

  openImport() {
    Modal.open(`<h3>匯入備份</h3><p class="fine in">貼上先前匯出的內容(相同 id 的不會重複加入)。</p>
      <textarea id="im-text" rows="8" placeholder="貼上 JSON…"></textarea>
      <div class="row-btns"><button class="btn ghost" data-close="1">取消</button><button class="btn primary" id="im-ok">匯入</button></div>`, m => {
      $('#im-ok', m).onclick = () => {
        try {
          const n = Store.importJson($('#im-text', m).value);
          Modal.close(); this.renderSaved(); Toast.show(`匯入完成,新增 ${n} 組`);
        } catch (e) { Toast.show('匯入失敗:' + e.message, 3500); }
      };
    });
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
        if (k === 'symbol') { Market._cache = {}; this.data = null; this.bt.res = null; Store.params.lower = ''; Store.params.upper = ''; Store.saveParams(); this.load(); }
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
