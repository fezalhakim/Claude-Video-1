// Import larian dari fail CSV (templat MGear, eksport MGear, atau keputusan Dragy yang disalin ke CSV).
// Tajuk lajur dikenal pasti secara fleksibel: "0-100", "0-100 km/h", "60ft", "1/8 mile", "1/4 mile trap" ...

export const TEMPLATE_HEADERS = ['date', 'time', 'car', 'driver', 'device', 'rollout', 'max_kmh',
  '0-60', '0-100', '100-200', '0-200', '60ft', '330ft', '1/8 mile', '1/8 mile trap kmh', '1/4 mile', '1/4 mile trap kmh', 'notes'];
const EXAMPLE = ['2026-11-20', '21:30', 'Proton Satria Neo', 'Faizal', 'Dragy', '1', '182.5',
  '2.45', '5.62', '', '', '2.10', '5.95', '9.10', '135.2', '14.05', '165.8', 'CONTOH - padam baris ini / EXAMPLE - delete this row'];

/** Kandungan fail templat (dengan BOM supaya Excel membaca UTF-8 dengan betul). */
export function templateCSV() {
  const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return '﻿' + [TEMPLATE_HEADERS, EXAMPLE].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}

/** Penghurai CSV ringkas: petikan "...", pemisah , ; atau tab (dikesan dari baris tajuk). */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = ch => (first.match(new RegExp(ch === '\t' ? '\t' : '\\' + ch, 'g')) || []).length;
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { rows: rows.filter(r => r.some(v => v.trim() !== '')), delim };
}

const DIST_ALIASES = [
  [/^(1\/8(mile|mi|batu|mil)?|660ft|eighthmile|1\/8英里)$/, '1/8 batu'],
  [/^(1\/4(mile|mi|batu|mil)?|1320ft|quartermile|1\/4英里)$/, '1/4 batu'],
  [/^(1\/2(mile|mi|batu|mil)?|halfmile|1\/2英里)$/, '1/2 batu'],
  [/^(1(mile|mi|batu|mil)|1英里)$/, '1 batu']
];

/** Kenal pasti makna satu tajuk lajur. */
export function classifyHeader(raw) {
  const h0 = String(raw).toLowerCase().trim();
  let h = h0.replace(/\(.*?\)/g, '').replace(/_s$/, '').replace(/\s+/g, '');
  const field = {
    date: /^(date|tarikh|tanggal|日期)$/, time: /^(time|jam|waktu|clock|时间)$/, car: /^(car|kereta|vehicle|mobil|车辆)$/,
    driver: /^(driver|pemandu|pengemudi|车手)$/, device: /^(device|peranti|perangkat|设备)$/, rollout: /^rollout/,
    max: /^(max_?kmh|maxkm\/?h|max|maxspeed|topspeed|lajumaks|kecepatanmaks|最高速度)$/, notes: /^(notes?|nota|catatan|备注)$/,
    datetime: /^(datetime|tarikhmasa)$/
  };
  for (const [k, re] of Object.entries(field)) if (re.test(h)) return { field: k };
  const isTrap = /trap|speed|laju|kmh|km\/h|km\/j/.test(h0) && !/^\d+-\d+/.test(h);
  h = h.replace(/trap|speed|laju|km\/?h|km\/j|kmh|seconds?|saat|time|masa/g, '');
  let key = null;
  for (const [re, k] of DIST_ALIASES) if (re.test(h)) key = k;
  if (!key && /^\d+-\d+$/.test(h)) key = h;                       // 0-100, 100-200, 100-0 ...
  if (!key && /^\d+(\.\d+)?ft$/.test(h)) key = h;                 // 60ft, 330ft, 1000ft
  if (!key && /^\d+(\.\d+)?m$/.test(h)) key = h.replace(/m$/, '') + ' m';
  if (!key) return null;
  return isTrap ? { trap: key } : { metric: key };
}

function parseNum(v, delim) {
  if (v == null) return NaN;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (delim === ';' || (/,\d+$/.test(s) && !s.includes('.'))) s = s.replace(',', '.');
  return s === '' ? NaN : parseFloat(s);
}

/** Tarikh: YYYY-MM-DD, DD/MM/YYYY (gaya Malaysia), DD-MM-YYYY, atau ISO penuh; masa HH:MM[:SS] [AM/PM]. */
export function parseDate(d, tm) {
  d = String(d || '').trim(); tm = String(tm || '').trim();
  let y, mo, da, m;
  if ((m = d.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
    [y, mo, da] = [+m[1], +m[2], +m[3]]; if (m[4] && !tm) tm = `${m[4]}:${m[5]}:${m[6] || 0}`;
  } else if ((m = d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i))) {
    [da, mo, y] = [+m[1], +m[2], +m[3]]; if (y < 100) y += 2000;
    if (mo > 12 && da <= 12) [da, mo] = [mo, da];                 // tarikh gaya AS (MM/DD)
    if (m[4] && !tm) tm = `${m[4]}:${m[5]}:${m[6] || 0} ${m[7] || ''}`;
  } else return null;
  let hh = 12, mm = 0, ss = 0;
  const tmm = tm.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|pg|ptg)?/i);
  if (tmm) {
    hh = +tmm[1]; mm = +tmm[2]; ss = +(tmm[3] || 0);
    const ap = (tmm[4] || '').toLowerCase();
    if ((ap === 'pm' || ap === 'ptg') && hh < 12) hh += 12;
    if ((ap === 'am' || ap === 'pg') && hh === 12) hh = 0;
  }
  const dt = new Date(y, mo - 1, da, hh, mm, ss);
  return isNaN(dt) || dt.getMonth() !== mo - 1 ? null : dt.getTime();
}

/**
 * Tukar teks CSV kepada rekod larian MGear.
 * Pulangkan { runs, skipped, problems: [teks] }.
 */
export function importRuns(text) {
  const { rows, delim } = parseCSV(text);
  if (rows.length < 2) return { runs: [], skipped: 0, problems: ['empty'] };
  const head = rows[0].map(classifyHeader);
  if (!head.some(h => h?.metric)) return { runs: [], skipped: rows.length - 1, problems: ['noMetrics'] };
  const runs = []; let skipped = 0;
  rows.slice(1).forEach((r, i) => {
    const f = {}, results = {}, traps = {};
    head.forEach((h, j) => {
      const v = (r[j] ?? '').trim(); if (!h || v === '') return;
      if (h.field) f[h.field] = v;
      else if (h.metric) { const n = parseNum(v, delim); if (n > 0 && n < 600) results[h.metric] = { time: n }; }
      else if (h.trap) { const n = parseNum(v, delim); if (n > 0 && n < 600) traps[h.trap] = n; }
    });
    if (/^(contoh|example)/i.test(f.notes || '')) { skipped++; return; }  // baris contoh templat
    for (const [k, v] of Object.entries(traps)) if (results[k]) results[k].trap = v;
    if (!Object.keys(results).length) { skipped++; return; }
    const at = parseDate(f.datetime || f.date, f.time) ?? (Date.now() - (rows.length - i) * 60000);
    const max = parseNum(f.max, delim);
    runs.push({
      at, imported: true, device: f.device || 'Dragy', car: f.car || '', driver: f.driver || '',
      rollout: /^(1|y|yes|ya|true|on)$/i.test(f.rollout || ''), maxKmh: max > 0 ? max : undefined,
      results, note: f.notes || ''
    });
  });
  return { runs, skipped, problems: [] };
}

/** Cap jari untuk elak import berganda. */
export const runFingerprint = r => `${Math.round(r.at / 60000)}|${Object.entries(r.results).sort().map(([k, v]) => k + ':' + v.time.toFixed(2)).join(',')}`;
