/* 視覺化元件:K 線圖、可滑動查看的十字線、儀表、刻度條、風險階梯、區間條、比較長條
 *
 * 可互動的圖(K 線 / 折線)都包在 <div class="ichart" data-cid="…"> 裡,
 * 畫完後呼叫 Viz.bind(root) 綁手指滑動;每張圖的 tooltip 內容存在 Viz._reg[cid]。
 * 所有顏色都走 CSS 變數,深淺色自動跟著變。
 */
const Viz = {
  _reg: {},
  _id: 0,
  W: 360,

  /* 太多根 K 線畫不清楚:合併成最多 maxN 根 */
  aggregate(cs, maxN) {
    if (cs.length <= maxN) return cs;
    const k = Math.ceil(cs.length / maxN), out = [];
    for (let i = 0; i < cs.length; i += k) {
      const g = cs.slice(i, i + k);
      out.push({ t: g[0].t, o: g[0].o, c: g[g.length - 1].c, h: Math.max(...g.map(x => x.h)), l: Math.min(...g.map(x => x.l)), v: g.reduce((s, x) => s + x.v, 0) });
    }
    return out;
  },

  /* ---------- K 線圖 ----------
   * o = { cs, overlays:[{d, cls, name}], band:{lo,hi}, lines:[{y, cls, label, range}], h, year, tipExtra(i) } */
  candles(o) {
    const cs = o.cs, n = cs.length;
    if (!n) return '';
    const W = this.W, H = o.h || 250, L = 4, R = 50, T = 8, B = 18, VH = 30;
    const PH = H - T - B - VH - 6;
    const vals = [];
    cs.forEach(k => vals.push(k.h, k.l));
    (o.overlays || []).forEach(s => s.d.forEach(v => { if (!isNaN(v)) vals.push(v); }));
    (o.lines || []).forEach(l => { if (l.range !== false) vals.push(l.y); });
    if (o.band) vals.push(o.band.lo, o.band.hi);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.04 || 1; lo -= pad; hi += pad;
    const cw = (W - L - R) / n;
    const X = i => L + cw * (i + 0.5);
    const Y = v => T + PH * (1 - (v - lo) / (hi - lo));
    const vmax = Math.max(...cs.map(k => k.v)) || 1;
    const vy0 = T + PH + 6 + VH;
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4, y = Y(v);
      g += `<line class="ch-axis" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ch-t" x="${W - R + 4}" y="${y + 3}">${fmt.n(v, v >= 1000 ? 0 : 2)}</text>`;
    }
    if (o.band) g += `<rect class="ch-band" x="${L}" width="${W - L - R}" y="${Y(o.band.hi)}" height="${Math.max(0, Y(o.band.lo) - Y(o.band.hi))}"/>`;
    const bw = Math.max(1, cw * 0.66);
    cs.forEach((k, i) => {
      const up = k.c >= k.o, cls = up ? 'cd-up' : 'cd-dn', x = X(i);
      const vh = k.v / vmax * VH;
      g += `<rect class="${cls} vol" x="${(x - bw / 2).toFixed(1)}" y="${(vy0 - vh).toFixed(1)}" width="${bw.toFixed(1)}" height="${vh.toFixed(1)}"/>`;
      g += `<line class="${cls}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(k.h).toFixed(1)}" y2="${Y(k.l).toFixed(1)}"/>`;
      const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c));
      g += `<rect class="${cls}" x="${(x - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.8, y2 - y1).toFixed(1)}"/>`;
    });
    (o.overlays || []).forEach(s => {
      let d = '', pen = false;
      s.d.forEach((v, i) => {
        if (isNaN(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true;
      });
      g += `<path class="${s.cls}" d="${d}"/>`;
    });
    (o.lines || []).forEach(l => {
      if (l.y < lo || l.y > hi) return;
      g += `<line class="${l.cls}" x1="${L}" x2="${W - R}" y1="${Y(l.y)}" y2="${Y(l.y)}"/>`;
      if (l.label) g += `<rect class="ch-lbl-bg ${l.cls}-bg" x="${W - R + 1}" y="${Y(l.y) - 7}" width="${R - 2}" height="13" rx="3"/><text class="ch-t ch-lbl" x="${W - R + 4}" y="${Y(l.y) + 3}">${esc(l.label)}</text>`;
    });
    const df = t => fmt.date(t, o.year);
    g += `<text class="ch-t" x="${L}" y="${H - 4}">${df(cs[0].t)}</text><text class="ch-t" x="${W - R}" y="${H - 4}" text-anchor="end">${df(cs[n - 1].t)}</text>`;

    const cid = 'c' + (++this._id);
    this._reg[cid] = {
      n, x: i => X(i) / W,
      tip: i => {
        const k = cs[i], chg = (k.c / k.o - 1) * 100;
        return `<b>${fmt.date(k.t, true)}${o.intraday ? ' ' + new Date(k.t).toTimeString().slice(0, 5) : ''}</b>
          <span>開 ${fmt.price(k.o)} 高 ${fmt.price(k.h)}</span><span>低 ${fmt.price(k.l)} 收 <em class="${fmt.cls(chg)}">${fmt.price(k.c)}</em></span>
          <span class="${fmt.cls(chg)}">${fmt.pct(chg)}</span>${o.tipExtra ? o.tipExtra(i) : ''}`;
      },
    };
    return `<div class="ichart" data-cid="${cid}"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg><i class="xh"></i><div class="tip"></div></div>`;
  },

  /* ---------- 折線圖(包 Chart.svg,加上十字線) ---------- */
  line(o, tip) {
    const n = Math.max(...o.series.map(s => s.d.length));
    const cid = 'c' + (++this._id), W = 360, L = 6, R = 52;
    this._reg[cid] = { n, x: i => (L + (W - L - R) * (n <= 1 ? 0 : i / (n - 1))) / W, tip };
    return `<div class="ichart" data-cid="${cid}">${Chart.svg(o)}<i class="xh"></i><div class="tip"></div></div>`;
  },

  /* 手指 / 滑鼠在圖上移動 → 顯示十字線與數值;直向滑動仍可捲動頁面 */
  bind(root = document) {
    $$('.ichart:not([data-bound])', root).forEach(el => {
      el.dataset.bound = '1';
      const reg = this._reg[el.dataset.cid];
      if (!reg) return;
      const xh = $('.xh', el), tip = $('.tip', el);
      const show = e => {
        const rect = el.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / rect.width;
        let best = 0, bd = 9;
        // x 位置 → 最近的一根
        const guess = Math.round(fx * (reg.n - 1));
        for (let i = Math.max(0, guess - 3); i <= Math.min(reg.n - 1, guess + 3); i++) {
          const d = Math.abs(reg.x(i) - fx);
          if (d < bd) { bd = d; best = i; }
        }
        const px = reg.x(best) * rect.width;
        xh.style.left = px + 'px';
        tip.innerHTML = reg.tip(best);
        el.classList.add('on');
        const tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(rect.width - tw, px < rect.width / 2 ? px + 10 : px - tw - 10)) + 'px';
      };
      const hide = () => el.classList.remove('on');
      el.addEventListener('pointerdown', show);
      el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || el.classList.contains('on')) show(e); });
      el.addEventListener('pointerleave', hide);
      el.addEventListener('pointercancel', hide);
      el.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') setTimeout(hide, 1800); });
    });
  },

  /* ---------- 半圓儀表:方向分數 -5 ~ +5 ---------- */
  gauge(score, size = 'lg') {
    const cx = 100, cy = 100, r = 80, sw = size === 'lg' ? 16 : 20;
    const segs = [['g-s2', -5, -3], ['g-s1', -3, -1], ['g-n', -1, 1], ['g-b1', 1, 3], ['g-b2', 3, 5]];
    const pt = (v, rr) => { const a = Math.PI * (1 - (v + 5) / 10); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
    let g = '';
    segs.forEach(([cls, a, b]) => {
      const [x1, y1] = pt(a + 0.08, r), [x2, y2] = pt(b - 0.08, r);
      g += `<path class="${cls}" d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke-width="${sw}" fill="none"/>`;
    });
    const s = Math.max(-5, Math.min(5, score));
    const [nx, ny] = pt(s, r - (size === 'lg' ? 22 : 18));
    g += `<line class="g-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"/><circle class="g-hub" cx="${cx}" cy="${cy}" r="${size === 'lg' ? 7 : 9}"/>`;
    if (size === 'lg') g += `<text class="g-lbl" x="14" y="116">偏空</text><text class="g-lbl" x="186" y="116" text-anchor="end">偏多</text>`;
    return `<svg class="gauge gauge-${size}" viewBox="0 0 200 ${size === 'lg' ? 122 : 108}" role="img" aria-label="方向分數 ${score}">${g}</svg>`;
  },

  /* ---------- 刻度條:RSI、ADX、資金費率… ----------
   * zones [{to, cls}] 由小到大;v 目前值 */
  meter(o) {
    const span = o.max - o.min, p = v => Math.max(0, Math.min(100, (v - o.min) / span * 100));
    let prev = o.min, z = '';
    o.zones.forEach(q => { z += `<i class="mz ${q.cls}" style="left:${p(prev)}%;width:${p(q.to) - p(prev)}%"></i>`; prev = q.to; });
    const ticks = (o.ticks || []).map(t => `<em style="left:${p(t)}%">${t}</em>`).join('');
    return `<div class="meter-row">
      <div class="mr-top"><span class="mr-l">${o.label}</span><b class="mr-v ${o.cls || ''}">${o.text}</b></div>
      ${o.lean ? `<div class="lean-chip ln-${o.lean}">${o.leanText}</div>` : ''}
      <div class="mbar">${z}<i class="mk" style="left:${isNaN(o.v) ? -99 : p(o.v)}%"></i></div>
      <div class="mticks">${ticks}</div>
      ${o.note ? `<div class="mr-n">${o.note}</div>` : ''}
    </div>`;
  },

  /* ---------- 風險階梯:由高到低列出關鍵價位,間距依距離放大 ----------
   * rows [{y, label, cls, now}],zone(上下兩列之間的區域)由 zoneOf(上, 下) 決定 */
  ladder(rows, price, zoneOf) {
    rows = rows.filter(r => r.y > 0 && !isNaN(r.y)).sort((a, b) => b.y - a.y);
    let h = '';
    rows.forEach((r, i) => {
      const d = price ? (r.y / price - 1) * 100 : NaN;
      h += `<div class="ld-row ${r.cls}${r.now ? ' now' : ''}"><i class="ld-dot"></i><span class="ld-l">${r.label}</span>
        <b class="ld-p">${fmt.n(r.y, r.y >= 1000 ? 0 : 2)}</b><span class="ld-d">${r.now ? '現價' : isNaN(d) ? '' : fmt.pct(d, 1)}</span></div>`;
      const nx = rows[i + 1];
      if (nx) {
        const gap = (r.y / nx.y - 1) * 100;
        const hgt = Math.max(10, Math.min(70, gap * 4));
        h += `<div class="ld-gap ${zoneOf ? zoneOf(r, nx) : ''}" style="height:${hgt.toFixed(0)}px"><span>${gap.toFixed(1)}%</span></div>`;
      }
    });
    return `<div class="ladder">${h}</div>`;
  },

  /* ---------- 區間條:強平 | 危險區 | 網格區間 | 現價 ---------- */
  rangeBar(o) {
    const pts = [o.lower, o.upper, o.price, o.liqDown, o.liqUp, o.stop].filter(v => v > 0 && !isNaN(v));
    const lo = Math.min(...pts) * 0.985, hi = Math.max(...pts) * 1.015;
    const p = v => ((v - lo) / (hi - lo) * 100).toFixed(2);
    let z = `<i class="rb-range" style="left:${p(o.lower)}%;width:${p(o.upper) - p(o.lower)}%"></i>`;
    if (o.liqDown > 0) z += `<i class="rb-dead" style="left:0;width:${p(o.liqDown)}%"></i><i class="rb-risk" style="left:${p(o.liqDown)}%;width:${Math.max(0, p(o.lower) - p(o.liqDown))}%"></i>`;
    if (o.liqUp > 0) z += `<i class="rb-dead" style="left:${p(o.liqUp)}%;right:0"></i><i class="rb-risk" style="left:${p(o.upper)}%;width:${Math.max(0, p(o.liqUp) - p(o.upper))}%"></i>`;
    /* 標籤太靠近(< 22%)就換到第二排,避免疊在一起 */
    const marks = [[o.liqDown, 'liq', '強平 '], [o.lower, 'edge', ''], [o.upper, 'edge', ''], [o.liqUp, 'liq', '強平 ']]
      .filter(m => m[0] > 0 && !isNaN(m[0])).sort((a, b) => a[0] - b[0]);
    let prevP = -99, prevRow = 1, two = false;
    const html = marks.map(([v, cls, t]) => {
      const pos = +p(v), row = pos - prevP < 22 && prevRow === 0 ? 1 : 0;
      if (row) two = true;
      prevP = pos; prevRow = row;
      return `<span class="rb-m ${cls}${row ? ' low' : ''}" style="left:${pos}%"><em>${t}${fmt.n(v, 0)}</em></span>`;
    }).join('');
    return `<div class="rbar${two ? ' two' : ''}"><div class="rb-track">${z}${o.price ? `<b class="rb-now" style="left:${p(o.price)}%"></b>` : ''}</div>
      <div class="rb-marks">${html}</div></div>`;
  },

  /* ---------- 比較長條(正負以 0 為中心) ----------
   * rows [{key, label, v, text, sub, act, cur}] */
  bars(rows) {
    const m = Math.max(1, ...rows.map(r => Math.abs(r.v)));
    return `<div class="bars">${rows.map(r => {
      const w = Math.abs(r.v) / m * 50;
      const tag = r.act ? 'button type="button"' : 'div';
      return `<${tag} class="bar-row${r.cur ? ' cur' : ''}${r.act ? ' tap' : ''}" ${r.act || ''}>
        <span class="bar-l">${r.label}</span>
        <span class="bar-track"><i class="bar-0"></i><i class="bar-f ${r.v >= 0 ? 'bf-pos' : 'bf-neg'}" style="${r.v >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></span>
        <span class="bar-v ${fmt.cls(r.v)}">${r.text}${r.sub ? `<small>${r.sub}</small>` : ''}</span></${r.act ? 'button' : 'div'}>`;
    }).join('')}</div>`;
  },

  /* 迷你走勢(價格卡用) */
  spark(d, cls = 'sp-line') {
    if (d.length < 2) return '';
    const lo = Math.min(...d), hi = Math.max(...d), W = 120, H = 36;
    const pts = d.map((v, i) => `${(i / (d.length - 1) * W).toFixed(1)},${(H - 2 - (v - lo) / (hi - lo || 1) * (H - 4)).toFixed(1)}`);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline class="${cls}" points="${pts.join(' ')}"/></svg>`;
  },
};
