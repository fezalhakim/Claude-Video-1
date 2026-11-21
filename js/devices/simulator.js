// Simulator 25 Hz untuk demo & ujian tanpa peranti.
// Pecut dari pegun sehingga sasaran (laju maks ATAU jarak) dicapai, meluncur 0.6 s, kemudian brek hingga berhenti.
//   targetKmh: berhenti memecut bila kelajuan ini dicapai (lalai 230 km/j)
//   targetM:   jika diberi, berhenti memecut bila jarak ini (m) dicapai — mengatasi targetKmh
const DEFAULT_SHIFTS = [60, 105, 150, 195, 240, 285, 330, 375, 420];

export function simulateRun({ hz = 25, vmax, tau = 9.5, holdS = 1.5, brake = 9.5, shifts,
  targetKmh = 230, targetM = null } = {}) {
  // had laju asimptot: cukup tinggi supaya sasaran kelajuan boleh dicapai dalam masa munasabah
  if (vmax == null) vmax = Math.max(78, (targetM ? 0 : targetKmh / 3.6) * 1.12);
  const shiftList = (shifts ?? DEFAULT_SHIFTS).filter(k => k < vmax * 3.6 * 0.97);
  const dt = 1000 / hz, out = [];
  let t = 0, v = 0, dist = 0, shiftAt = [...shiftList], shiftUntil = -1, lat = 3.139, lon = 101.6869, phase = 'hold', since = 0;
  const maxSteps = hz * 60 * 15; // keselamatan: maks 15 minit simulasi
  for (let step = 0; step < maxSteps; step++) {
    let a = 0;
    if (phase === 'hold') { if (since >= holdS * 1000) { phase = 'go'; since = 0; } }
    else if (phase === 'go') {
      a = Math.min(12, (vmax - v) / tau + (since < 400 ? 2 : 0));
      // simulasi tukar gear: pecutan hilang ~0.3 s
      if (shiftAt.length && v * 3.6 >= shiftAt[0]) { shiftAt.shift(); shiftUntil = since + 300; }
      if (since < shiftUntil) a = -0.3;
      const done = targetM ? dist >= targetM : v * 3.6 >= targetKmh;
      if (done) { phase = 'coast'; since = 0; }
    } else if (phase === 'coast') { // lepas garisan: meluncur sekejap sebelum brek
      a = -0.15; if (since >= 600) { phase = 'brake'; since = 0; }
    } else { a = -brake; }
    v = Math.max(0, v + a * dt / 1000);
    lat += (v * dt / 1000) / 111320; dist += v * dt / 1000;
    out.push({ t, speed: v, lat, lon, alt: 50 - dist * 0.005, heading: 0, sats: 21, fix: 3,
      gx: a / 9.81, gy: Math.sin(t / 700) * 0.05, gz: 1, battery: 87, source: 'Simulator' });
    t += dt; since += dt;
    if (phase === 'brake' && v === 0 && since > 2500) break;
  }
  return out;
}

/**
 * Main semula larian simulasi seperti peranti sebenar. Larian panjang dipercepatkan
 * supaya demo siap dalam ~30 s (cap masa sampel kekal realistik, jadi keputusan tidak berubah).
 */
export async function connectSimulator({ onSample, onDisconnect }) {
  const samples = simulateMoto();   // Demo: Y15 65hp, 135 kg, 6 gear
  const perTick = Math.max(1, Math.ceil(samples.length / (30 * 25)));
  let i = 0;
  const base = Date.now();
  const timer = setInterval(() => {
    for (let k = 0; k < perTick; k++) {
      if (i >= samples.length) { clearInterval(timer); onDisconnect && onDisconnect(); return; }
      onSample({ ...samples[i], t: base + samples[i].t }); i++;
    }
  }, 40);
  return { name: 'Demo Y15 65hp', disconnect: () => clearInterval(timer) };
}

/**
 * Demo motosikal dikira dari fizik (tiada masa "dipaksa"):
 *   kuasa di roda = hp × 745.7 × kecekapan; pecutan = min(cengkaman, P/v) − seretan angin (½ρ·CdA·v²/m) − rintangan tayar
 *   jalur kuasa: selepas tukar gear RPM jatuh, kuasa kira-kira (1−band) dan naik semula ke 100% menjelang titik tukar.
 * Preset lalai: Yamaha Y15 (150cc) ditala 65 hp, berat keseluruhan (motor + penunggang) 135 kg, 6 gear.
 */
// Ditala dengan data sebenar: Y15 65 hp (dyno roda), 135 kg -> 1/8 batu 6.40 s (1ft rollout).
// Setup drag: tayar slick (cengkaman ~1.23 g), penunggang membongkok (CdA 0.35), quickshifter 0.06 s, jalur kuasa rata.
export const Y15 = {
  name: 'Y15 65hp', hp: 65, massKg: 135, eff: 1.0, cda: 0.35, crr: 0.015, traction: 1.229,
  shiftsKmh: [58, 88, 114, 136, 156],   // 1→2 … 5→6
  shiftMs: 60, band: 0.08
};
export function simulateMoto({ hz = 25, holdS = 1.5, distM = 402.336, brake = 8, ...over } = {}) {
  const P = { ...Y15, ...over }, G = 9.80665;
  const pw = P.hp * 745.7 * P.eff / P.massKg;            // W/kg di roda
  const c = 0.5 * 1.2 * P.cda / P.massKg;                 // seretan angin per kg
  const edges = [0, ...P.shiftsKmh, P.shiftsKmh[P.shiftsKmh.length - 1] * 1.2];
  const dt = 1000 / hz, out = [];
  let t = 0, v = 0, dist = 0, gear = 1, shiftUntil = -1, lat = 3.139, lon = 101.6869, phase = 'hold', since = 0;
  for (let step = 0; step < hz * 150; step++) {
    let a = 0;
    if (phase === 'hold') { if (since >= holdS * 1000) { phase = 'go'; since = 0; } }
    else if (phase === 'go') {
      const kmh = v * 3.6;
      if (gear <= P.shiftsKmh.length && kmh >= P.shiftsKmh[gear - 1]) { gear++; shiftUntil = since + P.shiftMs; }
      const lo = edges[gear - 1], hi = edges[gear], frac = Math.min(1, Math.max(0, (kmh - lo) / (hi - lo)));
      const pe = pw * (gear === 1 ? 1 : 1 - P.band + P.band * frac);
      const aTrac = P.traction * G * Math.min(1, 0.5 + since / 500);          // cengkaman naik semasa pelancaran
      a = Math.min(aTrac, pe / Math.max(v, 0.5)) - c * v * v - P.crr * G;
      if (since < shiftUntil) a = -c * v * v - P.crr * G;                       // semasa tukar gear: tiada tolakan
      if (dist >= distM) { phase = 'coast'; since = 0; }
    } else if (phase === 'coast') { a = -c * v * v - P.crr * G; if (since >= 700) { phase = 'brake'; since = 0; } }
    else a = -brake;
    v = Math.max(0, v + a * dt / 1000);
    lat += (v * dt / 1000) / 111320; dist += v * dt / 1000;
    out.push({ t, speed: v, lat, lon, alt: 30 + Math.sin(dist / 120) * 0.6, heading: 0, sats: 23, fix: 3,
      gx: a / G, gy: Math.sin(t / 500) * 0.03, gz: 1, battery: 92, source: 'Simulator' });
    t += dt; since += dt;
    if (phase === 'brake' && v === 0 && since > 2000) break;
  }
  return out;
}
