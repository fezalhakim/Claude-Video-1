// Pemacu Dragy (dan modul GPS BLE lain yang menstrim NMEA).
// Dragy menstrim ayat NMEA melalui characteristic UART BLE. Protokol Dragy tidak
// didokumenkan secara rasmi, jadi beberapa UUID UART biasa dicuba ikut turutan.
import { connectBle } from '../ble.js';
import { NmeaStream } from '../nmea.js';

const S = n => `0000${n}-0000-1000-8000-00805f9b34fb`;
export const DRAGY_CANDIDATES = [
  { service: S('ffe0'), notify: S('ffe1'), write: S('ffe1') },              // UART gaya HM-10
  { service: S('fff0'), notify: S('fff1'), write: S('fff2') },
  { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',                         // Nordic UART
    notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' },
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455',                         // Microchip ISSC
    notify: '49535343-1e4d-4bd9-ba61-23c647249616' }
];

export async function connectDragy({ onSample, onDisconnect, anyDevice = false }) {
  const stream = new NmeaStream(onSample, 'Dragy');
  const decoder = new TextDecoder();
  return connectBle({
    filters: anyDevice ? undefined : [{ namePrefix: 'Dragy' }, { namePrefix: 'DRAGY' }],
    ...(anyDevice ? { acceptAllDevices: true } : {}),
    optionalServices: DRAGY_CANDIDATES.map(c => c.service),
    candidates: DRAGY_CANDIDATES,
    onData: dv => stream.push(decoder.decode(dv, { stream: true })),
    onDisconnect
  });
}
