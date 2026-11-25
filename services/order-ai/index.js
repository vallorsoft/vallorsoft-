// services/order-ai/index.js
// Kiolvasás-vezénylő — a megrendelő / e-mailes megrendelés kiolvasása.
// ÁLLANDÓ SZABÁLY (lib/docPrivacy.js): a megrendelő tartalma (fájl ÉS szöveg)
// SOHA nem hagyja el a szervert → mindig a helyi kiolvasás fut (lib/orderText),
// a Gemini-adapter (./gemini.js) erről az útról nem hívható. Az `aiEnabled`
// opció figyelmen kívül marad.
//
// Ha a PDF-nek nincs szövegrétege (szkennelt) vagy fotó jött, a szöveget a
// HELYI OCR adja (lib/localOcr — tesseract.js a saját szerveren).
'use strict';

const heuristic = require('./heuristic');
const { DOCS_LOCAL_ONLY } = require('../../lib/docPrivacy');

const MIN_TEXT = 80;              // ennél rövidebb szöveg = nincs használható szövegréteg
const OCR_MIME = /^(application\/pdf|image\/(jpe?g|png|webp|bmp|tiff?))$/i;

async function _ocr(buf, mime, name) {
  let ocr;
  try { ocr = require('../../lib/localOcr'); } catch (_) { return ''; }
  if (!ocr.enabled()) return '';
  let s;
  try {
    s = await ocr.open();
    const r = await s.read('data:' + mime + ';base64,' + buf.toString('base64'), name || '');
    return (r && r.text) || '';
  } catch (e) {
    console.warn('[order-ai] helyi OCR hiba:', e.message);
    return '';
  } finally { if (s) await s.close(); }
}

// A saját (fuvarozó) cég neve + CUI-ja — hogy ne olvassuk ki megbízóként.
async function _own(companyId) {
  if (!companyId) return null;
  try {
    const pool = require('../../db');
    const r = await pool.query("SELECT nev, (to_jsonb(c) ->> 'cui') AS cui FROM companies c WHERE id=$1", [companyId]);
    const row = r.rows[0];
    return row ? { ownNames: [row.nev].filter(Boolean), ownCui: row.cui || '' } : null;
  } catch (_) { return null; }
}

// opts: { text, docText?, pdfBuffer, pdfName, fileBuffer, mimeType, samples, companyId, own, aiEnabled }
async function extractFields(opts) {
  if (!DOCS_LOCAL_ONLY) throw new Error('DOCS_LOCAL_ONLY kötelező'); // védőkorlát
  const o = opts || {};
  let text = String(o.text || '');
  let ocrUsed = false;
  const buf = o.fileBuffer || o.pdfBuffer || null;
  const mime = o.fileBuffer ? String(o.mimeType || '').toLowerCase() : (o.pdfBuffer ? 'application/pdf' : '');
  // A döntés a DOKUMENTUM szövegén múlik (e-mailnél a levéltörzs mellett a PDF a megbízás).
  const docText = o.docText != null ? String(o.docText) : text;
  const len = (x) => String(x || '').replace(/\s+/g, '').length;
  if (len(docText) < MIN_TEXT && buf && buf.length && OCR_MIME.test(mime)) {
    const t = await _ocr(buf, mime, o.pdfName);
    if (len(t) > len(docText)) { text = (o.docText != null && text !== docText ? text + '\n\n' : '') + t; ocrUsed = true; }
  }
  const own = o.own || await _own(o.companyId);
  const r = heuristic.extract({ text, samples: o.samples, own });
  return { fields: r.fields, confidence: r.confidence, ai_used: false, ocr_used: ocrUsed, text, learned: r.learned };
}

module.exports = { extractFields };
