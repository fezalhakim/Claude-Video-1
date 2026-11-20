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

import { makeDistTargets, customKey } from '../js/perf.js';

test('jarak tersuai: masa betul, disusun ikut jarak, kunci unik', () => {
  const custom = [{ v: 500, u: 'm' }, { v: 800, u: 'ft' }, { v: 0.25, u: 'mi' }]; // 0.25 batu = 1/4 batu -> diabaikan
  const ts = makeDistTargets(custom);
  assert.deepEqual(ts.filter(g => g.custom).map(g => g.key), ['800ft', '500 m']);
  assert.equal(customKey({ v: 0.5, u: 'mi' }), '0.5 batu');
  const a = 5; let f;
  const pt = new PerfTimer({ customDist: custom, onResult: r => { if (r.kind === 'live') f = r.run; } });
  for (const s of constAccel(a, 25, 30)) pt.push(s);
  const expect = Math.sqrt(2 * 500 / a) - 0.8 / 3.6 / a;
  assert.ok(Math.abs(f.results['500 m'].time - expect) < 0.02, `500 m ${f.results['500 m'].time}`);
});

test('laju maks dalam jarak: angkat minyak sebelum garisan', () => {
  // pecut ke ~150 km/j, kemudian perlahan sebelum 1/4 batu
  const out = []; const dt = 40;
  for (let i = 0; i < 25; i++) out.push({ t: i * dt, speed: 0 });
  let v = 0, t = 25 * dt;
  while (v < 42) { v += 6 * dt / 1000; out.push({ t, speed: v }); t += dt; }
  for (let i = 0; i < 400; i++) { v -= 1 * dt / 1000; out.push({ t, speed: v }); t += dt; }
  let f; const pt = new PerfTimer({ onResult: r => { if (r.kind === 'live') f = r.run; } });
  for (const s of out) pt.push(s);
  const q = f.results['1/4 batu'];
  assert.ok(q.vmax > q.trap + 5, `vmax ${q.vmax} trap ${q.trap}`);
  assert.ok(Math.abs(q.vmax - 42 * 3.6) < 1);
});

test('simulator ikut sasaran: laju maks dan jarak', () => {
  const peak = s => Math.max(...s.map(x => x.speed)) * 3.6;
  const s300 = simulateRun({ targetKmh: 300 });
  assert.ok(peak(s300) >= 300 && peak(s300) < 303, `puncak ${peak(s300)}`);
  const s120 = simulateRun({ targetKmh: 120 });
  assert.ok(peak(s120) >= 120 && peak(s120) < 123);
  // sasaran jarak 1 batu: keputusan 1 batu (kunci tersuai) mesti wujud, 1/4 batu juga
  let fin; const pt = new PerfTimer({ customDist: [{ v: 1, u: 'mi' }], onResult: r => { if (r.kind === 'final') fin = r; } });
  for (const x of simulateRun({ targetM: 1609.344 })) pt.push(x);
  assert.ok(fin.results['1 batu'], 'tiada 1 batu');
  assert.ok(fin.results['1 batu'].vmax >= fin.results['1/4 batu'].vmax);
  assert.ok(fin.dist >= 1609);
});
