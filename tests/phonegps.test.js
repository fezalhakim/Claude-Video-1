import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeedFromPosition, haversine } from '../js/devices/phonegps.js';

const M_PER_DEG = 111320;

test('haversine ~111 km per darjah latitud', () => {
  assert.ok(Math.abs(haversine(3, 101, 4, 101) - 111195) < 200);
});

test('kelajuan dikira dari lokasi bila telefon tiada coords.speed', () => {
  const est = new SpeedFromPosition(); let v = 0;
  // motor 40 km/j (11.11 m/s) ke utara, 2 Hz, ketepatan 5 m
  for (let i = 0; i <= 20; i++) v = est.push({ t: i * 500, lat: 3 + (11.111 * i * 0.5) / M_PER_DEG, lon: 101, acc: 5 });
  assert.ok(Math.abs(v * 3.6 - 40) < 2, `kelajuan ${v * 3.6}`);
});

test('gangguan lokasi semasa pegun tidak dikira sebagai pergerakan', () => {
  const est = new SpeedFromPosition(); let v = 0;
  for (let i = 0; i <= 20; i++) v = est.push({ t: i * 500, lat: 3 + ((i % 2 ? 2 : -2) / M_PER_DEG), lon: 101, acc: 6 });
  assert.equal(v, 0);
});
