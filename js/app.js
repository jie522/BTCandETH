/* 主程式:四個分頁(行情 / 試算 / 回測 / 我的網格)+ 設定 */
const App = {
  tab: 'market',
  tf: '1d',                 // 行情頁用的 K 線週期
  data: null,               // {tk, cs, an} 最近一次載入的行情與分析
  loading: false,
  err: '',
  bt: { tf: '1h', days: 30, res: null, busy: false },

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
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  },

  /* ---------- 分頁切換 ---------- */
  go(tab) {
    this.tab = tab;
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $('#hdr-title').textContent = { market: '行情與訊號', calc: '網格試算', backtest: '歷史回測', saved: '我的網格' }[tab];
    $('#hdr-sub').textContent = this.sym().name + ' 永續合約';
    if (tab === 'market') this.renderMarket();
    if (tab === 'calc') this.renderCalc();
    if (tab === 'backtest') this.renderBacktest();
    if (tab === 'saved') this.renderSaved();
    window.scrollTo(0, 0);
  },

  /* ---------- 載入行情 ---------- */
  async load(force) {
    if (this.loading) return;
    if (force) Market._cache = {};
    this.loading = true; this.err = '';
    if (this.tab === 'market') this.renderMarket();
    try {
      const sym = Store.settings.symbol;
      const [tk, cs] = await Promise.all([Market.ticker(sym), Market.klines(sym, this.tf, 300)]);
      const an = Signal.analyze(cs, tk.funding, Store.settings.fee);
      this.data = { tk, cs, an, sym, tf: this.tf };
    } catch (e) {
      this.err = '連不上交易所行情(' + (e.message || e) + '),請檢查網路後重試';
    }
    this.loading = false;
    this.go(this.tab);
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
  },

  onSeg(el) {
    const k = el.dataset.seg, v = el.dataset.v;
    const P = Store.params;
    if (k === 'tf') { this.tf = v; this.load(); return; }
    if (k === 'dir' || k === 'mode') { P[k] = v; Store.saveParams(); $$(`[data-seg="${k}"]`).forEach(x => x.classList.toggle('active', x === el)); this.updateCalc(); return; }
    if (k === 'bt-tf') { this.bt.tf = v; this.renderBacktest(); return; }
    if (k === 'bt-days') { this.bt.days = +v; this.renderBacktest(); return; }
  },

  onInput(e) {
    const el = e.target;
    if (el.dataset.p) {
      Store.params[el.dataset.p] = el.value === '' ? '' : +el.value;
      Store.saveParams();
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

  /* ============ 行情頁 ============ */
  renderMarket() {
    const root = $('#page-market');
    if (this.err && !this.data) { root.innerHTML = this.errBox(); return; }
    if (!this.data) { root.innerHTML = '<div class="card skeleton">載入行情中…</div>'; return; }
    const { tk, cs, an } = this.data, name = this.sym().name;
    const lean = an.score >= 3 ? '偏多' : an.score <= -3 ? '偏空' : an.score > 0 ? '略偏多' : an.score < 0 ? '略偏空' : '方向不明';
    const meterPos = (an.score + 5) / 10 * 100;
    const ind = [
      ['MA20', fmt.price(an.ma20), tk.price > an.ma20 ? 'up' : 'down'],
      ['MA50', fmt.price(an.ma50), tk.price > an.ma50 ? 'up' : 'down'],
      ['MA200', isNaN(an.ma200) ? '—' : fmt.price(an.ma200), tk.price > an.ma200 ? 'up' : 'down'],
      ['RSI(14)', an.rsi.toFixed(0), an.rsi >= 70 ? 'warnc' : an.rsi <= 30 ? 'warnc' : ''],
      ['ADX 趨勢強度', an.adx.toFixed(0), an.adx >= 25 ? 'accent' : ''],
      ['ATR 單根波幅', an.atrPct.toFixed(2) + '%', ''],
      ['布林帶寬分位', isNaN(an.bwRank) ? '—' : an.bwRank.toFixed(0), ''],
      ['資金費率/8h', an.funding.toFixed(4) + '%', an.funding >= 0.03 || an.funding <= -0.01 ? 'warnc' : ''],
    ];
    const view = cs.slice(-100), off = cs.length - view.length;
    const sug = an.sug;
    root.innerHTML = `
      <div class="card price-card">
        <div class="pc-top"><span class="pc-name">${name}/USDT 永續</span><span class="pc-src">${esc(Market.source)} · ${new Date().toTimeString().slice(0, 5)}</span></div>
        <div class="pc-price ${fmt.cls(tk.change)}">${fmt.price(tk.price)}</div>
        <div class="pc-sub"><span class="${fmt.cls(tk.change)}">${fmt.pct(tk.change)}</span> · 24h 高 ${fmt.price(tk.high)} · 低 ${fmt.price(tk.low)}</div>
      </div>
      ${this.err ? this.errBox() : ''}
      <div class="section-title">判讀週期</div>
      ${this.seg('tf', [['4h', '4 小時'], ['1d', '日線'], ['1w', '週線']], this.tf)}
      <div class="card verdict v-${an.dir}">
        <div class="v-head"><span class="v-badge">${Signal.DIR_LABEL[an.dir]}</span><span class="v-conf">把握度 ${an.strength}</span></div>
        <div class="v-title">${name} 目前${lean}</div>
        <div class="v-why">${esc(an.why)}</div>
        <div class="meter"><i style="left:${meterPos}%"></i></div>
        <div class="meter-l"><span>偏空</span><span>方向分數 ${an.score > 0 ? '+' : ''}${an.score} / ±5</span><span>偏多</span></div>
        <ul class="reasons">${an.reasons.map(r => `<li class="r-${r.tone}">${esc(r.text)}</li>`).join('')}</ul>
      </div>
      <div class="card">
        <div class="section-title in">建議起手參數(可到「試算」再調整)</div>
        <div class="sug-grid">
          <div><span>方向</span><b>${Signal.DIR_LABEL[sug.dir]}</b></div>
          <div><span>區間</span><b>${fmt.n(sug.lower, 0)} ~ ${fmt.n(sug.upper, 0)}</b></div>
          <div><span>格數</span><b>${sug.n}</b></div>
          <div><span>槓桿</span><b>${sug.lev}x</b></div>
        </div>
        <button class="btn primary block" data-act="apply">套用到試算</button>
      </div>
      <div class="section-title">指標</div>
      <div class="ind-grid">${ind.map(([l, v, c]) => `<div class="ind"><div class="i-l">${l}</div><div class="i-v ${c}">${v}</div></div>`).join('')}</div>
      <div class="card">
        <div class="legend"><i class="lg lg-price"></i>價格 <i class="lg lg-ma50"></i>MA50 <i class="lg lg-ma200"></i>MA200 <i class="lg lg-band"></i>建議區間</div>
        ${Chart.svg({
          series: [
            { d: view.map(k => k.c), cls: 'ch-price' },
            { d: an.ma.ma50.slice(off), cls: 'ch-ma50' },
            { d: an.ma.ma200.slice(off), cls: 'ch-ma200' },
          ],
          band: { lo: sug.lower, hi: sug.upper },
          lines: [{ y: tk.price, cls: 'ch-now', label: fmt.n(tk.price, 0) }],
          x: [fmt.date(view[0].t, this.tf === '1w'), fmt.date(view[view.length - 1].t, this.tf === '1w')],
        })}
      </div>
      <p class="fine">訊號只是機率上的參考,不是預測。網格賺的是震盪,方向選錯或趨勢強時會累積虧損倉位,務必控制槓桿與止損。</p>`;
  },

  applySuggestion() {
    const s = this.data.an.sug;
    Object.assign(Store.params, { dir: s.dir, mode: s.mode, lower: s.lower, upper: s.upper, n: s.n, lev: s.lev });
    Store.saveParams();
    Toast.show('已套用建議參數');
    this.go('calc');
  },

  /* ============ 試算頁 ============ */
  renderCalc() {
    const P = Store.params;
    $('#page-calc').innerHTML = `
      <div class="card">
        <label class="lbl">方向</label>
        ${this.seg('dir', [['long', '做多'], ['neutral', '中性'], ['short', '做空']], P.dir)}
        <label class="lbl">格線間距</label>
        ${this.seg('mode', [['arith', '等差(價差相同)'], ['geo', '等比(漲幅相同)']], P.mode)}
        <div class="f-row">
          <div class="f"><label class="lbl" for="p-lower">下界價</label><input id="p-lower" data-p="lower" type="number" inputmode="decimal" value="${P.lower}"></div>
          <div class="f"><label class="lbl" for="p-upper">上界價</label><input id="p-upper" data-p="upper" type="number" inputmode="decimal" value="${P.upper}"></div>
        </div>
        <div class="f-row">
          <div class="f"><label class="lbl" for="p-n">格數</label><input id="p-n" data-p="n" type="number" inputmode="numeric" value="${P.n}"></div>
          <div class="f"><label class="lbl" for="p-cap">保證金 USDT</label><input id="p-cap" data-p="capital" type="number" inputmode="decimal" value="${P.capital}"></div>
          <div class="f"><label class="lbl" for="p-lev">槓桿 x</label><input id="p-lev" data-p="lev" type="number" inputmode="decimal" value="${P.lev}"></div>
        </div>
        <div class="chips">
          <button class="chip" data-act="quick" data-v="5">現價 ±5%</button>
          <button class="chip" data-act="quick" data-v="10">±10%</button>
          <button class="chip" data-act="quick" data-v="15">±15%</button>
          <button class="chip" data-act="quick" data-v="25">±25%</button>
        </div>
      </div>
      <div id="calc-out"></div>`;
    this.updateCalc();
    if (!this.data) this.ensureData().then(() => this.tab === 'calc' && this.updateCalc());
  },

  quickRange(pct) {
    const px = this.data ? this.data.tk.price : 0;
    if (!px) { Toast.show('還沒有現價,請稍候再試'); return; }
    const P = Store.params;
    P.lower = Grid.nice(px * (1 - pct / 100), px);
    P.upper = Grid.nice(px * (1 + pct / 100), px);
    Store.saveParams();
    $('#p-lower').value = P.lower; $('#p-upper').value = P.upper;
    this.updateCalc();
  },

  updateCalc() {
    const out = $('#calc-out');
    if (!out) return;
    const P = Store.params, err = Grid.validate(P);
    if (err) { out.innerHTML = `<div class="card muted-card">${esc(err)}</div>`; return; }
    const o = this.opt(), r = Grid.calc(P, o);
    const px = o.price;
    const lines = r.levels.map(y => ({ y, cls: 'ch-lvl', range: true }));
    lines.push({ y: P.lower, cls: 'ch-edge', label: fmt.n(P.lower, 0) }, { y: P.upper, cls: 'ch-edge', label: fmt.n(P.upper, 0) });
    if (!isNaN(r.liqDown)) lines.push({ y: r.liqDown, cls: 'ch-liq', label: '強平 ' + fmt.n(r.liqDown, 0) });
    if (!isNaN(r.liqUp)) lines.push({ y: r.liqUp, cls: 'ch-liq', label: '強平 ' + fmt.n(r.liqUp, 0) });
    if (px) lines.push({ y: px, cls: 'ch-now', label: fmt.n(px, 0) });
    const cs = this.data ? this.data.cs.slice(-90) : [];
    const liqTxt = (d, v, edge) => `${fmt.n(v, 0)}<small>(${d} ${fmt.n(Math.abs(v - edge) / edge * 100, 1)}%)</small>`;

    out.innerHTML = `
      ${r.warns.map(w => `<div class="warn w-${w.level}">${esc(w.text)}</div>`).join('')}
      <div class="kpi-grid">
        ${this.kpi('每格漲幅', r.gapMin === r.gapMax || P.mode === 'geo' ? r.gapAvg.toFixed(2) + '%' : r.gapMin.toFixed(2) + '~' + r.gapMax.toFixed(2) + '%', '', '兩條格線的價差')}
        ${this.kpi('每格淨利(扣手續費)', r.netAvg.toFixed(2) + '%', fmt.cls(r.netAvg), '≈ ' + fmt.usd(r.perCellUsd, 2) + ' USDT / 次')}
        ${this.kpi('每格名目', fmt.usd(r.cellN, 1) + ' U', '', '總名目 ' + fmt.n(r.notional, 0) + ' U')}
        ${this.kpi('估計強平價', [
          isNaN(r.liqDown) ? '' : liqTxt('下界外', r.liqDown, P.lower),
          isNaN(r.liqUp) ? '' : liqTxt('上界外', r.liqUp, P.upper),
        ].filter(Boolean).join('<br>') || '—', 'liq', '假設全部格子成交的最壞情況')}
      </div>
      <div class="card">
        <div class="legend"><i class="lg lg-price"></i>價格 <i class="lg lg-lvl"></i>格線 <i class="lg lg-liq"></i>強平 <i class="lg lg-now"></i>現價</div>
        ${Chart.svg({
          series: [{ d: cs.map(k => k.c), cls: 'ch-price' }],
          band: { lo: P.lower, hi: P.upper },
          lines, h: 220,
          x: cs.length ? [fmt.date(cs[0].t), fmt.date(cs[cs.length - 1].t)] : ['', ''],
        })}
        <details class="lv"><summary>全部 ${r.levels.length} 條格線價</summary>
          <div class="lv-grid">${r.levels.map((y, i) => `<span class="${px && y <= px ? 'below' : ''}">${i}. ${fmt.n(y, 2)}</span>`).join('')}</div>
        </details>
      </div>
      ${this.pionexHtml(P, r)}
      <div class="row-btns">
        <button class="btn" data-act="save">儲存這組</button>
        <button class="btn primary" data-act="to-bt">去回測</button>
      </div>
      <p class="fine">強平價為簡化估算(逐倉、最壞情況、維持保證金率 ${Store.settings.mmr}%),實際以交易所為準。</p>`;
  },

  /* 派網(Pionex)合約網格的「手動設定」欄位對照,照著填就好
   * 建議止損:區間外 3%,但一定要留在強平價內側(離強平至少 2%),不然止損還沒觸發就先被強平 */
  pionexRows(P, r) {
    const dirT = { long: '做多', short: '做空', neutral: '中性' }[P.dir];
    let slDown = '', slUp = '';
    if (P.dir !== 'short') {
      let v = P.lower * 0.97;
      if (!isNaN(r.liqDown)) v = Math.max(v, r.liqDown * 1.02);
      slDown = v < P.lower ? fmt.n(Grid.nice(v, P.lower), 0) : '';
    }
    if (P.dir !== 'long') {
      let v = P.upper * 1.03;
      if (!isNaN(r.liqUp)) v = Math.min(v, r.liqUp * 0.98);
      slUp = v > P.upper ? fmt.n(Grid.nice(v, P.upper), 0) : '';
    }
    const sl = [slDown && `跌破 ${slDown}`, slUp && `漲破 ${slUp}`].filter(Boolean).join(' / ') || '降低槓桿後再設';
    return [
      ['交易對', this.sym().name + '/USDT 永續'],
      ['策略', '合約網格 · ' + dirT],
      ['價格區間 下限', fmt.n(P.lower, 2)],
      ['價格區間 上限', fmt.n(P.upper, 2)],
      ['網格數量', P.n],
      ['網格模式', P.mode === 'geo' ? '等比' : '等差'],
      ['槓桿', P.lev + 'x'],
      ['投資額', fmt.n(P.capital, 0) + ' USDT'],
      ['止損價(建議)', sl],
    ];
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

  /* ============ 回測頁 ============ */
  renderBacktest() {
    const P = Store.params, root = $('#page-backtest'), b = this.bt;
    const err = Grid.validate(P);
    const dirTxt = Signal.DIR_LABEL[P.dir];
    root.innerHTML = `
      <div class="card">
        <div class="bt-sum"><span>${err ? `<span class="warn-t">${esc(err)}</span>` :
          `<b>${dirTxt}</b> · ${P.mode === 'geo' ? '等比' : '等差'} · ${fmt.n(P.lower, 0)}~${fmt.n(P.upper, 0)} · ${P.n} 格 · ${fmt.n(P.capital, 0)}U × ${P.lev}x`}</span>
          <button class="chip" data-act="to-calc">改參數</button></div>
        <label class="lbl">K 線週期(越細越接近真實成交)</label>
        ${this.seg('bt-tf', [['15m', '15 分'], ['1h', '1 小時'], ['4h', '4 小時']], b.tf)}
        <label class="lbl">回測天數</label>
        ${this.seg('bt-days', [[7, '7 天'], [14, '14 天'], [30, '30 天'], [60, '60 天'], [90, '90 天']], b.days)}
        <button class="btn primary block" data-act="run-bt" ${b.busy || err ? 'disabled' : ''}>${b.busy ? '回測中…' : '開始回測'}</button>
      </div>
      <div id="bt-out">${b.res ? this.btHtml(b.res) : '<div class="card muted-card">設定好參數後按「開始回測」。會用過去真實 K 線,同時跑做多 / 做空 / 中性三種方向給你比較。</div>'}</div>`;
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

  btHtml(B) {
    const { res, cs, P } = B, r = res[P.dir];
    const dirs = [['long', '做多'], ['neutral', '中性'], ['short', '做空']];
    const best = dirs.map(d => d[0]).sort((a, b) => res[b].ret - res[a].ret)[0];
    const lines = r.levels.map(y => ({ y, cls: 'ch-lvl' }));
    lines.push({ y: P.lower, cls: 'ch-edge', label: fmt.n(P.lower, 0) }, { y: P.upper, cls: 'ch-edge', label: fmt.n(P.upper, 0) });
    const eqBase = P.capital;
    return `
      ${r.liquidated ? `<div class="warn w-bad">這組參數在回測期間被強平(約第 ${r.liqIndex + 1} / ${cs.length} 根 K 線),本金歸零。</div>` : ''}
      <div class="kpi-grid">
        ${this.kpi('總報酬(含未實現)', fmt.pct(r.ret), fmt.cls(r.ret), fmt.usd(r.finalEq - P.capital, 2, true) + ' USDT')}
        ${this.kpi('最大回撤', r.maxDD.toFixed(1) + '%', r.maxDD > 20 ? 'down' : '', '權益從高點回落')}
        ${this.kpi('完成格數', r.closed + ' 次', '', `${B.days} 天 · 平均每天 ${(r.closed / B.days).toFixed(1)} 次`)}
        ${this.kpi('價格在區間內', r.inRange.toFixed(0) + '%', r.inRange < 70 ? 'warnc' : '', '期間價格 ' + fmt.pct(r.priceChg, 1))}
      </div>
      <div class="card">
        <div class="section-title in">收益拆解(${Signal.DIR_LABEL[P.dir]})</div>
        <table class="tbl">
          <tr><td>已實現價差</td><td class="${fmt.cls(r.realized + r.fees + r.funding)}">${fmt.usd(r.realized + r.fees + r.funding, 2, true)}</td></tr>
          <tr><td>手續費</td><td class="down">${fmt.usd(-r.fees, 2)}</td></tr>
          <tr><td>資金費(${Store.settings.funding}%/8h 假設)</td><td class="${fmt.cls(-r.funding)}">${fmt.usd(-r.funding, 2, true)}</td></tr>
          <tr><td>未實現(${r.held} 格持倉中)</td><td class="${fmt.cls(r.unreal)}">${fmt.usd(r.unreal, 2, true)}</td></tr>
        </table>
      </div>
      <div class="section-title">三種方向比較(同一段歷史、同一組參數)</div>
      <div class="card">
        <table class="tbl cmp">
          <tr><th>方向</th><th>報酬</th><th>最大回撤</th><th>格數</th><th></th></tr>
          ${dirs.map(([d, t]) => {
            const x = res[d];
            return `<tr class="${d === P.dir ? 'cur' : ''}"><td>${t}${d === best ? ' <span class="crown">最佳</span>' : ''}</td>
              <td class="${fmt.cls(x.ret)}">${fmt.pct(x.ret, 1)}</td><td>${x.maxDD.toFixed(1)}%</td><td>${x.closed}</td>
              <td>${x.liquidated ? '<span class="down">強平</span>' : ''}</td></tr>`;
          }).join('')}
        </table>
        <p class="fine in">這只代表過去這段時間。上漲段做多占優、下跌段做空占優是必然,不代表下一段也是;中性通常最穩但賺得最少。</p>
      </div>
      <div class="card">
        <div class="legend"><i class="lg lg-price"></i>價格 <i class="lg lg-lvl"></i>格線</div>
        ${Chart.svg({ series: [{ d: cs.map(k => k.c), cls: 'ch-price' }], lines, band: { lo: P.lower, hi: P.upper }, h: 210,
          x: [fmt.date(cs[0].t), fmt.date(cs[cs.length - 1].t)] })}
      </div>
      <div class="card">
        <div class="legend"><i class="lg lg-eq"></i>權益(USDT)<i class="lg lg-lvl"></i>本金</div>
        ${Chart.svg({ series: [{ d: r.eq, cls: 'ch-eq' }], lines: [{ y: eqBase, cls: 'ch-now', label: '本金' }], h: 150,
          yfmt: v => fmt.n(v, 0), x: [fmt.date(cs[0].t), fmt.date(cs[cs.length - 1].t)] })}
      </div>
      <p class="fine">回測為理想化:成交價 = 格線價、無滑價、不含真實歷史資金費率、假設掛單都排得到隊。實盤績效通常會比回測差一些。</p>`;
  },

  /* ============ 我的網格 ============ */
  async renderSaved() {
    const root = $('#page-saved');
    const px = this.data ? this.data.tk.price : 0;
    const list = Store.grids;
    root.innerHTML = `
      ${list.length ? list.map(g => this.gridCard(g, px)).join('') :
        '<div class="card muted-card">還沒有儲存的網格。<br>在「試算」頁調好參數後按「儲存這組」,就會出現在這裡。</div>'}
      <div class="row-btns">
        <button class="btn" data-act="export">匯出備份</button>
        <button class="btn" data-act="import">匯入</button>
      </div>
      <p class="fine">資料只存在這支手機的瀏覽器裡。換手機或清除瀏覽資料前,請先「匯出備份」。</p>`;
    if (!px) this.ensureData().then(() => this.tab === 'saved' && this.renderSaved());
  },

  gridCard(g, px) {
    const inRange = px >= g.lower && px <= g.upper;
    const pos = px ? Math.max(0, Math.min(100, (px - g.lower) / (g.upper - g.lower) * 100)) : 0;
    const status = !px ? '' : inRange ? `現價在區間內(${pos.toFixed(0)}%)` :
      px < g.lower ? `現價低於下界 ${fmt.n((g.lower - px) / g.lower * 100, 1)}%` : `現價高於上界 ${fmt.n((px - g.upper) / g.upper * 100, 1)}%`;
    const cal = Grid.calc(g, { fee: Store.settings.fee, mmr: Store.settings.mmr, price: px || g.lower });
    return `<div class="card g-card">
      <div class="g-head"><b>${esc(g.name)}</b><span class="badge b-${g.dir}">${Signal.DIR_LABEL[g.dir]}</span></div>
      <div class="g-meta">${Market.SYMS[g.symbol] ? Market.SYMS[g.symbol].name : g.symbol} · ${g.mode === 'geo' ? '等比' : '等差'} · ${fmt.n(g.lower, 0)}~${fmt.n(g.upper, 0)} · ${g.n} 格 · ${fmt.n(g.capital, 0)}U × ${g.lev}x</div>
      ${px && g.symbol === Store.settings.symbol ? `<div class="pos"><div class="pos-bar"><i style="left:${pos}%" class="${inRange ? '' : 'out'}"></i></div><div class="pos-t ${inRange ? '' : 'warnc'}">${status}</div></div>` : ''}
      <div class="g-meta">每格淨利 ${cal.netAvg.toFixed(2)}% · 強平約 ${fmt.n(isNaN(cal.liqDown) ? cal.liqUp : cal.liqDown, 0)}</div>
      ${g.note ? `<div class="g-note">${esc(g.note)}</div>` : ''}
      <div class="row-btns tight">
        <button class="btn sm" data-act="load-grid" data-id="${g.id}">試算</button>
        <button class="btn sm" data-act="bt-grid" data-id="${g.id}">回測</button>
        <button class="btn sm ghost" data-act="edit-grid" data-id="${g.id}">備註</button>
        <button class="btn sm ghost danger-t" data-act="del-grid" data-id="${g.id}">刪除</button>
      </div>
    </div>`;
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
          ['dir', 'mode', 'lower', 'upper', 'n', 'capital', 'lev'].reduce((o, k) => (o[k] = P[k], o), {})));
        Modal.close(); Toast.show('已儲存');
      };
    });
  },

  loadGrid(id, goto = 'calc') {
    const g = Store.grids.find(x => x.id === id);
    if (!g) return;
    if (g.symbol !== Store.settings.symbol) { Store.settings.symbol = g.symbol; Store.saveSettings(); Market._cache = {}; this.data = null; this.load(); }
    ['dir', 'mode', 'lower', 'upper', 'n', 'capital', 'lev'].forEach(k => { Store.params[k] = g[k]; });
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
