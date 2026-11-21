// Skrin "Butiran larian": ringkasan, graf G/ketinggian/kelajuan, jadual split, togol rollout.
import { analyze } from './analysis.js';
import { t, metric, locale } from './i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = x => (x == null || !isFinite(x) ? '–' : x.toFixed(2));
const COL = { other: '#e8ecf1', shift: '#c58bff', g: '#ffb340', alt: '#30d158', v: '#4aa3ff', grid: '#2a313a', text: '#8b95a3' };

let state = null;

export function openDetail(run, el, { onChange, onDelete, runs = [], customDist = [], rollout, tempC = true }) {
  // ikut tetapan rollout semasa jika larian ada data mentah (boleh dikira semula); jika tidak, ikut cara ia direkod
  const canRecalc = !!run.raw?.d?.length;
  state = { run, el, onChange, onDelete, runs, customDist, tempC, rollout: run.imported ? run.rollout !== false : canRecalc && rollout != null ? !!rollout : !!run.rollout, tab: 'dist', focus: null, xAxis: 'd', cmpNo: null, show: { v: true, g: true, alt: true }, zoom: null, cursor: null, viewKey: '' };
  el.hidden = false; document.body.style.overflow = 'hidden';
  render();
}

function close() { state.el.hidden = true; state.el.innerHTML = ''; document.body.style.overflow = ''; state = null; }

function render() {
  const { run, el } = state;
  const a = analyze(run, state.rollout, state.customDist);
  const keys = Object.keys(a.results);
  // metrik utama: pilihan pengguna, atau jarak terjauh / 0-100
  const pref = ['1/4 batu', '1/8 batu', '0-100', ...keys];
  if (!state.focus || !a.results[state.focus]) state.focus = pref.find(k => a.results[k]);
  const main = a.results[state.focus];
  const d = new Date(run.at);
  const tabRows = a.rows[state.tab];
  // larian pembanding (dikira dengan tetapan rollout yang sama supaya adil)
  const others = state.runs.filter(h => h.no !== run.no);
  const oRun = others.find(h => h.no === state.cmpNo) || null;
  const b = oRun ? analyze(oRun, state.rollout, state.customDist) : null;
  const delta = (x, y) => {
    if (x == null || y == null) return '<span class="dm">–</span>';
    const dd = x - y;
    return `<span class="${dd < 0 ? 'faster' : dd > 0 ? 'slower' : ''}">${dd > 0 ? '+' : dd < 0 ? '−' : '±'}${Math.abs(dd).toFixed(2)}</span>`;
  };
  const mainB = b?.results[state.focus];

  el.innerHTML = `<div class="dwrap">
    <div class="dtop"><button class="ghost" data-act="close">${t('d.back')}</button>
      <h3>Run ${run.no}</h3><button class="ghost danger" data-act="del">${t('d.del')}</button></div>

    <div class="hero">
      <div class="main"><small>${t('d.result', { k: esc(metric(state.focus || '')) })}</small><b>${f2(main?.time)}</b><i>s</i>${b ? `<span class="hdelta">${delta(main?.time, mainB?.time)} ${t('d.vs', { no: oRun.no })}</span>` : ''}</div>
      <div><small>${t('d.maxG')}</small><b>${a.maxG == null ? '–' : a.maxG.toFixed(2)}</b><i>g</i></div>
      <div><small>${t('d.maxV')}</small><b>${a.maxKmh == null ? '–' : a.maxKmh.toFixed(1)}</b><i>${t('kmh')}</i></div>
    </div>

    <div class="dcar"><span class="who">${esc(run.driver || t('d.driver'))}</span>
      <input id="dCar" maxlength="40" placeholder="${t('d.carPh')}" value="${esc(run.car)}" aria-label="${t('d.carPh')}"></div>

    <div class="info">
      <div><small>${t('d.sats')}</small><b>${a.sats ?? '–'}</b></div>
      <div><small>${t('d.slope')}</small><b>${a.slope == null ? '–' : (a.slope > 0 ? '+' : '') + a.slope.toFixed(2) + '%'}</b></div>
      <div><small>${t('d.da')}</small><b>${a.da == null ? '–' : a.da.toFixed(0) + ' m'}</b></div>
      <div><small>${t('d.elev')}</small><b>${a.elev == null ? '–' : (a.elev > 0 ? '+' : '') + a.elev.toFixed(1) + ' m'}</b></div>
      <div><small>${t('d.temp')}</small><b>${a.temp == null ? '–' : state.tempC ? a.temp.toFixed(1) + '°C' : (a.temp * 9 / 5 + 32).toFixed(1) + '°F'}</b></div>
    </div>

    <div class="chips">${keys.map(k => `<button data-focus="${esc(k)}" class="${k === state.focus ? 'on' : ''}">${esc(metric(k))}</button>`).join('')}</div>

    <div class="cmpPick">
      <label for="dCmp">${t('d.cmpWith')}</label>
      <select id="dCmp"><option value="">${t('d.none')}</option>${others.map(h => {
        const dt = new Date(h.at);
        return `<option value="${h.no}" ${h.no === state.cmpNo ? 'selected' : ''}>Run ${h.no} · ${dt.getDate()}/${dt.getMonth() + 1} ${dt.toTimeString().slice(0, 5)}${h.car ? ' · ' + esc(h.car) : ''}${h.results[state.focus] ? ' · ' + h.results[state.focus].time.toFixed(2) + 's' : ''}</option>`;
      }).join('')}</select>
    </div>

    <div class="dchart">
      <div class="axisSw"><button data-x="t" class="${state.xAxis === 't' ? 'on' : ''}">${t('axis.time')}</button><button data-x="d" class="${state.xAxis === 'd' ? 'on' : ''}">${t('axis.dist')}</button></div>
      <div class="legend lgToggle">
        ${[['v', COL.v, t('d.lgV')], ['g', COL.g, t('d.lgG')], ['alt', COL.alt, t('d.lgAlt')]].map(([k, c, l]) =>
          `<button data-series="${k}" class="${state.show[k] ? '' : 'off'}" style="--c:${c}">${l}</button>`).join('')}
        ${a.shifts.length ? `<span style="--c:${COL.shift}">${t('d.lgShift')}</span>` : ''}
      </div>
      ${b ? `<div class="legend lgRuns"><span class="solid" style="--c:#c3cad3">Run ${run.no}</span><span class="dash" style="--c:#c3cad3">Run ${oRun.no}</span></div>` : ''}
      <div class="zoomBar">
        <button data-zoom="left" aria-label="◀">◀</button><button data-zoom="out" aria-label="−">−</button>
        <span id="zoomLbl" class="zoomLbl"></span>
        <button data-zoom="in" aria-label="+">＋</button><button data-zoom="right" aria-label="▶">▶</button>
        <button data-zoom="reset" aria-label="↺">↺</button>
      </div>
      <canvas id="dCanvas" width="700" height="440" aria-label="Graf larian"></canvas>
      <div id="readout" class="readout"></div>
    </div>

    ${a.shifts.length ? `<h4 class="sub">${t('d.shifts')}</h4><table class="splits gears"><thead><tr>
      <th>${t('d.gear')}</th><th>${t('d.distM')}</th><th>${t('d.speedKmh')}</th><th>${t('d.timeS')}</th>${b ? `<th>Run ${oRun.no}</th>` : `<th>${t('d.gLost')}</th>`}</tr></thead>
      <tbody>${a.shifts.map((g, i) => { const o = b?.shifts[i]; return `<tr><td><span class="gearTag">${i + 1}→${i + 2}</span></td><td>${g.d.toFixed(1)}</td>
        <td>${g.v.toFixed(1)}</td><td>${g.t.toFixed(2)}</td>${b
          ? `<td class="oth">${o ? `<span class="nw">${o.d.toFixed(0)} m · ${o.v.toFixed(0)}</span><br><span class="dm">(${g.d < o.d ? '−' : '+'}${Math.abs(g.d - o.d).toFixed(0)} m)</span>` : '–'}</td>`
          : `<td class="g">−${g.drop.toFixed(2)}g · ${g.dur.toFixed(2)}s</td>`}</tr>`; }).join('')}</tbody></table>`
      : a.hasRaw ? `<p class="note">${t('d.noShift')}</p>` : ''}

    <div class="tabs">
      <button data-tab="dist" class="${state.tab === 'dist' ? 'on' : ''}">${t('d.tabDist')}</button>
      <button data-tab="speed" class="${state.tab === 'speed' ? 'on' : ''}">${t('d.tabSpeed')}</button>
      <button data-tab="roll" class="${state.tab === 'roll' ? 'on' : ''}">${t('d.tabRoll')}</button>
    </div>
    ${tabRows.length ? `<table class="splits ${b ? 'withCmp' : ''}"><thead><tr>
      <th>${state.tab === 'dist' ? t('d.colDist') : t('d.colRange')}</th><th>G</th><th>${state.tab === 'dist' ? t('d.speedMax') : t('d.distM')}</th><th>${t('d.split')}</th><th>${t('d.timeS')}</th>${b ? `<th>${t('d.vs', { no: oRun.no })}</th>` : ''}</tr></thead>
      <tbody>${tabRows.map(r => `<tr>
        <td>${esc(metric(r.key))}${r.custom ? ' <span class="cdStar">★</span>' : ''}</td>
        <td class="g">${r.g == null ? '–' : r.g.toFixed(2) + 'g'}</td>
        <td>${state.tab === 'dist' ? f2(r.speed) + (r.vmax != null ? `<span class="vm">${t('res.max', { v: r.vmax.toFixed(1) })}</span>` : '') : r.dist == null ? '–' : r.dist.toFixed(1)}</td>
        <td class="sp">${r.split == null ? '' : '+' + r.split.toFixed(2)}</td>
        <td class="tm">${f2(r.time)}</td>${b ? `<td class="dl">${delta(r.time, b.results[r.key]?.time)}</td>` : ''}</tr>`).join('')}</tbody></table>
      ${b ? `<p class="note">${t('d.vsNote', { no: oRun.no })}</p>` : ''}`
      : `<p class="empty">${t('d.empty')}</p>`}

    <div class="dfoot">
      <label class="toggle"><input type="checkbox" id="dRoll" ${state.rollout ? 'checked' : ''} ${a.hasRaw && !run.imported ? '' : 'disabled'}>
        <span>${t('d.rollout')}</span></label>
      <span class="note">${d.toLocaleDateString(locale())} ${d.toLocaleTimeString(locale())} · ${esc(run.device)}</span>
    </div>
    ${a.hasRaw ? (run.graphFromShot ? `<p class="note">${t('d.fromShot')}</p>` : '') : `<p class="note">${run.imported ? t('imp.noGraph') : t('d.old')}</p>`}
    <p class="note">${esc(t('d.note'))}</p>
  </div>`;

  // graf interaktif: set semula zoom/kursor bila paksi, metrik atau pembanding bertukar
  const key = [state.xAxis, state.focus, state.cmpNo, state.rollout].join('|');
  if (key !== state.viewKey) { state.viewKey = key; state.zoom = null; state.cursor = null; }
  state.chart = { a, b, tEnd: main?.time, oNo: oRun?.no };
  redraw();
  bindChart(el.querySelector('#dCanvas'));

  el.onclick = e => {
    const tg = e.target.closest('[data-act],[data-focus],[data-tab],[data-x],[data-series],[data-zoom]'); // (jangan guna nama 't' — itu fungsi terjemahan)
    if (!tg) return;
    const ds = tg.dataset;
    if (ds.act === 'close') return close();
    if (ds.act === 'del') { if (confirm(t('d.confirmDel', { no: run.no }))) { state.onDelete(); close(); } return; }
    if (ds.focus) { state.focus = ds.focus; return render(); }
    if (ds.tab) { state.tab = ds.tab; return render(); }
    if (ds.x) { state.xAxis = ds.x; return render(); }
    if (ds.series) { state.show[ds.series] = !state.show[ds.series]; return render(); }
    if (ds.zoom) return zoomBtn(ds.zoom);
  };
  el.querySelector('#dCmp').onchange = e => { state.cmpNo = e.target.value ? +e.target.value : null; render(); };
  el.querySelector('#dRoll').onchange = e => { state.rollout = e.target.checked; render(); };
  el.querySelector('#dCar').onchange = e => { run.car = e.target.value.trim(); state.onChange(); };
}

// ---------- Graf interaktif: zoom, kursor & bacaan tepat ----------
// nilai siri pada kedudukan x (masa atau jarak), interpolasi linear
function interp(arr, xk, x, key) {
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  if (x <= arr[0][xk]) return arr[0][key];
  if (x >= arr[hi][xk]) return arr[hi][key];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m][xk] <= x) lo = m; else hi = m; }
  const p = arr[lo], q = arr[hi], f = q[xk] === p[xk] ? 0 : (x - p[xk]) / (q[xk] - p[xk]);
  return p[key] == null || q[key] == null ? (p[key] ?? q[key]) : p[key] + (q[key] - p[key]) * f;
}
// langkah "bulat" untuk tanda paksi
function niceStep(span, n = 5) {
  const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
}
const decimals = step => Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)));

// sediakan data siri (fasa pecutan) untuk paksi semasa
function chartData() {
  const { a, b, tEnd } = state.chart, xk = state.xAxis;
  const s = a.series.filter(p => p.t >= 0);
  if (s.length < 2) return null;
  const tMax = tEnd && tEnd > 0.5 ? tEnd : s[s.length - 1].t;
  const pts = s.filter(p => p.t <= tMax + 1e-6);
  const xMax = xk === 't' ? tMax : Math.max(1, pts[pts.length - 1].d);
  let bPts = [];
  if (b) {
    const bs = b.series.filter(p => p.t >= 0);
    let iM = 0; bs.forEach((p, i) => { if (p.v > bs[iM].v) iM = i; });
    bPts = bs.slice(0, iM + 1).filter(p => p[xk] <= xMax + 1e-6);
  }
  return { pts, bPts, xMax, tMax, xk };
}
const view = d => { const z = state.zoom; return z ? [Math.max(0, z[0]), Math.min(d.xMax, z[1])] : [0, d.xMax]; };
const minSpan = xk => (xk === 't' ? 0.05 : 1);

function setZoom(x0, x1, d) {
  const span = Math.max(minSpan(d.xk), Math.min(d.xMax, x1 - x0));
  if (span >= d.xMax - 1e-9) { state.zoom = null; return; }
  if (x0 < 0) x0 = 0;
  if (x0 + span > d.xMax) x0 = d.xMax - span;
  state.zoom = [x0, x0 + span];
}
function zoomBtn(kind) {
  const d = chartData(); if (!d) return;
  const [v0, v1] = view(d), span = v1 - v0, c = state.cursor != null && state.cursor >= v0 && state.cursor <= v1 ? state.cursor : (v0 + v1) / 2;
  if (kind === 'reset') state.zoom = null;
  if (kind === 'in') setZoom(c - span / 4, c + span / 4, d);
  if (kind === 'out') setZoom(c - span, c + span, d);
  if (kind === 'left') setZoom(v0 - span * 0.4, v1 - span * 0.4, d);
  if (kind === 'right') setZoom(v0 + span * 0.4, v1 + span * 0.4, d);
  redraw();
}

// sentuh/leret = kursor; cubit 2 jari / roda tetikus = zoom
function bindChart(c) {
  const ptrs = new Map(); let pinch = null;
  const toX = (clientX) => {
    const d = chartData(); if (!d) return null;
    const r = c.getBoundingClientRect(), px = (clientX - r.left) * (c.width / r.width);
    const g = state.geom; if (!g) return null;
    const [v0, v1] = view(d);
    return Math.min(v1, Math.max(v0, v0 + ((px - g.L) / g.w) * (v1 - v0)));
  };
  c.onpointerdown = e => {
    ptrs.set(e.pointerId, e.clientX);
    try { c.setPointerCapture(e.pointerId); } catch { /* sesetengah pelayar/sentuhan tidak menyokong */ }
    if (ptrs.size === 2) {
      const d = chartData(), xs = [...ptrs.values()], [v0, v1] = view(d);
      pinch = { dist: Math.abs(xs[0] - xs[1]) || 1, mid: toX((xs[0] + xs[1]) / 2), v0, v1 };
    } else if (ptrs.size === 1) { state.cursor = toX(e.clientX); redraw(); }
  };
  c.onpointermove = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e.clientX);
    if (ptrs.size >= 2 && pinch) {
      const d = chartData(), xs = [...ptrs.values()], dist = Math.abs(xs[0] - xs[1]) || 1;
      const span = (pinch.v1 - pinch.v0) * pinch.dist / dist, f = (pinch.mid - pinch.v0) / (pinch.v1 - pinch.v0);
      setZoom(pinch.mid - span * f, pinch.mid + span * (1 - f), d); redraw();
    } else if (ptrs.size === 1) { state.cursor = toX(e.clientX); redraw(); }
  };
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
  c.onpointerup = up; c.onpointercancel = up;
  c.onwheel = e => {
    e.preventDefault();
    const d = chartData(), [v0, v1] = view(d), m = toX(e.clientX), k = e.deltaY > 0 ? 1.25 : 0.8, f = (m - v0) / (v1 - v0), span = (v1 - v0) * k;
    setZoom(m - span * f, m + span * (1 - f), d); redraw();
  };
}

function redraw() {
  const c = state.el.querySelector('#dCanvas'); if (!c) return;
  const d = chartData();
  draw(c, d);
  readout(d);
  const lbl = state.el.querySelector('#zoomLbl');
  if (lbl && d) {
    const [v0, v1] = view(d), u = d.xk === 't' ? 's' : 'm', dec = d.xk === 't' ? 2 : 0;
    lbl.textContent = state.zoom ? `${v0.toFixed(dec)}–${v1.toFixed(dec)} ${u} · ×${(d.xMax / (v1 - v0)).toFixed(1)}` : t('zoom.full');
  }
}

// panel bacaan pada kedudukan kursor
function readout(d) {
  const box = state.el.querySelector('#readout'); if (!box) return;
  if (!d) { box.innerHTML = ''; return; }
  if (state.cursor == null) { box.innerHTML = `<p class="roHint">${t('zoom.hint')}</p>`; return; }
  const { a, b, oNo } = state.chart, xk = d.xk, x = state.cursor;
  const vals = (arr, shifts) => {
    const o = { t: interp(arr, xk, x, 't'), d: interp(arr, xk, x, 'd'), v: interp(arr, xk, x, 'v'), g: interp(arr, xk, x, 'g'), alt: interp(arr, xk, x, 'alt') };
    o.gear = 1 + (shifts || []).filter(s => s[xk] <= x).length;
    return o;
  };
  const A = vals(d.pts, a.shifts), B = d.bPts.length > 1 ? vals(d.bPts, b.shifts) : null;
  const f = (v, dec, u = '') => v == null || !isFinite(v) ? '–' : v.toFixed(dec) + u;
  const sgn = (v, dec, u = '') => { if (v == null || !isFinite(v)) return '–'; const z = Math.abs(v) < 0.5 * Math.pow(10, -dec); return (z ? '±' : v > 0 ? '+' : '−') + Math.abs(z ? 0 : v).toFixed(dec) + u; };
  const rows = [
    [t('ro.time'), A.t, B?.t, 3, ' s'], [t('ro.dist'), A.d, B?.d, 1, ' m'], [t('ro.speed'), A.v, B?.v, 1, ''],
    [t('ro.g'), A.g, B?.g, 2, ' g'], [t('ro.alt'), A.alt, B?.alt, 1, ' m'], [t('ro.gear'), A.gear, B?.gear, 0, '']
  ];
  // beza yang bermakna: paksi jarak -> beza masa ke titik ini; paksi masa -> beza jarak pada saat ini
  const dIdx = xk === 'd' ? 0 : 1;
  box.innerHTML = `<table class="roTab"><thead><tr><th></th><th>Run ${state.run.no}</th>${B ? `<th>Run ${oNo}</th><th>Δ</th>` : ''}</tr></thead><tbody>${
    rows.map(([lbl, va, vb, dec, u], i) => `<tr${i === dIdx && B ? ' class="key"' : ''}><td>${lbl}</td><td>${f(va, dec, u)}</td>${B ? `<td>${f(vb, dec, u)}</td><td class="${i === dIdx ? (va - vb < 0 ? (xk === 'd' ? 'faster' : 'slower') : (xk === 'd' ? 'slower' : 'faster')) : ''}">${i === 5 ? '' : sgn(va - vb, dec, u)}</td>` : ''}</tr>`).join('')
  }</tbody></table>${B ? `<p class="roNote">${t(xk === 'd' ? 'ro.noteD' : 'ro.noteT', { a: state.run.no })}</p>` : ''}`;
}

function draw(c, d) {
  const x = c.getContext('2d'), W = c.width, H = c.height, show = state.show;
  const L = 78, R = 56, T = 14, B = 44, w = W - L - R, h = H - T - B;
  state.geom = { L, w, T, h };
  x.clearRect(0, 0, W, H);
  if (!d) { x.fillStyle = COL.text; x.font = '20px system-ui'; x.textAlign = 'center'; x.fillText(t('chart.nodata'), W / 2, H / 2); x.textAlign = 'left'; return; }
  const { a, b } = state.chart, { pts, bPts, xk } = d, [v0, v1] = view(d), zoomed = !!state.zoom;
  // titik yang kelihatan (+1 di setiap sisi supaya garisan bersambung ke tepi)
  const vis = arr => { const i0 = Math.max(0, arr.findIndex(p => p[xk] >= v0) - 1), i1 = arr.findIndex(p => p[xk] > v1); return arr.slice(i0, i1 < 0 ? arr.length : i1 + 1); };
  const P = vis(pts), BP = bPts.length > 1 ? vis(bPts) : [];
  const inView = arr => arr.filter(p => p[xk] >= v0 && p[xk] <= v1);
  // skala Y: penuh, atau disesuaikan dengan bahagian yang di-zoom supaya perubahan kecil jelas kelihatan
  const src = zoomed ? [...inView(P), ...inView(BP)] : [...pts, ...bPts];
  const sv = src.map(p => p.v), sg = src.map(p => p.g).filter(v => v != null);
  let vLo = 0, vHi = niceMax(Math.max(...sv, 1));
  if (zoomed && sv.length) { const lo = Math.min(...sv), hi = Math.max(...sv), pad = Math.max(1, (hi - lo) * 0.12); vLo = Math.max(0, lo - pad); vHi = hi + pad; }
  let gBot = Math.min(0, Math.floor(Math.min(...sg, 0) * 2) / 2), gTop = Math.max(0.5, Math.ceil(Math.max(...sg, 0.1) * 2) / 2);
  if (zoomed && sg.length) { const lo = Math.min(...sg), hi = Math.max(...sg), pad = Math.max(0.03, (hi - lo) * 0.12); gBot = lo - pad; gTop = hi + pad; }
  const av = [...pts, ...bPts].map(p => p.alt).filter(v => v != null);
  const aMid = av.length ? (Math.max(...av) + Math.min(...av)) / 2 : 0;
  const aSpan = av.length ? Math.max(10, (Math.max(...av) - Math.min(...av)) * 1.6) : 10;

  const X = v => L + ((v - v0) / (v1 - v0)) * w;
  const Yv = v => T + h - ((v - vLo) / (vHi - vLo)) * h;
  const Yg = g => T + h - ((g - gBot) / (gTop - gBot)) * h;
  const Ya = al => T + h - ((al - (aMid - aSpan / 2)) / aSpan) * h;

  // grid & paksi (tanda X ikut langkah "bulat" untuk julat yang dipaparkan)
  x.font = '17px system-ui'; x.lineWidth = 1; x.setLineDash([5, 5]); x.strokeStyle = COL.grid;
  const xs = niceStep(v1 - v0, 5), xd = decimals(xs);
  for (let xv = Math.ceil(v0 / xs - 1e-9) * xs; xv <= v1 + 1e-9; xv += xs) {
    const xx = X(xv); x.beginPath(); x.moveTo(xx, T); x.lineTo(xx, T + h); x.stroke();
    x.fillStyle = COL.text; x.textAlign = 'center'; x.fillText(xv.toFixed(xd), xx, H - 18);
  }
  for (let i = 0; i <= 4; i++) {
    const y = T + (h * i) / 4, fr = 1 - i / 4;
    x.beginPath(); x.moveTo(L, y); x.lineTo(L + w, y); x.stroke();
    const vv = vLo + (vHi - vLo) * fr, gg = gBot + (gTop - gBot) * fr;
    x.textAlign = 'left'; x.fillStyle = COL.v; x.fillText(vv.toFixed(vHi - vLo < 20 ? 1 : 0), L + w + 6, y + 6);
    x.textAlign = 'right'; x.fillStyle = COL.g; x.fillText(gg.toFixed(gTop - gBot < 1 ? 2 : 1), L - 6, y + 6);
    if (av.length) { x.fillStyle = COL.alt; x.fillText((aMid - aSpan / 2 + aSpan * fr).toFixed(0), L - 46, y + 6); }
  }
  x.setLineDash([]); x.textAlign = 'right'; x.fillStyle = COL.text; x.fillText(xk === 't' ? t('axis.time') : t('axis.dist'), L + w, H - 1);

  x.save(); x.beginPath(); x.rect(L, T - 2, w, h + 4); x.clip();   // lukis siri hanya dalam kawasan graf
  const cmp = BP.length > 1;
  const line = (arr, key, Y, col, { fill = false, dash = null, width = 3 } = {}) => {
    const pp = arr.filter(p => p[key] != null); if (pp.length < 2) return;
    x.beginPath(); pp.forEach((p, i) => (i ? x.lineTo(X(p[xk]), Y(p[key])) : x.moveTo(X(p[xk]), Y(p[key]))));
    if (fill) {
      x.lineTo(X(pp[pp.length - 1][xk]), T + h); x.lineTo(X(pp[0][xk]), T + h); x.closePath();
      const gr = x.createLinearGradient(0, T, 0, T + h); gr.addColorStop(0, col + '55'); gr.addColorStop(1, col + '05');
      x.fillStyle = gr; x.fill();
      x.beginPath(); pp.forEach((p, i) => (i ? x.lineTo(X(p[xk]), Y(p[key])) : x.moveTo(X(p[xk]), Y(p[key]))));
    }
    if (dash) x.setLineDash(dash);
    x.strokeStyle = col; x.lineWidth = width; x.stroke(); x.setLineDash([]);
  };
  if (show.g) line(P, 'g', Yg, COL.g, { fill: !cmp && !zoomed });
  if (show.v) line(P, 'v', Yv, COL.v, { fill: !cmp && !zoomed });
  if (show.alt && av.length) line(P, 'alt', Ya, COL.alt);
  if (cmp) {
    if (show.g) line(BP, 'g', Yg, COL.g, { dash: [9, 6], width: 2.5 });
    if (show.v) line(BP, 'v', Yv, COL.v, { dash: [9, 6], width: 2.5 });
    if (show.alt && av.length) line(BP, 'alt', Ya, COL.alt, { dash: [9, 6], width: 2.5 });
    if (show.v) for (const g of b.shifts) {
      if (g[xk] < v0 || g[xk] > v1) continue;
      x.strokeStyle = COL.other; x.lineWidth = 2; x.beginPath(); x.arc(X(g[xk]), Yv(g.v), 6, 0, Math.PI * 2); x.stroke();
    }
  }
  // penanda tukar gear
  a.shifts.forEach((g, i) => {
    if (g[xk] < v0 || g[xk] > v1 || !show.v) return;
    const gx = X(g[xk]);
    x.strokeStyle = COL.shift; x.lineWidth = 2; x.setLineDash([3, 4]);
    x.beginPath(); x.moveTo(gx, T + 24); x.lineTo(gx, T + h); x.stroke(); x.setLineDash([]);
    x.fillStyle = COL.shift; x.beginPath(); x.arc(gx, Yv(g.v), 5, 0, Math.PI * 2); x.fill();
    const lbl = `${i + 1}→${i + 2}`; x.font = 'bold 16px system-ui'; x.textAlign = 'center';
    const tw = x.measureText(lbl).width + 10;
    x.fillRect(gx - tw / 2, T + 2, tw, 22); x.fillStyle = '#0b0d10'; x.fillText(lbl, gx, T + 19);
  });
  // kursor
  const cur = state.cursor;
  if (cur != null && cur >= v0 && cur <= v1) {
    const cx = X(cur);
    x.strokeStyle = '#ffffff'; x.globalAlpha = 0.85; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(cx, T); x.lineTo(cx, T + h); x.stroke(); x.globalAlpha = 1;
    const dot = (arr, key, Y, col, hollow) => {
      const v = interp(arr, xk, cur, key); if (v == null) return;
      x.beginPath(); x.arc(cx, Y(v), 6, 0, Math.PI * 2);
      if (hollow) { x.strokeStyle = col; x.lineWidth = 2.5; x.stroke(); } else { x.fillStyle = col; x.fill(); }
    };
    if (show.v) dot(pts, 'v', Yv, COL.v); if (show.g) dot(pts, 'g', Yg, COL.g); if (show.alt && av.length) dot(pts, 'alt', Ya, COL.alt);
    if (cmp) { if (show.v) dot(bPts, 'v', Yv, COL.v, true); if (show.g) dot(bPts, 'g', Yg, COL.g, true); }
    x.font = 'bold 16px system-ui'; x.textAlign = cx > L + w - 90 ? 'right' : 'left'; x.fillStyle = '#fff';
    x.fillText(cur.toFixed(xk === 't' ? 3 : 1) + (xk === 't' ? ' s' : ' m'), cx + (x.textAlign === 'right' ? -8 : 8), T + h - 8);
  }
  x.restore(); x.textAlign = 'left';
}

function niceMax(v) { const st = v > 150 ? 50 : v > 60 ? 20 : 10; return Math.max(st, Math.ceil((v * 1.05) / st) * st); }
