// Analisis terperinci satu larian: siri masa (kelajuan, G, ketinggian), split,
// cerun, ketinggian ketumpatan (DA), dan pengiraan semula dengan/tanpa rollout.
import { PerfTimer, speedTargets, rollingTargets, brakeTargets, makeDistTargets } from './perf.js';

const G = 9.80665;

/** Mampatkan sampel mentah untuk storan: [dtMs, v(m/s), alt(m), gx|null, sats]. */
export function packSamples(samples) {
  if (!samples?.length) return null;
  const t0 = samples[0].t;
  return { t0, d: samples.map(s => [Math.round(s.t - t0), +s.speed.toFixed(3), +(s.alt ?? 0).toFixed(1),
    s.gx == null ? null : +s.gx.toFixed(3), s.sats ?? null]) };
}
export function unpackSamples(raw) {
  if (!raw?.d) return [];
  return raw.d.map(([dt, speed, alt, gx, sats]) => ({ t: raw.t0 + dt, speed, alt, gx: gx ?? undefined, sats }));
}

/** Kira semula keputusan dari sampel mentah (cth. bila togol rollout ditukar). */
export function recompute(samples, rollout, customDist = []) {
  let final = null;
  const pt = new PerfTimer({ rollout, customDist, onResult: r => { if (r.kind === 'final') final = r; } });
  for (const s of samples) pt.push(s);
  if (!final) pt.finish();
  return final;
}

/** Pecutan membujur (g) diterbitkan dari kelajuan GNSS, dilicinkan ~0.3 s. */
function derivedG(samples) {
  const n = samples.length, raw = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)], b = samples[Math.min(n - 1, i + 1)];
    const dt = (b.t - a.t) / 1000;
    raw[i] = dt > 0 ? (b.speed - a.speed) / dt / G : 0;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0;
    for (let j = i; j >= 0 && samples[i].t - samples[j].t <= 150; j--) { sum += raw[j]; c++; }
    for (let j = i + 1; j < n && samples[j].t - samples[i].t <= 150; j++) { sum += raw[j]; c++; }
    out.push(sum / c);
  }
  return out;
}

/** Siri relatif kepada permulaan larian: { t(s), v(km/j), g, alt(m), d(m) } */
export function buildSeries(samples, startT) {
  if (samples.length < 2) return [];
  const hasDevG = samples.some(s => s.gx !== undefined && s.gx !== null);
  const gs = hasDevG ? smooth(samples.map(s => s.gx ?? 0), samples, 100) : derivedG(samples);
  const out = []; let d = 0;
  samples.forEach((s, i) => {
    if (i) d += (samples[i - 1].speed + s.speed) / 2 * (s.t - samples[i - 1].t) / 1000;
    out.push({ t: (s.t - startT) / 1000, v: s.speed * 3.6, g: gs[i], alt: s.alt ?? 0, d, sats: s.sats });
  });
  // jarak relatif kepada titik mula (t = 0)
  const d0 = at(out, 0, 'd');
  return out.map(p => ({ ...p, d: p.d - d0 })).filter(p => p.t >= -0.05);
}

function smooth(vals, samples, halfMs) {
  return vals.map((_, i) => {
    let sum = 0, c = 0;
    for (let j = i; j >= 0 && samples[i].t - samples[j].t <= halfMs; j--) { sum += vals[j]; c++; }
    for (let j = i + 1; j < vals.length && samples[j].t - samples[i].t <= halfMs; j++) { sum += vals[j]; c++; }
    return sum / c;
  });
}

/**
 * Kesan tukar gear: G jatuh dengan ketara (>= 0.12 g atau 30% dari puncak sebelumnya)
 * kemudian pulih dalam masa 0.8 s. Titik tukar = saat G mula jatuh.
 */
export function detectShifts(acc) {
  const shifts = [];
  for (let i = 1; i < acc.length - 1; i++) {
    const p = acc[i];
    if (p.v < 15 || !(p.g <= acc[i - 1].g && p.g < acc[i + 1].g)) continue;
    let pk = null, rec = null;
    for (let j = i - 1; j >= 0 && p.t - acc[j].t <= 0.8; j--) if (!pk || acc[j].g > pk.g) pk = acc[j];
    for (let j = i + 1; j < acc.length && acc[j].t - p.t <= 0.8; j++) if (!rec || acc[j].g > rec.g) rec = acc[j];
    if (!pk || !rec) continue;
    const drop = pk.g - p.g;
    if (drop < Math.max(0.12, 0.3 * pk.g) || rec.g - p.g < 0.08) continue;
    // titik mula jatuhan: dari minimum ke belakang, titik pertama G >= 80% jalan ke puncak
    let st = pk;
    for (let j = i - 1; j >= 0 && acc[j].t >= pk.t; j--) if (acc[j].g >= p.g + 0.8 * drop) { st = acc[j]; break; }
    const sh = { t: st.t, d: st.d, v: st.v, g: st.g, tMin: p.t, gMin: p.g, drop, dur: rec.t - pk.t };
    const last = shifts[shifts.length - 1];
    // Tukar gear yang sama jika: jatuhan dalam 0.35 s, ATAU beza kelajuan terlalu kecil untuk gear berbeza
    // (< 8 km/j atau < 8%). Motor laju boleh tukar setiap ~0.6 s tetapi kelajuannya tetap jauh berbeza.
    const sameShift = last && (p.t - last.tMin < 0.35 || sh.v - last.v < Math.max(8, last.v * 0.08));
    if (sameShift) { if (sh.drop > last.drop) shifts[shifts.length - 1] = sh; }
    else shifts.push(sh);
  }
  return shifts;
}

/** Nilai pada masa t (interpolasi linear). */
export function at(series, t, key) {
  for (let i = 1; i < series.length; i++) {
    if (series[i].t >= t) {
      const a = series[i - 1], b = series[i], f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a[key] + (b[key] - a[key]) * f;
    }
  }
  return series.length ? series[series.length - 1][key] : 0;
}

/** Ketinggian ketumpatan (m) dari suhu (°C) & tekanan stesen (hPa). */
export function densityAltitude(tempC, pressureHpa) {
  if (tempC == null || pressureHpa == null) return null;
  const ratio = (pressureHpa / 1013.25) * (288.15 / (tempC + 273.15));
  return 44330.8 * (1 - Math.pow(ratio, 0.234969));
}

/** Analisis penuh. run = rekod sejarah. */
/** customDist: jarak tersuai semasa — boleh dikira semula untuk larian lama yang ada data mentah. */
export function analyze(run, rollout, customDist = []) {
  const allCustom = [...(run.customDist || []), ...customDist];
  const samples = unpackSamples(run.raw);
  let results = run.results, startT = null, maxKmh = run.maxKmh;
  if (samples.length > 2) {
    // larian import (Dragy): diukur dengan 1ft rollout (NHRA) — kira graf dengan rollout yang sama seperti larian asal
    const f = recompute(samples, run.imported ? run.rollout !== false : rollout, allCustom);
    // larian import dengan graf dari screenshot: nilai tepat dari jadual diutamakan, graf mengisi metrik lain
    if (f) { results = run.imported ? { ...f.results, ...run.results } : f.results; startT = f.startT; maxKmh = run.imported ? (run.maxKmh ?? f.maxKmh) : f.maxKmh; }
  }
  let series = [];
  if (startT != null) series = buildSeries(samples, startT);
  else if (run.pts?.length) series = run.pts.map(([t, v]) => ({ t, v, g: null, alt: null }));

  // Hadkan analisis "larian pecutan" ke bahagian sebelum kelajuan maksimum
  let iMax = 0; series.forEach((p, i) => { if (p.v > series[iMax].v) iMax = i; });
  const acc = series.slice(0, iMax + 1).filter(p => p.t >= 0);
  const hasG = acc.some(p => p.g != null);
  const maxG = hasG ? Math.max(...acc.map(p => p.g)) : null;
  const shifts = hasG ? detectShifts(acc) : [];

  let slope = null, elev = null, sats = null;
  if (acc.length > 2 && acc[0].alt != null) {
    const a = acc[0], b = acc[acc.length - 1];
    elev = b.alt - a.alt;
    slope = b.d - a.d > 20 ? (elev / (b.d - a.d)) * 100 : null;
    const sv = acc.map(p => p.sats).filter(x => x != null);
    sats = sv.length ? Math.round(sv.reduce((x, y) => x + y, 0) / sv.length) : null;
  }

  const rowsFor = (targets, kind) => {
    let prev = 0;
    return targets.filter(g => results[g.key]).map(g => {
      const r = results[g.key];
      const row = { key: g.key, time: r.time, split: prev ? r.time - prev : null,
        g: hasG && kind !== 'roll' ? at(series, r.time, 'g') : null,
        speed: r.trap ?? null, vmax: r.vmax ?? null, dist: r.dist ?? null, custom: !!g.custom };
      if (kind !== 'roll') prev = r.time;
      return row;
    });
  };

  return {
    results, series, shifts, maxG, maxKmh, slope: run.imported && run.slope != null ? run.slope : (slope ?? run.slope ?? null), elev, sats,
    da: run.weather?.da ?? densityAltitude(run.weather?.temp, run.weather?.pressure),
    temp: run.weather?.temp ?? null,
    hasRaw: samples.length > 2,
    rows: {
      dist: rowsFor(makeDistTargets(allCustom), 'dist'),
      speed: rowsFor(speedTargets(), 'speed'),
      roll: rowsFor([...rollingTargets(), ...brakeTargets()], 'roll')
    }
  };
}
