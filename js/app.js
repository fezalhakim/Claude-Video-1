import { bleSupported } from './ble.js';
import { connectRaceBox } from './devices/racebox.js';
import { connectDragy } from './devices/dragy.js';
import { connectPhoneGps } from './devices/phonegps.js';
import { connectSimulator } from './devices/simulator.js';
import { openDetail } from './detail.js';
import { t, metric, setLang, getLang, locale, applyStatic, detectLang, LANGS } from './i18n.js';
import { packSamples, analyze } from './analysis.js';
import { PerfTimer, SPEED_TARGETS, ROLLING_TARGETS, DIST_TARGETS, BRAKE_TARGETS } from './perf.js';

const $ = id => document.getElementById(id);
const ALL = [...SPEED_TARGETS, ...ROLLING_TARGETS, ...DIST_TARGETS, ...BRAKE_TARGETS].map(g => g.key);
const HKEY = 'pgear.history.v1', SKEY = 'pgear.settings.v1';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storan tidak tersedia */ } }
};

let conn = null, history = store.get(HKEY, []), settings = { rollout: false, anyBle: false, speak: true, weather: true, driver: '', car: '', lang: detectLang(), ...store.get(SKEY, {}) };
setLang(settings.lang);
// beri nombor run kepada rekod lama (yang belum bernombor)
{ let n = 0; for (let i = history.length - 1; i >= 0; i--) { if (history[i].no) n = Math.max(n, history[i].no); else history[i].no = ++n; } }
let cmp = { a: null, b: null, x: 'd' };
let current = {}, lastSample = null, rateTimes = [], gTrail = [], chartPts = [];

// ---------- Bahasa ----------
const SHORT = { ms: 'BM', en: 'EN', id: 'ID', zh: '中文' };
$('lang').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('langTop').innerHTML = Object.keys(LANGS).map(k => `<option value="${k}">${SHORT[k]}</option>`).join('');
function changeLang(l) {
  settings.lang = l; store.set(SKEY, settings); setLang(l);
  $('lang').value = l; $('langTop').value = l;
  applyStatic();
  $('runState').textContent = t('state.' + timer.state) || '';
  $('conn').textContent = conn ? t('conn.on', { name: conn.name }) : t('conn.off');
  renderResults(); renderHistory(); scheduleDraw();
  document.dispatchEvent(new Event('pgear:lang'));
}
for (const id of ['lang', 'langTop']) $(id).addEventListener('change', e => changeLang(e.target.value));
$('lang').value = getLang(); $('langTop').value = getLang();
applyStatic();

// ---------- Tetapan ----------
for (const k of ['driver', 'car']) {
  $(k).value = settings[k] || '';
  $(k).addEventListener('change', () => { settings[k] = $(k).value.trim(); store.set(SKEY, settings); });
}
for (const k of ['rollout', 'anyBle', 'speak', 'weather']) {
  $(k).checked = !!settings[k];
  $(k).addEventListener('change', () => {
    settings[k] = $(k).checked; store.set(SKEY, settings);
    if (k === 'rollout') timer.rollout = settings.rollout;
  });
}
if (!bleSupported()) $('bleWarn').hidden = false;

// ---------- Enjin masa ----------
const timer = new PerfTimer({
  rollout: settings.rollout,
  onState: s => { const el = $('runState'); el.className = 'state ' + s; el.textContent = t('state.' + s);
    if (s === 'run') { current = {}; chartPts = []; renderResults(); } },
  onResult: r => {
    if (r.kind === 'live') {
      Object.assign(current, r.run.results);
      $('elapsed').textContent = (r.run.elapsed || 0).toFixed(2);
      $('dist').textContent = r.run.dist.toFixed(0);
      $('vmax').textContent = r.run.maxKmh.toFixed(0);
      chartPts = r.run.pts;
      renderResults();
    } else if (r.kind === 'final') {
      Object.assign(current, r.results); renderResults();
      const run = saveRun({ at: r.at, device: conn?.name || '-', rollout: r.rollout, maxKmh: r.maxKmh, results: r.results,
        raw: packSamples(r.samples), driver: settings.driver, car: settings.car });
      lastRunNo = run.no; $('lastDetail').hidden = false;
      fetchWeather(run);
      announce(r.results);
    } else { // rolling / brake di luar larian
      Object.assign(current, r.results); renderResults();
      saveRun({ at: r.at, device: conn?.name || '-', rollout: false, results: r.results });
      announce(r.results);
    }
  }
});

// ---------- Sambungan ----------
const CONNECTORS = {
  racebox: connectRaceBox,
  dragy: o => connectDragy({ ...o, anyDevice: settings.anyBle }),
  phone: connectPhoneGps,
  sim: connectSimulator
};

document.querySelectorAll('.dev').forEach(btn => btn.addEventListener('click', async () => {
  if (conn) conn.disconnect();
  setButtons(true);
  try {
    conn = await CONNECTORS[btn.dataset.dev]({ onSample, onDisconnect, onError: e => toast(e.message) });
    timer.reset(); lastSample = null; rateTimes = [];
    $('devName').textContent = conn.name;
    $('conn').textContent = t('conn.on', { name: conn.name }); $('conn').className = 'pill on';
    $('livePanel').hidden = false; $('connectPanel').hidden = true;
  } catch (e) {
    if (e.name !== 'NotFoundError') toast(e.message || String(e)); // NotFoundError = pengguna batal
    conn = null;
  } finally { setButtons(false); }
}));

$('disconnect').addEventListener('click', () => { if (conn) conn.disconnect(); onDisconnect(); });
$('resetRun').addEventListener('click', () => { timer.reset(); current = {}; chartPts = []; renderResults(); });

function setButtons(dis) { document.querySelectorAll('.dev').forEach(b => b.disabled = dis); }

function onDisconnect() {
  conn = null;
  $('conn').textContent = t('conn.off'); $('conn').className = 'pill off';
  $('livePanel').hidden = true; $('connectPanel').hidden = false;
}

// ---------- Sampel masuk ----------
function onSample(s) {
  lastSample = s;
  timer.push(s);
  const now = performance.now();
  rateTimes.push(now); while (rateTimes.length && now - rateTimes[0] > 1000) rateTimes.shift();
  if (s.gx !== undefined) { gTrail.push([s.gx, s.gy]); if (gTrail.length > 60) gTrail.shift(); }
  scheduleDraw();
}

let drawPending = false;
function scheduleDraw() { if (!drawPending) { drawPending = true; requestAnimationFrame(draw); } }

function draw() {
  drawPending = false;
  const s = lastSample; if (!s) return;
  $('speed').textContent = Math.round(s.speed * 3.6);
  $('sats').textContent = s.sats ?? '-';
  $('fix').textContent = s.fix >= 3 ? '3D' : s.fix === 2 ? '2D' : t('fix.none');
  $('fix').style.color = s.fix >= 2 ? 'var(--green)' : 'var(--red)';
  $('hz').textContent = rateTimes.length + ' Hz';
  $('bat').textContent = s.battery != null ? s.battery + '%' + (s.charging ? '⚡' : '') : '-';
  drawG(s); drawChart();
}

function drawG(s) {
  const c = $('gmeter'), x = c.getContext('2d'), w = c.width, h = c.height, cx = w / 2, cy = h / 2, R = w / 2 - 14;
  x.clearRect(0, 0, w, h);
  x.strokeStyle = '#2a313a'; x.lineWidth = 2;
  for (const f of [1 / 3, 2 / 3, 1]) { x.beginPath(); x.arc(cx, cy, R * f, 0, Math.PI * 2); x.stroke(); }
  x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
  x.fillStyle = '#8b95a3'; x.font = '18px system-ui'; x.fillText('1.5g', cx + 4, cy - R + 18);
  if (s.gx === undefined) { x.textAlign = 'center'; x.fillText(t('g.nodata'), cx, cy + 40); x.textAlign = 'left'; return; }
  const k = R / 1.5;
  x.strokeStyle = 'rgba(255,59,48,.35)'; x.beginPath();
  gTrail.forEach(([gx, gy], i) => { const px = cx + gy * k, py = cy - gx * k; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.stroke();
  x.fillStyle = '#ff3b30'; x.beginPath(); x.arc(cx + s.gy * k, cy - s.gx * k, 10, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#f2f4f7'; x.font = 'bold 22px system-ui';
  x.fillText(Math.hypot(s.gx, s.gy).toFixed(2) + 'g', 10, h - 12);
}

function drawChart() {
  const c = $('chart'), x = c.getContext('2d'), w = c.width, h = c.height, p = 30;
  x.clearRect(0, 0, w, h);
  const tMax = Math.max(10, ...chartPts.map(q => q[0])), vMax = Math.max(100, ...chartPts.map(q => q[1])) * 1.1;
  x.strokeStyle = '#242a32'; x.fillStyle = '#8b95a3'; x.font = '16px system-ui'; x.lineWidth = 1;
  for (let v = 0; v <= vMax; v += 50) { const y = h - p - (v / vMax) * (h - 2 * p);
    x.beginPath(); x.moveTo(p, y); x.lineTo(w - 8, y); x.stroke(); x.fillText(v, 2, y + 5); }
  x.fillText(tMax.toFixed(0) + ' s', w - 50, h - 8);
  if (chartPts.length < 2) { x.textAlign = 'center'; x.fillText(t('chart.live'), w / 2, h / 2); x.textAlign = 'left'; return; }
  x.strokeStyle = '#ff3b30'; x.lineWidth = 3; x.beginPath();
  chartPts.forEach(([t, v], i) => { const px = p + (t / tMax) * (w - p - 8), py = h - p - (v / vMax) * (h - 2 * p);
    i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.stroke();
}

// ---------- Keputusan ----------
function fmt(key, r) {
  if (!r) return '<b>--.--</b>';
  let extra = '';
  if (r.trap !== undefined) extra = `@ ${r.trap.toFixed(1)} ${t('kmh')}`;
  else if (r.dist !== undefined) extra = `${r.dist.toFixed(1)} m`;
  return `<b>${r.time.toFixed(2)}</b> s<em>${extra}</em>`;
}
function renderResults() {
  $('results').innerHTML = ALL.map(k =>
    `<div class="res ${current[k] ? 'hit' : ''}"><small>${metric(k)}${/batu|ft/.test(k) ? '' : ' ' + t('kmh')}</small>${fmt(k, current[k])}</div>`).join('');
}

// ---------- Sejarah ----------
function saveRun(run) {
  run.no = history.reduce((m, h) => Math.max(m, h.no || 0), 0) + 1;
  history.unshift(run); history = history.slice(0, 200);
  // simpan data mentah (graf & analisis) untuk 60 larian terkini sahaja supaya storan tidak penuh
  history.forEach((h, i) => { if (i >= 60) delete h.raw; });
  // larian baru jadi B, larian sebelumnya jadi A
  cmp.b = run.no; if (!cmp.a || cmp.a === run.no) cmp.a = history[1]?.no ?? null;
  persist(); renderHistory();
  return run;
}
function persist() {
  try { localStorage.setItem(HKEY, JSON.stringify(history)); } catch {
    // storan penuh: buang data mentah larian lama dan cuba lagi
    for (let i = history.length - 1; i > 5; i--) delete history[i].raw;
    store.set(HKEY, history);
  }
}
let lastRunNo = null;
$('lastDetail').addEventListener('click', () => showDetail(lastRunNo));

// Cuaca semasa larian (untuk DA). Tidak wajib; gagal secara senyap jika luar talian.
async function fetchWeather(run) {
  if (!settings.weather || !run.raw) return;
  const lat = lastSample?.lat, lon = lastSample?.lon;
  if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,surface_pressure`;
    const j = await (await fetch(u)).json();
    run.weather = { temp: j.current.temperature_2m, pressure: j.current.surface_pressure };
    persist();
  } catch { /* abaikan */ }
}

function showDetail(no) {
  const run = byNo(no); if (!run) return;
  openDetail(run, $('detail'), {
    runs: history,
    onChange: () => { persist(); renderHistory(); },
    onDelete: () => { history = history.filter(h => h.no !== run.no); persist(); renderHistory(); }
  });
}
// siri kelajuan [t, km/j] untuk graf banding
function curve(run, xk = 't') {
  if (run.raw) {
    const a = analyze(run, run.rollout);
    // fasa pecutan sahaja (hingga kelajuan maksimum), tanpa brek
    const s = a.series.filter(p => p.t >= 0);
    let iMax = 0; s.forEach((p, i) => { if (p.v > s[iMax].v) iMax = i; });
    return { pts: s.slice(0, iMax + 1).map(p => [p[xk], p.v]), shifts: a.shifts.map(g => [g[xk], g.v, g.d]) };
  }
  return { pts: xk === 't' ? (run.pts || []) : [], shifts: [] }; // larian lama tiada data jarak
}
document.querySelectorAll('[data-cx]').forEach(b => b.addEventListener('click', () => {
  cmp.x = b.dataset.cx;
  document.querySelectorAll('[data-cx]').forEach(o => o.classList.toggle('on', o === b));
  renderCompare();
}));
const byNo = no => history.find(h => h.no === no);
const label = h => { const d = new Date(h.at); return `Run ${h.no} · ${d.getDate()}/${d.getMonth() + 1} ${d.toTimeString().slice(0, 5)}`; };

function renderHistory() {
  const best = {};
  for (const h of history) for (const [k, r] of Object.entries(h.results))
    if (!best[k] || r.time < best[k].time) best[k] = r;
  $('best').innerHTML = ALL.filter(k => best[k]).map(k => `<span>${t('best', { k: metric(k) })}: <b>${best[k].time.toFixed(2)} s</b></span>`).join('');
  $('history').innerHTML = history.length ? history.map((h, i) => {
    const vals = ALL.filter(k => h.results[k]).map(k => `${metric(k)} <b>${h.results[k].time.toFixed(2)}</b>`).join(' · ');
    const d = new Date(h.at);
    return `<li><div class="hinfo" data-open="${h.no}"><div class="meta"><span class="runno">Run ${h.no}</span>${d.toLocaleDateString(locale())} ${d.toLocaleTimeString(locale())} · ${esc(h.device)}${h.rollout ? ' · rollout' : ''}${h.maxKmh ? ` · ${t('hist.max')} ${h.maxKmh.toFixed(0)} ${t('kmh')}` : ''}</div>
      <div class="vals">${vals}</div><div class="open">${h.car ? esc(h.car) + ' · ' : ''}${t('hist.open')}</div></div><div class="acts">
      <button class="pick a ${cmp.a === h.no ? 'on' : ''}" data-pick="a" data-no="${h.no}" aria-label="${t('aria.pickA')}">A</button>
      <button class="pick b ${cmp.b === h.no ? 'on' : ''}" data-pick="b" data-no="${h.no}" aria-label="${t('aria.pickB')}">B</button>
      <button data-del="${h.no}" aria-label="${t('aria.del')}">×</button></div></li>`;
  }).join('') : `<li class="empty">${t('hist.empty')}</li>`;
  renderCompare();
}

// ---------- Banding larian ----------
function renderCompare() {
  if (!byNo(cmp.a)) cmp.a = history[1]?.no ?? null;
  if (!byNo(cmp.b)) cmp.b = history[0]?.no ?? null;
  for (const k of ['a', 'b']) {
    $('cmp' + k.toUpperCase()).innerHTML = history.map(h =>
      `<option value="${h.no}" ${cmp[k] === h.no ? 'selected' : ''}>${esc(label(h))}</option>`).join('');
  }
  const A = byNo(cmp.a), B = byNo(cmp.b), body = $('cmpBody');
  if (history.length < 2 || !A || !B) {
    body.innerHTML = `<p class="empty">${t('cmp.need2')}</p>`; return;
  }
  if (A === B) { body.innerHTML = `<p class="empty">${t('cmp.diff2')}</p>`; return; }
  const keys = ALL.filter(k => A.results[k] || B.results[k]);
  let winA = 0, winB = 0;
  const rows = keys.map(k => {
    const a = A.results[k], b = B.results[k];
    let diff = '–', ca = '', cb = '';
    if (a && b) {
      const d = b.time - a.time;
      diff = `<span class="${d < 0 ? 'faster' : d > 0 ? 'slower' : ''}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(2)}</span>`;
      if (d < 0) { cb = 'win'; winB++; } else if (d > 0) { ca = 'win'; winA++; }
    }
    return `<tr><td>${metric(k)}</td><td class="${ca}">${a ? a.time.toFixed(2) : '–'}</td><td class="${cb}">${b ? b.time.toFixed(2) : '–'}</td><td>${diff}</td></tr>`;
  }).join('');
  const vmax = (A.maxKmh || B.maxKmh)
    ? `<tr><td>${t('cmp.maxkmh')}</td><td>${A.maxKmh?.toFixed(0) ?? '–'}</td><td>${B.maxKmh?.toFixed(0) ?? '–'}</td><td></td></tr>` : '';
  const sum = winA === winB ? t('cmp.tie', { n: winA })
    : t('cmp.win', { no: winB > winA ? B.no : A.no, n: Math.max(winA, winB), total: winA + winB });
  body.innerHTML = `<canvas id="cmpChart" width="600" height="300" ></canvas>
    <table class="cmp"><thead><tr><th>${t('cmp.metric')}</th><th><span class="tag a">A</span> Run ${A.no}</th><th><span class="tag b">B</span> Run ${B.no}</th><th>${t('cmp.delta')}</th></tr></thead>
    <tbody>${rows}${vmax}</tbody></table><p class="cmpSum">${sum} ${t('cmp.green')}</p>`;
  const ca = curve(A, cmp.x), cb = curve(B, cmp.x);
  const n = Math.max(ca.shifts.length, cb.shifts.length);
  if (n) {
    const cell = (g, o) => g ? `${g[2].toFixed(0)} m · ${g[1].toFixed(0)}` + (o ? ` <span class="dm">(${g[2] < o[2] ? '−' : '+'}${Math.abs(g[2] - o[2]).toFixed(0)} m)</span>` : '') : '–';
    body.insertAdjacentHTML('beforeend', `<table class="cmp"><thead><tr><th>${t('cmp.shift')}</th><th><span class="tag a">A</span> ${t('cmp.distkmh')}</th><th><span class="tag b">B</span> ${t('cmp.distkmh')}</th></tr></thead><tbody>${
      Array.from({ length: n }, (_, i) => `<tr><td>${i + 1}→${i + 2}</td><td>${cell(ca.shifts[i])}</td><td>${cell(cb.shifts[i], ca.shifts[i])}</td></tr>`).join('')
    }</tbody></table><p class="cmpSum">${t('cmp.shiftNote')}</p>`);
  }
  drawCompare(A, B, ca, cb);
}

function drawCompare(A, B, ca, cb) {
  const c = $('cmpChart'), x = c.getContext('2d'), w = c.width, h = c.height, p = 30;
  const pa = ca.pts, pb = cb.pts, all = [...pa, ...pb];
  x.clearRect(0, 0, w, h);
  if (all.length < 2) {
    x.fillStyle = '#8b95a3'; x.font = '18px system-ui';
    x.textAlign = 'center'; x.fillText(t('chart.nodata'), w / 2, h / 2); x.textAlign = 'left'; return;
  }
  const tMax = Math.max(...all.map(q => q[0])), vMax = Math.max(100, ...all.map(q => q[1])) * 1.1;
  x.strokeStyle = '#242a32'; x.fillStyle = '#8b95a3'; x.font = '16px system-ui'; x.lineWidth = 1;
  for (let v = 0; v <= vMax; v += 50) { const y = h - p - (v / vMax) * (h - 2 * p);
    x.beginPath(); x.moveTo(p, y); x.lineTo(w - 8, y); x.stroke(); x.fillText(v, 2, y + 5); }
  x.textAlign = 'right'; x.fillText(tMax.toFixed(0) + (cmp.x === 't' ? ' s' : ' m'), w - 8, h - 8); x.textAlign = 'left';
  for (const [pts, col] of [[pa, '#ff3b30'], [pb, '#4aa3ff']]) {
    if (!pts.length) continue;
    x.strokeStyle = col; x.lineWidth = 3; x.beginPath();
    pts.forEach(([t, v], i) => { const px = p + (t / tMax) * (w - p - 8), py = h - p - (v / vMax) * (h - 2 * p);
      i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
  }
  // penanda tukar gear (A di atas paksi, B di bawah)
  for (const [sh, col, top] of [[ca.shifts, '#ff3b30', true], [cb.shifts, '#4aa3ff', false]]) {
    for (const [t, v] of sh) {
      const px = p + (t / tMax) * (w - p - 8), py = h - p - (v / vMax) * (h - 2 * p);
      x.strokeStyle = col; x.lineWidth = 1.5; x.setLineDash([3, 4]);
      x.beginPath(); x.moveTo(px, top ? 30 : py); x.lineTo(px, top ? py : h - p); x.stroke(); x.setLineDash([]);
      x.fillStyle = col; x.beginPath(); x.arc(px, py, 4.5, 0, Math.PI * 2); x.fill();
    }
  }
  x.font = 'bold 16px system-ui';
  x.fillStyle = '#ff3b30'; x.fillText('A · Run ' + A.no, p + 10, 22);
  x.fillStyle = '#4aa3ff'; x.fillText('B · Run ' + B.no, p + 110, 22);
}

for (const k of ['a', 'b']) $('cmp' + k.toUpperCase()).addEventListener('change', e => { cmp[k] = +e.target.value; renderHistory(); });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('history').addEventListener('click', e => {
  const op = e.target.closest('[data-open]');
  if (op) { showDetail(+op.dataset.open); return; }
  const { del, pick, no } = e.target.dataset;
  if (pick) { cmp[pick] = +no; renderHistory(); $('compareCard').scrollIntoView({ behavior: 'smooth' }); return; }
  if (del === undefined) return;
  history = history.filter(h => h.no !== +del); persist(); renderHistory();
});
$('clearHist').addEventListener('click', () => {
  if (history.length && confirm(t('confirm.clear'))) { history = []; store.set(HKEY, history); renderHistory(); }
});
$('exportCsv').addEventListener('click', () => {
  const rows = [['run', 'date', 'device', 'rollout', 'max_kmh', ...ALL.map(k => metric(k) + '_s')]];
  for (const h of history) rows.push([h.no, new Date(h.at).toISOString(), h.device, h.rollout ? 1 : 0, h.maxKmh?.toFixed(1) ?? '',
    ...ALL.map(k => h.results[k]?.time.toFixed(3) ?? '')]);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `pgear-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Lain-lain ----------
function announce(results) {
  if (!settings.speak || !('speechSynthesis' in window)) return;
  const keys = ['0-100', '100-200', '1/4 batu', '100-0'].filter(k => results[k]);
  if (!keys.length) return;
  const u = new SpeechSynthesisUtterance(keys.map(k => `${metric(k).replace('-', t('speak.to'))}, ${results[k].time.toFixed(2)} ${t('speak.sec')}`).join('. '));
  u.lang = locale(); speechSynthesis.speak(u);
}
let toastT;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 4500);
}

// Elak skrin tidur semasa larian
async function wakeLock() { try { await navigator.wakeLock?.request('screen'); } catch { /* abaikan */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn) wakeLock(); });
document.addEventListener('click', wakeLock, { once: true });

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

renderResults(); renderHistory();
