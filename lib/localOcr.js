// ============================================================
//  VallorSoft — lib/localOcr.js
//  Helyi szövegfelismerés (OCR) szkennelt PDF-hez és fotóhoz — a SAJÁT szerveren
//  (tesseract.js, WebAssembly). Külső szolgáltatóhoz semmi nem megy ki
//  (lib/docPrivacy): a román nyelvi modell is az npm-csomagban van
//  (@tesseract.js-data/ron|hun|eng|deu), futás közben nincs letöltés.
//  Nyelvek: alapból román + magyar + angol (`WAYBILL_DOC_OCR_LANGS`, pl.
//  „ron+hun+eng+deu"); más nyelvhez a megfelelő @tesseract.js-data/<kód> csomag kell.
//
//  Szkennelt PDF: a beágyazott JPEG-képeket (DCTDecode — a szkennerek többsége így
//  ment) vesszük ki és olvassuk be; más tömörítésű kép-PDF „nem olvasható" marad.
// ============================================================
'use strict';

const path = require('path');
const os = require('os');

const MAX_IMAGES = 4;               // egy iratból legfeljebb ennyi oldal/kép
const MIN_JPEG = 15 * 1024;         // ennél kisebb JPEG (logó, pecsét) nem oldal
const MAX_BYTES = 20 * 1024 * 1024;
const IMG_TIMEOUT_MS = 60 * 1000;

function enabled() { return process.env.WAYBILL_DOC_OCR !== '0'; }

const fs = require('fs');
const DEFAULT_LANGS = 'ron+hun+eng';
function langs() {
  return String(process.env.WAYBILL_DOC_OCR_LANGS || DEFAULT_LANGS).toLowerCase()
    .split(/[+,;\s]+/).filter((l) => /^[a-z_]{3,8}$/.test(l));
}
// A tesseract egy könyvtárból tölti a nyelveket → a csomagok modelljeit egy helyi
// könyvtárba másoljuk (egyszer). A hiányzó nyelvi csomagot kihagyjuk.
let _langDir = null;
function _langSetup() {
  const want = langs();
  const dir = path.join(os.tmpdir(), 'vs-tess-lang');
  fs.mkdirSync(dir, { recursive: true });
  const ok = [];
  for (const l of want) {
    try {
      const src = path.join(path.dirname(require.resolve('@tesseract.js-data/' + l + '/package.json')), '4.0.0_best_int', l + '.traineddata.gz');
      const dst = path.join(dir, l + '.traineddata.gz');
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
      ok.push(l);
    } catch (_) { console.warn('[OCR] nincs nyelvi modell:', l, '(npm i @tesseract.js-data/' + l + ')'); }
  }
  _langDir = dir;
  return { dir, list: ok };
}

// A PDF-be ágyazott JPEG-ek (nyers bájtok) — függőség nélkül, a stream-ek alapján.
function pdfJpegs(buf, max) {
  const out = [];
  if (!Buffer.isBuffer(buf)) return out;
  const s = buf.toString('latin1');
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s)) && out.length < (max || MAX_IMAGES)) {
    const start = m.index + m[0].length;
    if (s.charCodeAt(start) !== 0xFF || s.charCodeAt(start + 1) !== 0xD8) continue;
    const dictStart = s.lastIndexOf('obj', m.index);
    const dict = dictStart >= 0 ? s.slice(dictStart, m.index) : '';
    if (!/DCTDecode/.test(dict) || /FlateDecode/.test(dict)) continue;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    let stop = end;
    while (stop > start && (s.charCodeAt(stop - 1) === 0x0A || s.charCodeAt(stop - 1) === 0x0D)) stop--;
    if (stop - start >= MIN_JPEG) out.push(buf.subarray(start, stop));
    re.lastIndex = end;
  }
  return out;
}

function _kind(b64, fileName) {
  const head = /^data:([^;]+);/i.exec(b64 || '');
  const mime = head ? head[1].toLowerCase() : '';
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/^image\/(jpe?g|png|webp|bmp|gif|tiff?)$/.test(mime) || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'].includes(ext)) return 'image';
  return null;
}

function _withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('ocr timeout')), ms); })])
    .finally(() => clearTimeout(t));
}

// Egy munkamenet (worker) több irathoz: open() → read(b64, name) … → close().
async function open() {
  const L = _langSetup();
  if (!L.list.length) throw new Error('lipsește modelul OCR (@tesseract.js-data/ron)');
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker(L.list.join('+'), 1, {
    langPath: L.dir, gzip: true, cachePath: path.join(os.tmpdir(), 'vs-tess'), logger: () => {}, errorHandler: () => {},
  });
  return {
    // → { text, images } — text üres, ha nincs olvasható kép
    async read(b64, fileName) {
      const kind = _kind(b64, fileName);
      if (!kind) return { text: '', images: 0 };
      const raw = String(b64 || '');
      const buf = Buffer.from(raw.slice(raw.indexOf(',') + 1), 'base64');
      if (!buf.length || buf.length > MAX_BYTES) return { text: '', images: 0 };
      const imgs = kind === 'pdf' ? pdfJpegs(buf, MAX_IMAGES) : [buf];
      const parts = [];
      for (const img of imgs) {
        try {
          const r = await _withTimeout(worker.recognize(img), IMG_TIMEOUT_MS);
          const txt = String((r && r.data && r.data.text) || '').trim();
          if (txt) parts.push(txt);
        } catch (e) { console.warn('[OCR] kép-olvasás hiba:', e.message); }
      }
      return { text: parts.join('\n\n'), images: imgs.length };
    },
    async close() { try { await worker.terminate(); } catch (_) {} },
  };
}

module.exports = { enabled, open, pdfJpegs, langs, MIN_JPEG };
