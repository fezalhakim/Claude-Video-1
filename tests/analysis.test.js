import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfTimer } from '../js/perf.js';
import { simulateRun } from '../js/devices/simulator.js';
import { packSamples, analyze, densityAltitude } from '../js/analysis.js';

function makeRun() {
  let f; const pt = new PerfTimer({ onResult: r => { if (r.kind === 'final') f = r; } });
  for (const s of simulateRun()) pt.push(s);
  return { no: 1, at: 0, rollout: false, results: f.results, maxKmh: f.maxKmh, raw: packSamples(f.samples),
    weather: { temp: 30, pressure: 1008 } };
}

test('analisis: keputusan dari data mentah sama dengan semasa larian', () => {
  const run = makeRun(); const a = analyze(run, false);
  for (const k of ['0-100', '1/4 batu', '60ft', '330ft'])
    assert.ok(Math.abs(a.results[k].time - run.results[k].time) < 0.02, k);
  assert.ok(a.maxG > 0.3 && a.maxG < 1.5, `maxG ${a.maxG}`);
  assert.ok(a.slope < 0 && a.slope > -1, `cerun ${a.slope}`); // simulator menurun 0.5%
  assert.equal(a.sats, 21);
  const d = a.rows.dist;
  assert.deepEqual(d.map(r => r.key).slice(0, 3), ['60ft', '100ft', '330ft']);
  assert.ok(Math.abs(d[1].split - (d[1].time - d[0].time)) < 1e-9);
  assert.ok(d[0].speed > 0 && d[0].g > 0);
});

test('analisis: rollout memendekkan masa', () => {
  const run = makeRun();
  assert.ok(analyze(run, true).results['1/4 batu'].time < analyze(run, false).results['1/4 batu'].time);
  assert.equal(analyze(run, true).results['0-100'].time, analyze(run, false).results['0-100'].time);
});

test('DA: panas & tekanan rendah -> DA tinggi', () => {
  assert.ok(Math.abs(densityAltitude(15, 1013.25)) < 1);
  const da = densityAltitude(32, 1005);
  assert.ok(da > 600 && da < 800, `DA ${da}`); // ~PA 69 m + 36.6 m/°C x 17.5°C
});

test('kesan tukar gear dari simulator (4 tukar gear)', () => {
  const a = analyze(makeRun(), false);
  assert.equal(a.shifts.length, 4, JSON.stringify(a.shifts.map(s => s.v.toFixed(0))));
  const exp = [60, 105, 150, 195];
  a.shifts.forEach((s, i) => assert.ok(Math.abs(s.v - exp[i]) < 6, `gear ${i} @ ${s.v}`));
  assert.ok(a.shifts[1].d > a.shifts[0].d);
});

import { simulateMoto } from '../js/devices/simulator.js';

test('Demo Y15 65hp 135 kg: 60ft 1.51 & 1/8 batu 6.40 s (data sebenar), 6 gear (5 tukar gear dikesan)', () => {
  let f; const pt = new PerfTimer({ rollout: true, onResult: r => { if (r.kind === 'final') f = r; } });
  for (const s of simulateMoto()) pt.push(s);
  const e = f.results['1/8 batu'], q = f.results['1/4 batu'];
  assert.ok(Math.abs(e.time - 6.40) < 0.02, `1/8 ${e.time}`);
  assert.ok(Math.abs(f.results['60ft'].time - 1.51) < 0.02, `60ft ${f.results['60ft'].time}`);
  assert.ok(q.time > 9.8 && q.time < 10.6, `1/4 ${q.time}`);
  const a = analyze({ results: f.results, rollout: true, raw: packSamples(f.samples) }, true);
  assert.equal(a.shifts.length, 5, JSON.stringify(a.shifts.map(s => s.v.toFixed(0))));
  // tukar gear ikut jarak: 80ft, 100 m, 150 m, 201 m, 300 m
  [24.384, 100, 150, 201.168, 300].forEach((m, i) => assert.ok(Math.abs(a.shifts[i].d - m) < 4, `gear ${i + 1}->${i + 2} @ ${a.shifts[i].d.toFixed(1)} m`));
  // lebih kuasa = lebih pantas (model fizik konsisten)
  let g; const p2 = new PerfTimer({ rollout: true, onResult: r => { if (r.kind === 'final') g = r; } });
  for (const s of simulateMoto({ hp: 80 })) p2.push(s);
  assert.ok(g.results['1/4 batu'].time < q.time);
});
