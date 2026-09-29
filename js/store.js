/* 資料層:全部存在這支手機的 localStorage,不上傳任何地方
 *
 * settings  裝置設定
 *   symbol    'ETHUSDT' | 'BTCUSDT'
 *   theme     'auto' | 'light' | 'dark'
 *   upColor   'red' | 'green'     漲的顏色(台灣習慣紅漲綠跌)
 *   fee       單邊手續費 %(0.02 = 用派網合約網格實單的網格利潤 ÷ 套利次數反推出來的)
 *   funding   回測用的資金費率假設 %/8h(多方付、空方收;約 0.01 是常態)
 *   mmr       維持保證金率 %(強平估算用,ETH/BTC 小倉位約 0.4~0.5)
 *   lev       預設槓桿
 * params    目前試算的網格參數(換頁不會掉)
 *   dir       'long' | 'short' | 'neutral'
 *   mode      'arith'(等差) | 'geo'(等比)
 *   lower / upper / n / capital(派網「投資額」USDT) / extra(派網「額外保證金」) / lev
 * grids     存下來的網格組合 [{id, name, symbol, dir, mode, lower, upper, n, capital, extra, lev, note, at,
 *             live(true = 派網上正在跑的機器人), open(開單時價格), pxLiq(派網顯示的預估強平價)}]
 */
const Store = {
  KEY: { settings: 'eg.settings', params: 'eg.params', grids: 'eg.grids' },

  DEFAULT_SETTINGS: { symbol: 'ETHUSDT', theme: 'auto', upColor: 'red', fee: 0.02, funding: 0.01, mmr: 0.5, lev: 3 },
  DEFAULT_PARAMS: { dir: 'neutral', mode: 'arith', lower: '', upper: '', n: 30, capital: 1000, extra: 0, lev: 3 },

  settings: {},
  params: {},
  grids: [],

  read(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  },
  write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 私密模式存不了就算了 */ }
  },

  load() {
    this.settings = Object.assign({}, this.DEFAULT_SETTINGS, this.read(this.KEY.settings, {}));
    if (this.settings.fee === 0.05 && !this.settings.feeFixed) { this.settings.fee = 0.02; this.settings.feeFixed = true; this.saveSettings(); }
    this.params = Object.assign({}, this.DEFAULT_PARAMS, { lev: this.settings.lev }, this.read(this.KEY.params, {}));
    const g = this.read(this.KEY.grids, []);
    this.grids = Array.isArray(g) ? g : [];
  },
  saveSettings() { this.write(this.KEY.settings, this.settings); },
  saveParams() { this.write(this.KEY.params, this.params); },
  saveGrids() { this.write(this.KEY.grids, this.grids); },

  addGrid(g) {
    const rec = Object.assign({ id: 'g' + Date.now().toString(36), at: Date.now(), note: '' }, g);
    this.grids.unshift(rec);
    this.saveGrids();
    return rec;
  },
  removeGrid(id) {
    this.grids = this.grids.filter(g => g.id !== id);
    this.saveGrids();
  },
  updateGrid(id, patch) {
    const g = this.grids.find(x => x.id === id);
    if (g) { Object.assign(g, patch); this.saveGrids(); }
  },

  /* 匯出 / 匯入:換手機或備份用 */
  exportJson() {
    return JSON.stringify({ app: 'ethgrid', v: 1, settings: this.settings, grids: this.grids }, null, 2);
  },
  importJson(text) {
    const d = JSON.parse(text);
    if (!d || d.app !== 'ethgrid' || !Array.isArray(d.grids)) throw new Error('不是這個 App 匯出的檔案');
    const have = new Set(this.grids.map(g => g.id));
    let added = 0;
    d.grids.forEach(g => { if (g && g.id && !have.has(g.id)) { this.grids.push(g); added++; } });
    this.grids.sort((a, b) => (b.at || 0) - (a.at || 0));
    this.saveGrids();
    return added;
  },
};
