// Baca semula graf dari screenshot laporan (gaya Dragy): kotak graf bergaris kelabu, garisan biru = kelajuan,
// oren = pecutan (g), hijau-biru = ketinggian. Pulangkan sampel {t, speed(m/s), gx, alt} yang boleh dianalisis MGear.

const isGrid = (r, g, b) => Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 170 && r < 236;
const isBlue = (r, g, b) => b > 170 && b - r > 70 && b - g > 15 && g > 110;          // kelajuan
const isOrange = (r, g, b) => r > 200 && g > 120 && g < 215 && b < 170 && r - b > 70;  // pecutan
const isTeal = (r, g, b) => g > 150 && b > 120 && r < 130 && g - r > 70 && g >= b - 12 && g - b < 45; // ketinggian (hijau ≥ biru, beza dari tepi garisan kelajuan)

/**
 * Cari jujukan nilai yang sama jarak (garis grid), bertolak ansur dengan garis yang hilang
 * (cth. garis grid yang ditutup sepenuhnya oleh garisan graf). Pulangkan [pertama, terakhir, langkah] atau null.
 */
function evenSeq(vals, minStep) {
  const cands = [];
  for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) {
    const step = vals[j] - vals[i]; if (step < minStep) continue;
    let last = vals[j], found = 2, err = 0;
    for (let k = j + 1; k < vals.length; k++) {
      const m = Math.round((vals[k] - last) / step);
      if (m < 1) continue;
      if (m > 2) break;                                   // terlalu jauh: bukan sebahagian grid ini
      const e = Math.abs(vals[k] - (last + m * step));
      if (e <= 2 + m) { last = vals[k]; found++; err += e; }
    }
    const span = Math.round((last - vals[i]) / step) + 1;
    if (span >= 4 && found >= 3) cands.push({ a: vals[i], b: last, step, score: found * 10 + span - err });
  }
  return cands.sort((x, y) => y.score - x.score).map(c => [c.a, c.b, c.step]);
}

/** Gabung indeks bersebelahan (garis tebal 2-3 px) kepada titik tengah. */
function centers(idx) {
  const out = []; let s = null, p = null;
  for (const v of idx) { if (s == null) s = p = v; else if (v - p <= 2) p = v; else { out.push((s + p) / 2); s = p = v; } }
  if (s != null) out.push((s + p) / 2);
  return out;
}

/** Cari kotak graf dari garis grid kelabu mendatar & tegak yang sama jarak. */
export function findPlotBox(img) {
  const { width: W, height: H, data: d } = img;
  const gray = (x, y) => { const i = (y * W + x) * 4; return isGrid(d[i], d[i + 1], d[i + 2]); };
  // baris yang banyak piksel kelabu (garis grid terputus-putus kerana dilintasi garisan graf pun dikira)
  const rowIdx = [];
  for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x++) if (gray(x, y)) c++; if (c > W * 0.25) rowIdx.push(y); }
  const ys = centers(rowIdx);
  // cuba calon terbaik dahulu; kotak graf sebenar mesti ada garis grid tegak yang sama jarak juga
  for (const hs of evenSeq(ys, Math.max(12, H * 0.012)).slice(0, 8)) {
    const top = Math.round(hs[0]), bottom = Math.round(hs[1]);
    const colIdx = [];
    for (let x = 0; x < W; x++) { let c = 0; for (let y = top; y <= bottom; y++) if (gray(x, y)) c++; if (c / (bottom - top + 1) > 0.6) colIdx.push(x); }
    const vs = evenSeq(centers(colIdx), Math.max(12, W * 0.04))[0];
    if (vs) return { top, bottom, x0: Math.round(vs[0]), x1: Math.round(vs[1]) };
  }
  return null;
}

/**
 * Untuk setiap lajur, kedudukan menegak (0 = bawah, 1 = atas) garisan berwarna; null jika tiada.
 * Garisan dijejak secara berterusan: dalam setiap lajur, ambil kelompok piksel yang paling dekat dengan
 * kedudukan lajur sebelumnya (elak tersilap ambil label/penanda/garisan lain yang warnanya hampir sama).
 */
function trace(img, box, test, { despike = false } = {}) {
  const { width: W, data: d } = img, H = box.bottom - box.top, out = [];
  let prev = null;
  for (let x = box.x0 + 2; x <= box.x1 - 2; x++) {
    const groups = []; let g = null;
    for (let y = box.top - 4; y <= box.bottom + 4; y++) {
      const i = (y * W + x) * 4;
      if (test(d[i], d[i + 1], d[i + 2])) { if (g && y - g.b <= 2) g.b = y; else groups.push(g = { a: y, b: y }); }
    }
    let pick = null;
    if (groups.length) {
      const c = gr => (gr.a + gr.b) / 2;
      pick = prev == null ? groups.reduce((m, gr) => (gr.b - gr.a > m.b - m.a ? gr : m))
        : groups.reduce((m, gr) => (Math.abs(c(gr) - prev) < Math.abs(c(m) - prev) ? gr : m));
      // lompatan besar dari lajur sebelumnya: mungkin bukan garisan ini
      if (prev != null && Math.abs(c(pick) - prev) > H * 0.25) pick = null;
    }
    if (pick) prev = (pick.a + pick.b) / 2;
    out.push(pick ? 1 - (((pick.a + pick.b) / 2) - box.top) / H : null);
  }
  // isi lompang dengan interpolasi
  for (let i = 0; i < out.length; i++) if (out[i] == null) {
    let a = i - 1; while (a >= 0 && out[a] == null) a--;
    let b = i + 1; while (b < out.length && out[b] == null) b++;
    if (a >= 0 && b < out.length) out[i] = out[a] + (out[b] - out[a]) * (i - a) / (b - a);
    else out[i] = a >= 0 ? out[a] : b < out.length ? out[b] : null;
  }
  if (!despike) return out;
  // tapis median (garisan yang sepatutnya licin, cth. ketinggian): buang lonjakan sempit
  const w = Math.max(5, Math.round(out.length / 40)), med = [];
  for (let i = 0; i < out.length; i++) {
    const win = out.slice(Math.max(0, i - w), i + w + 1).filter(v => v != null).sort((p, q) => p - q);
    med.push(win.length ? win[win.length >> 1] : out[i]);
  }
  return med;
}

/**
 * Bina semula larian dari graf.
 * opts: { T: masa metrik utama (s, cth. masa 1/8 mile), known?: { dist: [{m, time, trap?}], speed: [{kmh, time}] } nilai tepat
 *         dari jadual untuk menala paksi, distM?: jarak pada T (m) jika tiada known,
 *         trapKmh?: laju pada T, vTop?: nilai atas paksi kelajuan (lalai 200), gRange?: [bawah, atas] (lalai [-0.5, 1.5]),
 *         hRange?: [bawah, atas] (lalai [-16, 16]), hz?: kadar sampel (lalai 25) }
 * Pulangkan { samples, box, vTop, calibrated } atau null jika graf tidak dijumpai.
 */
export function digitizeChart(img, opts) {
  const box = findPlotBox(img); if (!box || !(opts.T > 0)) return null;
  const sp = trace(img, box, isBlue);
  if (sp.filter(v => v != null).length < sp.length * 0.5) return null;
  const g = trace(img, box, isOrange), h = trace(img, box, isTeal, { despike: true });
  const n = sp.length;
  // kelajuan bermula dari 0 dan tidak menurun secara mendadak semasa pecutan; licinkan sedikit
  const sm = sp.map((_, i) => { let s = 0, c = 0; for (let k = -2; k <= 2; k++) if (sp[i + k] != null) { s += sp[i + k]; c++; } return s / c; });
  // Penalaan: cari panjang paksi masa S, rollout o dan skala kelajuan vTop yang paling sepadan dengan
  // nilai tepat dari jadual (jarak: masa+trap; kelajuan: masa label pada graf). Masa jarak = masa graf - o.
  let vTop = opts.vTop || 200, S = opts.T, o = 0, calibrated = false;
  const C = [0]; for (let i = 1; i < n; i++) C.push(C[i - 1] + (sm[i] + sm[i - 1]) / 2 / (n - 1)); // kamiran ikut pecahan x
  const sAt = f => { const i = Math.min(n - 1, Math.max(0, f * (n - 1))), a = Math.floor(i), b2 = Math.min(n - 1, a + 1); return sm[a] + (sm[b2] - sm[a]) * (i - a); };
  const cAt = f => { const i = Math.min(n - 1, Math.max(0, f * (n - 1))), a = Math.floor(i), b2 = Math.min(n - 1, a + 1); return C[a] + (C[b2] - C[a]) * (i - a); };
  const known = opts.known || (opts.distM ? { dist: [{ m: opts.distM, time: opts.T, trap: opts.trapKmh }], speed: [] } : null);
  if (known && known.dist.length) {
    const tMax = Math.max(...known.dist.map(k => k.time));
    let best = null;
    for (let Sx = tMax; Sx <= tMax * 1.5; Sx += 0.01) for (let ox = 0; ox <= 0.6 + 1e-9; ox += 0.01) {
      if (ox + tMax > Sx + 1e-9) continue;
      const vs = known.dist.map(k => { const D = Sx * cAt((ox + k.time) / Sx); return D > 0 ? k.m * 3.6 / D : NaN; });
      if (vs.some(v => !isFinite(v))) continue;
      const v = vs.reduce((x, y) => x + y, 0) / vs.length;
      let err = vs.reduce((e, x) => e + ((x - v) / v) ** 2, 0);
      for (const k of known.dist) if (k.trap) err += ((v * sAt((ox + k.time) / Sx) - k.trap) / k.trap) ** 2;
      for (const k of known.speed || []) err += ((v * sAt(k.time / Sx) - k.kmh) / k.kmh) ** 2;
      if (v < 50 || v > 600) continue;
      if (!best || err < best.err) best = { err, S: Sx, o: ox, v };
    }
    if (best) { S = best.S; o = best.o; vTop = best.v; calibrated = true; }
  }
  const dtCol = S / (n - 1);
  const [g0, g1] = opts.gRange || [-0.5, 1.5], [h0, h1] = opts.hRange || [-16, 16];
  const hz = opts.hz || 25, samples = [];
  const at = (arr, f) => { const i = Math.min(n - 1, Math.max(0, f)), a = Math.floor(i), b = Math.min(n - 1, a + 1); const va = arr[a], vb = arr[b]; return va == null ? vb : vb == null ? va : va + (vb - va) * (i - a); };
  // 1 s pegun sebelum mula supaya pengira masa MGear mengesan permulaan
  for (let k = 0; k < hz; k++) samples.push({ t: -1000 + k * (1000 / hz), speed: 0, gx: 0, alt: h ? at(h, 0) * (h1 - h0) + h0 : 0 });
  for (let t = 0; t <= S + 1e-9; t += 1 / hz) {
    const f = t / dtCol;
    const v = Math.max(0, at(sm, f)) * vTop / 3.6;
    const gv = g && at(g, f) != null ? at(g, f) * (g1 - g0) + g0 : undefined;
    const hv = h && at(h, f) != null ? at(h, f) * (h1 - h0) + h0 : 0;
    samples.push({ t: t * 1000, speed: t === 0 ? 0 : v, gx: gv, alt: hv });
  }
  // sambung 0.5 s selepas hujung graf pada laju terakhir, supaya garisan yang tamat tepat di tepi graf masih dilepasi
  const last = samples[samples.length - 1];
  for (let k = 1; k <= hz / 2; k++) samples.push({ ...last, t: last.t + k * 1000 / hz, gx: 0 });
  return { samples, box, vTop, calibrated, span: S, rollout: o };
}
