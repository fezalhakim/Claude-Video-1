// Pemacu RaceBox (Mini / Mini S / Micro) - berdasarkan "RaceBox Mini BLE Protocol" rasmi.
// Paket gaya UBX: 0xB5 0x62 | class | id | len(u16 LE) | payload | CK_A CK_B
import { connectBle } from '../ble.js';

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // tulis ke peranti
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notify dari peranti

export function checksum(bytes, start, end) {
  let a = 0, b = 0;
  for (let i = start; i < end; i++) { a = (a + bytes[i]) & 0xff; b = (b + a) & 0xff; }
  return [a, b];
}

/** Hurai payload "RaceBox Data Message" (class 0xFF id 0x01, 80 bait). */
export function parseDataMessage(dv, o = 0) {
  const fix = dv.getUint8(o + 20);
  const flags = dv.getUint8(o + 21);
  const bat = dv.getUint8(o + 67);
  return {
    iTOW: dv.getUint32(o + 0, true),
    year: dv.getUint16(o + 4, true),
    month: dv.getUint8(o + 6), day: dv.getUint8(o + 7),
    hour: dv.getUint8(o + 8), minute: dv.getUint8(o + 9), second: dv.getUint8(o + 10),
    nano: dv.getInt32(o + 16, true),
    fix,                                   // 0 tiada, 2 = 2D, 3 = 3D
    fixOk: (flags & 0x01) === 1 && fix >= 2,
    sats: dv.getUint8(o + 23),
    lon: dv.getInt32(o + 24, true) / 1e7,
    lat: dv.getInt32(o + 28, true) / 1e7,
    alt: dv.getInt32(o + 36, true) / 1000,       // m (MSL)
    hAcc: dv.getUint32(o + 40, true) / 1000,     // m
    speed: dv.getInt32(o + 48, true) / 1000,     // m/s
    heading: dv.getInt32(o + 52, true) / 1e5,    // darjah
    sAcc: dv.getUint32(o + 56, true) / 1000,     // m/s
    pdop: dv.getUint16(o + 64, true) / 100,
    battery: bat & 0x7f,
    charging: (bat & 0x80) !== 0,
    gx: dv.getInt16(o + 68, true) / 1000,        // g
    gy: dv.getInt16(o + 70, true) / 1000,
    gz: dv.getInt16(o + 72, true) / 1000,
    rx: dv.getInt16(o + 74, true) / 100,         // deg/s
    ry: dv.getInt16(o + 76, true) / 100,
    rz: dv.getInt16(o + 78, true) / 100
  };
}

/** Penimbal aliran: suap bait, keluarkan mesej yang lengkap & sah. */
export class RaceBoxStream {
  constructor(onMessage) { this.buf = new Uint8Array(0); this.onMessage = onMessage; this.bad = 0; }
  push(chunk) {
    const n = new Uint8Array(this.buf.length + chunk.length);
    n.set(this.buf); n.set(chunk, this.buf.length);
    this.buf = n;
    let i = 0;
    while (this.buf.length - i >= 8) {
      if (this.buf[i] !== 0xb5 || this.buf[i + 1] !== 0x62) { i++; continue; }
      const len = this.buf[i + 4] | (this.buf[i + 5] << 8);
      if (len > 1024) { i++; continue; }
      const total = 6 + len + 2;
      if (this.buf.length - i < total) break;
      const [a, b] = checksum(this.buf, i + 2, i + 6 + len);
      if (a === this.buf[i + 6 + len] && b === this.buf[i + 7 + len]) {
        const cls = this.buf[i + 2], id = this.buf[i + 3];
        const dv = new DataView(this.buf.buffer, this.buf.byteOffset + i + 6, len);
        if (cls === 0xff && id === 0x01 && len === 80) this.onMessage(parseDataMessage(dv));
        i += total;
      } else { this.bad++; i++; }
    }
    this.buf = this.buf.slice(i);
  }
}

export async function connectRaceBox({ onSample, onDisconnect, onStatus, device }) {
  const stream = new RaceBoxStream(m => onSample({
    t: m.iTOW, speed: m.fixOk ? m.speed : 0, lat: m.lat, lon: m.lon, alt: m.alt,
    heading: m.heading, sats: m.sats, fix: m.fixOk ? m.fix : 0, hAcc: m.hAcc, sAcc: m.sAcc,
    gx: m.gx, gy: m.gy, gz: m.gz, battery: m.battery, charging: m.charging, source: 'RaceBox'
  }));
  return connectBle({
    filters: [{ namePrefix: 'RaceBox' }],
    optionalServices: [NUS_SERVICE],
    candidates: [{ service: NUS_SERVICE, notify: NUS_TX, write: NUS_RX }],
    onData: dv => stream.push(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)),
    onDisconnect, onStatus, device
  });
}
