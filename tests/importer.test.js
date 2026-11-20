import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importRuns, templateCSV, classifyHeader, parseDate, parseCSV, runFingerprint } from '../js/importer.js';

test('templat: baris CONTOH dilangkau', () => {
  const r = importRuns(templateCSV());
  assert.equal(r.runs.length, 0); assert.equal(r.skipped, 1);
});

test('templat diisi: semua metrik, trap, kereta, tarikh', () => {
  const csv = templateCSV().replace(/\r\n2026[^\r]*\r\n$/, '\r\n') +
    '2026-11-18,20:15,Honda Civic FK8,Ali,Dragy Pro,1,201.3,2.10,4.95,9.80,,1.95,5.40,8.30,148.6,12.75,182.4,\r\n' +
    '19/11/2026,9:05 PM,Honda Civic FK8,Ali,Dragy Pro,yes,,2.05,4.88,,,,,,,12.60,184.1,run baik\r\n';
  const { runs, skipped } = importRuns(csv);
  assert.equal(runs.length, 2); assert.equal(skipped, 0);
  const a = runs[0];
  assert.equal(a.car, 'Honda Civic FK8'); assert.equal(a.device, 'Dragy Pro'); assert.ok(a.rollout); assert.equal(a.maxKmh, 201.3);
  assert.equal(a.results['0-100'].time, 4.95); assert.equal(a.results['1/4 batu'].time, 12.75); assert.equal(a.results['1/4 batu'].trap, 182.4);
  assert.equal(a.results['1/8 batu'].trap, 148.6); assert.equal(a.results['60ft'].time, 1.95);
  const d = new Date(runs[1].at); assert.equal(d.getDate(), 19); assert.equal(d.getMonth(), 10); assert.equal(d.getHours(), 21);
  assert.equal(runs[1].note, 'run baik');
});

test('Excel Eropah: pemisah ; dan perpuluhan ,', () => {
  const csv = 'Tarikh;0-100 km/h;1/4 mile (s);1/4 mile trap (km/h)\n20/11/2026;5,62;14,05;165,8\n';
  const { runs, problems } = importRuns(csv);
  assert.deepEqual(problems, []);
  assert.equal(runs[0].results['0-100'].time, 5.62); assert.equal(runs[0].results['1/4 batu'].trap, 165.8);
});

test('eksport MGear sendiri boleh diimport semula', () => {
  const csv = 'run,date,device,rollout,max_kmh,0-60_s,0-100_s,1/8 batu_s,1/4 mile_s,330ft_s,500 m_s\n3,2026-11-20T08:31:00.000Z,RaceBox Mini S,1,230.3,2.170,4.400,8.190,12.320,5.490,14.070\n';
  const { runs } = importRuns(csv);
  const r = runs[0];
  assert.equal(r.device, 'RaceBox Mini S'); assert.equal(r.results['1/8 batu'].time, 8.19);
  assert.equal(r.results['1/4 batu'].time, 12.32); assert.equal(r.results['500 m'].time, 14.07); assert.equal(r.results['330ft'].time, 5.49);
});

test('pengenalan tajuk', () => {
  assert.deepEqual(classifyHeader('1/8 Mile'), { metric: '1/8 batu' });
  assert.deepEqual(classifyHeader('660ft'), { metric: '1/8 batu' });
  assert.deepEqual(classifyHeader('1/4 mile trap kmh'), { trap: '1/4 batu' });
  assert.deepEqual(classifyHeader('0-100 km/h'), { metric: '0-100' });
  assert.deepEqual(classifyHeader('100-0'), { metric: '100-0' });
  assert.deepEqual(classifyHeader('Max Speed'), { field: 'max' });
  assert.equal(classifyHeader('random'), null);
});

test('fail tanpa metrik ditolak dengan mesej', () => {
  assert.deepEqual(importRuns('a,b\n1,2\n').problems, ['noMetrics']);
  assert.ok(parseDate('2026-02-30') === null);
  assert.equal(parseCSV('"a,b",c\n"x ""y""",z').rows[1][0], 'x "y"');
});

test('cap jari sama untuk larian sama', () => {
  const { runs } = importRuns('date,time,0-100\n2026-11-20,10:00,5.10\n2026-11-20,10:00,5.10\n');
  assert.equal(runFingerprint(runs[0]), runFingerprint(runs[1]));
});

test('data Dragy: rollout ON jika lajur kosong / tiada, OFF hanya jika dinyatakan', () => {
  const { runs } = importRuns('date,rollout,0-100\n2026-11-20,,5.1\n2026-11-21,0,5.2\n2026-11-22,1,5.0\n');
  assert.deepEqual(runs.map(r => r.rollout), [true, false, true]);
  assert.equal(importRuns('date,0-100\n2026-11-20,5.1\n').runs[0].rollout, true);
});
