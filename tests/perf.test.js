import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfTimer, MILE } from '../js/perf.js';
import { simulateRun } from '../js/devices/simulator.js';

function constAccel(a, hz = 25, tmax = 20) {
  const out = []; const dt = 1000 / hz;
  for (let i = 0; i < 25; i++) out.push({ t: i * dt, speed: 0 });
  const t0 = 25 * dt;
  for (let t = 0; t <= tmax * 1000; t += dt) out.push({ t: t0 + t, speed: a * t / 1000 });
  return out;
}

test('0-100 pecutan malar tepat', () => {
  const a = 5; // m/s^2  -> 0-100 = 27.78/5 = 5.556 s
  let final;
  const pt = new PerfTimer({ onResult: r => { if (r.kind === 'live') final = r.run; } });
  for (const s of constAccel(a)) pt.push(s);
  const r = final.results['0-100'];
  // permulaan pada 0.8 km/j memberi ofset kecil (0.8/3.6/5 = 0.044 s)
  assert.ok(Math.abs(r.time - (100 / 3.6 / a - 0.8 / 3.6 / a)) < 0.01, `masa ${r.time}`);
  const q = final.results['1/4 batu'];
  const expect = Math.sqrt(2 * (MILE / 4) / a) - 0.8 / 3.6 / a;
  assert.ok(Math.abs(q.time - expect) < 0.02, `1/4 ${q.time} vs ${expect}`);
});

test('larian simulator lengkap menghasilkan keputusan final', () => {
  const finals = [];
  const pt = new PerfTimer({ onResult: r => { if (r.kind === 'final') finals.push(r); } });
  for (const s of simulateRun()) pt.push(s);
  assert.equal(finals.length, 1);
  const res = finals[0].results;
  for (const k of ['0-60', '0-100', '0-200', '100-200', '60ft', '1/8 batu', '1/4 batu', '100-0'])
    assert.ok(res[k], `tiada ${k}`);
  assert.ok(res['0-100'].time < res['0-200'].time);
  assert.ok(Math.abs(res['0-200'].time - res['0-100'].time - res['100-200'].time) < 0.05);
});

test('rollout 1 kaki memendekkan masa', () => {
  const get = rollout => { let f; const pt = new PerfTimer({ rollout, onResult: r => { if (r.kind === 'live') f = r.run; } });
    for (const s of constAccel(5)) pt.push(s); return f.results['0-100'].time; };
  assert.ok(get(true) < get(false));
});
