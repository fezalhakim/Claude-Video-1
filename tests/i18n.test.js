import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _dict, t, setLang, metric } from '../js/i18n.js';

test('setiap bahasa ada semua kunci yang sama', () => {
  const base = Object.keys(_dict.ms).sort();
  for (const [l, d] of Object.entries(_dict)) {
    const keys = Object.keys(d).sort();
    assert.deepEqual(keys.filter(k => !base.includes(k)), [], `${l}: kunci lebihan`);
    assert.deepEqual(base.filter(k => !keys.includes(k)), [], `${l}: kunci hilang`);
  }
});

test('pemboleh ubah {x} sama dalam setiap bahasa', () => {
  const vars = s => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of Object.keys(_dict.ms))
    for (const l of Object.keys(_dict)) assert.equal(vars(_dict[l][k]), vars(_dict.ms[k]), `${l}.${k}`);
});

test('t() dan metric()', () => {
  setLang('en');
  assert.equal(t('conn.on', { name: 'RaceBox' }), 'Connected: RaceBox');
  assert.equal(metric('1/4 batu'), '1/4 mile');
  assert.equal(metric('0-100'), '0-100');
  setLang('zh'); assert.equal(metric('1/8 batu'), '1/8 英里');
  setLang('xx'); assert.equal(t('h.history'), 'Sejarah');
});
