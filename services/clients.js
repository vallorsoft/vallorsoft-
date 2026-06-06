// clients-service.js
// Ügyfél-validáció: ANAF v9 (hivatalos adatok CUI alapján), helyi CUI-ellenőrzés, VIES (EU ÁFA).
// Mind SZERVER OLDALON fut (CORS + tisztaság miatt).

const ANAF_URL = 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva';
const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms'; // /{country}/vat/{number}

// Csak számjegyek (RO előtag és szóközök nélkül)
function normalizeCui(cui) {
  return String(cui || '').toUpperCase().replace(/^RO/, '').replace(/\D/g, '');
}

// Román CUI kontroll-számjegy ellenőrzése (azonnali, hálózat nélkül)
function validateCui(cui) {
  const n = normalizeCui(cui);
  if (n.length < 2 || n.length > 10) return false;
  const key = '753217532';
  const control = parseInt(n.slice(-1), 10);
  const body = n.slice(0, -1).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(body[i], 10) * parseInt(key[i], 10);
  let c = (sum * 10) % 11; if (c === 10) c = 0;
  return c === control;
}

async function fetchJson(url, opts, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (_) { data = null; }
    return { ok: res.ok, status: res.status, data, text };
  } finally { clearTimeout(t); }
}

// ANAF: hivatalos cégadatok CUI alapján. data = mai dátum (a státusz arra a napra).
async function anafLookup(cui) {
  const n = normalizeCui(cui);
  if (!n) return { found: false, error: 'Üres CUI.' };
  const data = new Date().toISOString().slice(0, 10);
  const r = await fetchJson(ANAF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ cui: Number(n), data }]),
  });
  if (!r.ok || !r.data) return { found: false, error: `ANAF hiba (${r.status}).` };
  const rec = (r.data.found && r.data.found[0]) || null;
  if (!rec) return { found: false };

  const g = rec.date_generale || {};
  const tva = rec.inregistrare_scop_Tva || {};
  const inactiv = rec.stare_inactiv || {};
  return {
    found: true,
    name: g.denumire || null,
    cui: 'RO'.startsWith('RO') ? (g.cui ? String(g.cui) : n) : n,
    address: g.adresa || null,
    regCom: g.nrRegCom || null,
    phone: g.telefon || null,
    vatPayer: !!tva.scpTVA,                 // ÁFA-alany?
    active: !inactiv.statusInactivi,         // aktív (nem radiált/inaktív)?
    raw: rec,
  };
}

// VIES: EU-s ÁFA-szám érvényessége (külföldi, EU-s ügyfélhez). pl. country='DE', number='123456789'
async function viesCheck(country, number) {
  const c = String(country || '').toUpperCase().slice(0, 2);
  const num = String(number || '').replace(/\s/g, '');
  if (!c || !num) return { valid: false, error: 'Hiányzó ország/szám.' };
  const r = await fetchJson(`${VIES_URL}/${c}/vat/${encodeURIComponent(num)}`, { method: 'GET' });
  if (!r.ok || !r.data) return { valid: false, error: `VIES hiba (${r.status}).` };
  return { valid: !!r.data.isValid, name: r.data.name || null, address: r.data.address || null, raw: r.data };
}

module.exports = { normalizeCui, validateCui, anafLookup, viesCheck };
