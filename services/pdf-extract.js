// services/pdf-extract.js
// PDF → szöveg. 1) szöveges PDF-ből közvetlen kinyerés (pdf-parse, ingyenes).
// 2) ha nincs érdemi szöveg (szkennelt), opcionális Tesseract OCR (ingyenes, helyi).
// Megjegyzés: ha az AI (Gemini) BE van kapcsolva, a szkennelt PDF-et úgyis a Gemini
// olvassa multimodálisan, így a Tesseract csak az AI-KI módú szkennelt esethez kell.

let pdfParse = null, tesseract = null;
try { pdfParse = require('pdf-parse'); } catch (_) { /* npm i pdf-parse */ }
try { tesseract = require('tesseract.js'); } catch (_) { /* opcionális: npm i tesseract.js */ }

const MIN_TEXT = 40; // ennél kevesebb karakter -> valószínűleg szkennelt

async function extractText(pdfBuffer) {
  let text = '';
  if (pdfParse && pdfBuffer && pdfBuffer.length) {
    try { const r = await pdfParse(pdfBuffer); text = (r.text || '').trim(); } catch (_) {}
  }
  let scanned = text.length < MIN_TEXT;
  if (scanned && tesseract && pdfBuffer) {
    try {
      const { data } = await tesseract.recognize(pdfBuffer, 'ron+hun+eng');
      if (data && data.text && data.text.trim().length > text.length) { text = data.text.trim(); scanned = false; }
    } catch (_) { /* OCR nem elérhető / hibázott -> marad ami van */ }
  }
  return { text, scanned, hasParser: !!pdfParse };
}

module.exports = { extractText };
