// services/pdf-extract.js
// PDF → szöveg. Szöveges PDF-ből közvetlen kinyerés (pdf-parse, ingyenes).
// Szkennelt (kép-alapú) PDF-et CSAK az AI (Gemini) tud olvasni multimodálisan —
// a korábbi Tesseract-ág el lett távolítva, mert a tesseract.js nem fogad PDF
// byte-folyamot (csak képet), így az a kód soha nem működött, csak némán hibázott.

let pdfParse = null;
try { pdfParse = require('pdf-parse'); } catch (_) { /* npm i pdf-parse */ }

const MIN_TEXT = 40; // ennél kevesebb karakter -> valószínűleg szkennelt

async function extractText(pdfBuffer) {
  let text = '';
  if (pdfParse && pdfBuffer && pdfBuffer.length) {
    try { const r = await pdfParse(pdfBuffer); text = (r.text || '').trim(); }
    catch (e) { console.error('pdf-parse hiba:', e.message); }
  }
  const scanned = text.length < MIN_TEXT;
  if (scanned) {
    console.warn('[pdf-extract] A PDF-ből nem nyerhető ki szöveg (valószínűleg szkennelt) — a kiolvasáshoz AI mód szükséges.');
  }
  return { text, scanned, hasParser: !!pdfParse };
}

module.exports = { extractText };
