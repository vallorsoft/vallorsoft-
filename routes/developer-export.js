// ============================================================
//  VallorSoft — routes/developer-export.js
//  GET /api/developer/export/:id
//  Developer-only: teljes céges adatexport ZIP-ben (szerződésbontáshoz).
//  CSV: orders, order_legs, clients, vehicles, carriers, users (jelszó nélkül),
//       invoices, carrier_invoices, fuvarlevelek, inbound_orders, order_uit_codes.
//  Bináris: order_documents, POD fotók (documents), carrier_documents.
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { buildZip } = require('../lib/zip');

function devGuard(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.is_dev) {
    return res.status(403).send('Acces interzis.');
  }
  next();
}

function dstr(d) { return d ? String(new Date(d).toISOString()).slice(0, 10) : ''; }

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv(cols, rows) {
  const lines = [cols.map(csvCell).join(';')].concat(
    rows.map((r) => cols.map((c) => csvCell(r[c])).join(';'))
  );
  return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}

function b64ToBuf(s) {
  if (!s) return null;
  let data = String(s);
  const m = data.match(/^data:[^;]+;base64,(.*)$/);
  if (m) data = m[1];
  if (data.length < 10) return null;
  try { return Buffer.from(data, 'base64'); } catch (_) { return null; }
}

router.get('/api/developer/export/:id', devGuard, async (req, res) => {
  const cid = parseInt(req.params.id, 10);
  if (!cid) return res.status(400).send('ID-ul firmei lipseste.');

  try {
    // Cég neve a fájlnévhez
    const compR = await pool.query('SELECT nev FROM companies WHERE id=$1', [cid]);
    if (!compR.rows.length) return res.status(404).send('Firma negasita.');
    const cegNev = (compR.rows[0].nev || String(cid)).replace(/[^a-zA-Z0-9_\-]/g, '_');

    const files = [];

    // ── CSV táblák ────────────────────────────────────────────

    // orders
    const orders = await pool.query(
      `SELECT id,status,client,ref,
              loc_incarcare,loc_descarcare,data_incarcare,data_descarcare,
              pret,km,sofer_type,email_sofer,nume_sofer,
              firma_extern,telefon_extern,rendszam_camion,rendszam_remorca,
              load_type,suly_kg,hossz_cm,szel_cm,mag_cm,toll_cost,
              client_id,carrier_id,carrier_cost,payment_status,paid_amount,
              nc_code,marfa_value,marfa_currency,needs_uit,
              created_at,finalized_at
       FROM orders WHERE company_id=$1 ORDER BY id`, [cid]);
    if (orders.rows.length) {
      files.push({ name: 'csv/orders.csv', buffer: buildCsv(
        ['id','status','client','ref',
         'loc_incarcare','loc_descarcare','data_incarcare','data_descarcare',
         'pret','km','sofer_type','email_sofer','nume_sofer',
         'firma_extern','telefon_extern','rendszam_camion','rendszam_remorca',
         'load_type','suly_kg','hossz_cm','szel_cm','mag_cm','toll_cost',
         'client_id','carrier_id','carrier_cost','payment_status','paid_amount',
         'nc_code','marfa_value','marfa_currency','needs_uit','created_at','finalized_at'],
        orders.rows) });
    }

    // order_legs
    const legs = await pool.query(
      `SELECT id,order_id,leg_number,sofer_type,email_sofer,nume_sofer,
              firma_extern,telefon_extern,rendszam_camion,rendszam_remorca,
              loc_preluare,data_preluare,loc_predare,data_predare,created_at
       FROM order_legs WHERE company_id=$1 ORDER BY order_id,leg_number`, [cid]);
    if (legs.rows.length) {
      files.push({ name: 'csv/order_legs.csv', buffer: buildCsv(
        ['id','order_id','leg_number','sofer_type','email_sofer','nume_sofer',
         'firma_extern','telefon_extern','rendszam_camion','rendszam_remorca',
         'loc_preluare','data_preluare','loc_predare','data_predare','created_at'],
        legs.rows) });
    }

    // clients
    const clients = await pool.query(
      `SELECT id,denumire,tip,cui_cif,reg_com,tara,judet,localitate,adresa,
              email,telefon,iban,payment_term_days,created_at
       FROM clients WHERE company_id=$1 ORDER BY id`, [cid]);
    if (clients.rows.length) {
      files.push({ name: 'csv/clients.csv', buffer: buildCsv(
        ['id','denumire','tip','cui_cif','reg_com','tara','judet','localitate','adresa',
         'email','telefon','iban','payment_term_days','created_at'],
        clients.rows) });
    }

    // vehicles
    const vehicles = await pool.query(
      `SELECT id,rendszam,marca,model,tip,an,trailer_kind,
              cargo_length_cm,cargo_width_cm,cargo_height_cm,
              length_cm,width_cm,height_cm,weight_kg,
              fuel_per_100km,default_trailer_id,assigned_driver_email,created_at
       FROM vehicles WHERE company_id=$1 ORDER BY id`, [cid]);
    if (vehicles.rows.length) {
      files.push({ name: 'csv/vehicles.csv', buffer: buildCsv(
        ['id','rendszam','marca','model','tip','an','trailer_kind',
         'cargo_length_cm','cargo_width_cm','cargo_height_cm',
         'length_cm','width_cm','height_cm','weight_kg',
         'fuel_per_100km','default_trailer_id','assigned_driver_email','created_at'],
        vehicles.rows) });
    }

    // carriers (alvállalkozók)
    const carriers = await pool.query(
      `SELECT id,nev,cui,email,telefon,iban,payment_term_days,
              cmr_insurance_expiry,created_at
       FROM carriers WHERE company_id=$1 ORDER BY id`, [cid]);
    if (carriers.rows.length) {
      files.push({ name: 'csv/carriers.csv', buffer: buildCsv(
        ['id','nev','cui','email','telefon','iban','payment_term_days',
         'cmr_insurance_expiry','created_at'],
        carriers.rows) });
    }

    // users (jelszó-hash kizárva)
    const users = await pool.query(
      `SELECT id,nume,email,pozicio,tel,blocked,created_at
       FROM users WHERE company_id=$1 ORDER BY id`, [cid]);
    if (users.rows.length) {
      files.push({ name: 'csv/users.csv', buffer: buildCsv(
        ['id','nume','email','pozicio','tel','blocked','created_at'],
        users.rows) });
    }

    // kimenő számlák
    const invoices = await pool.query(
      `SELECT id,serie,numar,client_name,client_cui,total,valuta,tva,
              provider,status,efactura_status,order_id,created_at
       FROM invoices WHERE company_id=$1 ORDER BY id`, [cid]).catch(() => ({ rows: [] }));
    if (invoices.rows.length) {
      files.push({ name: 'csv/invoices.csv', buffer: buildCsv(
        ['id','serie','numar','client_name','client_cui','total','valuta','tva',
         'provider','status','efactura_status','order_id','created_at'],
        invoices.rows) });
    }

    // alvállalkozói (bejövő) számlák
    const carInv = await pool.query(
      `SELECT ci.id,ci.invoice_number,ci.issue_date,ci.due_date,
              c.nev AS carrier_name,c.cui AS carrier_cui,
              ci.amount,ci.currency,ci.status,ci.paid_amount,ci.order_ids,ci.created_at
       FROM carrier_invoices ci
       JOIN carriers c ON c.id=ci.carrier_id AND c.company_id=ci.company_id
       WHERE ci.company_id=$1 ORDER BY ci.id`, [cid]).catch(() => ({ rows: [] }));
    if (carInv.rows.length) {
      files.push({ name: 'csv/carrier_invoices.csv', buffer: buildCsv(
        ['id','invoice_number','issue_date','due_date','carrier_name','carrier_cui',
         'amount','currency','status','paid_amount','order_ids','created_at'],
        carInv.rows) });
    }

    // menetlevelek (company_id horgony, fallback email→users.company_id)
    const fl = await pool.query(
      `SELECT f.id,f.email_sofer,f.nume_sofer,f.order_ids,f.data_completare,
              f.numar_camion,f.numar_remorca,f.numar_fisa,
              f.km_inceput,f.km_sfarsit,f.total_km,
              f.loc_plecare,f.loc_sosire,f.total_alim,f.consum_100,f.alte_mentiuni
       FROM fuvarlevelek f
       WHERE f.company_id=$1 OR LOWER(f.email_sofer) IN (SELECT LOWER(email) FROM users WHERE company_id=$1)
       ORDER BY f.id`, [cid]).catch(() => ({ rows: [] }));
    if (fl.rows.length) {
      files.push({ name: 'csv/fuvarlevelek.csv', buffer: buildCsv(
        ['id','email_sofer','nume_sofer','order_ids','data_completare',
         'numar_camion','numar_remorca','numar_fisa',
         'km_inceput','km_sfarsit','total_km',
         'loc_plecare','loc_sosire','total_alim','consum_100','alte_mentiuni'],
        fl.rows) });
    }

    // beérkező (email/portal) megrendelések
    const inbound = await pool.query(
      `SELECT id,source,source_email,subject,status,confidence,ai_used,
              created_order_id,received_at,created_at
       FROM inbound_orders WHERE company_id=$1 ORDER BY id`, [cid]).catch(() => ({ rows: [] }));
    if (inbound.rows.length) {
      files.push({ name: 'csv/inbound_orders.csv', buffer: buildCsv(
        ['id','source','source_email','subject','status','confidence','ai_used',
         'created_order_id','received_at','created_at'],
        inbound.rows) });
    }

    // UIT kódok
    const uit = await pool.query(
      `SELECT id,order_id,uit_code,rendszam,provider,status,valid_until,
              anaf_confirmed,anaf_confirmed_at,created_at
       FROM order_uit_codes WHERE company_id=$1 ORDER BY id`, [cid]).catch(() => ({ rows: [] }));
    if (uit.rows.length) {
      files.push({ name: 'csv/order_uit_codes.csv', buffer: buildCsv(
        ['id','order_id','uit_code','rendszam','provider','status','valid_until',
         'anaf_confirmed','anaf_confirmed_at','created_at'],
        uit.rows) });
    }

    // e-CMR (digitális CMR aláírásokkal) — jogi fuvar-dokumentum.
    // Az aláírások (név+IP+időbélyeg) személyes adat, de jogi
    // megőrzési kötelezettség alá esnek (Legea 82/1991). A rajzolt
    // aláírás (*_sig) data URL-eket kihagyjuk a CSV-ből (méret).
    const ecmr = await pool.query(
      `SELECT id,order_id,status,created_by,created_at,
              sender_name,sender_signed_at,sender_ip,
              carrier_name,carrier_signed_at,carrier_ip,
              consignee_name,consignee_signed_at,consignee_ip
       FROM order_ecmr WHERE company_id=$1 ORDER BY id`, [cid]).catch(() => ({ rows: [] }));
    if (ecmr.rows.length) {
      files.push({ name: 'csv/order_ecmr.csv', buffer: buildCsv(
        ['id','order_id','status','created_by','created_at',
         'sender_name','sender_signed_at','sender_ip',
         'carrier_name','carrier_signed_at','carrier_ip',
         'consignee_name','consignee_signed_at','consignee_ip'],
        ecmr.rows) });
    }

    // ── Bináris dokumentumok ──────────────────────────────────
    let totalBytes = files.reduce((s, f) => s + f.buffer.length, 0);
    const LIMIT = 400 * 1024 * 1024; // 400 MB vészfék

    // order_documents (feltöltött + aláírt)
    const odocs = await pool.query(
      `SELECT id,order_id,file_name,original_base64,signed_base64,created_at
       FROM order_documents WHERE company_id=$1 ORDER BY order_id,id`, [cid]);
    for (const d of odocs.rows) {
      if (totalBytes >= LIMIT) break;
      const buf = b64ToBuf(d.signed_base64 || d.original_base64);
      if (!buf) continue;
      totalBytes += buf.length;
      const dd = dstr(d.created_at);
      const fn = (dd ? dd + '_' : '') + (d.file_name || ('doc_' + d.id + '.pdf'));
      files.push({ name: 'documents/' + String(d.order_id || 'altele') + '/' + fn, buffer: buf, date: d.created_at ? new Date(d.created_at) : null });
    }

    // POD fotók (documents tábla)
    const pods = await pool.query(
      `SELECT d.id,d.order_id,d.file_name,d.storage_url,d.created_at
       FROM documents d
       JOIN orders o ON o.id=d.order_id AND o.company_id=$1
       ORDER BY d.order_id,d.id`, [cid]);
    for (const d of pods.rows) {
      if (totalBytes >= LIMIT) break;
      const buf = b64ToBuf(d.storage_url);
      if (!buf) continue;
      totalBytes += buf.length;
      const dd = dstr(d.created_at);
      const fn = (dd ? dd + '_' : '') + (d.file_name || ('pod_' + d.id + '.jpg'));
      files.push({ name: 'pod/' + String(d.order_id || 'altele') + '/' + fn, buffer: buf, date: d.created_at ? new Date(d.created_at) : null });
    }

    // alvállalkozói dokumentumok
    const cdocs = await pool.query(
      `SELECT id,order_id,file_name,data_base64,created_at
       FROM carrier_documents WHERE company_id=$1 ORDER BY order_id,id`, [cid]).catch(() => ({ rows: [] }));
    for (const d of cdocs.rows) {
      if (totalBytes >= LIMIT) break;
      const buf = b64ToBuf(d.data_base64);
      if (!buf) continue;
      totalBytes += buf.length;
      const dd = dstr(d.created_at);
      const fn = (dd ? dd + '_' : '') + (d.file_name || ('cdoc_' + d.id));
      files.push({ name: 'carrier_docs/' + String(d.order_id || 'altele') + '/' + fn, buffer: buf, date: d.created_at ? new Date(d.created_at) : null });
    }

    if (!files.length) return res.status(404).send('Nu exista date de exportat pentru aceasta firma.');

    const zip = buildZip(files);
    const today = dstr(new Date());
    const fn = 'vallorsoft-export-' + cegNev + '-' + today + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fn + '"');
    return res.send(zip);
  } catch (err) {
    console.error('devExport hiba:', err);
    return res.status(500).send('Eroare de server la crearea exportului.');
  }
});

module.exports = router;
