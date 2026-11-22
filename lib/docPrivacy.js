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
//   3. bon-scan / UIT-fotó — a fotós AI-kiolvasás kikapcsolva; UIT-nál a
//      PDF szövegrétege helyben olvasható.
// ============================================================
'use strict';

const DOCS_LOCAL_ONLY = true;

const BLOCKED_MSG = 'Documentele (comenzi, facturi, bonuri, poze) nu părăsesc serverul nostru — citirea automată cu AI extern este dezactivată. Completează datele manual.';

function _isFilePart(p) {
  return !!(p && typeof p === 'object' &&
    (p.inlineData || p.inline_data || p.fileData || p.file_data));
}

function hasFilePart(parts) {
  return Array.isArray(parts) && parts.some(_isFilePart);
}

module.exports = { DOCS_LOCAL_ONLY, BLOCKED_MSG, hasFilePart };
