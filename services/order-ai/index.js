// services/order-ai/index.js
// Kiolvasás-vezénylő — a megrendelő / e-mailes megrendelés kiolvasása.
// ÁLLANDÓ SZABÁLY (lib/docPrivacy.js): a megrendelő tartalma (fájl ÉS szöveg)
// SOHA nem hagyja el a szervert → mindig a helyi heurisztika fut, a Gemini-adapter
// (./gemini.js) erről az útról nem hívható. Az `aiEnabled` opció figyelmen kívül marad.
const heuristic = require('./heuristic');
const { DOCS_LOCAL_ONLY } = require('../../lib/docPrivacy');

// opts: { text, pdfBuffer, pdfName, fileBuffer, mimeType, aiEnabled }
async function extractFields(opts) {
  if (!DOCS_LOCAL_ONLY) throw new Error('DOCS_LOCAL_ONLY kötelező'); // védőkorlát
  const r = heuristic.extract(opts || {});
  return { fields: r.fields, confidence: r.confidence, ai_used: false };
}

module.exports = { extractFields };
