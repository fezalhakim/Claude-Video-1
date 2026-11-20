import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitGRange } from '../js/chartdigitize.js';

// graf sintetik: kelajuan dari pecutan a(t), garisan oren dilukis pada skala paksi tertentu
function synth(range, S = 7, n = 400, vTop = 200) {
  const dt = S / (n - 1), a = i => 1.4 * Math.exp(-i * dt / 2.5) + 0.15 * Math.sin(i * dt * 3); // g
  const v = [0]; for (let i = 1; i < n; i++) v.push(v[i - 1] + a(i) * 9.80665 * dt);          // m/s
  const sm = v.map(x => x * 3.6 / vTop);                                                          // pecahan paksi kelajuan
  const g = Array.from({ length: n }, (_, i) => (a(i) - range[0]) / (range[1] - range[0]));     // pecahan paksi G
  return { sm, g, S, vTop };
}

for (const r of [[-0.5, 1.5], [-1, 3], [-0.25, 0.75], [0, 2]]) {
  test(`skala paksi G dikesan dari fizik: ${r[0]}…${r[1]}`, () => {
    const { sm, g, S, vTop } = synth(r);
    assert.deepEqual(fitGRange(sm, g, S, vTop), r);
  });
}
