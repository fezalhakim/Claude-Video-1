import { bleSupported, findKnownDevice } from './ble.js';
import { connectRaceBox } from './devices/racebox.js';
import { connectDragy } from './devices/dragy.js';
import { connectPhoneGps } from './devices/phonegps.js';
import { connectSimulator } from './devices/simulator.js';
import { openDetail } from './detail.js';
import { importRuns, templateCSV, runFingerprint } from './importer.js';
import { ocrImage, parseReportText } from './ocrimport.js';
import { digitizeChart } from './chartdigitize.js';
import { t, metric, setLang, getLang, locale, applyStatic, detectLang, LANGS } from './i18n.js';
import { packSamples, analyze, unpackSamples, recompute } from './analysis.js';
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

let conn = null, history = store.get(HKEY, []), settings = { rollout: true, keepAwake: true, tempC: true, shown: null, anyBle: false, speak: true, weather: true, driver: '', car: '', lang: detectLang(), customDist: [], ...store.get(SKEY, {}) };
setLang(settings.lang);
// Rollout 1 kaki ON secara lalai. Hanya ikut nilai tersimpan jika pengguna sendiri pernah menukarnya
// (tetapan lama mungkin menyimpan rollout:false secara automatik walaupun tidak pernah disentuh).
if (!settings.rolloutUser) settings.rollout = true;
// beri nombor run kepada rekod lama (yang belum bernombor)
{ let n = 0; for (let i = history.length - 1; i >= 0; i--) { if (history[i].no) n = Math.max(n, history[i].no); else history[i].no = ++n; } }
let cmp = { a: null, b: null, x: 'd', s: 'v' };
let gpsOk = false, locked = false, holdT = null;
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

// ---------- Pilih keputusan yang dipaparkan ----------
const DEFAULT_SHOWN = ['0-60', '0-100', '100-200', '60ft', '1/8 batu', '1/4 batu'];
const shownKeys = () => settings.shown || [...DEFAULT_SHOWN, ...customKeys()];
const ICON_SPEED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 17l4-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.6" fill="currentColor"/></svg>';
const ICON_DIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18M4 15v-4M8 15v-2.5M12 15v-4M16 15v-2.5M20 15v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function renderShown() {
  const sh = shownKeys(), ck = customKeys();
  const row = k => `<label class="shownRow">${isDistKey(k) ? ICON_DIST : ICON_SPEED}<span>${esc(metric(k))}${isDistKey(k) ? '' : ' ' + t('kmh')}${ck.includes(k) ? ` <em>★</em>` : ''}</span><input type="checkbox" data-shown="${esc(k)}" ${sh.includes(k) ? 'checked' : ''}></label>`;
  const speed = ALL.filter(k => !isDistKey(k)), dist = ALL.filter(k => isDistKey(k));
  $('shownList').innerHTML = `<h4>${t('set.grpSpeed')}</h4>${speed.map(row).join('')}<h4>${t('set.grpDist')}</h4>${dist.map(row).join('')}`;
}
$('shownList').addEventListener('change', e => {
  const k = e.target.dataset.shown; if (k == null) return;
  const sh = new Set(shownKeys());
  e.target.checked ? sh.add(k) : sh.delete(k);
  settings.shown = ALL.filter(x => sh.has(x)); store.set(SKEY, settings);
  renderResults(); renderHistory();
});
document.addEventListener('pgear:lang', () => { renderShown(); renderLockSplits(); });

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
  if (settings.shown && !settings.shown.includes(customKey(c))) settings.shown.push(customKey(c));
  customChanged();
});
$('cdVal').addEventListener('keydown', e => { if (e.key === 'Enter') $('cdAdd').click(); });
$('cdList').addEventListener('click', e => {
  const i = e.target.dataset.cd; if (i === undefined) return;
  settings.customDist.splice(+i, 1); customChanged();
});
function customChanged() {
  store.set(SKEY, settings); timer.setCustomDist(settings.customDist);
  rebuildKeys(); renderCustom(); renderShown(); renderResults(); renderHistory();
}
document.addEventListener('pgear:lang', renderCustom);

// ---------- Tetapan ----------
for (const k of ['driver', 'car']) {
  $(k).value = settings[k] || '';
  $(k).addEventListener('change', () => { settings[k] = $(k).value.trim(); store.set(SKEY, settings); });
}
for (const k of ['rollout', 'keepAwake', 'tempC', 'anyBle', 'speak', 'weather']) {
  $(k).checked = !!settings[k];
  $(k).addEventListener('change', () => {
    settings[k] = $(k).checked;
    if (k === 'rollout') { settings.rolloutUser = true; timer.rollout = settings.rollout; }
    if (k === 'keepAwake') keepAwake(!!conn);
    store.set(SKEY, settings);
  });
}
// iPhone/iPad (termasuk iPad yang mengaku Mac)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (!bleSupported()) { if (isIOS) $('iosBle').hidden = false; else $('bleWarn').hidden = false; }

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
    keepAwake(true);
    return true;
  } catch (e) {
    if (e.name !== 'NotFoundError') toast(e.message || String(e)); // NotFoundError = pengguna batal
    conn = null; return false;
  } finally { setButtons(false); if (btn) { btn.classList.remove('busy'); sub.textContent = orig; } }
}
document.querySelectorAll('.dev').forEach(btn => btn.addEventListener('click', () => {
  if (settings.keepAwake && !('wakeLock' in navigator)) startVideoFallback(); // mesti dalam sentuhan pengguna (iPhone)
  connectDev(btn.dataset.dev, btn);
}));

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
  conn = null; keepAwake(false); setLock(false);
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
  $('lkState').className = 'state ' + st; $('lkState').textContent = t('state.' + st);
}
const buzz = p => { try { navigator.vibrate?.(p); } catch { /* abaikan */ } };

function draw() {
  drawPending = false;
  const s = lastSample; if (!s) return;
  $('speed').textContent = Math.round(s.speed * 3.6);
  $('topSpeed').textContent = topKmh.toFixed(1);
  if (locked) {
    $('lkSpeed').textContent = Math.round(s.speed * 3.6); $('lkTop').textContent = topKmh.toFixed(1);
    $('lkTime').textContent = $('elapsed').textContent; $('lkDist').textContent = $('dist').textContent;
  }
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
  const sh = shownKeys();
  $('results').innerHTML = ALL.filter(k => sh.includes(k)).map(k =>
    `<div class="res ${current[k] ? 'hit' : ''} ${ck.includes(k) ? 'custom' : ''}"><small>${metric(k)}${isDistKey(k) ? '' : ' ' + t('kmh')}</small>${fmt(k, current[k])}</div>`).join('');
  renderLockSplits();
}
// Skrin kunci: masa 60ft, 330ft & 1/8 batu (660ft, 201.168 m)
const LOCK_SPLITS = ['60ft', '330ft', '1/8 batu'];
function renderLockSplits() {
  $('lkSplits').innerHTML = LOCK_SPLITS.map(k => {
    const label = metric(k);
    const r = current[k];
    return `<div class="${r ? 'hit' : ''}"><small>${label}</small><b>${r ? r.time.toFixed(2) : '--.--'}</b><em>${r?.trap != null ? r.trap.toFixed(1) + ' ' + t('kmh') : '&nbsp;'}</em></div>`;
  }).join('');
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
    runs: history, customDist: settings.customDist, rollout: settings.rollout, tempC: settings.tempC,
    onChange: () => { persist(); renderHistory(); },
    onDelete: () => removeRun(run.no)
  });
}
// siri kelajuan [t, km/j] untuk graf banding
// siri [x, nilai] untuk graf banding. key: 'v' kelajuan, 'g' pecutan, 'alt' ketinggian
function curve(run, xk = 't', key = 'v') {
  if (run.raw) {
    const a = analyze(run, run.rollout, settings.customDist);
    // fasa pecutan sahaja (hingga kelajuan maksimum), tanpa brek
    const s = a.series.filter(p => p.t >= 0);
    let iMax = 0; s.forEach((p, i) => { if (p.v > s[iMax].v) iMax = i; });
    return { pts: s.slice(0, iMax + 1).filter(p => p[key] != null).map(p => [p[xk], p[key]]),
      // [x, laju (untuk jadual), jarak, nilai siri dipilih (untuk penanda graf)]
      shifts: a.shifts.map(g => [g[xk], g.v, g.d, key === 'v' ? g.v : key === 'g' ? g.g : null]) };
  }
  return { pts: xk === 't' && key === 'v' ? (run.pts || []) : [], shifts: [] }; // larian lama: hanya kelajuan ikut masa
}
document.querySelectorAll('[data-cs]').forEach(b => b.addEventListener('click', () => {
  cmp.s = b.dataset.cs;
  document.querySelectorAll('[data-cs]').forEach(o => o.classList.toggle('on', o === b));
  renderCompare();
}));
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
  const sh = shownKeys();
  $('best').innerHTML = ALL.filter(k => best[k] && sh.includes(k)).map(k => `<span>${t('best', { k: metric(k) })}: <b>${best[k].time.toFixed(2)} s</b></span>`).join('');
  $('history').innerHTML = history.length ? history.map((h, i) => {
    const hk = ALL.filter(k => h.results[k]), hs = hk.filter(k => sh.includes(k));
    const vals = (hs.length ? hs : hk).map(k => `${metric(k)} <b>${h.results[k].time.toFixed(2)}</b>`).join(' · ');
    const d = new Date(h.at);
    return `<li><div class="hinfo" data-open="${h.no}"><div class="meta"><span class="runno">Run ${h.no}</span>${h.imported ? `<span class="impTag">${t('imp.tag')}</span> ` : ''}${d.toLocaleDateString(locale())} ${d.toLocaleTimeString(locale())} · ${esc(h.device)}${h.rollout ? ' · rollout' : ''}${h.maxKmh ? ` · ${t('hist.max')} ${h.maxKmh.toFixed(0)} ${t('kmh')}` : ''}</div>
      <div class="vals">${vals}</div><div class="open">${h.car ? esc(h.car) + ' · ' : ''}${t('hist.open')}</div></div><div class="acts">
      <button class="pick a ${cmp.a === h.no ? 'on' : ''}" data-pick="a" data-no="${h.no}" aria-label="${t('aria.pickA')}">A</button>
      <button class="pick b ${cmp.b === h.no ? 'on' : ''}" data-pick="b" data-no="${h.no}" aria-label="${t('aria.pickB')}">B</button>
      <button data-del="${h.no}" aria-label="${t('aria.del')}">×</button></div></li>`;
  }).join('') : `<li class="empty">${t('hist.empty')} <button class="ghost" data-demo>${t('hist.tryDemo')}</button></li>`;
  renderMetricHist();
  renderCompare();
}

// ---------- Sejarah ikut metrik (senarai metrik -> kedudukan run) ----------
let hv = 'metric', mSel = null, mSort = 'best';
const icon = k => isDistKey(k) ? ICON_DIST : ICON_SPEED;
const unitLbl = k => isDistKey(k) ? '' : ' ' + t('kmh');
function renderMetricHist() {
  document.querySelectorAll('[data-hv]').forEach(b => b.classList.toggle('on', b.dataset.hv === hv));
  $('allRuns').hidden = hv !== 'all';
  const showMetric = hv === 'metric';
  if (showMetric && !history.length) { // tiada larian: guna paparan kosong yang sama
    $('metricList').innerHTML = `<p class="empty">${t('hist.empty')} <button class="ghost" data-demo>${t('hist.tryDemo')}</button></p>`;
    $('metricList').hidden = false; $('metricView').hidden = true; return;
  }
  if (mSel && !history.some(h => h.results[mSel])) mSel = null;
  $('metricList').hidden = !showMetric || !!mSel;
  $('metricView').hidden = !showMetric || !mSel;
  if (!showMetric) return;
  if (!mSel) {
    const sh = shownKeys();
    const keys = ALL.filter(k => history.some(h => h.results[k]))
      .sort((a, b) => (sh.includes(b) ? 1 : 0) - (sh.includes(a) ? 1 : 0)); // pilihan pengguna di atas
    $('metricList').innerHTML = keys.map(k => {
      const runs = history.filter(h => h.results[k]);
      const best = Math.min(...runs.map(h => h.results[k].time));
      return `<button class="mItem" data-metric="${esc(k)}">${icon(k)}<span class="ml"><b>${esc(metric(k))}${unitLbl(k)}</b><small>${t('hist.bestIs', { v: best.toFixed(2) })}</small></span>
        <span class="mc">${t('hist.runs', { n: runs.length })}</span><span class="chev">›</span></button>`;
    }).join('');
    return;
  }
  const k = mSel;
  const runs = history.filter(h => h.results[k]);
  const best = Math.min(...runs.map(h => h.results[k].time));
  const byBest = [...runs].sort((a, b) => a.results[k].time - b.results[k].time);
  const rankOf = new Map(byBest.map((h, i) => [h.no, i + 1]));
  const list = mSort === 'best' ? byBest : [...runs].sort((a, b) => b.at - a.at);
  $('metricView').innerHTML = `<div class="mvHead"><button class="ghost" data-mback>${t('hist.back')}</button><h3>${esc(metric(k))}${unitLbl(k)}</h3></div>
    <div class="seg"><button data-msort="best" class="${mSort === 'best' ? 'on' : ''}">${t('hist.sortBest')}</button><button data-msort="new" class="${mSort === 'new' ? 'on' : ''}">${t('hist.sortNew')}</button></div>
    ${runs.length > 1 ? `<canvas id="mvChart" class="mvChart" width="600" height="200"></canvas><p class="note">${t('hist.trend')}</p>` : ''}
    <ol class="mvList">${list.map(h => {
      const r = h.results[k], rank = rankOf.get(h.no), d = new Date(h.at), dd = r.time - best;
      const extra = r.trap != null ? ` · @ ${r.trap.toFixed(1)} ${t('kmh')}` : r.dist != null ? ` · ${r.dist.toFixed(1)} m` : '';
      return `<li class="mRow ${rank === 1 ? 'top' : ''}"><span class="rank">${rank === 1 ? '🏆' : '#' + rank}</span>
        <div class="mi" data-open="${h.no}"><b>${r.time.toFixed(2)}<i>s</i></b><small>Run ${h.no}${h.imported ? ' · ' + t('imp.tag') + ' ' + esc(h.device) : ''} · ${d.toLocaleDateString(locale())} ${d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}${extra}${h.car ? ' · ' + esc(h.car) : ''}</small></div>
        <span class="dlt">${rank === 1 ? t('hist.top') : '+' + dd.toFixed(2)}</span>
        <span class="acts"><button class="a ${cmp.a === h.no ? 'on' : ''}" data-pick="a" data-no="${h.no}" aria-label="${t('aria.pickA')}">A</button><button class="b ${cmp.b === h.no ? 'on' : ''}" data-pick="b" data-no="${h.no}" aria-label="${t('aria.pickB')}">B</button></span></li>`;
    }).join('')}</ol>`;
  if (runs.length > 1) drawTrend(runs, k, best);
}
function drawTrend(runs, k, best) {
  const c = $('mvChart'), x = c.getContext('2d'), w = c.width, h = c.height, L = 46, R = 14, T = 16, B = 26;
  const pts = [...runs].sort((a, b) => a.at - b.at).map(h => [h.no, h.results[k].time]);
  const ts = pts.map(p => p[1]), lo = Math.min(...ts), hi = Math.max(...ts), pad = Math.max(0.05, (hi - lo) * 0.2);
  const y0 = lo - pad, y1 = hi + pad;
  const X = i => L + (pts.length === 1 ? (w - L - R) / 2 : (i / (pts.length - 1)) * (w - L - R));
  const Y = v => T + ((v - y0) / (y1 - y0)) * (h - T - B); // lebih pantas = lebih tinggi
  x.clearRect(0, 0, w, h); x.font = '15px system-ui'; x.fillStyle = '#8b95a3'; x.strokeStyle = '#242a32'; x.lineWidth = 1;
  for (const v of [lo, (lo + hi) / 2, hi]) { const yy = Y(v); x.beginPath(); x.moveTo(L, yy); x.lineTo(w - R, yy); x.stroke(); x.fillText(v.toFixed(2), 2, yy + 5); }
  x.strokeStyle = '#4aa3ff'; x.lineWidth = 3; x.beginPath();
  pts.forEach(([, v], i) => (i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)))); x.stroke();
  x.textAlign = 'center';
  pts.forEach(([no, v], i) => {
    const isBest = v === best;
    x.fillStyle = isBest ? '#30d158' : '#4aa3ff'; x.beginPath(); x.arc(X(i), Y(v), isBest ? 8 : 5, 0, Math.PI * 2); x.fill();
    if (pts.length <= 12) { x.fillStyle = '#8b95a3'; x.fillText('R' + no, X(i), h - 6); }
  });
  x.textAlign = 'left';
}
document.querySelectorAll('[data-hv]').forEach(b => b.addEventListener('click', () => { hv = b.dataset.hv; renderMetricHist(); }));
for (const id of ['metricList', 'metricView']) $(id).addEventListener('click', e => {
  const m = e.target.closest('[data-metric]');
  if (m) { mSel = m.dataset.metric; mSort = 'best'; renderMetricHist(); $('metricView').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
  if (e.target.closest('[data-mback]')) { mSel = null; renderMetricHist(); return; }
  const so = e.target.closest('[data-msort]'); if (so) { mSort = so.dataset.msort; renderMetricHist(); return; }
  if (e.target.dataset.demo !== undefined) { go('measure'); document.querySelector('[data-dev=sim]').click(); return; }
  const pk = e.target.closest('[data-pick]');
  if (pk) { cmp[pk.dataset.pick] = +pk.dataset.no; renderHistory(); $('compareCard').scrollIntoView({ behavior: 'smooth' }); return; }
  const op = e.target.closest('[data-open]'); if (op) showDetail(+op.dataset.open);
});

// ---------- Banding larian ----------
function renderCompare() {
  // pilihan lalai: B = larian terbaru, A = larian lain (jangan sama dengan B jika dipilih secara automatik)
  const autoA = !byNo(cmp.a), autoB = !byNo(cmp.b);
  if (autoB) cmp.b = history[0]?.no ?? null;
  if (autoA) cmp.a = history.find(h => h.no !== cmp.b)?.no ?? null;
  if ((autoA || autoB) && cmp.a === cmp.b && history.length > 1) cmp.a = history.find(h => h.no !== cmp.b).no;
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
  const ca = curve(A, cmp.x, cmp.s), cb = curve(B, cmp.x, cmp.s);
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
  const tMax = Math.max(...all.map(q => q[0]));
  // skala paksi-Y ikut siri yang dipilih
  const vals = all.map(q => q[1]);
  let yMin, yMax, step;
  if (cmp.s === 'v') { yMin = 0; yMax = Math.max(100, ...vals) * 1.1; step = 50; }
  else if (cmp.s === 'g') { yMin = Math.min(0, Math.floor(Math.min(...vals) * 2) / 2); yMax = Math.max(0.5, Math.ceil(Math.max(...vals) * 2) / 2); step = 0.5; }
  else { const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(1, (hi - lo) * 0.3); yMin = Math.floor(lo - pad); yMax = Math.ceil(hi + pad); step = Math.max(1, Math.round((yMax - yMin) / 4)); }
  const Y = v => h - p - ((v - yMin) / (yMax - yMin)) * (h - 2 * p);
  x.strokeStyle = '#242a32'; x.fillStyle = '#8b95a3'; x.font = '16px system-ui'; x.lineWidth = 1;
  for (let v = yMin; v <= yMax + 1e-9; v += step) { const y = Y(v);
    x.beginPath(); x.moveTo(p, y); x.lineTo(w - 8, y); x.stroke(); x.fillText(cmp.s === 'g' ? v.toFixed(1) : Math.round(v), 2, y + 5); }
  x.fillText(cmp.s === 'v' ? t('kmh') : cmp.s === 'g' ? 'g' : 'm', p + 230, 22);
  x.textAlign = 'right'; x.fillText(tMax.toFixed(0) + (cmp.x === 't' ? ' s' : ' m'), w - 8, h - 8); x.textAlign = 'left';
  for (const [pts, col] of [[pa, '#ff3b30'], [pb, '#4aa3ff']]) {
    if (!pts.length) continue;
    x.strokeStyle = col; x.lineWidth = 3; x.beginPath();
    pts.forEach(([tt, v], i) => { const px = p + (tt / tMax) * (w - p - 8), py = Y(v);
      i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
  }
  // penanda tukar gear (A di atas paksi, B di bawah)
  for (const [sh, col, top] of [[ca.shifts, '#ff3b30', true], [cb.shifts, '#4aa3ff', false]]) {
    for (const [tt, , , v] of sh) {
      if (v == null) continue;
      const px = p + (tt / tMax) * (w - p - 8), py = Y(v);
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
  const keys = shownKeys().filter(k => results[k]).slice(0, 4);
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
  const sh = shownKeys();
  const pick = ALL.filter(k => sh.includes(k) && run.results[k]).slice(0, 5);
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
// ---------- Kekalkan skrin hidup semasa bersambung ----------
// Web app dibekukan bila skrin dikunci (GPS & Bluetooth berhenti), jadi skrin dihalang daripada tidur.
// Utama: Screen Wake Lock API. Sandaran (iPhone lama / pelayar tanpa API): video senyap berulang.
let wakeSentinel = null, awakeVid = null, awakeMode = 'off';
function startVideoFallback() {
  if (!awakeVid) {
    awakeVid = document.createElement('video');
    Object.assign(awakeVid, { muted: true, loop: true, playsInline: true, src: 'media/awake.mp4' });
    awakeVid.setAttribute('playsinline', ''); awakeVid.setAttribute('muted', '');
    awakeVid.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;bottom:0;left:0';
    document.body.appendChild(awakeVid);
  }
  return awakeVid.play().then(() => true).catch(() => false);
}
async function keepAwake(on) {
  if (!on || !settings.keepAwake) {
    try { await wakeSentinel?.release(); } catch { /* abaikan */ }
    wakeSentinel = null; awakeVid?.pause(); awakeMode = 'off'; updateAwake(); return;
  }
  if (document.visibilityState !== 'visible') return;
  let ok = false;
  if ('wakeLock' in navigator) {
    try {
      if (!wakeSentinel) {
        wakeSentinel = await navigator.wakeLock.request('screen');
        wakeSentinel.addEventListener('release', () => { wakeSentinel = null; if (awakeMode === 'lock') { awakeMode = 'fail'; updateAwake(); } });
      }
      ok = true; awakeMode = 'lock';
    } catch { /* cuba sandaran */ }
  }
  if (!ok) { ok = await startVideoFallback(); awakeMode = ok ? 'video' : 'fail'; }
  updateAwake();
}
function updateAwake() {
  const el = $('awake'); if (!el) return;
  el.hidden = !conn || !settings.keepAwake;
  const on = awakeMode === 'lock' || awakeMode === 'video';
  el.className = 'awake ' + (on ? 'on' : 'warn');
  el.textContent = t(on ? 'awake.on' : 'awake.off');
}
// sentuhan pengguna diperlukan oleh sesetengah pelayar (terutama iPhone) — cuba semula pada sentuhan
document.addEventListener('pointerdown', () => { if (conn && awakeMode !== 'lock' && awakeMode !== 'video') keepAwake(true); }, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn) keepAwake(true); });
document.addEventListener('pgear:lang', updateAwake);

// ---------- Kemas kini app ----------
const APP_VERSION = '34';
$('appVer').textContent = 'v' + APP_VERSION;
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;   // lawatan pertama: tiada notis
  navigator.serviceWorker.register('sw.js').then(reg => {
    // semak versi baru setiap kali app dibuka semula
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || shown) return; shown = true;
    if (conn && timer.state === 'run') return;                   // jangan ganggu larian yang sedang direkod
    toast(t('upd.ready'), t('upd.reload'), () => location.reload());
  });
}

// Pindahan data: 0-100 & ujian kelajuan kini dari pegun (tanpa rollout). Kira semula larian lama yang ada data penuh.
{
  let changed = 0;
  for (const h of history) {
    if (h.speedFromStandstill || h.imported || !h.rollout || !h.raw?.d?.length) { h.speedFromStandstill = true; continue; }
    try {
      const f = recompute(unpackSamples(h.raw), true, h.customDist || []);
      if (f) for (const [k, r] of Object.entries(f.results)) if (/^0-\d+$/.test(k)) h.results[k] = r;
      changed++;
    } catch { /* biarkan nilai lama */ }
    h.speedFromStandstill = true;
  }
  if (changed) persist();
}

rebuildKeys(); renderCustom(); renderShown(); renderResults(); renderHistory();
if (!settings.onboarded) openOnb();

// pulihkan laju maks & sambungan selepas refresh
{ const s0 = sess.get(); if (s0.top > 0) { topKmh = s0.top; $('topSpeed').textContent = topKmh.toFixed(1); } }
resumeSession();

// ---------- Panduan pasang (iPhone: arahan; Android: butang Pasang) ----------
let installEvt = null;
function showInstall(how) {
  if (isStandalone || settings.installDismissed) return;
  $('installHow').textContent = how; $('installBar').hidden = false;
}
$('installX').addEventListener('click', () => { $('installBar').hidden = true; settings.installDismissed = true; store.set(SKEY, settings); });
// iPhone hanya boleh dipasang dari Safari (Bluefy/Chrome iOS tiada "Add to Home Screen" untuk PWA penuh)
if (isIOS && !isStandalone && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent) && bleSupported() === false) showInstall(t('inst.ios'));
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e; $('installBtn').hidden = false; showInstall(t('inst.android'));
});
$('installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('installBar').hidden = true;
});
window.addEventListener('appinstalled', () => { $('installBar').hidden = true; });

// ---------- Kunci skrin dalam app (halang tertekan butang semasa memandu) ----------
// Lapisan hitam menyekat semua sentuhan; buka dengan tekan & tahan 🔓 selama 1.5 s.
function setLock(on) {
  if (on === locked) return;
  locked = on; $('lockScr').hidden = !on;
  if (on) {
    $('lkSpeed').textContent = $('speed').textContent; $('lkTop').textContent = $('topSpeed').textContent;
    $('lkState').className = $('runState').className; $('lkState').textContent = $('runState').textContent;
    $('lkTime').textContent = $('elapsed').textContent; $('lkDist').textContent = $('dist').textContent;
    try { window.history.pushState({ mgLock: 1 }, ''); } catch { /* abaikan */ }        // sekat butang Back Android
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    buzz(30);
  } else {
    cancelHold();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    if (window.history.state?.mgLock) window.history.back(); // buang entri sekatan Back
  }
}
$('lockBtn').addEventListener('click', () => setLock(true));
window.addEventListener('popstate', () => { if (locked) { try { window.history.pushState({ mgLock: 1 }, ''); } catch { /* abaikan */ } } });
function cancelHold() { clearTimeout(holdT); holdT = null; $('unlockBtn').classList.remove('holding'); }
$('unlockBtn').addEventListener('pointerdown', e => {
  e.preventDefault(); $('unlockBtn').classList.add('holding');
  holdT = setTimeout(() => { holdT = null; setLock(false); buzz([20, 40, 20]); }, 1500);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('unlockBtn').addEventListener(ev, cancelHold);
// telan semua sentuhan lain pada lapisan kunci
for (const ev of ['click', 'contextmenu', 'touchmove', 'wheel']) $('lockScr').addEventListener(ev, e => { if (!e.target.closest('#unlockBtn')) e.preventDefault(); e.stopPropagation(); }, { passive: false });

// ---------- Import data (Dragy / CSV) ----------
$('importBtn').addEventListener('click', () => { $('importBox').hidden = false; });
$('impClose').addEventListener('click', () => { $('importBox').hidden = true; });
$('importBox').addEventListener('click', e => { if (e.target.id === 'importBox') $('importBox').hidden = true; });
$('impTpl').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([templateCSV()], { type: 'text/csv;charset=utf-8' }));
  a.download = 'mgear-import-template.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('impPick').addEventListener('click', () => $('impFile').click());
$('impFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  let text = '';
  try { text = await file.text(); } catch (err) { return toast(err.message); }
  const { runs } = importRuns(text);
  if (!runs.length) return toast(t('imp.none'));
  const seen = new Set(history.map(runFingerprint));
  const fresh = runs.filter(r => { const fp = runFingerprint(r); if (seen.has(fp)) return false; seen.add(fp); return true; });
  // nombor run diberi ikut tarikh (lama -> baru), sejarah disusun terbaru dahulu
  let n = history.reduce((m, h) => Math.max(m, h.no || 0), 0);
  fresh.sort((a, b) => a.at - b.at).forEach(r => { r.no = ++n; });
  history = [...history, ...fresh].sort((a, b) => b.at - a.at);
  persist(); renderHistory();
  $('importBox').hidden = true;
  const dup = runs.length - fresh.length;
  toast(t('imp.done', { n: fresh.length }) + (dup ? ' · ' + t('imp.dup', { n: dup }) : ''));
});

// ---------- Import dari screenshot (OCR) ----------
let shotQueue = [], shotIdx = 0, shotCond = {}, shotUrl = null, shotGraph = null;
// jarak metrik (m) untuk menala paksi graf dari nilai jadual
const KNOWN_M = { '60ft': 18.288, '100ft': 30.48, '330ft': 100.584, '1/8 batu': 201.168, '1000ft': 304.8, '1/4 batu': 402.336, '1/2 batu': 804.672 };
async function readGraph(file, parsed) {
  const dist = Object.entries(parsed.results).filter(([k]) => KNOWN_M[k]).map(([k, r]) => ({ m: KNOWN_M[k], time: r.time, trap: r.trap }));
  if (!dist.length) return null;
  // label graf (cth. "2.70s 100") ialah masa dari pegun pada paksi graf — sesuai untuk menala graf
  const speed = Object.entries(parsed.labels || {}).map(([k, r]) => ({ kmh: +k.slice(2), time: r.time }));
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  return digitizeChart(x.getImageData(0, 0, c.width, c.height), { T: Math.max(...dist.map(d => d.time)), known: { dist, speed } });
}
$('impShot').addEventListener('click', () => $('shotFile').click());
$('shotFile').addEventListener('change', e => {
  shotQueue = [...e.target.files]; e.target.value = ''; shotIdx = 0;
  if (!shotQueue.length) return;
  $('importBox').hidden = true; $('ocrBox').hidden = false; nextShot();
});
const pad2 = n => String(n).padStart(2, '0');
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
function ocrRow(k = '0-100', time = '', trap = '') {
  const opts = ALL.map(x => `<option value="${esc(x)}" ${x === k ? 'selected' : ''}>${esc(metric(x))}</option>`).join('');
  return `<div class="ocrRow"><select>${opts}</select><input type="number" inputmode="decimal" step="0.001" value="${time}" placeholder="0.00"><input type="number" inputmode="decimal" step="0.01" value="${trap}" placeholder="—"><button aria-label="${t('aria.del')}">×</button></div>`;
}
async function nextShot() {
  if (shotIdx >= shotQueue.length) { $('ocrBox').hidden = true; return; }
  const file = shotQueue[shotIdx];
  $('ocrCount').textContent = shotQueue.length > 1 ? `(${shotIdx + 1}/${shotQueue.length})` : '';
  if (shotUrl) URL.revokeObjectURL(shotUrl); shotUrl = URL.createObjectURL(file); $('ocrImg').src = shotUrl;
  $('ocrForm').hidden = true; $('ocrSave').disabled = true;
  $('ocrStatus').innerHTML = `${t('ocr.reading')}<div class="bar"><i id="ocrBar"></i></div>`;
  let parsed = { results: {} };
  try {
    const txt = await ocrImage(file, p => { const b = document.getElementById('ocrBar'); if (b) b.style.width = Math.round(p * 100) + '%'; });
    parsed = parseReportText(txt);
  } catch { $('ocrStatus').textContent = t('ocr.fail'); }
  shotGraph = null;
  try { shotGraph = await readGraph(file, parsed); } catch { /* tiada graf */ }
  // tanpa graf, label graf (0-100 dari pegun) masih berguna sebagai keputusan; dengan graf, ia dikira semula dengan 1ft rollout
  if (!shotGraph) for (const [k, r] of Object.entries(parsed.labels || {})) if (!parsed.results[k]) parsed.results[k] = r;
  const keys = ALL.filter(k => parsed.results[k]);
  if ($('ocrStatus').textContent !== t('ocr.fail'))
    $('ocrStatus').innerHTML = keys.length ? t('ocr.found', { n: keys.length }) : t('ocr.nothing');
  $('ocrRows').innerHTML = `<div class="ocrHead"><span>${t('ocr.metric')}</span><span>${t('ocr.time')}</span><span>${t('ocr.trap')}</span></div>` +
    (keys.length ? keys.map(k => ocrRow(k, parsed.results[k].time, parsed.results[k].trap ?? '')).join('') : ocrRow());
  $('ocrWhen').value = toLocalInput(file.lastModified || Date.now());
  $('ocrCar').value = settings.car || ''; $('ocrDev').value = parsed.device || 'Dragy'; $('ocrMax').value = '';
  shotCond = { temp: parsed.temp, da: parsed.da, alt: parsed.alt, slope: parsed.slope };
  const c = [shotCond.temp != null && `${shotCond.temp}°C`, shotCond.alt != null && `${shotCond.alt} m`, shotCond.da != null && `DA ${shotCond.da} m`, shotCond.slope != null && `${t('d.slope')} ${shotCond.slope}%`].filter(Boolean);
  $('ocrCond').innerHTML = esc(c.length ? t('ocr.cond', { c: c.join(' · ') }) : '') + '<br>' + (shotGraph ? t('ocr.graph') : t('ocr.noGraph'));
  $('ocrForm').hidden = false; $('ocrSave').disabled = false;
}
$('ocrAdd').addEventListener('click', () => $('ocrRows').insertAdjacentHTML('beforeend', ocrRow()));
$('ocrRows').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') e.target.closest('.ocrRow').remove(); });
$('ocrSkip').addEventListener('click', () => { shotIdx++; nextShot(); });
$('ocrSave').addEventListener('click', () => {
  const results = {};
  $('ocrRows').querySelectorAll('.ocrRow').forEach(r => {
    const [sel, ti, tr] = r.querySelectorAll('select, input');
    const v = parseFloat(String(ti.value).replace(',', '.')), tp = parseFloat(String(tr.value).replace(',', '.'));
    if (v > 0) { results[sel.value] = { time: v }; if (tp > 0) results[sel.value].trap = tp; }
  });
  if (!Object.keys(results).length) return toast(t('ocr.needOne'));
  const at = new Date($('ocrWhen').value).getTime() || Date.now();
  const max = parseFloat($('ocrMax').value);
  const run = { at, imported: true, device: $('ocrDev').value.trim() || 'Dragy', car: $('ocrCar').value.trim(), driver: settings.driver || '',
    rollout: true, maxKmh: max > 0 ? max : undefined, results, slope: shotCond.slope,
    weather: (shotCond.temp != null || shotCond.da != null) ? { temp: shotCond.temp, da: shotCond.da } : undefined, note: 'screenshot' };
  if (shotGraph) { run.raw = packSamples(shotGraph.samples); run.graphFromShot = true; } // graf dibina semula dari screenshot
  if (history.some(h => runFingerprint(h) === runFingerprint(run))) { toast(t('imp.dup', { n: 1 })); shotIdx++; return nextShot(); }
  run.no = history.reduce((m, h) => Math.max(m, h.no || 0), 0) + 1;
  history = [...history, run].sort((a, b) => b.at - a.at);
  persist(); renderHistory(); toast(t('ocr.saved'));
  shotIdx++; nextShot();
});

