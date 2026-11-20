import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RaceBoxStream, checksum } from '../js/devices/racebox.js';
import { NmeaStream, parseSentence } from '../js/nmea.js';

function buildRaceBox() {
  const p = new DataView(new ArrayBuffer(80));
  p.setUint32(0, 123456, true); p.setUint16(4, 2026, true); p.setUint8(6, 11); p.setUint8(7, 20);
  p.setUint8(20, 3); p.setUint8(21, 1); p.setUint8(23, 18);
  p.setInt32(24, 1016869000, true); p.setInt32(28, 31390000, true);
  p.setInt32(36, 52000, true); p.setInt32(48, 27778, true); p.setInt32(52, 9000000, true);
  p.setUint8(67, 0x80 | 76); p.setInt16(68, -250, true); p.setInt16(70, 120, true); p.setInt16(72, 1000, true);
  const pkt = new Uint8Array(88);
  pkt.set([0xb5, 0x62, 0xff, 0x01, 80, 0]); pkt.set(new Uint8Array(p.buffer), 6);
  const [a, b] = checksum(pkt, 2, 86); pkt[86] = a; pkt[87] = b;
  return pkt;
}

test('RaceBox: hurai paket walaupun dipecah & ada sampah', () => {
  const msgs = []; const st = new RaceBoxStream(m => msgs.push(m));
  const pkt = buildRaceBox();
  st.push(new Uint8Array([1, 2, 0xb5]));
  st.push(pkt.slice(0, 20)); st.push(pkt.slice(20));
  assert.equal(msgs.length, 1);
  const m = msgs[0];
  assert.equal(m.iTOW, 123456); assert.equal(m.sats, 18); assert.equal(m.fix, 3); assert.ok(m.fixOk);
  assert.ok(Math.abs(m.lat - 3.139) < 1e-9); assert.ok(Math.abs(m.lon - 101.6869) < 1e-9);
  assert.equal(m.speed, 27.778); assert.equal(m.heading, 90); assert.equal(m.battery, 76); assert.ok(m.charging);
  assert.equal(m.gx, -0.25); assert.equal(m.gz, 1);
});

test('RaceBox: checksum salah ditolak', () => {
  const msgs = []; const st = new RaceBoxStream(m => msgs.push(m));
  const pkt = buildRaceBox(); pkt[50] ^= 0xff; st.push(pkt);
  assert.equal(msgs.length, 0);
});

test('NMEA: RMC + GGA', () => {
  const gga = '$GNGGA,123519.00,0308.340,N,10141.214,E,1,14,0.8,45.0,M,0,M,,';
  const rmc = '$GNRMC,123519.10,A,0308.340,N,10141.214,E,54.0,90.0,201126,,,A';
  const cs = s => { let c = 0; for (const ch of s.slice(1)) c ^= ch.charCodeAt(0); return s + '*' + c.toString(16).toUpperCase().padStart(2, '0'); };
  const out = []; const st = new NmeaStream(s => out.push(s), 'Dragy');
  st.push(cs(gga) + '\r\n' + cs(rmc).slice(0, 30)); st.push(cs(rmc).slice(30) + '\r\n');
  assert.equal(out.length, 1);
  assert.equal(out[0].sats, 14);
  assert.ok(Math.abs(out[0].speed - 54 * 0.514444) < 1e-6);
  assert.ok(Math.abs(out[0].lat - (3 + 8.34 / 60)) < 1e-9);
  assert.equal(out[0].t, (12 * 3600 + 35 * 60 + 19.1) * 1000);
  assert.equal(parseSentence('$GNRMC,bad*00'), null);
});
