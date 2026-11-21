// Enjin pengiraan masa prestasi. Masa dikira dari cap masa GNSS peranti (bukan masa
// ketibaan BLE) dan setiap lintasan ambang diinterpolasi secara linear antara sampel.
export const FT = 0.3048, MILE = 1609.344;
const KMH = 3.6;

// Senarai lalai (sama seperti Dragy). Pengguna boleh tambah kelajuan sendiri (lihat setCustomSpeed).
export const SPEED_TARGETS = [            // dari pegun (km/j)
  { key: '0-60', to: 60 }, { key: '0-100', to: 100 }, { key: '0-200', to: 200 }
];
export const ROLLING_TARGETS = [          // bergolek (km/j)
  { key: '100-200', from: 100, to: 200 }, { key: '200-250', from: 200, to: 250 },
  { key: '200-300', from: 200, to: 300 }
];
export const DIST_TARGETS = [             // jarak (m)
  { key: '60ft', m: 60 * FT }, { key: '100ft', m: 100 * FT }, { key: '330ft', m: 330 * FT },
  { key: '1/8 batu', m: MILE / 8 },
  { key: '1000ft', m: 1000 * FT }, { key: '1/4 batu', m: MILE / 4 },
  { key: '1/2 batu', m: MILE / 2 }, { key: '1 batu', m: MILE }
];

/** Jarak tersuai: { v: nilai, u: 'm' | 'ft' | 'mi' } -> sasaran { key, m, custom: true } */
export const UNIT_M = { m: 1, ft: FT, mi: MILE };
export function customKey(c) {
  const n = +(+c.v).toFixed(3);
  return c.u === 'ft' ? `${n}ft` : c.u === 'mi' ? `${n} batu` : `${n} m`;
}
export function makeDistTargets(custom = []) {
  const out = [...DIST_TARGETS];
  for (const c of custom) {
    const key = customKey(c), m = c.v * UNIT_M[c.u];
    if (!(m > 0) || out.some(g => g.key === key || Math.abs(g.m - m) < 0.01)) continue;
    out.push({ key, m, custom: true });
  }
  return out.sort((a, b) => a.m - b.m);
}
export const isDistKey = k => /(ft|batu| m)$/.test(k);

/**
 * Kelajuan tersuai: { from, to } km/j.
 *   from = 0          -> dari pegun (cth. 0-120)
 *   0 < from < to     -> bergolek (cth. 80-160)
 *   from > to = 0     -> brek (cth. 120-0)
 */
let customSpeed = [];
export const speedKey = c => `${+c.from}-${+c.to}`;
export function validSpeed(c) {
  const a = +c.from, b = +c.to;
  return Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0 && a <= 450 && b <= 450 && a !== b && (a < b || b === 0);
}
export function setCustomSpeed(list = []) { customSpeed = list.filter(validSpeed); }
const merge = (base, extra) => { const keys = new Set(base.map(g => g.key)); return [...base, ...extra.filter(g => !keys.has(g.key))]; };
export const speedTargets = () => merge(SPEED_TARGETS, customSpeed.filter(c => +c.from === 0).map(c => ({ key: speedKey(c), to: +c.to, custom: true }))).sort((a, b) => a.to - b.to);
export const rollingTargets = () => merge(ROLLING_TARGETS, customSpeed.filter(c => +c.from > 0 && +c.to > +c.from).map(c => ({ key: speedKey(c), from: +c.from, to: +c.to, custom: true }))).sort((a, b) => a.from - b.from || a.to - b.to);
export const brakeTargets = () => merge(BRAKE_TARGETS, customSpeed.filter(c => +c.to === 0 && +c.from > 0).map(c => ({ key: speedKey(c), from: +c.from, custom: true }))).sort((a, b) => a.from - b.from);

export const BRAKE_TARGETS = [{ key: '100-0', from: 100 }];

const lerp = (a, b, f) => a + (b - a) * f;
const frac = (x0, x1, x) => (x1 === x0 ? 1 : (x - x0) / (x1 - x0));

export class PerfTimer {
  constructor({ rollout = false, startKmh = 0.8, stopKmh = 0.8, onResult, onState, customDist = [] } = {}) {
    this.distTargets = makeDistTargets(customDist);
    this.rollout = rollout; this.startKmh = startKmh; this.stopKmh = stopKmh;
    this.onResult = onResult; this.onState = onState;
    this.reset();
  }

  setCustomDist(list) { this.distTargets = makeDistTargets(list); }

  reset() {
    this.state = 'wait';         // wait (belum pegun) | armed (pegun, sedia) | run
    this.prev = null; this.run = null; this.rolling = {}; this.brake = {};
    this.stillSince = null;
    this.onState && this.onState(this.state);
  }

  setState(s) { if (s !== this.state) { this.state = s; this.onState && this.onState(s); } }

  /** sample: { t(ms), speed(m/s), ... } */
  push(s) {
    const p = this.prev; this.prev = s;
    const kmh = s.speed * KMH;
    if (!p) { if (kmh < this.startKmh) this.setState('armed'); return; }
    const pk = p.speed * KMH, dt = (s.t - p.t) / 1000;
    if (dt <= 0 || dt > 2) { // jurang data -> batalkan larian
      if (this.run) { this.run = null; }
      this.setState(kmh < this.startKmh ? 'armed' : 'wait'); return;
    }
    const dd = (p.speed + s.speed) / 2 * dt; // trapezoid

    this.trackRolling(p, s, pk, kmh, dd);
    this.trackBrake(p, s, pk, kmh, dd);

    if (this.state === 'armed') {
      if (kmh < this.startKmh) return;
      if (pk < this.startKmh) {
        // mula: interpolasi titik kelajuan melepasi ambang
        const f = frac(pk, kmh, this.startKmh);
        const t0 = lerp(p.t, s.t, f);
        const dPart = dd * (1 - f);
        this.run = { t0, dist: dPart, startT: t0, results: {}, maxKmh: kmh, rolloutDone: !this.rollout, pts: [],
          samples: [p, s] };
        if (this.rollout && dPart >= FT) { this.run.rolloutDone = true; }
        this.setState('run');
        this.emit();
        return;
      }
    }

    if (this.state === 'wait') { if (kmh < this.startKmh) this.setState('armed'); return; }
    if (this.state !== 'run' || !this.run) return;

    const r = this.run;
    const d0 = r.dist, d1 = r.dist + dd;
    // rollout 1 kaki: jam bermula selepas kenderaan bergerak 0.3048 m
    if (!r.rolloutDone && d1 >= FT) {
      r.startT = lerp(p.t, s.t, frac(d0, d1, FT)); r.rolloutDone = true;
    }
    const base = r.rolloutDone ? r.startT : null;
    const distOff = this.rollout ? FT : 0;

    // Kelajuan (0-60, 0-100…): sentiasa dari pegun, TANPA rollout (r.t0 = saat mula bergerak).
    for (const g of speedTargets()) {
      if (!r.results[g.key] && pk < g.to && kmh >= g.to) {
        const tt = lerp(p.t, s.t, frac(pk, kmh, g.to));
        r.results[g.key] = { time: (tt - r.t0) / 1000, dist: lerp(d0, d1, frac(pk, kmh, g.to)) };
      }
    }
    // Jarak (60ft, 1/8, 1/4…): guna 1ft rollout jika diaktifkan (gaya dragstrip / NHRA).
    if (base !== null) {
      for (const g of this.distTargets) {
        const m = g.m + distOff;
        if (!r.results[g.key] && d0 < m && d1 >= m) {
          const f = frac(d0, d1, m), trap = lerp(pk, kmh, f);
          // vmax = laju maksimum sepanjang jarak ini (penting jika pemandu angkat minyak sebelum garisan)
          r.results[g.key] = { time: (lerp(p.t, s.t, f) - base) / 1000, trap, vmax: Math.max(r.maxKmh, trap) };
        }
      }
    }
    r.dist = d1; r.maxKmh = Math.max(r.maxKmh, kmh);
    r.elapsed = base !== null ? (s.t - base) / 1000 : 0;
    r.pts.push([r.elapsed, kmh]);
    r.samples.push(s);

    if (kmh < this.stopKmh) this.finish();
    else this.emit();
  }

  trackRolling(p, s, pk, kmh, dd) {
    for (const g of rollingTargets()) {
      const st = this.rolling[g.key];
      if (pk < g.from && kmh >= g.from) {
        const f = frac(pk, kmh, g.from);
        this.rolling[g.key] = { t0: lerp(p.t, s.t, f), dist: dd * (1 - f) };
        continue;
      }
      if (!st) continue;
      if (kmh < g.from) { delete this.rolling[g.key]; continue; }
      if (pk < g.to && kmh >= g.to) {
        const f = frac(pk, kmh, g.to);
        const res = { time: (lerp(p.t, s.t, f) - st.t0) / 1000, dist: st.dist + dd * f };
        delete this.rolling[g.key];
        if (this.run) this.run.results[g.key] = res;
        else this.onResult && this.onResult({ kind: 'rolling', at: Date.now(), results: { [g.key]: res } });
      } else st.dist += dd;
    }
  }

  trackBrake(p, s, pk, kmh, dd) {
    for (const g of brakeTargets()) {
      const st = this.brake[g.key];
      if (pk >= g.from && kmh < g.from) {
        const f = frac(pk, kmh, g.from);
        this.brake[g.key] = { t0: lerp(p.t, s.t, f), dist: dd * (1 - f) };
        continue;
      }
      if (!st) continue;
      if (kmh > g.from + 2) { delete this.brake[g.key]; continue; }
      if (kmh < this.stopKmh) {
        const f = frac(pk, kmh, this.stopKmh);
        const res = { time: (lerp(p.t, s.t, f) - st.t0) / 1000, dist: st.dist + dd * f };
        delete this.brake[g.key];
        if (this.run) this.run.results[g.key] = res;
        else this.onResult && this.onResult({ kind: 'brake', at: Date.now(), results: { [g.key]: res } });
      } else st.dist += dd;
    }
  }

  emit() { this.onResult && this.run && this.onResult({ kind: 'live', run: this.run }); }

  finish() {
    const r = this.run; this.run = null;
    this.setState('armed');
    if (r && Object.keys(r.results).length) {
      this.onResult && this.onResult({ kind: 'final', at: Date.now(), results: r.results,
        maxKmh: r.maxKmh, dist: r.dist, rollout: this.rollout, pts: r.pts,
        startT: r.startT, samples: r.samples });
    }
  }
}
