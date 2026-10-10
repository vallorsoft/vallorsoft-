// ============================================================
//  VallorSoft — lib/mailUploads.js
//  A felhasználó által a chatben (vagy a levél-szerkesztőben) a gépéről /
//  telefonjáról hozzáadott csatolmányok ellenőrzése.
//  SZABÁLY: a feltöltött fájl CSAK a kimenő levélbe kerül — nem tároljuk,
//  és sosem megy az AI-hoz (CLAUDE.md: tárolt/feltöltött dokumentum soha
//  nem kerül AI-hoz). A mail_sent napló csak a fájlneveket őrzi.
// ============================================================
'use strict';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;   // 10 MB / fájl
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;  // 15 MB összesen (a levél-szolgáltatók korlátja alatt)

// Kiterjesztés → elfogadott MIME-ek. Futtatható/szkript fájl NEM küldhető.
const TYPES = {
  pdf: ['application/pdf'],
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], gif: ['image/gif'], webp: ['image/webp'],
  heic: ['image/heic', 'image/heif'], heif: ['image/heic', 'image/heif'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], xls: ['application/vnd.ms-excel'],
  csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], doc: ['application/msword'],
  odt: ['application/vnd.oasis.opendocument.text'], ods: ['application/vnd.oasis.opendocument.spreadsheet'],
  txt: ['text/plain'], zip: ['application/zip', 'application/x-zip-compressed'],
};
const EXTS = Object.keys(TYPES);

function _safeName(n) {
  let s = String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  if (s.length > 120) { const m = /\.[A-Za-z0-9]{1,5}$/.exec(s); s = s.slice(0, 120 - (m ? m[0].length : 0)) + (m ? m[0] : ''); }
  return s || 'fisier';
}
function _ext(n) { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(n || '')); return m ? m[1].toLowerCase() : ''; }

// Bemenet: [{ name, mime?, b64 }] (b64 lehet data-URL is).
// Kimenet: { ok:true, files:[{name, contentBase64}] } | { ok:false, err }
function sanitizeUploads(list, lang) {
  const hu = lang === 'hu';
  if (list == null) return { ok: true, files: [] };
  if (!Array.isArray(list)) return { ok: false, err: hu ? 'Érvénytelen csatolmány.' : 'Atașament invalid.' };
  if (list.length > MAX_FILES) return { ok: false, err: (hu ? 'Legfeljebb ' + MAX_FILES + ' fájl csatolható.' : 'Se pot atașa cel mult ' + MAX_FILES + ' fișiere.') };
  const files = [];
  let total = 0;
  for (const f of list) {
    if (!f || typeof f !== 'object') return { ok: false, err: hu ? 'Érvénytelen csatolmány.' : 'Atașament invalid.' };
    const name = _safeName(f.name);
    const ext = _ext(name);
    if (!EXTS.includes(ext)) return { ok: false, err: (hu ? 'Nem küldhető fájltípus: ' : 'Tip de fișier nepermis: ') + name };
    let b64 = String(f.b64 || '');
    const dm = /^data:([^;,]+)?;base64,/.exec(b64);
    if (dm) b64 = b64.slice(dm[0].length);
    b64 = b64.replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return { ok: false, err: (hu ? 'Hibás fájl: ' : 'Fișier corupt: ') + name };
    const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    if (bytes <= 0) return { ok: false, err: (hu ? 'Üres fájl: ' : 'Fișier gol: ') + name };
    if (bytes > MAX_FILE_BYTES) return { ok: false, err: (hu ? 'Túl nagy fájl (max. 10 MB): ' : 'Fișier prea mare (max. 10 MB): ') + name };
    total += bytes;
    if (total > MAX_TOTAL_BYTES) return { ok: false, err: hu ? 'A csatolmányok együtt legfeljebb 15 MB lehetnek.' : 'Atașamentele pot avea împreună cel mult 15 MB.' };
    const mime = String(f.mime || (dm && dm[1]) || '').toLowerCase();
    if (mime && mime !== 'application/octet-stream' && !TYPES[ext].includes(mime)) {
      return { ok: false, err: (hu ? 'A fájl típusa nem egyezik a kiterjesztéssel: ' : 'Tipul fișierului nu corespunde extensiei: ') + name };
    }
    files.push({ name, contentBase64: b64 });
  }
  return { ok: true, files };
}

module.exports = { sanitizeUploads, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, EXTS };
