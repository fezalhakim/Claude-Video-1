import { t } from '../i18n.js';
// GPS telefon (Geolocation API) - sandaran bila tiada peranti luaran. Biasanya hanya 1 Hz.
export async function connectPhoneGps({ onSample, onError }) {
  if (!('geolocation' in navigator)) throw new Error(t('err.gps'));
  const id = navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    onSample({ t: p.timestamp, speed: c.speed ?? 0, lat: c.latitude, lon: c.longitude,
      alt: c.altitude ?? 0, heading: c.heading ?? 0, sats: null, fix: 3, hAcc: c.accuracy, source: 'GPS Telefon' });
  }, e => onError && onError(new Error(e.message)), { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  return { name: t('dev.phone'), disconnect: () => navigator.geolocation.clearWatch(id) };
}
