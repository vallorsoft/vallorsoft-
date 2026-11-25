// ============================================================
//  VallorSoft — lib/clientByCui.js
//  Ügyfél a CUI alapján: ha a cég ügyfelei közt már megvan, azt adja vissza;
//  ha nincs, az ANAF-ból lekéri a hivatalos adatokat és felveszi a `clients`
//  táblába. KÖZÖS út: a szöveges fuvarkiírás (chat), a megrendelő-kiolvasás
//  és a fuvar-kiíró „ANAF" gombja is ezt használja. Minden lekérdezés
//  company_id-re szűr, paraméteres SQL.
// ============================================================
'use strict';

const pool = require('../db');
const clientsSvc = require('../services/clients');

// Meglévő ügyfél a CUI számjegyei alapján (RO előtag / szóköz független).
async function findByCui(cid, cuiN) {
  if (!cid || !cuiN) return null;
  try {
    const r = await pool.query(
      `SELECT id, denumire, cui_cif FROM clients
        WHERE company_id=$1 AND regexp_replace(UPPER(COALESCE(cui_cif,'')), '[^0-9]', '', 'g') = $2
        ORDER BY id LIMIT 1`, [cid, cuiN]);
    return r.rows[0] || null;
  } catch (_) { return null; }
}

// ANAF-adatokból új ügyfél mentése. Kiterjesztett cím-mezők, ha a migráció
// már lefutott; különben az alap oszlopok.
async function saveAnafClient(cid, an) {
  const adresa = an.address || null;
  const complet = !!(an.cui && adresa);
  try {
    const r = await pool.query(
      `INSERT INTO clients (company_id, denumire, tip, cui_cif, reg_com, tara, judet, localitate, adresa,
                            strada, nr_strada, detalii_adresa, oras, cod_postal, telefon,
                            complet_facturare, anaf_status, anaf_last_check)
       VALUES ($1,$2,'PJ',$3,$4,'RO',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       RETURNING id, denumire, cui_cif`,
      [cid, an.name, an.cui, an.regCom, an.county, an.locality, adresa,
        an.street, an.streetNumber, an.addressDetails, an.city, an.postalCode, an.phone,
        complet, an.active ? 'activ' : 'inactiv']);
    return r.rows[0];
  } catch (e) {
    try {
      const r = await pool.query(
        `INSERT INTO clients (company_id, denumire, tip, cui_cif, reg_com, tara, judet, localitate, adresa,
                              telefon, complet_facturare)
         VALUES ($1,$2,'PJ',$3,$4,'RO',$5,$6,$7,$8,$9) RETURNING id, denumire, cui_cif`,
        [cid, an.name, an.cui, an.regCom, an.county, an.locality, adresa, an.phone, complet]);
      return r.rows[0];
    } catch (e2) { console.error('ügyfél-mentés (ANAF) hiba:', e2.message); return null; }
  }
}

// → { client:{id,denumire,cui_cif}|null, created:bool, notFound?:bool, invalid?:bool, err?:string }
async function ensureClientByCui(cid, cui, opts) {
  opts = opts || {};
  const cuiN = clientsSvc.normalizeCui(cui || '');
  if (!cid || !cuiN) return { client: null, created: false, invalid: true };
  if (!clientsSvc.validateCui(cuiN)) return { client: null, created: false, invalid: true };
  const existing = await findByCui(cid, cuiN);
  if (existing) return { client: existing, created: false };
  let an = null;
  try { an = await clientsSvc.anafLookup(cuiN); }
  catch (e) { return { client: null, created: false, err: String((e && e.message) || e).slice(0, 160) }; }
  if (!an || !an.found || !an.name) return { client: null, created: false, notFound: true };
  const saved = await saveAnafClient(cid, an);
  if (!saved) return { client: null, created: false, err: 'Salvarea clientului a eșuat.' };
  if (opts.req) {
    try { await require('./audit').fromReq(opts.req, 'client.create', 'client', saved.id, { source: opts.source || 'anaf_cui' }); }
    catch (_) { /* audit best-effort */ }
  }
  return { client: saved, created: true, anaf: an };
}

module.exports = { findByCui, saveAnafClient, ensureClientByCui };
