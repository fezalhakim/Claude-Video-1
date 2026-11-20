// Simulator 25 Hz: pecutan 0 -> ~230 km/j, kemudian brek. Untuk demo & ujian tanpa peranti.
export function simulateRun({ hz = 25, vmax = 78, tau = 9.5, holdS = 1.5, brake = 9.5, shifts = [60, 105, 150, 195] } = {}) {
  const dt = 1000 / hz, out = [];
  let t = 0, v = 0, dist = 0, shiftAt = [...shifts], shiftUntil = -1, lat = 3.139, lon = 101.6869, phase = 'hold', since = 0;
  while (true) {
    let a = 0;
    if (phase === 'hold') { if (since >= holdS * 1000) { phase = 'go'; since = 0; } }
    else if (phase === 'go') {
      a = (vmax - v) / tau + (since < 400 ? 2 : 0);
      // simulasi tukar gear: pecutan hilang ~0.3 s
      if (shiftAt.length && v * 3.6 >= shiftAt[0]) { shiftAt.shift(); shiftUntil = since + 300; }
      if (since < shiftUntil) a = -0.3;
      if (v * 3.6 >= 230) { phase = 'brake'; since = 0; }
    } else { a = -brake; }
    v = Math.max(0, v + a * dt / 1000);
    lat += (v * dt / 1000) / 111320; dist += v * dt / 1000;
    out.push({ t, speed: v, lat, lon, alt: 50 - dist * 0.005, heading: 0, sats: 21, fix: 3,
      gx: a / 9.81, gy: Math.sin(t / 700) * 0.05, gz: 1, battery: 87, source: 'Simulator' });
    t += dt; since += dt;
    if (phase === 'brake' && v === 0) { if (since > 2500) break; }
  }
  return out;
}

export async function connectSimulator({ onSample, onDisconnect }) {
  const samples = simulateRun();
  let i = 0;
  const base = Date.now();
  const timer = setInterval(() => {
    if (i >= samples.length) { clearInterval(timer); onDisconnect && onDisconnect(); return; }
    onSample({ ...samples[i], t: base + samples[i].t }); i++;
  }, 40);
  return { name: 'Simulator', disconnect: () => clearInterval(timer) };
}
