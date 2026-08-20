// lib/uitFormat.js — közös UIT-formátum kezelés (szerver).
//
// A UIT-kód alfanumerikus, MAX 16 karakter. A felületen 4-esével kötőjellel
// tagolva jelenítjük meg (XXXX-XXXX-XXXX-XXXX), de a DB-ben normalizálva
// (kötőjel nélkül, nagybetűvel) tároljuk — így két bevitel („ab-cd 12 34"
// vs „ABCD1234") ugyanannak a kódnak számít az egyediségnél.
//
// A CLI-oldali auto-format (a beírás közbeni ▮4-kar. kötőjel + nagybetű) a
// `public/uit-format.js`-ben él, ugyanezekkel a szabályokkal.
'use strict';

// Max 16 karakter (A-Z, 0-9), a régi 12-jegyű ANAF UIT és a 16-jegyű változat
// is belefér. A `[^A-Z0-9]` mindent kivág (kötőjel, szóköz, ékezet stb.).
const UIT_MAX = 16;

function normalizeUit(s) {
  if (s == null) return '';
  return String(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, UIT_MAX);
}

// Emberi olvasásra: 4-karakteres blokkok kötőjellel (XXXX-XXXX-XXXX-XXXX).
// Kód rövidebb → csak amennyi van (pl. „ABCD-1234").
function formatUit(s) {
  const raw = normalizeUit(s);
  if (!raw) return '';
  return raw.match(/.{1,4}/g).join('-');
}

// Egyszerű validáció: min 1 karakter, csak alfanumerikus, ≤ 16 karakter.
function isValidUit(s) {
  const raw = normalizeUit(s);
  return raw.length > 0 && raw.length <= UIT_MAX;
}

module.exports = { UIT_MAX, normalizeUit, formatUit, isValidUit };
