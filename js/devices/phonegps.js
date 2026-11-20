import { t } from '../i18n.js';
// GPS telefon (Geolocation API) - sandaran bila tiada peranti luaran. Biasanya hanya 1-2 Hz.
//
// Banyak telefon Android TIDAK memberi coords.speed (nilainya null). Jika begitu, kelajuan
// dikira sendiri dari perubahan lokasi dalam tetingkap ~2 s, supaya gangguan lokasi
// (beberapa meter) semasa pegun tidak dikira sebagai pergerakan.

const R = 6371000;
export function haversine(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180, dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Penganggar kelajuan dari kedudukan. push({t, lat, lon, acc}) -> m/s */
export class SpeedFromPosition {
  constructor({ windowMs = 2000 } = {}) { this.win = windowMs; this.hist = []; this.v = 0; }
  push({ t, lat, lon, acc = 10 }) {
    this.hist.push({ t, lat, lon });
    while (this.hist.length > 2 && t - this.hist[1].t >= this.win) this.hist.shift();
    const a = this.hist[0];
    const dt = (t - a.t) / 1000;
    if (dt < 0.4) return this.v;
    const d = haversine(a.lat, a.lon, lat, lon);
    // pergerakan lebih kecil daripada hingar lokasi = pegun
    const noise = Math.min(Math.max(acc, 3), 15) * 0.8;
    const raw = d < noise ? 0 : d / dt;
    this.v = this.v === 0 || raw === 0 ? raw : this.v * 0.4 + raw * 0.6; // licinkan sedikit
    return this.v;
  }
}

export async function connectPhoneGps({ onSample, onError }) {
  if (!('geolocation' in navigator)) throw new Error(t('err.gps'));
  const est = new SpeedFromPosition();
  const id = navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    const derived = est.push({ t: p.timestamp, lat: c.latitude, lon: c.longitude, acc: c.accuracy });
    const hasSpeed = typeof c.speed === 'number' && isFinite(c.speed);
    onSample({ t: p.timestamp, speed: hasSpeed ? Math.max(0, c.speed) : derived, lat: c.latitude, lon: c.longitude,
      alt: c.altitude ?? 0, heading: c.heading ?? 0, sats: null, fix: 3, hAcc: c.accuracy,
      speedSrc: hasSpeed ? 'gps' : 'pos', source: 'GPS Telefon' });
  }, e => onError && onError(new Error(e.message)), { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  return { name: t('dev.phone'), disconnect: () => navigator.geolocation.clearWatch(id) };
}
