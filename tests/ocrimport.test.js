import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReportText } from '../js/ocrimport.js';

// teks seperti hasil OCR screenshot "Performance Report" (dengan sedikit hingar OCR)
const SAMPLE = `DRG69 | 12
Performance Report
26°C 72m DA 571m
Speed(km/h) Height(m) Acceleration(g)
16 1.5 200
3.71s 100
660ft 7.68s 0.50%
Distance(m) 1/8 mile Slope
Distance sec@km/h Distance sec@km/h
60ft 1.71s 1/8 7.68s@136.10
330ft 4.85s`;

test('screenshot laporan: metrik, trap & keadaan', () => {
  const r = parseReportText(SAMPLE);
  assert.equal(r.results['60ft'].time, 1.71);
  assert.equal(r.results['330ft'].time, 4.85);
  assert.equal(r.results['1/8 batu'].time, 7.68);
  assert.equal(r.results['1/8 batu'].trap, 136.1);
  assert.equal(r.temp, 26); assert.equal(r.da, 571); assert.equal(r.alt, 72); assert.equal(r.slope, 0.5);
  assert.equal(r.device, 'DRG69');
  assert.equal(r.results['0-100'].time, 3.71); // label penanda graf
  assert.equal(Object.keys(r.results).length, 4, JSON.stringify(r.results));
});

test('hingar OCR biasa: ruang dalam nombor, koma', () => {
  const r = parseReportText('60 ft  1 .71 s\n1/4 mile 12,74s @ 182.3\n0-100km/h 4.85s\n100-200 km/h 9.95 s');
  assert.equal(r.results['60ft'].time, 1.71);
  assert.equal(r.results['1/4 batu'].time, 12.74); assert.equal(r.results['1/4 batu'].trap, 182.3);
  assert.equal(r.results['0-100'].time, 4.85); assert.equal(r.results['100-200'].time, 9.95);
});

test('teks tanpa data tidak menghasilkan metrik palsu', () => {
  const r = parseReportText('Hello world 2026-11-20 12:30\nSpeed 16 1.5 200');
  assert.deepEqual(r.results, {});
});

test('titik perpuluhan hilang: "171s" dibaca sebagai 1.71', () => {
  const r = parseReportText('60ft 171s 1/8 7.68s@136.10\n330ft 4.85s');
  assert.equal(r.results['60ft'].time, 1.71); assert.equal(r.results['330ft'].time, 4.85);
});

test('baris suhu yang tersilap baca OCR: "&26C A72m BI571m"', () => {
  const r = parseReportText('826C A72m BRSTIm BNGLA\n&26C A72m BI571m %');
  assert.equal(r.temp, 26); assert.equal(r.alt, 72); assert.equal(r.da, 571);
});

test('label penanda graf "3.71s 100" dibaca sebagai 0-100', () => {
  const r = parseReportText('3.71s 100\n660ft 7.68s 0.50%\n60ft 1.71s 1/8 7.68s@136.10');
  assert.equal(r.results['0-100'].time, 3.71);
  assert.equal(r.results['1/8 batu'].trap, 136.1);
  assert.equal(parseReportText('7.68s 0.50%').results['0-0'], undefined);
});

test('suhu dalam Fahrenheit ditukar ke Celsius: "79°F 17m DA 559m"', () => {
  const r = parseReportText('79°F 17m DA 559m');
  assert.equal(r.temp, 26.1); assert.equal(r.alt, 17); assert.equal(r.da, 559);
});
