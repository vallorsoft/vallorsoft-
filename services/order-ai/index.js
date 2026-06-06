// services/order-ai/index.js
// Kiolvasás-vezénylő. AI BE (és van GEMINI_API_KEY) -> Gemini; különben heurisztika.
// Az AI-szolgáltató cserélhető (mint a többi adapter): ide pattintható be groq/local.
const gemini = require('./gemini');
const heuristic = require('./heuristic');

// opts: { text, pdfBuffer, pdfName, aiEnabled }
async function extractFields(opts) {
  const wantAi = opts.aiEnabled && process.env.GEMINI_API_KEY;
  if (wantAi) {
    try {
      const r = await gemini.extract(opts);
      return { fields: r.fields, confidence: r.confidence, ai_used: true };
    } catch (e) {
      // ha az AI hibázik, ne vesszen el a megrendelés -> heurisztika + jelzés
      const r = heuristic.extract(opts);
      r.fields.observatii = '[AI hiba: ' + e.message + ']';
      return { fields: r.fields, confidence: r.confidence, ai_used: false };
    }
  }
  const r = heuristic.extract(opts);
  return { fields: r.fields, confidence: r.confidence, ai_used: false };
}

module.exports = { extractFields };
