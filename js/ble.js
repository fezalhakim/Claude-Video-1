import { t } from './i18n.js';
// Pembantu Web Bluetooth generik, dengan sambung semula automatik.
export function bleSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Peranti yang pernah diberi kebenaran (selepas refresh) — tanpa perlu dialog pilih peranti. */
export async function findKnownDevice(id) {
  if (!bleSupported() || !navigator.bluetooth.getDevices || !id) return null;
  try { return (await navigator.bluetooth.getDevices()).find(d => d.id === id) || null; } catch { return null; }
}

/**
 * Sambung ke peranti BLE dan langgan characteristic "notify".
 * @param {object} opts
 *   filters / acceptAllDevices / optionalServices: untuk dialog pilih peranti
 *   device: peranti sedia ada (sambung semula selepas refresh) — dialog dilangkau
 *   candidates: [{service, notify, write?}] dicuba ikut turutan
 *   onData(DataView), onDisconnect(), onStatus('reconnecting' | 'connected')
 */
export async function connectBle({ filters, acceptAllDevices, optionalServices, candidates, onData, onDisconnect, onStatus, device }) {
  if (!bleSupported()) throw new Error(t('err.ble'));
  if (!device) {
    device = await navigator.bluetooth.requestDevice(
      acceptAllDevices ? { acceptAllDevices: true, optionalServices } : { filters, optionalServices });
  }

  let manual = false, writeChar = null, used = null;
  const onValue = ev => onData(ev.target.value);

  async function setup() {
    const server = await device.gatt.connect();
    let notifyChar = null;
    for (const c of candidates) {
      try {
        const svc = await server.getPrimaryService(c.service);
        notifyChar = await svc.getCharacteristic(c.notify);
        writeChar = null;
        if (c.write) { try { writeChar = await svc.getCharacteristic(c.write); } catch { /* pilihan */ } }
        used = c;
        break;
      } catch { /* cuba calon seterusnya */ }
    }
    if (!notifyChar) { device.gatt.disconnect(); throw new Error(t('err.service')); }
    notifyChar.removeEventListener('characteristicvaluechanged', onValue);
    notifyChar.addEventListener('characteristicvaluechanged', onValue);
    await notifyChar.startNotifications();
  }

  // sambungan awal: beberapa cubaan (peranti mungkin sedang sibuk / baru dihidupkan)
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { await setup(); lastErr = null; break; }
    catch (e) { lastErr = e; if (e.message === t('err.service')) break; await sleep(700 * (i + 1)); }
  }
  if (lastErr) throw lastErr;

  // terputus tanpa sengaja (isyarat lemah, peranti tidur sekejap): cuba sambung semula dahulu
  device.addEventListener('gattserverdisconnected', async () => {
    if (manual) return;
    onStatus && onStatus('reconnecting');
    for (let i = 0; i < 6 && !manual; i++) {
      await sleep(Math.min(1000 * 2 ** i, 8000));
      if (manual) return;
      try { await setup(); onStatus && onStatus('connected'); return; } catch { /* cuba lagi */ }
    }
    if (!manual) onDisconnect && onDisconnect();
  });

  return {
    name: device.name || 'BLE',
    id: device.id,
    service: used.service,
    write: async bytes => { if (writeChar) await writeChar.writeValueWithoutResponse(bytes); },
    disconnect: () => { manual = true; try { device.gatt.disconnect(); } catch { /* abaikan */ } }
  };
}
