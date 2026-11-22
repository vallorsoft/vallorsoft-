// ============================================================
//  VallorSoft — lib/docPrivacy.js
//  ÁLLANDÓ SZABÁLY: megrendelő, számla / bon és fuvar-fotó (bármilyen
//  feltöltött fájl vagy annak szövege) SOHA nem hagyhatja el a saját
//  szerverünket (Fly.io + Neon + Cloudflare tárhely) — külső AI-hoz
//  (Google Gemini) sem, egy pillanatra sem.
//
//  Ez egy KÓDBA ÉGETETT kapcsoló, szándékosan NEM env-változó: a szabályt
//  nem lehet véletlenül egy beállítással visszakapcsolni. A chat-szöveg és
//  a sofőr-fordító (csak a beírt szöveg) továbbra is mehet AI-hoz.
//
//  Védelmi rétegek:
//   1. lib/geminiJson.js — bármilyen fájl-rész (inlineData/fileData) a
//      kérésben → hálózati hívás NÉLKÜL elutasítva.
//   2. services/order-ai — a megrendelő/e-mail kiolvasás mindig helyi
//      heurisztika (a dokumentum SZÖVEGE sem megy ki).
//   3. UIT-fotó — a fotós AI-kiolvasás kikapcsolva; a PDF szövegrétege
//      helyben olvasható.
//
//  KIVÉTEL (a tulajdonos döntése, 2026-11-22): a sofőr BON-szkennelése
//  (tankolás/vásárlás nyugta) marad AI-val — csak a `fileKind: 'receipt'`
//  jelöléssel hívott kérés vihet fájlt. Más fájl-fajtát ide ne vegyél fel
//  a tulajdonos kifejezett kérése nélkül.
// ============================================================
'use strict';

const DOCS_LOCAL_ONLY = true;
const ALLOWED_FILE_KINDS = Object.freeze(['receipt']);

const BLOCKED_MSG = 'Documentele (comenzi, facturi, poze) nu părăsesc serverul nostru — citirea automată cu AI extern este dezactivată. Completează datele manual.';

function _isFilePart(p) {
  return !!(p && typeof p === 'object' &&
    (p.inlineData || p.inline_data || p.fileData || p.file_data));
}

function hasFilePart(parts) {
  return Array.isArray(parts) && parts.some(_isFilePart);
}

function fileAllowed(fileKind) {
  return ALLOWED_FILE_KINDS.includes(fileKind);
}

module.exports = { DOCS_LOCAL_ONLY, ALLOWED_FILE_KINDS, BLOCKED_MSG, hasFilePart, fileAllowed };
