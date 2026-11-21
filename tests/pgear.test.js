import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoGpsStream } from '../js/devices/pgear.js';
import { checksum } from '../js/devices/racebox.js';

function ubx(cls, id, payload) {
  const p = new Uint8Array(8 + payload.length);
  p.set([0xb5, 0x62, cls, id, payload.length & 0xff, payload.length >> 8]); p.set(payload, 6);
  const [a, b] = checksum(p, 2, 6 + payload.length); p[6 + payload.length] = a; p[7 + payload.length] = b;
  return p;
}
function navPvt({ iTOW = 1000, speedMs = 27.778, sats = 19 } = {}) {
  const d = new DataView(new ArrayBuffer(92));
  d.setUint32(0, iTOW, true); d.setUint8(20, 3); d.setUint8(21, 1); d.setUint8(23, sats);
  d.setInt32(24, 1016869000, true); d.setInt32(28, 31390000, true); d.setInt32(36, 45000, true);
  d.setUint32(40, 800, true); d.setInt32(60, Math.round(speedMs * 1000), true); d.setInt32(64, 9000000, true); d.setUint32(68, 150, true);
  return new Uint8Array(d.buffer);
}

test('PGear: UBX NAV-PVT dikesan & dihurai (data dalam potongan kecil)', () => {
  const out = []; const st = new AutoGpsStream(s => out.push(s));
  const bytes = new Uint8Array([...ubx(0x01, 0x07, navPvt({ iTOW: 1000 })), ...ubx(0x01, 0x07, navPvt({ iTOW: 1040, speedMs: 30 }))]);
  for (let i = 0; i < bytes.length; i += 20) st.push(bytes.slice(i, i + 20));   // pakej BLE 20 bait
  assert.equal(out.length, 2); assert.equal(st.format, 'UBX NAV-PVT');
  assert.equal(out[0].t, 1000); assert.equal(out[0].sats, 19); assert.equal(out[0].fix, 3);
  assert.ok(Math.abs(out[0].speed - 27.778) < 1e-3); assert.equal(out[1].speed, 30);
  assert.ok(Math.abs(out[0].lat - 3.139) < 1e-9); assert.equal(out[0].alt, 45); assert.equal(out[0].source, 'PGear');
});

test('PGear: NMEA dikesan & dihurai', () => {
  const cs = s => { let c = 0; for (const ch of s.slice(1)) c ^= ch.charCodeAt(0); return s + '*' + c.toString(16).toUpperCase().padStart(2, '0'); };
  const out = []; const st = new AutoGpsStream(s => out.push(s));
  const txt = cs('$GNGGA,123519.00,0308.340,N,10141.214,E,1,14,0.8,45.0,M,0,M,,') + '\r\n' + cs('$GNRMC,123519.10,A,0308.340,N,10141.214,E,54.0,90.0,201126,,,A') + '\r\n';
  const enc = new TextEncoder().encode(txt);
  st.push(enc.slice(0, 30)); st.push(enc.slice(30));
  assert.equal(out.length, 1); assert.equal(st.format, 'NMEA'); assert.equal(out[0].sats, 14); assert.equal(out[0].source, 'PGear');
});

test('PGear: format serasi RaceBox dikesan', () => {
  const d = new DataView(new ArrayBuffer(80));
  d.setUint32(0, 5000, true); d.setUint8(20, 3); d.setUint8(21, 1); d.setUint8(23, 21); d.setInt32(48, 20000, true); d.setInt16(68, 500, true);
  const out = []; const st = new AutoGpsStream(s => out.push(s));
  st.push(new Uint8Array([7, 7, ...ubx(0xff, 0x01, new Uint8Array(d.buffer))]));   // bait sampah di depan
  assert.equal(out.length, 1); assert.equal(st.format, 'RaceBox'); assert.equal(out[0].speed, 20); assert.equal(out[0].gx, 0.5);
});
