// services/order-ai/heuristic.js
// AI-KIKAPCSOLT tartalék: egyszerű regex/kulcsszó-alapú kiolvasás (ingyenes, offline,
// adat nem megy ki sehova). Best-effort — a bizonytalan mezőket a diszpécser tölti ki.

function firstMatch(re, s) { const m = re.exec(s); return m ? (m[1] || m[0]).trim() : null; }

function extract({ text }) {
  const t = text || '';
  const fields = {
    client: null, client_cui: null, ref: null,
    loc_incarcare: null, loc_descarcare: null,
    data_incarcare: null, data_descarcare: null,
    pret: null, valuta: null, km: null, greutate: null,
    rendszam_camion: null, rendszam_remorca: null, observatii: null,
  };
  // CUI (RO + 6-10 számjegy, vagy "CUI/CIF: 12345678")
  fields.client_cui = firstMatch(/\b(?:RO\s?)?(?:CUI|CIF)\s*[:.]?\s*(RO?\s?\d{6,10})/i, t)
    || firstMatch(/\bRO\s?\d{6,10}\b/i, t);
  // dátum (YYYY-MM-DD vagy DD.MM.YYYY)
  const isoDate = firstMatch(/\b(\d{4}-\d{2}-\d{2})\b/, t);
  const euDate = firstMatch(/\b(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})\b/, t);
  fields.data_incarcare = isoDate || euDate || null;
  // ár + pénznem
  const price = firstMatch(/(\d[\d.\s]{2,})\s*(?:RON|LEI|EUR|€)/i, t);
  if (price) fields.pret = Number(price.replace(/[.\s]/g, '')) || null;
  fields.valuta = /EUR|€/i.test(t) ? 'EUR' : (/RON|LEI/i.test(t) ? 'RON' : null);
  // rendszám (RO formátum, pl. CJ12ABC / B104VLR)
  fields.rendszam_camion = firstMatch(/\b([A-Z]{1,2}\d{2,3}[A-Z]{2,3})\b/, t);
  // referencia
  fields.ref = firstMatch(/\b(?:ref(?:erinta|erence)?|nr\.?\s*comanda)\s*[:#]?\s*([A-Z0-9\-\/]{3,})/i, t);
  return { fields, confidence: 0.25 }; // alacsony — jelzi, hogy ellenőrzendő
}

module.exports = { extract, provider: 'heuristic' };
