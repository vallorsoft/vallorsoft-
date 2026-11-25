// services/order-ai/heuristic.js
// Helyi (AI nélküli) megrendelő-kiolvasás: a felirat-alapú szöveg-értelmező
// (lib/orderText.js) + a cég megerősített ügyfél-mintái (order_scan_samples).
// Adat nem megy ki sehova (lib/docPrivacy).
'use strict';

const { parseOrderText } = require('../../lib/orderText');

// Template-kulcs a megbízó nevéből (azonos a handlers/orderScan normalizeTemplateKey-jével).
function _key(client) {
  if (!client) return '';
  const w = String(client).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length >= 3 && /[a-z]/.test(x));
  return (w[0] || '').slice(0, 60);
}

// (Régi) értékalapú alapértelmezés — NEM használjuk: egy megbízónál is minden
// fuvarnál más lehet az érték. A tanulás címke-alapú: lib/orderLearn.js.
function applySamples(fields, samples) {
  if (!Array.isArray(samples) || !samples.length || !fields.client) return 0;
  const k = _key(fields.client);
  const s = samples.find((x) => _key(x.template_label) === k);
  if (!s || !s.fields) return 0;
  let n = 0;
  for (const f of ['valuta', 'load_type', 'hossz_cm', 'szel_cm', 'mag_cm']) {
    if (fields[f] == null && s.fields[f] != null) { fields[f] = s.fields[f]; n++; }
  }
  return n;
}

function extract({ text, samples, own }) {
  const r = parseOrderText(text || '', own || {});
  void samples;
  return { fields: r.fields, confidence: r.confidence, learned: 0 };
}

module.exports = { extract, applySamples, provider: 'heuristic' };
