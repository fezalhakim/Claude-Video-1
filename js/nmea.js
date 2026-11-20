// Penghurai NMEA 0183 (RMC, GGA, VTG) untuk aliran teks GNSS.
const KNOT = 0.514444;

export function validChecksum(line) {
  const star = line.lastIndexOf('*');
  if (line[0] !== '$' || star < 0) return false;
  let c = 0;
  for (let i = 1; i < star; i++) c ^= line.charCodeAt(i);
  return c === parseInt(line.slice(star + 1, star + 3), 16);
}

function coord(v, hemi) {
  if (!v) return NaN;
  const dot = v.indexOf('.');
  const deg = parseInt(v.slice(0, dot - 2), 10);
  const min = parseFloat(v.slice(dot - 2));
  const d = deg + min / 60;
  return hemi === 'S' || hemi === 'W' ? -d : d;
}

function todMs(v) {
  if (!v || v.length < 6) return NaN;
  return ((+v.slice(0, 2) * 60 + +v.slice(2, 4)) * 60 + parseFloat(v.slice(4))) * 1000;
}

export function parseSentence(line) {
  line = line.trim();
  if (!validChecksum(line)) return null;
  const f = line.slice(1, line.lastIndexOf('*')).split(',');
  const type = f[0].slice(2);
  if (type === 'RMC') {
    return { type, tod: todMs(f[1]), valid: f[2] === 'A', lat: coord(f[3], f[4]), lon: coord(f[5], f[6]),
      speed: (parseFloat(f[7]) || 0) * KNOT, heading: parseFloat(f[8]) || 0, date: f[9] };
  }
  if (type === 'GGA') {
    return { type, tod: todMs(f[1]), lat: coord(f[2], f[3]), lon: coord(f[4], f[5]),
      quality: +f[6] || 0, sats: +f[7] || 0, hdop: parseFloat(f[8]) || 0, alt: parseFloat(f[9]) || 0 };
  }
  if (type === 'VTG') {
    return { type, speed: (parseFloat(f[7]) || 0) / 3.6, heading: parseFloat(f[1]) || 0 };
  }
  return { type };
}

/** Gabung ayat NMEA kepada sampel; satu sampel dikeluarkan bagi setiap RMC. */
export class NmeaStream {
  constructor(onSample, source = 'NMEA') {
    this.text = ''; this.onSample = onSample; this.source = source;
    this.sats = 0; this.alt = 0; this.quality = 0; this.lastTod = null; this.dayOffset = 0;
  }
  push(str) {
    this.text += str;
    let nl;
    while ((nl = this.text.search(/[\r\n]/)) >= 0) {
      const line = this.text.slice(0, nl);
      this.text = this.text.slice(nl + 1);
      if (line.length) this.handle(line);
    }
    if (this.text.length > 2048) this.text = '';
  }
  handle(line) {
    const s = parseSentence(line);
    if (!s) return;
    if (s.type === 'GGA') { this.sats = s.sats; this.alt = s.alt; this.quality = s.quality; return; }
    if (s.type !== 'RMC' || isNaN(s.tod)) return;
    // tangani lintasan tengah malam
    if (this.lastTod !== null && s.tod < this.lastTod - 3600e3) this.dayOffset += 86400e3;
    this.lastTod = s.tod;
    this.onSample({
      t: s.tod + this.dayOffset, speed: s.valid ? s.speed : 0, lat: s.lat, lon: s.lon, alt: this.alt,
      heading: s.heading, sats: this.sats, fix: s.valid ? 3 : 0, source: this.source
    });
  }
}
