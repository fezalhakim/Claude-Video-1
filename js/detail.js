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
  state = { run, el, onChange, onDelete, runs, customDist, tempC, rollout: canRecalc && rollout != null ? !!rollout : !!run.rollout, tab: 'dist', focus: null, xAxis: 'd', cmpNo: null };
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
      <div class="legend"><span style="--c:${COL.g}">${t('d.lgG')}</span><span style="--c:${COL.alt}">${t('d.lgAlt')}</span><span style="--c:${COL.v}">${t('d.lgV')}</span>${a.shifts.length ? `<span style="--c:${COL.shift}">${t('d.lgShift')}</span>` : ''}${b ? `<span class="dash" style="--c:${COL.other}">${t('d.lgOther', { no: oRun.no })}</span>` : ''}</div>
      <canvas id="dCanvas" width="700" height="440" aria-label="Graf larian"></canvas>
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
      <label class="toggle"><input type="checkbox" id="dRoll" ${state.rollout ? 'checked' : ''} ${a.hasRaw ? '' : 'disabled'}>
        <span>${t('d.rollout')}</span></label>
      <span class="note">${d.toLocaleDateString(locale())} ${d.toLocaleTimeString(locale())} · ${esc(run.device)}</span>
    </div>
    ${a.hasRaw ? '' : `<p class="note">${run.imported ? t('imp.noGraph') : t('d.old')}</p>`}
    <p class="note">${esc(t('d.note'))}</p>
  </div>`;

  draw(el.querySelector('#dCanvas'), a, main?.time, state.xAxis, b);

  el.onclick = e => {
    const t = e.target;
    if (t.dataset.act === 'close') return close();
    if (t.dataset.act === 'del') { if (confirm(t('d.confirmDel', { no: run.no }))) { state.onDelete(); close(); } return; }
    if (t.dataset.focus) { state.focus = t.dataset.focus; return render(); }
    if (t.dataset.tab) { state.tab = t.dataset.tab; return render(); }
    if (t.dataset.x) { state.xAxis = t.dataset.x; return render(); }
  };
  el.querySelector('#dCmp').onchange = e => { state.cmpNo = e.target.value ? +e.target.value : null; render(); };
  el.querySelector('#dRoll').onchange = e => { state.rollout = e.target.checked; render(); };
  el.querySelector('#dCar').onchange = e => { run.car = e.target.value.trim(); state.onChange(); };
}

function draw(c, a, tEnd, xk = 't', b = null) {
  const x = c.getContext('2d'), W = c.width, H = c.height;
  const L = 78, R = 56, T = 14, B = 44, w = W - L - R, h = H - T - B;
  x.clearRect(0, 0, W, H);
  const s = a.series.filter(p => p.t >= 0);
  if (s.length < 2) { x.fillStyle = COL.text; x.font = '20px system-ui'; x.textAlign = 'center'; x.fillText(t('chart.nodata'), W / 2, H / 2); x.textAlign = 'left'; return; }
  const tMax = tEnd && tEnd > 0.5 ? tEnd : s[s.length - 1].t;
  const pts = s.filter(p => p.t <= tMax + 1e-6);
  const xMax = xk === 't' ? tMax : Math.max(1, pts[pts.length - 1].d);
  // siri pembanding: fasa pecutan sahaja, dipotong pada had paksi X
  let bPts = [];
  if (b) {
    const bs = b.series.filter(p => p.t >= 0);
    let iM = 0; bs.forEach((p, i) => { if (p.v > bs[iM].v) iM = i; });
    bPts = bs.slice(0, iM + 1).filter(p => p[xk] <= xMax + 1e-6);
  }

  const vTop = niceMax(Math.max(...pts.map(p => p.v), ...bPts.map(p => p.v)));
  const gv = pts.map(p => p.g).filter(v => v != null);
  const gTop = Math.max(0.5, Math.ceil(Math.max(...gv, 0.1) * 2) / 2), gBot = Math.min(0, Math.floor(Math.min(...gv, 0) * 2) / 2);
  const av = pts.map(p => p.alt).filter(v => v != null);
  const aMid = av.length ? (Math.max(...av) + Math.min(...av)) / 2 : 0;
  const aSpan = av.length ? Math.max(10, (Math.max(...av) - Math.min(...av)) * 1.6) : 10;

  const X = v => L + (v / xMax) * w;
  const Yv = v => T + h - (v / vTop) * h;
  const Yg = g => T + h - ((g - gBot) / (gTop - gBot)) * h;
  const Ya = al => T + h - ((al - (aMid - aSpan / 2)) / aSpan) * h;

  // grid & paksi
  x.font = '17px system-ui'; x.lineWidth = 1; x.setLineDash([5, 5]); x.strokeStyle = COL.grid;
  for (let i = 0; i <= 4; i++) {
    const y = T + (h * i) / 4, xx = L + (w * i) / 4;
    x.beginPath(); x.moveTo(L, y); x.lineTo(L + w, y); x.stroke();
    x.beginPath(); x.moveTo(xx, T); x.lineTo(xx, T + h); x.stroke();
    x.fillStyle = COL.text; x.textAlign = 'center'; x.fillText(xk === 't' ? ((xMax * i) / 4).toFixed(2) : ((xMax * i) / 4).toFixed(0), xx, H - 18);
    const fr = 1 - i / 4;
    x.textAlign = 'left'; x.fillStyle = COL.v; x.fillText((vTop * fr).toFixed(0), L + w + 6, y + 6);
    x.textAlign = 'right'; x.fillStyle = COL.g; x.fillText((gBot + (gTop - gBot) * fr).toFixed(1), L - 6, y + 6);
    if (av.length) { x.fillStyle = COL.alt; x.fillText((aMid - aSpan / 2 + aSpan * fr).toFixed(0), L - 42, y + 6); }
  }
  x.setLineDash([]); x.textAlign = 'right'; x.fillStyle = COL.text; x.fillText(xk === 't' ? t('axis.time') : t('axis.dist'), L + w, H - 1);

  const area = (key, Y, col, base) => {
    x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(X(p[xk]), Y(p[key])) : x.moveTo(X(p[xk]), Y(p[key]))));
    if (base != null) {
      x.lineTo(X(pts[pts.length - 1][xk]), base); x.lineTo(X(pts[0][xk]), base); x.closePath();
      const gr = x.createLinearGradient(0, T, 0, T + h); gr.addColorStop(0, col + '55'); gr.addColorStop(1, col + '05');
      x.fillStyle = gr; x.fill();
      x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(X(p[xk]), Y(p[key])) : x.moveTo(X(p[xk]), Y(p[key]))));
    }
    x.strokeStyle = col; x.lineWidth = 3; x.stroke();
  };
  if (gv.length) area('g', Yg, COL.g, Yg(Math.max(gBot, 0)));
  area('v', Yv, COL.v, T + h);
  if (av.length) area('alt', Ya, COL.alt, null);

  // larian pembanding: garis kelajuan putus-putus + titik tukar gear berongga
  if (bPts.length > 1) {
    x.strokeStyle = COL.other; x.lineWidth = 2.5; x.setLineDash([8, 6]); x.beginPath();
    bPts.forEach((p, i) => (i ? x.lineTo(X(p[xk]), Yv(p.v)) : x.moveTo(X(p[xk]), Yv(p.v))));
    x.stroke(); x.setLineDash([]);
    for (const g of b.shifts) {
      if (g[xk] > xMax) continue;
      x.strokeStyle = COL.other; x.lineWidth = 2; x.beginPath(); x.arc(X(g[xk]), Yv(g.v), 6, 0, Math.PI * 2); x.stroke();
    }
  }

  // penanda tukar gear
  a.shifts.forEach((g, i) => {
    if (g.t > tMax) return;
    const gx = X(g[xk]);
    x.strokeStyle = COL.shift; x.lineWidth = 2; x.setLineDash([3, 4]);
    x.beginPath(); x.moveTo(gx, T + 24); x.lineTo(gx, T + h); x.stroke(); x.setLineDash([]);
    x.fillStyle = COL.shift; x.beginPath(); x.arc(gx, Yv(g.v), 5, 0, Math.PI * 2); x.fill();
    const lbl = `${i + 1}→${i + 2}`; x.font = 'bold 16px system-ui'; x.textAlign = 'center';
    const tw = x.measureText(lbl).width + 10;
    x.fillRect(gx - tw / 2, T + 2, tw, 22); x.fillStyle = '#0b0d10'; x.fillText(lbl, gx, T + 19);
  });
  x.textAlign = 'left';
}

function niceMax(v) { const st = v > 150 ? 50 : v > 60 ? 20 : 10; return Math.max(st, Math.ceil((v * 1.05) / st) * st); }
