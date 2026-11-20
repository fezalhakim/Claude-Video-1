// Jana kad gambar (PNG 1080x1350, sesuai untuk Instagram/WhatsApp) untuk laju maks & keputusan larian,
// kemudian tunjuk pratonton dengan pilihan Kongsi / Simpan.
import { t, metric, locale } from './i18n.js';

const W = 1080, H = 1350;
const C = { bg1: '#0b0d10', bg2: '#2a1512', red: '#ff3b30', pink: '#ff8a80', text: '#f2f4f7', mute: '#8b95a3', tile: 'rgba(255,255,255,.06)' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Data kad daripada satu rekod larian. extraKeys = jarak tersuai semasa. */
export function runCard(run, extraKeys = []) {
  const pref = ['0-100', '100-200', '60ft', '1/8 batu', '1/4 batu', ...extraKeys, '0-200', '0-60', '100-0'];
  const keys = pref.filter((k, i) => run.results?.[k] && pref.indexOf(k) === i).slice(0, 6);
  return {
    label: t('live.top'), value: run.maxKmh != null ? run.maxKmh.toFixed(1) : '–', unit: t('kmh'),
    rows: keys.map(k => [metric(k), run.results[k].time.toFixed(2) + ' s']),
    who: [run.driver, run.car].filter(Boolean).join(' · '),
    when: new Date(run.at), device: run.device, tag: `Run ${run.no}`
  };
}

function drawLogo(x, cx, y) {
  x.save();
  x.lineCap = 'round'; x.lineWidth = 14;
  x.strokeStyle = '#3a414b'; x.beginPath(); x.arc(cx - 150, y + 40, 46, Math.PI, 2 * Math.PI); x.stroke();
  x.strokeStyle = C.red; x.beginPath(); x.arc(cx - 150, y + 40, 46, Math.PI, 1.65 * Math.PI); x.stroke();
  x.strokeStyle = C.text; x.lineWidth = 9; x.beginPath(); x.moveTo(cx - 150, y + 40); x.lineTo(cx - 122, y + 8); x.stroke();
  x.font = `900 76px ${FONT}`; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillStyle = C.text; x.fillText('M', cx - 82, y + 66);
  const mw = x.measureText('M').width;
  x.fillStyle = C.red; x.fillText('GEAR', cx - 82 + mw, y + 66);
  x.restore();
}

function roundRect(x, px, py, w, h, r) {
  x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
}

/** Lukis kad ke kanvas baru dan pulangkan kanvas itu. */
export function drawCard(d) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg2);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // corak garis laju di latar
  x.strokeStyle = 'rgba(255,59,48,.08)'; x.lineWidth = 3;
  for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(-100 + i * 150, H); x.lineTo(500 + i * 150, 0); x.stroke(); }

  drawLogo(x, W / 2, 70);

  x.textAlign = 'center';
  x.fillStyle = C.pink; x.font = `800 46px ${FONT}`;
  if ('letterSpacing' in x) x.letterSpacing = '8px';
  x.fillText(d.label.toUpperCase(), W / 2, 330);
  if ('letterSpacing' in x) x.letterSpacing = '0px';

  // nombor besar: muatkan dalam lebar
  let size = 300; x.font = `900 ${size}px ${FONT}`;
  while (x.measureText(d.value).width > W - 160 && size > 120) { size -= 10; x.font = `900 ${size}px ${FONT}`; }
  x.fillStyle = C.text; x.fillText(d.value, W / 2, 600);
  x.fillStyle = C.mute; x.font = `600 60px ${FONT}`; x.fillText(d.unit, W / 2, 690);

  // jubin keputusan (2 lajur)
  const rows = d.rows || [], tw = 440, th = 118, gap = 18, top = 740;
  const left = (W - (tw * 2 + gap)) / 2;
  rows.forEach(([k, v], i) => {
    const px = left + (i % 2) * (tw + gap), py = top + Math.floor(i / 2) * (th + gap);
    x.fillStyle = C.tile; roundRect(x, px, py, tw, th, 24); x.fill();
    x.textAlign = 'left'; x.fillStyle = C.mute; x.font = `600 32px ${FONT}`; x.fillText(k, px + 30, py + 44);
    x.fillStyle = C.text; x.font = `800 54px ${FONT}`; x.fillText(v, px + 30, py + 98);
  });

  // maklumat bawah
  x.textAlign = 'center';
  const metaY = rows.length ? top + Math.ceil(rows.length / 2) * (th + gap) + 34 : 860;
  let y = Math.max(metaY, 860);
  if (d.who) { x.fillStyle = C.text; x.font = `700 44px ${FONT}`; x.fillText(d.who, W / 2, y); y += 60; }
  const when = d.when ? `${d.when.toLocaleDateString(locale())} ${d.when.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}` : '';
  x.fillStyle = C.mute; x.font = `500 34px ${FONT}`;
  x.fillText([d.tag, when, d.device].filter(Boolean).join('  ·  '), W / 2, y);

  x.fillStyle = 'rgba(255,255,255,.35)'; x.font = `700 30px ${FONT}`;
  if ('letterSpacing' in x) x.letterSpacing = '6px';
  x.fillText('MGEAR GPS', W / 2, H - 36);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  return c;
}

let urlNow = null;
/** Tunjuk pratonton kad; pengguna boleh Kongsi (jika disokong) atau Simpan. */
export async function openShare(d, toast) {
  const canvas = drawCard(d);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const name = `mgear-${(d.tag || 'top-speed').replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (urlNow) URL.revokeObjectURL(urlNow);
  urlNow = URL.createObjectURL(blob);

  let el = document.getElementById('shareBox');
  if (!el) { el = document.createElement('div'); el.id = 'shareBox'; el.className = 'shareBox'; document.body.appendChild(el); }
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  el.innerHTML = `<div class="shareInner" role="dialog" aria-modal="true">
    <img src="${urlNow}" alt="${t('share.title')}">
    <div class="sheetBtns ${canShare ? '' : 'one'}">
      <button class="ghost" data-s="save">${t('share.save')}</button>
      ${canShare ? `<button class="primary" data-s="share">${t('share.btn')}</button>` : ''}
    </div>
    <button class="ghost wide" data-s="close">${t('done.close')}</button>
  </div>`;
  el.hidden = false;
  el.onclick = async e => {
    const a = e.target.dataset.s;
    if (e.target === el || a === 'close') { el.hidden = true; return; }
    if (a === 'save') {
      const l = document.createElement('a'); l.href = urlNow; l.download = name; l.click();
      toast && toast(t('share.saved'));
    }
    if (a === 'share') {
      try { await navigator.share({ files: [file], title: 'MGear' }); }
      catch (err) { if (err.name !== 'AbortError') toast && toast(err.message); }
    }
  };
}
