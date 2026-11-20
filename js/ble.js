import { t } from './i18n.js';
// Pembantu Web Bluetooth generik.
export function bleSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

/**
 * Sambung ke peranti BLE dan langgan characteristic "notify".
 * @param {object} opts
 *   filters: penapis requestDevice
 *   optionalServices: senarai UUID servis
 *   candidates: [{service, notify, write?}] dicuba ikut turutan
 *   onData(DataView), onDisconnect()
 */
export async function connectBle({ filters, acceptAllDevices, optionalServices, candidates, onData, onDisconnect }) {
  if (!bleSupported()) {
    throw new Error(t('err.ble'));
  }
  const device = await navigator.bluetooth.requestDevice(
    acceptAllDevices ? { acceptAllDevices: true, optionalServices } : { filters, optionalServices });
  device.addEventListener('gattserverdisconnected', () => onDisconnect && onDisconnect());
  const server = await device.gatt.connect();

  let notifyChar = null, writeChar = null, used = null;
  for (const c of candidates) {
    try {
      const svc = await server.getPrimaryService(c.service);
      notifyChar = await svc.getCharacteristic(c.notify);
      if (c.write) { try { writeChar = await svc.getCharacteristic(c.write); } catch { /* pilihan */ } }
      used = c;
      break;
    } catch { /* cuba calon seterusnya */ }
  }
  if (!notifyChar) {
    device.gatt.disconnect();
    throw new Error(t('err.service'));
  }
  notifyChar.addEventListener('characteristicvaluechanged', ev => onData(ev.target.value));
  await notifyChar.startNotifications();

  return {
    name: device.name || 'Peranti BLE',
    service: used.service,
    write: async bytes => { if (writeChar) await writeChar.writeValueWithoutResponse(bytes); },
    disconnect: () => { try { device.gatt.disconnect(); } catch { /* abaikan */ } }
  };
}
