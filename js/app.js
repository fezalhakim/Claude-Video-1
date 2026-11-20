import { bleSupported, findKnownDevice } from './ble.js';
import { connectRaceBox } from './devices/racebox.js';
import { connectDragy } from './devices/dragy.js';
import { connectPhoneGps } from './devices/phonegps.js';
import { connectSimulator } from './devices/simulator.js';
import { openDetail } from './detail.js';
import { t, metric, setLang, getLang, locale, applyStatic, detectLang, LANGS } from './i18n.js';
import { packSamples, analyze } from './analysis.js';
import { PerfTimer, SPEED_TARGETS, ROLLING_TARGETS, BRAKE_TARGETS, makeDistTargets, customKey, isDistKey, UNIT_M } from './perf.js';

const $ = id => document.getElementById(id);
// senarai metrik semasa: termasuk jarak tersuai & metrik tersuai lama yang ada dalam sejarah
let ALL = [];
function rebuildKeys() {
  const dist = makeDistTargets(settings.customDist).map(g => g.key);
  const base = [...SPEED_TARGETS.map(g => g.key), ...ROLLING_TARGETS.map(g => g.key), ...dist, ...BRAKE_TARGETS.map(g => g.key)];
  const extra = new Set();
  for (const h of history) for (const k of Object.keys(h.results)) if (!base.includes(k)) extra.add(k);
  ALL = [...base, ...extra];
}
const customKeys = () => (settings.customDist || []).map(customKey);
const HKEY = 'pgear.history.v1', SKEY = 'pgear.settings.v1';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storan tidak tersedia */ } }
};

let conn = null, history = store.get(HKEY, []), settings = { rollout: true, anyBle: false, speak: true, weather: true, driver: '', car: '', lang: detectLang(), customDist: [], ...store.get(SKEY, {}) };
setLang(settings.lang);
// Rollout 1 kaki ON secara lalai. Hanya ikut nilai tersimpan jika pengguna sendiri pernah menukarnya
// (tetapan lama mungkin menyimpan rollout:false secara automatik walaupun tidak pernah disentuh).
if (!settings.rolloutUser) settings.rollout = true;
// beri nombor run kepada rekod lama (yang belum bernombor)
{ let n = 0; for (let i = history.length - 1; i >= 0; i--) { if (history[i].no) n = Math.max(n, history[i].no); else history[i].no = ++n; } }
let cmp = { a: null, b: null, x: 'd' };
let gpsOk = false;
let current = {}, lastSample = null, rateTimes = [], gTrail = [], chartPts = [];

// ---------- Bahasa ----------
const SHORT = { ms: 'BM', en: 'EN', id: 'ID', zh: '中文' };
$('lang').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('langTop').innerHTML = Object.keys(LANGS).map(k => `<option value="${k}">${SHORT[k]}</option>`).join('');
function changeLang(l) {
  settings.lang = l; store.set(SKEY, settings); setLang(l);
  $('lang').value = l; $('langTop').value = l;
  applyStatic();
  $('runState').dataset.st = ''; refreshState();
  setPill(conn ? 'on' : 'off');
  renderResults(); renderHistory(); scheduleDraw();
  document.dispatchEvent(new Event('pgear:lang'));
}
for (const id of ['lang', 'langTop']) $(id).addEventListener('change', e => changeLang(e.target.value));
$('lang').value = getLang(); $('langTop').value = getLang();
applyStatic();

// ---------- Jarak tersuai ----------
function renderCustom() {
  $('cdList').innerHTML = settings.customDist.map((c, i) =>
    `<span>${esc(metric(customKey(c)))}<button data-cd="${i}" aria-label="${t('aria.del')}">×</button></span>`).join('');
}
$('cdAdd').addEventListener('click', () => {
  const v = parseFloat(String($('cdVal').value).replace(',', '.')), u = $('cdUnit').value;
  const m = v * UNIT_M[u];
  if (!(m >= 1 && m <= 10000)) return toast(t('cd.invalid'));
  if (settings.customDist.length >= 10) return toast(t('cd.max'));
  const c = { v: +v.toFixed(3), u };
  if (makeDistTargets().some(g => Math.abs(g.m - m) < 0.01) || settings.customDist.some(o => Math.abs(o.v * UNIT_M[o.u] - m) < 0.01))
    return toast(t('cd.exists'));
  settings.customDist.push(c); $('cdVal').value = '';
  customChanged();
});
$('cdVal').addEventListener('keydown', e => { if (e.key === 'Enter') $('cdAdd').click(); });
$('cdList').addEventListener('click', e => {
  const i = e.target.dataset.cd; if (i === undefined) return;
  settings.customDist.splice(+i, 1); customChanged();
});
function customChanged() {
  store.set(SKEY, settings); timer.setCustomDist(settings.customDist);
  rebuildKeys(); renderCustom(); renderResults(); renderHistory();
}
document.addEventListener('pgear:lang', renderCustom);

// ---------- Tetapan ----------
for (const k of ['driver', 'car']) {
  $(k).value = settings[k] || '';
  $(k).addEventListener('change', () => { settings[k] = $(k).value.trim(); store.set(SKEY, settings); });
}
for (const k of ['rollout', 'anyBle', 'speak', 'weather']) {
  $(k).checked = !!settings[k];
  $(k).addEventListener('change', () => {
    settings[k] = $(k).checked;
    if (k === 'rollout') { settings.rolloutUser = true; timer.rollout = settings.rollout; }
    store.set(SKEY, settings);
  });
}
if (!bleSupported()) $('bleWarn').hidden = false;

// ---------- Enjin masa ----------
const timer = new PerfTimer({
  rollout: settings.rollout, customDist: settings.customDist,
  onState: s => {
    refreshState(s);
    if (s === 'run') { current = {}; chartPts = []; renderResults(); buzz(60); }
  },
  onResult: r => {
    if (r.kind === 'live') {
      Object.assign(current, r.run.results);
      $('elapsed').textContent = (r.run.elapsed || 0).toFixed(2);
      $('dist').textContent = r.run.dist.toFixed(0);
      chartPts = r.run.pts;
      renderResults();
    } else if (r.kind === 'final') {
      Object.assign(current, r.results); renderResults();
      const run = saveRun({ at: r.at, device: conn?.name || '-', rollout: r.rollout, maxKmh: r.maxKmh, results: r.results,
        raw: packSamples(r.samples), driver: settings.driver, car: settings.car, customDist: [...settings.customDist] });
      lastRunNo = run.no; $('lastDetail').hidden = false;
      showSummary(run); buzz([80, 60, 80]);
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

// ---------- Sambungan (dengan sambung semula selepas refresh) ----------
// sessionStorage kekal selepas refresh dalam tab yang sama, tetapi hilang bila app ditutup.
const SESS = 'mgear.session';
const sess = {
  get() { try { return JSON.parse(sessionStorage.getItem(SESS)) || {}; } catch { return {}; } },
  set(v) { try { sessionStorage.setItem(SESS, JSON.stringify({ ...sess.get(), ...v })); } catch { /* abaikan */ } }
};

async function connectDev(dev, btn, extra = {}) {
  if (conn) conn.disconnect();
  setButtons(true);
  const sub = btn?.querySelector('small'), orig = sub?.textContent;
  if (btn) { btn.classList.add('busy'); sub.textContent = t('conn.searching'); }
  try {
    conn = await CONNECTORS[dev]({ onSample, onDisconnect, onStatus, onError: e => toast(e.message), ...extra });
    const keepTop = extra.resume;
    timer.reset(); lastSample = null; rateTimes = [];
    if (!keepTop) resetTop();
    $('devName').textContent = conn.name;
    setPill('on');
    $('livePanel').hidden = false; $('connectPanel').hidden = true; $('resumeBtn').hidden = true;
    sess.set({ dev: dev === 'sim' ? null : dev, bleId: conn.id || null, name: conn.name });
    return true;
  } catch (e) {
    if (e.name !== 'NotFoundError') toast(e.message || String(e)); // NotFoundError = pengguna batal
    conn = null; return false;
  } finally { setButtons(false); if (btn) { btn.classList.remove('busy'); sub.textContent = orig; } }
}
document.querySelectorAll('.dev').forEach(btn => btn.addEventListener('click', () => connectDev(btn.dataset.dev, btn)));

function setPill(st) {
  const el = $('conn');
  if (st === 'on') { el.textContent = t('conn.on', { name: conn.name }); el.className = 'pill on'; }
  else if (st === 'reconnecting') { el.textContent = t('conn.reconnecting'); el.className = 'pill warn'; }
  else { el.textContent = t('conn.off'); el.className = 'pill off'; }
}
function onStatus(st) {
  if (st === 'reconnecting') { setPill('reconnecting'); toast(t('conn.lost')); }
  else if (st === 'connected' && conn) setPill('on');
}

// Selepas refresh: sambung semula peranti terakhir
async function resumeSession() {
  const s = sess.get();
  if (!s.dev) return;
  if (s.dev === 'phone') return connectDev('phone', null, { resume: true });
  // RaceBox / Dragy: cuba tanpa dialog (Chrome yang menyokong getDevices), jika tidak tunjuk butang sekali tekan
  const device = await findKnownDevice(s.bleId);
  if (device) {
    setPill('reconnecting');
    if (await connectDev(s.dev, null, { device, resume: true })) return;
  }
  setPill('off');
  const b = $('resumeBtn');
  b.textContent = t('conn.resume', { name: s.name || s.dev });
  b.hidden = false;
  b.onclick = async () => {
    const d = await findKnownDevice(s.bleId);
    connectDev(s.dev, null, d ? { device: d, resume: true } : { resume: true });
  };
}

$('disconnect').addEventListener('click', () => {
  if (conn) conn.disconnect();
  sess.set({ dev: null }); // putus sengaja: jangan sambung semula selepas refresh
  onDisconnect();
});
$('resetRun').addEventListener('click', () => { timer.reset(); current = {}; chartPts = []; renderResults(); });

function setButtons(dis) { document.querySelectorAll('.dev').forEach(b => b.disabled = dis); }

function onDisconnect() {
  conn = null;
  setPill('off');
  $('livePanel').hidden = true; $('connectPanel').hidden = false;
}

// ---------- Sampel masuk ----------
// Laju maks sesi: laju tertinggi sejak sambung / set semula. Bacaan tanpa fix GPS
// atau dengan ketepatan teruk (GPS telefon > 25 m) diabaikan supaya gangguan tidak dikira.
let topKmh = 0, topFlash = 0;
function resetTop() { topKmh = 0; $('topSpeed').textContent = '0.0'; sess.set({ top: 0 }); }
$('resetMax').addEventListener('click', resetTop);
function trackTop(s) {
  if (!(s.fix >= 2) || (s.hAcc != null && s.hAcc > 25) || (s.sAcc != null && s.sAcc > 2)) return;
  const k = s.speed * 3.6;
  if (k < 2 || k <= topKmh) return; // < 2 km/j = gangguan semasa pegun
  topKmh = k; sess.set({ top: k });
  const now = performance.now();
  if (now - topFlash > 800) { // kesan "rekod baru" (dihadkan supaya tidak berkelip berterusan)
    topFlash = now; const el = $('maxBox'); el.classList.remove('new'); void el.offsetWidth; el.classList.add('new');
  }
}

function onSample(s) {
  lastSample = s;
  trackTop(s);
  timer.push(s);
  const now = performance.now();
  rateTimes.push(now); while (rateTimes.length && now - rateTimes[0] > 1000) rateTimes.shift();
  if (s.gx !== undefined) { gTrail.push([s.gx, s.gy]); if (gTrail.length > 60) gTrail.shift(); }
  scheduleDraw();
}

let drawPending = false;
function scheduleDraw() { if (!drawPending) { drawPending = true; requestAnimationFrame(draw); } }

function refreshState(state = timer.state) {
  const el = $('runState');
  const st = state !== 'run' && lastSample && !gpsOk ? 'gps' : state;
  if (el.dataset.st === st) return;
  el.dataset.st = st; el.className = 'state ' + st; el.textContent = t('state.' + st);
}
const buzz = p => { try { navigator.vibrate?.(p); } catch { /* abaikan */ } };

function draw() {
  drawPending = false;
  const s = lastSample; if (!s) return;
  $('speed').textContent = Math.round(s.speed * 3.6);
  $('topSpeed').textContent = topKmh.toFixed(1);
  $('sats').textContent = s.sats ?? '-';
  $('fix').textContent = s.fix >= 3 ? '3D' : s.fix === 2 ? '2D' : t('fix.none');
  $('fix').style.color = s.fix >= 2 ? 'var(--green)' : 'var(--red)';
  $('hz').textContent = rateTimes.length + ' Hz';
  $('bat').textContent = s.battery != null ? s.battery + '%' + (s.charging ? '⚡' : '') : '-';
  // senarai semak: GPS kuat (3D + >= 6 satelit, atau ketepatan <= 15 m untuk GPS telefon) & berhenti
  gpsOk = s.fix >= 3 && (s.sats == null ? (s.hAcc == null || s.hAcc <= 15) : s.sats >= 6);
  $('stepGps').classList.toggle('ok', gpsOk);
  $('stepStop').classList.toggle('ok', s.speed * 3.6 < 0.8);
  refreshState();
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
  if (r.trap !== undefined) {
    extra = `@ ${r.trap.toFixed(1)} ${t('kmh')}`;
    if (r.vmax != null && r.vmax - r.trap >= 0.5) extra += ` · ${t('res.max', { v: r.vmax.toFixed(1) })}`;
  }
  else if (r.dist !== undefined) extra = `${r.dist.toFixed(1)} m`;
  return `<b>${r.time.toFixed(2)}</b> s<em>${extra}</em>`;
}
function renderResults() {
  const ck = customKeys();
  // tunjuk metrik utama + jarak tersuai; yang lain hanya bila dicapai
  const CORE = ['0-60', '0-100', '100-200', '60ft', '1/8 batu', '1/4 batu'];
  $('results').innerHTML = ALL.filter(k => CORE.includes(k) || ck.includes(k) || current[k]).map(k =>
    `<div class="res ${current[k] ? 'hit' : ''} ${ck.includes(k) ? 'custom' : ''}"><small>${metric(k)}${isDistKey(k) ? '' : ' ' + t('kmh')}</small>${fmt(k, current[k])}</div>`).join('');
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
    runs: history, customDist: settings.customDist, rollout: settings.rollout,
    onChange: () => { persist(); renderHistory(); },
    onDelete: () => removeRun(run.no)
  });
}
// siri kelajuan [t, km/j] untuk graf banding
function curve(run, xk = 't') {
  if (run.raw) {
    const a = analyze(run, run.rollout, settings.customDist);
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
  rebuildKeys();
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
  }).join('') : `<li class="empty">${t('hist.empty')} <button class="ghost" data-demo>${t('hist.tryDemo')}</button></li>`;
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
  if (e.target.dataset.demo !== undefined) { go('measure'); document.querySelector('[data-dev=sim]').click(); return; }
  if (del === undefined) return;
  removeRun(+del);
});
$('clearHist').addEventListener('click', () => {
  if (!history.length || !confirm(t('confirm.clear'))) return;
  const old = history; history = []; persist(); renderHistory();
  toast(t('deletedAll'), t('undo'), () => { history = old; persist(); renderHistory(); });
});
$('exportCsv').addEventListener('click', () => {
  const rows = [['run', 'date', 'device', 'rollout', 'max_kmh', ...ALL.map(k => metric(k) + '_s')]];
  for (const h of history) rows.push([h.no, new Date(h.at).toISOString(), h.device, h.rollout ? 1 : 0, h.maxKmh?.toFixed(1) ?? '',
    ...ALL.map(k => h.results[k]?.time.toFixed(3) ?? '')]);
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `mgear-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
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
function toast(msg, actionLabel, action) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = ''; const sp = document.createElement('span'); sp.textContent = msg; el.appendChild(sp);
  if (actionLabel) {
    const b = document.createElement('button'); b.textContent = actionLabel;
    b.onclick = () => { action(); el.remove(); }; el.appendChild(b);
  }
  clearTimeout(toastT); toastT = setTimeout(() => el.remove(), actionLabel ? 6000 : 4500);
}

function removeRun(no) {
  const i = history.findIndex(h => h.no === no); if (i < 0) return;
  const [run] = history.splice(i, 1); persist(); renderHistory();
  toast(t('deleted', { no }), t('undo'), () => { history.splice(i, 0, run); persist(); renderHistory(); });
}

// ---------- Navigasi tab ----------
let newRuns = 0;
function go(view) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === view));
  window.scrollTo(0, 0);
  if (view === 'history') { newRuns = 0; updateBadge(); }
}
function updateBadge() { const b = $('histBadge'); b.hidden = !newRuns; b.textContent = newRuns; }
document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => go(b.dataset.nav)));

// ---------- Ringkasan selepas larian ----------
function showSummary(run) {
  const pick = ['0-100', '100-200', '60ft', '1/8 batu', '1/4 batu', ...customKeys(), '0-200', '0-60'].filter((k, i, a) => run.results[k] && a.indexOf(k) === i).slice(0, 5);
  const tiles = pick.map(k => `<div><small>${esc(metric(k))}</small><b>${run.results[k].time.toFixed(2)}</b><i>s</i></div>`);
  if (run.maxKmh) tiles.push(`<div><small>${t('d.maxV')}</small><b>${run.maxKmh.toFixed(0)}</b><i>${t('kmh')}</i></div>`);
  $('sheetBody').innerHTML = tiles.join('');
  $('sheet').hidden = false;
  if (document.querySelector('[data-nav=history]').classList.contains('on') === false) { newRuns++; updateBadge(); }
}
$('sheetClose').addEventListener('click', () => { $('sheet').hidden = true; });
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('sheet').hidden = true; });
$('sheetDetail').addEventListener('click', () => { $('sheet').hidden = true; showDetail(lastRunNo); });

// ---------- Panduan kali pertama ----------
const ONB = [['📡', 'onb.t1', 'onb.b1'], ['✅', 'onb.t2', 'onb.b2'], ['🏁', 'onb.t3', 'onb.b3']];
let onbStep = 0;
function renderOnb() {
  const [art, ti, bo] = ONB[onbStep];
  $('onbArt').textContent = art; $('onbTitle').textContent = t(ti); $('onbBody').textContent = t(bo);
  $('onbDots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === onbStep));
  $('onbNext').textContent = onbStep === ONB.length - 1 ? t('onb.start') : t('onb.next');
  $('onbSkip').style.visibility = onbStep === ONB.length - 1 ? 'hidden' : '';
}
function openOnb() { onbStep = 0; renderOnb(); $('onb').hidden = false; }
function closeOnb() { $('onb').hidden = true; settings.onboarded = true; store.set(SKEY, settings); }
$('onbNext').addEventListener('click', () => { if (onbStep < ONB.length - 1) { onbStep++; renderOnb(); } else closeOnb(); });
$('onbSkip').addEventListener('click', closeOnb);
$('showGuide').addEventListener('click', openOnb);
document.addEventListener('pgear:lang', () => { if (!$('onb').hidden) renderOnb(); });

// Elak skrin tidur semasa larian
async function wakeLock() { try { await navigator.wakeLock?.request('screen'); } catch { /* abaikan */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn) wakeLock(); });
document.addEventListener('click', wakeLock, { once: true });

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

rebuildKeys(); renderCustom(); renderResults(); renderHistory();
if (!settings.onboarded) openOnb();

// pulihkan laju maks & sambungan selepas refresh
{ const s0 = sess.get(); if (s0.top > 0) { topKmh = s0.top; $('topSpeed').textContent = topKmh.toFixed(1); } }
resumeSession();
