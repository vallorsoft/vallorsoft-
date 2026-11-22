// ============================================================
//  VallorSoft — lib/docArchiveCloud.js
//  Fizetős dokumentum-archiválás: a cég teljes archívuma (lib/docArchive writeArchive,
//  felhő-mód) titkosítva (AES-256-GCM, kulcs az INTEGRATION_ENC_KEY-ből származtatva)
//  a saját Cloudflare R2 tárhelyünkre kerül. Cégenként egy aktuális példány, amíg az
//  archiválás aktív, havonta frissül. Letöltéskor a szerver visszafejti (a cég csak a
//  saját archívumát kaphatja meg).
// ============================================================
'use strict';

const crypto = require('crypto');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const r2 = require('./r2');

const REFRESH_DAYS = 30;
let _pool = null;
function _db() { return _pool || (_pool = require('../db')); }
function _isMissing(e) { return e && (e.code === '42P01' || e.code === '42703'); }

function archiveKey() {
  const raw = process.env.INTEGRATION_ENC_KEY;
  if (!raw) throw new Error('INTEGRATION_ENC_KEY hiányzik');
  const master = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.from('vallorsoft'), Buffer.from('doc-archive-r2'), 32));
}

const _running = new Set();

// Egy cég pillanatképének elkészítése és feltöltése.
async function snapshot(cid) {
  const db = _db();
  if (_running.has(cid)) return { ok: false, err: 'running' };
  if (!r2.configured()) {
    await db.query(
      `INSERT INTO doc_archive_cloud (company_id, status, error, updated_at) VALUES ($1,'not_configured','R2 nincs beállítva',NOW())
       ON CONFLICT (company_id) DO UPDATE SET status='not_configured', error='R2 nincs beállítva', updated_at=NOW()`, [cid]);
    return { ok: false, err: 'not_configured' };
  }
  _running.add(cid);
  const objKey = 'doc-archives/' + cid + '/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(6).toString('hex') + '.zip.enc';
  try {
    const prev = await db.query('SELECT r2_key FROM doc_archive_cloud WHERE company_id=$1', [cid]);
    await db.query(
      `INSERT INTO doc_archive_cloud (company_id, status, started_at, updated_at) VALUES ($1,'running',NOW(),NOW())
       ON CONFLICT (company_id) DO UPDATE SET status='running', started_at=NOW(), error=NULL, updated_at=NOW()`, [cid]);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', archiveKey(), iv);
    const up = r2.createUploadStream(objKey, 'application/octet-stream');
    cipher.pipe(up);
    const done = finished(up);
    const arch = require('./docArchive');
    const r = await arch.writeArchive(cipher, { company_id: cid, email: 'vallorsoft-cloud', pozicio: 'Admin' }, { cloud: true });
    cipher.end();
    await done;
    const tag = cipher.getAuthTag();
    await db.query(
      `UPDATE doc_archive_cloud SET status='ok', r2_key=$2, iv=$3, tag=$4, bytes=$5, file_count=$6, error=NULL, updated_at=NOW()
        WHERE company_id=$1`, [cid, objKey, iv.toString('base64'), tag.toString('base64'), up.bytes, r.files || 0]);
    try { await verify(cid); } catch (e) { console.warn('[DocArchiveCloud] méret-ellenőrzés hiba', e.message); }
    const old = prev.rows[0] && prev.rows[0].r2_key;
    if (old && old !== objKey) await r2.deleteObject(old).catch((e) => console.warn('[DocArchiveCloud] régi példány törlése', e.message));
    return { ok: true, key: objKey, bytes: up.bytes, files: r.files };
  } catch (e) {
    console.warn('[DocArchiveCloud] hiba', cid, e.message);
    await db.query(`UPDATE doc_archive_cloud SET status='error', error=$2, updated_at=NOW() WHERE company_id=$1`, [cid, String(e.message).slice(0, 500)]).catch(() => {});
    r2.deleteObject(objKey).catch(() => {});
    return { ok: false, err: e.message };
  } finally {
    _running.delete(cid);
  }
}

// Az aktív archiválású cégek közül egy, amelynek friss pillanatkép kell.
async function round() {
  const db = _db();
  let rows = [];
  try {
    const r = await db.query(
      `SELECT c.id FROM companies c LEFT JOIN doc_archive_cloud d ON d.company_id = c.id
        WHERE c.doc_archive_paid_until > NOW()
          AND (d.company_id IS NULL OR d.status = 'queued'
               OR (d.status IN ('ok', 'not_configured') AND d.updated_at < NOW() - INTERVAL '${REFRESH_DAYS} days')
               OR (d.status = 'not_configured' AND d.updated_at < NOW() - INTERVAL '6 hours')
               OR (d.status = 'error' AND d.updated_at < NOW() - INTERVAL '6 hours')
               OR (d.status = 'running' AND d.started_at < NOW() - INTERVAL '6 hours'))
        ORDER BY d.updated_at ASC NULLS FIRST LIMIT 1`);
    rows = r.rows;
  } catch (e) { if (_isMissing(e)) return null; throw e; }
  if (!rows.length) return null;
  return snapshot(rows[0].id);
}

// Aktiváláskor: sorba áll (és azonnal el is indul a háttérben).
async function queue(cid) {
  const db = _db();
  await db.query(
    `INSERT INTO doc_archive_cloud (company_id, status, updated_at) VALUES ($1,'queued',NOW())
     ON CONFLICT (company_id) DO UPDATE SET status = CASE WHEN doc_archive_cloud.status='running' THEN 'running' ELSE 'queued' END, updated_at=NOW()`, [cid]);
  setImmediate(() => { snapshot(cid).catch(() => {}); });
}

async function info(cid) {
  try {
    const r = await _db().query('SELECT status, bytes, file_count, error, updated_at FROM doc_archive_cloud WHERE company_id=$1', [cid]);
    return r.rows[0] || null;
  } catch (e) { if (_isMissing(e)) return null; throw e; }
}

// A cég saját archívumának letöltése: R2 → visszafejtés → kimenet.
async function download(cid, out) {
  const r = await _db().query(`SELECT r2_key, iv, tag FROM doc_archive_cloud WHERE company_id=$1 AND status='ok' AND r2_key IS NOT NULL`, [cid]);
  const row = r.rows[0];
  if (!row) return false;
  const res = await r2.getObject(row.r2_key);
  const decipher = crypto.createDecipheriv('aes-256-gcm', archiveKey(), Buffer.from(row.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  Readable.fromWeb(res.body).pipe(decipher).pipe(out);
  await finished(out);
  return true;
}

// A Cloudflare R2-n ténylegesen tárolt méret (HEAD) → null, ha nincs példány.
async function actualSize(cid) {
  const db = _db();
  let row;
  try {
    const r = await db.query(`SELECT r2_key FROM doc_archive_cloud WHERE company_id=$1 AND status='ok' AND r2_key IS NOT NULL`, [cid]);
    row = r.rows[0];
  } catch (e) { if (_isMissing(e)) return null; throw e; }
  if (!row || !r2.configured()) return null;
  const h = await r2.headObject(row.r2_key);
  if (!h) return null;
  await db.query('UPDATE doc_archive_cloud SET bytes=$2, verified_at=NOW() WHERE company_id=$1', [cid, h.size]).catch(() => {});
  return h.size;
}

// A tényleges R2-méret összevetése az aktív (kifizetett) archiválás sávjával. Ha
// nagyobb sávba esik, mint amit fizettek, jelöljük, és a developer e-mailt kap (egyszer).
async function verify(cid) {
  const size = await actualSize(cid);
  if (size == null) return null;
  const db = _db();
  const arch = require('./docArchive');
  const o = await db.query(
    `SELECT id, reference, annual_eur, size_flag FROM doc_archive_orders
      WHERE company_id=$1 AND status='paid' AND covered_until > NOW() ORDER BY activated_at DESC LIMIT 1`, [cid]);
  const order = o.rows[0];
  if (!order) return { size };
  const tier = arch.tierFor(size, await arch.priceTiers(db));
  const over = !tier || tier.eur > Number(order.annual_eur);
  await db.query(`UPDATE doc_archive_orders SET actual_bytes=$2, actual_checked_at=NOW(), size_flag=$3 WHERE id=$1`,
    [order.id, size, over ? 'over_tier' : 'ok']);
  if (over && order.size_flag !== 'over_tier') {
    try {
      const c = await db.query('SELECT nev FROM companies WHERE id=$1', [cid]);
      const { sendDeveloperEmail } = require('../services/email');
      await sendDeveloperEmail(process.env.DEV_NOTIFY_EMAIL || 'vallorsoft@gmail.com', 'VallorSoft System',
        '⚠️ Archiválás: a Cloudflare-en tárolt méret túllépi a kifizetett sávot',
        '<p><b>' + String((c.rows[0] && c.rows[0].nev) || cid).replace(/</g, '&lt;') + '</b> (' + order.reference + '): a Cloudflare R2-n tárolt archívum ' +
        (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB, a kifizetett sáv éves díja ' + Number(order.annual_eur).toFixed(2) + ' EUR' +
        (tier ? ', a tényleges méret sávja ' + tier.eur + ' EUR / év.' : ' — a méret a legnagyobb sáv fölött van (egyedi ajánlat).') + '</p>', cid);
    } catch (e) { console.warn('[DocArchiveCloud] értesítés hiba', e.message); }
  }
  return { size, over, tier };
}

module.exports = { snapshot, round, queue, info, download, actualSize, verify, archiveKey, REFRESH_DAYS };
