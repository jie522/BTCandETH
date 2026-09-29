/* 共用 UI 小工具:格式化、圖示、彈窗、提示、SVG 走勢圖 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = {
  n(x, d = 2) {
    if (x == null || isNaN(x)) return '—';
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  price(x) { return fmt.n(x, x >= 1000 ? 1 : 2); },
  pct(x, d = 2, sign = true) {
    if (x == null || isNaN(x)) return '—';
    return (sign && x > 0 ? '+' : '') + x.toFixed(d) + '%';
  },
  usd(x, d = 2, sign = false) {
    if (x == null || isNaN(x)) return '—';
    return (sign && x > 0 ? '+' : '') + fmt.n(x, d);
  },
  cls(x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; },
  date(t, yr) { const d = new Date(t); return (yr ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate(); },
};

const ICONS = {
  chart: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  flask: '<path d="M10 3v6L4.6 18.6a1.6 1.6 0 0 0 1.4 2.4h12a1.6 1.6 0 0 0 1.4-2.4L14 9V3"/><path d="M9 3h6M7.6 15h8.8"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><polyline points="20 4 20 11 13 11"/>',
};
function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach(el => { el.innerHTML = icon(el.dataset.icon, +el.dataset.size || 22); el.removeAttribute('data-icon'); });
}

/* 深淺色 + 漲跌顏色 */
const Theme = {
  apply() {
    const s = Store.settings, root = document.documentElement;
    if (s.theme === 'light' || s.theme === 'dark') root.setAttribute('data-theme', s.theme);
    else root.removeAttribute('data-theme');
    root.setAttribute('data-up', s.upColor === 'green' ? 'green' : 'red');
  },
};

const Toast = {
  show(msg, ms = 2200) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._t);
    this._t = setTimeout(() => el.classList.remove('show'), ms);
  },
};

/* 底部彈出的面板;內容整包換掉,不留舊的監聽器 */
const Modal = {
  open(html, onMount) {
    this.close();
    const wrap = document.createElement('div');
    wrap.id = 'modal';
    wrap.innerHTML = `<div class="sheet-bg" data-close="1"></div><div class="sheet" role="dialog">${html}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) Modal.close(); });
    if (onMount) onMount(wrap);
  },
  close() {
    const m = $('#modal');
    if (m) m.remove();
    document.body.classList.remove('no-scroll');
  },
};

/* App 內的確認彈窗(取代 confirm()) */
function ask(text, okLabel = '確定') {
  return new Promise(resolve => {
    Modal.open(`<p class="ask-text">${esc(text)}</p>
      <div class="row-btns"><button class="btn ghost" data-close="1" id="ask-no">取消</button>
      <button class="btn danger" id="ask-yes">${esc(okLabel)}</button></div>`, m => {
      $('#ask-yes', m).onclick = () => { Modal.close(); resolve(true); };
      $('#ask-no', m).onclick = () => resolve(false);
      $('.sheet-bg', m).onclick = () => { Modal.close(); resolve(false); };
    });
  });
}

/* SVG 走勢圖
 *   series  [{d:[數值...], cls:'ch-price'}]  全部等長、由舊到新(NaN 會斷線)
 *   lines   [{y, cls, label}]                 水平線(格線、強平價、現價)
 *   band    {lo, hi}                          區間底色
 *   x       [左標籤, 右標籤]
 */
const Chart = {
  svg(o) {
    const W = 360, H = o.h || 190, L = 6, R = 52, T = 8, B = 20;
    const all = [];
    o.series.forEach(s => s.d.forEach(v => { if (!isNaN(v)) all.push(v); }));
    (o.lines || []).forEach(l => { if (l.range !== false) all.push(l.y); });
    if (o.band) all.push(o.band.lo, o.band.hi);
    if (!all.length) return '';
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.05 || 1; lo -= pad; hi += pad;
    const n = Math.max(...o.series.map(s => s.d.length));
    const X = i => L + (W - L - R) * (n <= 1 ? 0 : i / (n - 1));
    const Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const yfmt = o.yfmt || (v => fmt.n(v, v >= 1000 ? 0 : 2));
    let g = '';
    for (let k = 0; k <= 3; k++) {
      const v = lo + (hi - lo) * k / 3, y = Y(v);
      g += `<line class="ch-axis" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ch-t" x="${W - R + 4}" y="${y + 3}">${yfmt(v)}</text>`;
    }
    if (o.band) g += `<rect class="ch-band" x="${L}" width="${W - L - R}" y="${Y(o.band.hi)}" height="${Math.max(0, Y(o.band.lo) - Y(o.band.hi))}"/>`;
    (o.lines || []).forEach(l => {
      if (l.y < lo || l.y > hi) return;
      g += `<line class="${l.cls}" x1="${L}" x2="${W - R}" y1="${Y(l.y)}" y2="${Y(l.y)}"/>`;
      if (l.label) g += `<text class="ch-t ${l.cls}-t" x="${W - R + 4}" y="${Y(l.y) + 3}">${esc(l.label)}</text>`;
    });
    const step = Math.max(1, Math.ceil(n / 200));       // 點太多就抽樣,路徑才不會太長
    o.series.forEach(s => {
      let d = '', pen = false;
      for (let i = 0; i < s.d.length; i += step) {
        const v = s.d[i];
        if (isNaN(v)) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        pen = true;
      }
      g += `<path class="${s.cls}" d="${d}"/>`;
    });
    if (o.x) g += `<text class="ch-t" x="${L}" y="${H - 5}">${esc(o.x[0])}</text><text class="ch-t" x="${W - R}" y="${H - 5}" text-anchor="end">${esc(o.x[1])}</text>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
  },
};
