// ============================================================
//  VallorSoft — lib/docArchive.js
//  Kötelező éves cég-dokumentum archívum + menetlevél-letöltések naplója.
//
//  Ciklus: a cég határideje (`companies.doc_archive_due_at`) az utolsó visszaigazolt
//  archívum (vagy a cég létrehozása) + 1 év. 30 nappal előtte figyelmeztetés, az
//  utolsó 5 napban (és lejárat után) az Admin/Manager felületen CSAK az archívum
//  letöltése + a kód visszaigazolása működik (middleware/archiveLock.js).
//
//  Az archívum a cég ÖSSZES feltöltött / generált dokumentuma, havi mappákra és
//  típusokra bontva, streamelt ZIP-ben (lib/zipStream). Minden lekérdezés szigorúan
//  a cégre szűr. A ZIP-ben lévő KOD-ARHIVA.txt kódját vissza kell írni — csak a kód
//  kivonata (sha256) tárolódik.
// ============================================================
'use strict';

const crypto = require('crypto');
const { createZipStream } = require('./zipStream');

const DAY = 24 * 3600 * 1000;
const WARN_DAYS = 30;
const LOCK_DAYS = 5;
const CYCLE_DAYS = 365;
const NOTICE_AT = [30, 14, 7, 5, 3, 1];
const BATCH = 25;

let _pool = null;
function _db() { return _pool || (_pool = require('../db')); }
function _isMissing(e) { return e && (e.code === '42P01' || e.code === '42703'); }

// ── Határidő / állapot ───────────────────────────────────────
function phaseOf(daysLeft) {
  if (daysLeft <= LOCK_DAYS) return 'lock';
  if (daysLeft <= WARN_DAYS) return 'warn';
  return 'ok';
}
function daysLeftOf(due, now) {
  return Math.ceil((new Date(due).getTime() - (now || Date.now())) / DAY);
}

async function status(cid, opts) {
  const db = (opts && opts.db) || _db();
  let row;
  try {
    const r = await db.query('SELECT created_at, doc_archive_due_at FROM companies WHERE id=$1', [cid]);
    row = r.rows[0];
  } catch (e) { if (_isMissing(e)) return null; throw e; }
  if (!row) return null;
  let due = row.doc_archive_due_at;
  if (!due) {
    const base = row.created_at ? new Date(row.created_at).getTime() : Date.now();
    due = new Date(Math.max(base + CYCLE_DAYS * DAY, Date.now() + 35 * DAY));
    await db.query('UPDATE companies SET doc_archive_due_at=$2 WHERE id=$1 AND doc_archive_due_at IS NULL', [cid, due]);
  }
  const daysLeft = daysLeftOf(due);
  let last = null, pending = false;
  try {
    const a = await db.query(
      `SELECT MAX(confirmed_at) AS last_confirmed,
              BOOL_OR(completed AND confirmed_at IS NULL AND created_at > NOW() - INTERVAL '30 days') AS pending
         FROM company_doc_archives WHERE company_id=$1`, [cid]);
    last = a.rows[0] && a.rows[0].last_confirmed;
    pending = !!(a.rows[0] && a.rows[0].pending);
  } catch (e) { if (!_isMissing(e)) throw e; }
  return { due_at: new Date(due).toISOString(), days_left: daysLeft, phase: phaseOf(daysLeft),
    warn_days: WARN_DAYS, lock_days: LOCK_DAYS, last_confirmed_at: last, pending_code: pending };
}

// A middleware-hez: rövid cache cégenként (60 mp), a visszaigazolás törli.
const _cache = new Map();
async function isLocked(cid) {
  const hit = _cache.get(cid);
  if (hit && hit.t > Date.now() - 60 * 1000) return hit.v;
  let v = false;
  try { const s = await status(cid); v = !!(s && s.phase === 'lock'); } catch (_) { v = false; }
  _cache.set(cid, { t: Date.now(), v });
  return v;
}
function invalidate(cid) { _cache.delete(cid); }

// ── Kód ──────────────────────────────────────────────────────
function newCode() {
  let s = String(crypto.randomInt(1, 10));
  for (let i = 1; i < 16; i++) s += String(crypto.randomInt(0, 10));
  return s;   // 16 számjegy
}
function codeHash(cid, code) {
  return crypto.createHash('sha256').update(cid + ':' + String(code || '').replace(/\D/g, '')).digest('hex');
}

async function confirm(cid, code, by) {
  const db = _db();
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 20) return { ok: false, err: 'Codul trebuie să aibă 10–20 de cifre.' };
  const r = await db.query(
    `UPDATE company_doc_archives SET confirmed_at=NOW(), confirmed_by=$3
      WHERE id = (SELECT id FROM company_doc_archives
                   WHERE company_id=$1 AND code_hash=$2 AND completed AND confirmed_at IS NULL
                   ORDER BY created_at DESC LIMIT 1)
      RETURNING id`, [cid, codeHash(cid, digits), by || null]);
  if (!r.rows.length) return { ok: false, err: 'Cod incorect sau arhivă nedescărcată complet. Descarcă din nou arhiva și copiază codul din KOD-ARHIVA.txt.' };
  const due = new Date(Date.now() + CYCLE_DAYS * DAY);
  await db.query('UPDATE companies SET doc_archive_due_at=$2, doc_archive_notice_days=NULL WHERE id=$1', [cid, due]);
  invalidate(cid);
  return { ok: true, archive_id: r.rows[0].id, due_at: due.toISOString() };
}

// ── Fájl-segédek ─────────────────────────────────────────────
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'text/html': 'html', 'text/plain': 'txt', 'application/zip': 'zip' };
function decodeData(v, fallbackMime) {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return { buf: v, mime: fallbackMime || 'application/octet-stream' };
  const s = String(v);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return { url: s };
  const m = /^data:([^;,]+)?(;base64)?,/i.exec(s);
  if (m) {
    const body = s.slice(m[0].length);
    return { buf: m[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8'), mime: (m[1] || fallbackMime || '').toLowerCase() };
  }
  return { buf: Buffer.from(s, 'base64'), mime: (fallbackMime || '').toLowerCase() };
}
function safe(s, n) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[_.]+|_+$/g, '').slice(0, n || 80) || 'fara_nume';
}
function withExt(name, mime) {
  const n = safe(name, 120);
  if (/\.[a-z0-9]{2,5}$/i.test(n)) return n;
  return n + '.' + (EXT[mime] || 'bin');
}
function monthOf(d) {
  const x = d ? new Date(d) : null;
  if (!x || isNaN(x)) return 'fara_data';
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
}

// Keyset-lapozás: egyszerre csak BATCH sor (a fájlok tartalmával) van a memóriában.
async function* batches(db, sql, params) {
  let last = 0;
  for (;;) {
    const r = await db.query(sql, params.concat([last, BATCH]));
    if (!r.rows.length) return;
    for (const row of r.rows) yield row;
    last = r.rows[r.rows.length - 1].id;
    if (r.rows.length < BATCH) return;
  }
}

// A cég fuvar-számai (mappanévhez) — csak a saját cég fuvarjai.
async function orderNames(db, cid) {
  const out = {};
  const r = await db.query('SELECT id, fuvar_no FROM orders WHERE company_id=$1', [cid]);
  r.rows.forEach((o) => { out[o.id] = safe(o.fuvar_no || o.id, 40); });
  return out;
}

// ── A teljes archívum írása a kimenetre (streamelt ZIP) ──────
// out: írható stream (HTTP-válasz). user: { company_id, email, nume, pozicio }.
async function writeArchive(out, user, opts) {
  const db = _db();
  const cid = user.company_id;
  if (!cid) throw new Error('no company');
  const code = newCode();
  const rec = await db.query(
    `INSERT INTO company_doc_archives (company_id, code_hash, created_by) VALUES ($1,$2,$3) RETURNING id`,
    [cid, codeHash(cid, code), user.email || user.nume || null]);
  const archiveId = rec.rows[0].id;
  const zip = createZipStream(out);
  const manifest = [['cale', 'sursa', 'luna', 'octeti']];
  const skipped = [];
  const put = async (path, buf, when, source) => {
    const name = await zip.add(path, buf, when ? new Date(when) : null);
    manifest.push([name, source, path.split('/')[0], buf.length]);
  };
  const ON = await orderNames(db, cid);
  const oname = (id) => (id && ON[id]) || (id ? safe(id, 40) : 'fara_cursa');
  const aborted = () => !!(opts && opts.isAborted && opts.isAborted());

  // 1) Fuvar- és menetlevél-iratok (order_documents)
  for await (const d of batches(db,
    `SELECT od.id, od.order_id, od.waybill_id, od.file_name, od.doc_type, od.original_base64, od.signed_base64, od.created_at
       FROM order_documents od LEFT JOIN orders o ON o.id = od.order_id
      WHERE (od.company_id = $1 OR (od.company_id IS NULL AND o.company_id = $1)) AND od.id > $2
      ORDER BY od.id LIMIT $3`, [cid])) {
    if (aborted()) break;
    const folder = monthOf(d.created_at) + '/01_Curse/' + (d.order_id ? oname(d.order_id) : 'Foaie_' + safe(d.waybill_id || 'fara', 30));
    const type = safe(d.doc_type || 'document', 20);
    const o = decodeData(d.original_base64);
    if (o && o.buf) await put(folder + '/' + type + '__' + withExt(d.file_name, o.mime), o.buf, d.created_at, 'order_documents#' + d.id);
    else if (o && o.url) skipped.push('order_documents#' + d.id + ' ' + o.url);
    const sg = decodeData(d.signed_base64, 'application/pdf');
    if (sg && sg.buf) await put(folder + '/' + type + '__semnat__' + withExt(d.file_name, sg.mime), sg.buf, d.created_at, 'order_documents#' + d.id + '(semnat)');
  }

  // 2) Menetlevelek — a nyomtatható lap (HTML), a menetlevél dátuma szerinti hónapban
  let buildWaybillHtml = null;
  try { buildWaybillHtml = require('../routes/soferApi').buildWaybillHtml; } catch (_) {}
  if (buildWaybillHtml && !aborted()) {
    const wbs = await db.query(
      `SELECT id, numar_fisa, COALESCE(erkezes_dt, indulas_dt, data_completare) AS eff
         FROM fuvarlevelek
        WHERE company_id = $1 OR (company_id IS NULL AND email_sofer IN (SELECT email FROM users WHERE company_id = $1))
        ORDER BY id`, [cid]);
    const wbUser = { company_id: cid, pozicio: 'Admin', email: user.email };
    for (const w of wbs.rows) {
      if (aborted()) break;
      try {
        const h = await buildWaybillHtml(wbUser, w.id);
        if (h && h.status === 200) {
          await put(monthOf(w.eff) + '/02_Foi_de_parcurs/' + safe(w.numar_fisa || w.id, 40) + '.html', Buffer.from(h.body, 'utf8'), w.eff, 'fuvarlevelek#' + w.id);
        }
      } catch (e) { skipped.push('fuvarlevelek#' + w.id + ' ' + e.message); }
    }
  }

  // 3) Sofőr-feltöltések (CMR / POD fotó, iratok)
  try {
    for await (const d of batches(db,
      `SELECT d.id, d.order_id, d.file_name, d.tip, d.storage_url, d.created_at, d.nume_sofer
         FROM documents d
        WHERE (d.company_id = $1 OR (d.company_id IS NULL AND d.email_sofer IN (SELECT email FROM users WHERE company_id = $1)))
          AND d.id > $2 ORDER BY d.id LIMIT $3`, [cid])) {
      if (aborted()) break;
      const x = decodeData(d.storage_url);
      if (x && x.buf) {
        await put(monthOf(d.created_at) + '/03_Documente_soferi/' + oname(d.order_id) + '/' + safe(d.tip || 'doc', 20) + '__' + withExt(d.file_name, x.mime),
          x.buf, d.created_at, 'documents#' + d.id);
      } else if (x && x.url) skipped.push('documents#' + d.id + ' ' + x.url);
    }
  } catch (e) { if (!_isMissing(e)) throw e; }

  // 4) Alvállalkozói feltöltések
  try {
    const carriers = {};
    const cr = await db.query('SELECT id, nev FROM carriers WHERE company_id=$1', [cid]);
    cr.rows.forEach((c) => { carriers[c.id] = safe(c.nev || ('subcontractor_' + c.id), 50); });
    for await (const d of batches(db,
      `SELECT id, carrier_id, order_id, file_name, mime, kind, data_base64, created_at FROM carrier_documents
        WHERE company_id = $1 AND id > $2 ORDER BY id LIMIT $3`, [cid])) {
      if (aborted()) break;
      const x = decodeData(d.data_base64, d.mime);
      if (x && x.buf) {
        await put(monthOf(d.created_at) + '/04_Subcontractori/' + (carriers[d.carrier_id] || 'subcontractor') + '/' +
          (d.order_id ? oname(d.order_id) + '__' : '') + safe(d.kind || 'doc', 20) + '__' + withExt(d.file_name, x.mime), x.buf, d.created_at, 'carrier_documents#' + d.id);
      }
    }
  } catch (e) { if (!_isMissing(e)) throw e; }

  // 5) Megbízások az alvállalkozónak (generált Comanda de Transport)
  try {
    for await (const a of batches(db,
      `SELECT id, order_id, custom_number, rendered_pdf_base64, signed_pdf_base64, created_at FROM order_assignments
        WHERE company_id = $1 AND id > $2 ORDER BY id LIMIT $3`, [cid])) {
      if (aborted()) break;
      const base = monthOf(a.created_at) + '/05_Comenzi_subcontractori/' + oname(a.order_id) + '__comanda' + (a.custom_number ? '_' + safe(a.custom_number, 30) : '');
      const r1 = decodeData(a.rendered_pdf_base64, 'application/pdf');
      if (r1 && r1.buf) await put(base + '.pdf', r1.buf, a.created_at, 'order_assignments#' + a.id);
      const r2 = decodeData(a.signed_pdf_base64, 'application/pdf');
      if (r2 && r2.buf) await put(base + '__semnata.pdf', r2.buf, a.created_at, 'order_assignments#' + a.id + '(semnat)');
    }
  } catch (e) { if (!_isMissing(e)) throw e; }

  // 6) UIT-kód fotók
  try {
    for await (const u of batches(db,
      `SELECT id, order_id, uit_code, photo_b64, photo_mime, created_at FROM order_uit_codes
        WHERE company_id = $1 AND photo_b64 IS NOT NULL AND id > $2 ORDER BY id LIMIT $3`, [cid])) {
      if (aborted()) break;
      const x = decodeData(u.photo_b64, u.photo_mime || 'image/jpeg');
      if (x && x.buf) await put(monthOf(u.created_at) + '/06_UIT/' + oname(u.order_id) + '__' + withExt('UIT_' + (u.uit_code || u.id), x.mime || 'image/jpeg'), x.buf, u.created_at, 'order_uit_codes#' + u.id);
    }
  } catch (e) { if (!_isMissing(e)) throw e; }

  // 7) E-mailben / portálon érkezett megrendelések mellékletei
  try {
    for await (const m of batches(db,
      `SELECT id, pdf_name, pdf_data, received_at, created_at FROM inbound_orders
        WHERE company_id = $1 AND pdf_data IS NOT NULL AND id > $2 ORDER BY id LIMIT $3`, [cid])) {
      if (aborted()) break;
      const when = m.received_at || m.created_at;
      await put(monthOf(when) + '/07_Comenzi_primite/' + m.id + '__' + withExt(m.pdf_name || 'comanda', 'application/pdf'), m.pdf_data, when, 'inbound_orders#' + m.id);
    }
  } catch (e) { if (!_isMissing(e)) throw e; }

  // 8) Dokumentum-nyilvántartás (registru) csatolmányai
  try {
    const groups = {};
    const gr = await db.query('SELECT g.id, g.name FROM doc_register_groups g WHERE g.company_id=$1', [cid]);
    gr.rows.forEach((g) => { groups[g.id] = safe(g.name, 40); });
    for await (const f of batches(db,
      `SELECT f.id, f.file_name, f.mime, f.data_base64, f.created_at, e.reg_no, e.group_id
         FROM doc_register_files f JOIN doc_register_entries e ON e.id = f.entry_id AND e.company_id = f.company_id
        WHERE f.company_id = $1 AND f.id > $2 ORDER BY f.id LIMIT $3`, [cid])) {
      if (aborted()) break;
      const x = decodeData(f.data_base64, f.mime);
      if (x && x.buf) await put(monthOf(f.created_at) + '/08_Registru_documente/' + (groups[f.group_id] || 'grup') + '/' + safe(f.reg_no, 30) + '__' + withExt(f.file_name, x.mime), x.buf, f.created_at, 'doc_register_files#' + f.id);
    }
  } catch (e) { if (!_isMissing(e)) throw e; }

  // 9) Letöltött (összefűzött) menetlevél-csomagok
  try {
    for await (const p of batches(db,
      `SELECT d.id, d.waybill_id, d.file_name, d.pdf_data, d.downloaded_at, f.numar_fisa
         FROM waybill_doc_downloads d LEFT JOIN fuvarlevelek f ON f.id = d.waybill_id
        WHERE d.company_id = $1 AND d.pdf_data IS NOT NULL AND d.id > $2 ORDER BY d.id LIMIT $3`, [cid])) {
      if (aborted()) break;
      const stamp = new Date(p.downloaded_at).toISOString().slice(0, 16).replace(/[:T]/g, '-');
      await put(monthOf(p.downloaded_at) + '/09_Pachete_descarcate/' + safe(p.numar_fisa || p.waybill_id, 40) + '__' + stamp + '.pdf', p.pdf_data, p.downloaded_at, 'waybill_doc_downloads#' + p.id);
    }
  } catch (e) { if (!_isMissing(e)) throw e; }

  if (aborted()) return { ok: false, aborted: true, archive_id: archiveId };

  // Gyökér: kód + tartalomjegyzék
  const now = new Date();
  const txt = [
    'VallorSoft — arhiva documentelor firmei / a cég dokumentum-archívuma',
    'Data: ' + now.toISOString(),
    'Fișiere / fájlok: ' + (manifest.length - 1),
    '',
    'COD DE CONFIRMARE / VISSZAIGAZOLÓ KÓD:',
    code,
    '',
    'RO: Copiază acest cod în VallorSoft (fereastra „Arhiva documentelor") pentru a confirma că arhiva a fost descărcată.',
    'HU: Másold be ezt a kódot a VallorSoftba („Dokumentum-archívum" ablak), hogy igazold: az archívum letöltve.',
  ].join('\r\n');
  await zip.add('KOD-ARHIVA.txt', Buffer.from(txt, 'utf8'), now);
  const csv = manifest.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  await zip.add('CUPRINS.csv', Buffer.from('﻿' + csv, 'utf8'), now);
  if (skipped.length) await zip.add('NEINCLUSE.txt', Buffer.from(skipped.join('\r\n'), 'utf8'), now);
  await zip.finish();
  await db.query('UPDATE company_doc_archives SET completed=TRUE, file_count=$2, total_bytes=$3 WHERE id=$1',
    [archiveId, manifest.length - 1, zip.bytes]);
  return { ok: true, archive_id: archiveId, files: manifest.length - 1, bytes: zip.bytes };
}

// ── Figyelmeztető e-mailek (30 / 14 / 7 / 5 / 3 / 1 nappal) ─
async function noticeRound(send) {
  const db = _db();
  let rows = [];
  try {
    const r = await db.query(
      `SELECT id, nev, doc_archive_due_at, doc_archive_notice_days FROM companies
        WHERE doc_archive_due_at IS NOT NULL AND doc_archive_due_at < NOW() + INTERVAL '31 days'
          AND COALESCE(subscription_status, 'active') NOT IN ('cancelled', 'inactive')`);
    rows = r.rows;
  } catch (e) { if (_isMissing(e)) return 0; throw e; }
  let n = 0;
  for (const c of rows) {
    const left = daysLeftOf(c.doc_archive_due_at);
    const step = NOTICE_AT.filter((d) => left <= d).pop();
    if (step == null) continue;
    if (c.doc_archive_notice_days != null && c.doc_archive_notice_days <= step) continue;
    await db.query('UPDATE companies SET doc_archive_notice_days=$2 WHERE id=$1', [c.id, step]);
    try { await send(c, Math.max(left, 0)); n++; } catch (e) { console.warn('[DocArchive] értesítés hiba', c.id, e.message); }
  }
  return n;
}

// A lejárt (1 évnél régebbi) letöltött csomagok törlése.
async function cleanupDownloads() {
  try {
    const r = await _db().query('DELETE FROM waybill_doc_downloads WHERE expires_at < NOW()');
    return r.rowCount || 0;
  } catch (e) { if (_isMissing(e)) return 0; throw e; }
}

module.exports = {
  WARN_DAYS, LOCK_DAYS, CYCLE_DAYS, phaseOf, daysLeftOf, status, isLocked, invalidate,
  newCode, codeHash, confirm, decodeData, safe, monthOf, writeArchive, noticeRound, cleanupDownloads,
};
