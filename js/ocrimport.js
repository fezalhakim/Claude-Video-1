// Import dari screenshot laporan prestasi (cth. Dragy): OCR dalam pelayar (Tesseract.js, dimuat bila perlu)
// + penghurai teks yang mencari metrik, trap speed, suhu, DA, ketinggian & cerun.

const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) loading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = TESS; s.async = true;
    s.onload = () => res(window.Tesseract); s.onerror = () => { loading = null; rej(new Error('ocr-load')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Besarkan & tukar ke kelabu kontras tinggi supaya OCR lebih tepat. Pulangkan kanvas. */
async function prepImage(file, invert = false) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(2, Math.max(1, 2000 / Math.max(bmp.width, bmp.height)));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    // biasa: teks gelap di atas latar cerah. Terbalik: hanya teks putih (di atas latar kelabu/berwarna) jadi hitam.
    const v = invert ? (g > 215 ? 0 : 255) : (g > 200 ? 255 : g < 120 ? 0 : (g - 120) * 3.2);
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  x.putImageData(d, 0, 0);
  return c;
}

/** OCR satu fail gambar. onProgress(0..1). Pulangkan teks. */
export async function ocrImage(file, onProgress) {
  const T = await loadTesseract();
  const worker = await T.createWorker('eng');
  try {
    let out = '';
    for (const [i, inv] of [[0, false], [1, true]]) {   // 2 laluan: teks gelap, kemudian teks putih
      const img = await prepImage(file, inv);
      onProgress && onProgress(i / 2);
      const res = await worker.recognize(img);
      out += (res.data.text || '') + '\n';
    }
    onProgress && onProgress(1);
    return out;
  } finally { worker.terminate(); }
}

const num = s => parseFloat(String(s).replace(',', '.'));

/**
 * Cari data prestasi dalam teks OCR.
 * Pulangkan { results: {key: {time, trap?}}, temp, alt, da, slope, device }.
 */
export function parseReportText(raw) {
  const text = raw.replace(/\r/g, '').replace(/[|]/g, ' ').replace(/[’`´]/g, "'")
    .replace(/(\d)\s*[.,]\s*(\d)/g, '$1.$2')          // "7 .68" -> "7.68"
    .replace(/(\d)\s*s\b/g, '$1s');
  const results = {};
  const put = (key, t, trap) => {
    if (!/[.]/.test(String(t)) && /^\d{3,4}$/.test(String(t))) t = +t / 100; // "171s" -> 1.71 (titik hilang semasa OCR)
    t = num(t); if (!(t > 0.3 && t < 120)) return;
    const tr = trap != null && num(trap) > 5 && num(trap) < 600 ? num(trap) : null;
    const cur = results[key];
    if (cur) { if (cur.trap == null && tr != null && Math.abs(cur.time - t) < 0.005) cur.trap = tr; return; } // kekalkan yang pertama, lengkapkan trap
    results[key] = { time: t }; if (tr != null) results[key].trap = tr;
  };
  const T = String.raw`(\d{1,3}\.\d{1,3}|\d{3,4})\s*s(?:\s*@\s*(\d{1,3}(?:\.\d{1,2})?))?`;
  const pats = [
    [new RegExp(String.raw`\b60\s*ft\b[^\n\d]{0,20}` + T, 'gi'), '60ft'],
    [new RegExp(String.raw`\b100\s*ft\b[^\n\d]{0,20}` + T, 'gi'), '100ft'],
    [new RegExp(String.raw`\b330\s*ft\b[^\n\d]{0,20}` + T, 'gi'), '330ft'],
    [new RegExp(String.raw`\b1000\s*ft\b[^\n\d]{0,20}` + T, 'gi'), '1000ft'],
    [new RegExp(String.raw`(?:\b1\s*/\s*8|\b660\s*ft)(?:\s*mi(?:le)?)?\b[^\n\d]{0,20}` + T, 'gi'), '1/8 batu'],
    [new RegExp(String.raw`(?:\b1\s*/\s*4|\b1320\s*ft)(?:\s*mi(?:le)?)?\b[^\n\d]{0,20}` + T, 'gi'), '1/4 batu'],
    [new RegExp(String.raw`\b1\s*/\s*2\s*mi(?:le)?\b[^\n\d]{0,20}` + T, 'gi'), '1/2 batu']
  ];
  for (const [re, key] of pats) for (const m of text.matchAll(re)) put(key, m[1], m[2]);
  // julat kelajuan: "0-100km/h 3.71s", "100-200 7.85s"
  for (const m of text.matchAll(new RegExp(String.raw`\b(\d{1,3})\s*[-–~]\s*(\d{1,3})\s*(?:km\s*/?\s*h|kmh|km/j)?[^\n\d]{0,12}` + T, 'gi'))) {
    const a = +m[1], b = +m[2];
    if (a !== b && a <= 400 && b <= 400 && (a === 0 || b === 0 || b > a)) put(`${a}-${b}`, m[3]);
  }
  // nilai besar di kad ringkasan: "7.68s" diikuti "1/8 mile" pada baris seterusnya
  // (hanya jika metrik itu belum dijumpai dengan label yang jelas)
  for (const m of text.matchAll(/(\d{1,2}\.\d{2})s[ \t]*\n[ \t]*(?:\S+[ \t]+)?(1\s*\/\s*[48])\s*mi/gi)) {
    const key = m[2].replace(/\s/g, '') === '1/8' ? '1/8 batu' : '1/4 batu';
    if (!results[key]) put(key, m[1]);
  }

  const out = { results };
  let m;
  // suhu / ketinggian / DA: OCR sering hilangkan "°" dan salah baca ikon & "DA" (cth. "&26C A72m BI571m")
  for (const line of text.split('\n')) {
    const tm = line.match(/(?:^|[^\d.])(-?\d{1,2}(?:\.\d)?)\s*°?\s*[cC](?![a-z])/);
    if (!tm || out.temp != null) continue;
    const tv = num(tm[1]); if (tv < -30 || tv > 60) continue;
    out.temp = tv;
    const rest = line.slice(tm.index + tm[0].length);
    const ms = [...rest.matchAll(/(-?\d{1,4})\s*m\b/g)].map(x => num(x[1]));
    if (ms[0] != null) out.alt = ms[0];
    if (ms[1] != null) out.da = ms[1];
  }
  if ((m = text.match(/\bDA\s*[:]?\s*(-?\d{1,4})\s*m\b/i))) out.da = num(m[1]);   // label DA yang jelas diutamakan
  if ((m = text.match(/(-?\d{1,2}\.\d{1,2})\s*%[^\n]*\n?[^\n]*slope|slope[^\n]*?(-?\d{1,2}\.\d{1,2})\s*%/i))) out.slope = num(m[1] ?? m[2]);
  else if ((m = text.match(/(-?\d{1,2}\.\d{1,2})\s*%/))) out.slope = num(m[1]);
  if ((m = text.match(/\b(DRG\w{1,8}|Dragy\s*\w*)/i))) out.device = m[1].trim();
  return out;
}
