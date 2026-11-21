// Pemacu peranti PGear (modul GPS Bluetooth). Format data dikesan secara automatik:
//   - u-blox UBX NAV-PVT (class 0x01 id 0x07, 92 bait)
//   - mesej data RaceBox (class 0xFF id 0x01, 80 bait)
//   - NMEA 0183 (teks $..RMC / $..GGA)
import { connectBle } from '../ble.js';
import { checksum, parseDataMessage } from './racebox.js';
import { NmeaStream } from '../nmea.js';

const S = n => `0000${n}-0000-1000-8000-00805f9b34fb`;
export const PGEAR_CANDIDATES = [
  { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' }, // Nordic UART
  { service: S('ffe0'), notify: S('ffe1'), write: S('ffe1') },
  { service: S('fff0'), notify: S('fff1'), write: S('fff2') },
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', notify: '49535343-1e4d-4bd9-ba61-23c647249616' }
];

/** Hurai UBX NAV-PVT (92 bait) kepada sampel MGear. */
export function parseNavPvt(dv, o = 0) {
  const fixType = dv.getUint8(o + 20), flags = dv.getUint8(o + 21);
  const ok = (flags & 0x01) === 1 && fixType >= 2;
  return {
    t: dv.getUint32(o + 0, true),                        // iTOW (ms)
    fix: ok ? Math.min(3, fixType) : 0,
    sats: dv.getUint8(o + 23),
    lon: dv.getInt32(o + 24, true) / 1e7,
    lat: dv.getInt32(o + 28, true) / 1e7,
    alt: dv.getInt32(o + 36, true) / 1000,               // hMSL (m)
    hAcc: dv.getUint32(o + 40, true) / 1000,
    speed: ok ? dv.getInt32(o + 60, true) / 1000 : 0,    // gSpeed (m/s)
    heading: dv.getInt32(o + 64, true) / 1e5,
    sAcc: dv.getUint32(o + 68, true) / 1000
  };
}

/**
 * Aliran automatik: suap bait mentah, keluarkan sampel. Mengesan sendiri sama ada data UBX (binari)
 * atau NMEA (teks), dan kekal dengan format itu selepas dikesan.
 */
export class AutoGpsStream {
  constructor(onSample) {
    this.onSample = onSample; this.mode = null; this.buf = new Uint8Array(0);
    this.nmea = new NmeaStream(s => this.emit(s, 'NMEA'), 'PGear'); this.dec = new TextDecoder(); this.format = null;
  }
  emit(s, fmt) { this.format = fmt; this.onSample({ ...s, source: 'PGear' }); }
  push(chunk) {
    if (!this.mode) {
      // UBX bermula 0xB5 0x62; NMEA bermula '$'
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0xb5 && chunk[i + 1] === 0x62) { this.mode = 'ubx'; break; }
        if (chunk[i] === 0x24) { this.mode = 'nmea'; break; }
      }
      if (!this.mode) return;
    }
    if (this.mode === 'nmea') return this.nmea.push(this.dec.decode(chunk, { stream: true }));
    // UBX
    const n = new Uint8Array(this.buf.length + chunk.length); n.set(this.buf); n.set(chunk, this.buf.length); this.buf = n;
    let i = 0;
    while (this.buf.length - i >= 8) {
      if (this.buf[i] !== 0xb5 || this.buf[i + 1] !== 0x62) { i++; continue; }
      const len = this.buf[i + 4] | (this.buf[i + 5] << 8);
      if (len > 1024) { i++; continue; }
      const total = 8 + len; if (this.buf.length - i < total) break;
      const [a, b] = checksum(this.buf, i + 2, i + 6 + len);
      if (a === this.buf[i + 6 + len] && b === this.buf[i + 7 + len]) {
        const cls = this.buf[i + 2], id = this.buf[i + 3], dv = new DataView(this.buf.buffer, this.buf.byteOffset + i + 6, len);
        if (cls === 0x01 && id === 0x07 && len >= 92) this.emit(parseNavPvt(dv), 'UBX NAV-PVT');
        else if (cls === 0xff && id === 0x01 && len === 80) {
          const m = parseDataMessage(dv);
          this.emit({ t: m.iTOW, speed: m.fixOk ? m.speed : 0, lat: m.lat, lon: m.lon, alt: m.alt, heading: m.heading,
            sats: m.sats, fix: m.fixOk ? m.fix : 0, hAcc: m.hAcc, sAcc: m.sAcc, gx: m.gx, gy: m.gy, gz: m.gz,
            battery: m.battery, charging: m.charging }, 'RaceBox');
        }
        i += total;
      } else i++;
    }
    this.buf = this.buf.slice(i);
  }
}

export async function connectPGear({ onSample, onDisconnect, onStatus, device, anyDevice = false }) {
  const stream = new AutoGpsStream(onSample);
  const conn = await connectBle({
    filters: anyDevice ? undefined : [{ namePrefix: 'PGear' }, { namePrefix: 'PGEAR' }, { namePrefix: 'pgear' }],
    ...(anyDevice ? { acceptAllDevices: true } : {}),
    optionalServices: PGEAR_CANDIDATES.map(c => c.service),
    candidates: PGEAR_CANDIDATES,
    onData: dv => stream.push(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)),
    onDisconnect, onStatus, device
  });
  return { ...conn, name: conn.name || 'PGear', format: () => stream.format };
}
