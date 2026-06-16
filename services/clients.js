// clients-service.js
// Ügyfél-validáció: ANAF v9 (hivatalos adatok CUI alapján) + helyi CUI-ellenőrzés.
// Mind SZERVER OLDALON fut (CORS + tisztaság miatt).

const ANAF_URL = 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva';

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
  if (!n) return { found: false, error: 'CUI gol.' };
  const data = new Date().toISOString().slice(0, 10);
  const r = await fetchJson(ANAF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ cui: Number(n), data }]),
  });
  if (!r.ok || !r.data) return { found: false, error: `Eroare ANAF (${r.status}).` };
  const rec = (r.data.found && r.data.found[0]) || null;
  if (!rec) return { found: false };

  const g = rec.date_generale || {};
  const tva = rec.inregistrare_scop_Tva || {};
  const inactiv = rec.stare_inactiv || {};

  // Strukturált székhely-cím az ANAF v9 válaszból (adresa_sediu_social, 's' prefix).
  // Ebből építünk egy teljes, jól formázott címet, amely KÜLÖN tartalmazza
  // a helységet (város/falu) ÉS a megyét (județ) — a panaszolt összemosódás ellen.
  const sediu = rec.adresa_sediu_social || {};
  // Megye: tegyük elé a 'Jud. ' előtagot, ha még nincs benne.
  const judetRaw = String(sediu.sdenumire_Judet || '').trim();
  const judet = judetRaw
    ? (/^jud(\.|ețul|etul)?\b/i.test(judetRaw) ? judetRaw : `Jud. ${judetRaw}`)
    : '';
  // Utca + házszám egy darabban (csak ha van utcanév).
  const strada = String(sediu.sdenumire_Strada || '').trim();
  const numar = String(sediu.snumar_Strada || '').trim();
  const utca = strada
    ? (numar ? `${strada} nr. ${numar}` : strada)
    : '';
  // A meglévő részeket sorrendben, üreseket kihagyva, vesszővel fűzzük össze.
  const parts = [
    utca,
    String(sediu.sdetalii_Adresa || '').trim(),     // pl. bloc/scară/apartament
    String(sediu.sdenumire_Localitate || '').trim(), // helység (város/falu)
    judet,
    String(sediu.scod_Postal || '').trim(),          // irányítószám
  ];
  const fullAddress = parts.filter(Boolean).join(', ');
  // Fallback: ha a strukturált székhely-cím üres, marad a régi összefűzött string.
  const address = fullAddress || g.adresa || null;

  const out = {
    found: true,
    name: g.denumire || null,
    cui: g.cui ? String(g.cui) : n, // (a korábbi 'RO'.startsWith('RO') feltétel mindig igaz volt)
    address,                        // összevont cím — visszafelé kompatibilis
    regCom: g.nrRegCom || null,
    phone: g.telefon || null,
    vatPayer: !!tva.scpTVA,                 // ÁFA-alany?
    active: !inactiv.statusInactivi,         // aktív (nem radiált/inaktív)?
    raw: rec,
  };
  // KÜLÖN strukturált cím-mezők — a kliens-űrlap ezeket tölti ki (nem egy összevont sort).
  out.street = strada || null;                                      // utca (strada)
  out.streetNumber = numar || null;                                 // házszám (numar)
  out.addressDetails = String(sediu.sdetalii_Adresa || '').trim() || null; // detalii: bloc/scară/apartament
  const localityRaw = String(sediu.sdenumire_Localitate || '').trim();
  out.locality = localityRaw || null;                              // helység (oras/localitate)
  out.city = localityRaw || null;                                  // alias
  out.county = judetRaw || null;                                    // megye (judet) — 'Jud.' előtag nélkül
  out.postalCode = String(sediu.scod_Postal || '').trim() || null; // irányítószám (cod postal)
  return out;
}

module.exports = { normalizeCui, validateCui, anafLookup };
