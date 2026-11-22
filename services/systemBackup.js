// ============================================================
//  VallorSoft — services/systemBackup.js
//  TELJES RENDSZER-MENTÉS a saját Cloudflare R2 tárhelyre, hogy baj esetén az
//  egész rendszer (minden cég, minden adat, minden dokumentum és fájl — ezek az
//  adatbázisban vannak) újraéleszthető legyen.
//
//  - Teljes mentés: pg_dump (custom formátum) → AES-256-GCM → R2
//    (system/YYYY/MM/full-….vsdb). Az első futáskor, majd 30 naponta.
//  - Változás-mentés minden éjjel: a sys_change_log szerint megváltozott sorok
//    AKTUÁLIS állapota + a törölt sorok kulcsa (system/YYYY/MM/delta-….vsbk).
//    A triggerek csak a kulcsot jegyzik fel, az adatot nem másolják.
//  - Minden fájl mellé egy .json leíró kerül (fajta, időpont, mire épül) — így az
//    adatbázis teljes elvesztése után is összerakható a lánc (scripts/system-restore.js).
//  - Kulcs: az INTEGRATION_ENC_KEY-ből származtatva (lib/backupFile systemKey) —
//    ezt a kulcsot a szerveren kívül is meg kell őrizni!
//  - Csak az ütemező-vezető fut (startAllSchedulers), egyszerre egy mentés.
// ============================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { finished } = require('stream/promises');
const log = require('../lib/logger');
const r2 = require('../lib/r2');
const { createWriter, systemKey } = require('../lib/backupFile');
const { pgEnvFromUrl } = require('./backup');

const FULL_EVERY_DAYS = 30;
const DELTA_KEEP_DAYS = 35;
const FULL_KEEP_DAYS = 365;
const BATCH = 500;
const DB_MAGIC = Buffer.from('VSDB');
const DB_VERSION = 1;
// Ezek változását nem követjük (munkamenet / rendszer-könyvelés / maga a napló).
const SKIP = new Set(['session', 'sys_change_log', 'system_backup_runs', 'scheduler_leader']);

let _pool = null;
function _db() { return _pool || (_pool = require('../db')); }
function qi(n) { return '"' + String(n).replace(/"/g, '""') + '"'; }
function ql(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// ── Változás-követő triggerek ───────────────────────────────
function fnName(tbl) {
  const h = crypto.createHash('sha1').update(tbl).digest('hex').slice(0, 6);
  return 'sys_tc_' + String(tbl).replace(/[^a-z0-9_]/gi, '_').slice(0, 40) + '_' + h;
}
// A trigger-függvény SQL-je egy táblára (csak a kulcs-oszlopokat olvassa).
function triggerFunctionSql(tbl, pk) {
  const keyOf = (rec) => 'jsonb_build_object(' + pk.map((c) => ql(c) + ', ' + rec + '.' + qi(c)).join(', ') + ')';
  const changed = pk.map((c) => '(OLD.' + qi(c) + ' IS DISTINCT FROM NEW.' + qi(c) + ')').join(' OR ');
  return `CREATE OR REPLACE FUNCTION ${qi(fnName(tbl))}() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO sys_change_log (tbl, pk, op) VALUES (${ql(tbl)}, ${keyOf('OLD')}, 'D');
  ELSE
    IF TG_OP = 'UPDATE' AND (${changed}) THEN
      INSERT INTO sys_change_log (tbl, pk, op) VALUES (${ql(tbl)}, ${keyOf('OLD')}, 'D');
    END IF;
    INSERT INTO sys_change_log (tbl, pk, op) VALUES (${ql(tbl)}, ${keyOf('NEW')}, left(TG_OP, 1));
  END IF;
  RETURN NULL;
END $f$`;
}

async function tableInfo(db) {
  const r = await db.query(
    `SELECT c.relname AS tbl,
            COALESCE(array_agg(a.attname::text ORDER BY array_position(i.indkey::int2[], a.attnum)) FILTER (WHERE a.attname IS NOT NULL), '{}'::text[]) AS pk
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey) AND a.attnum > 0
      WHERE c.relkind = 'r'
      GROUP BY c.relname ORDER BY c.relname`);
  return r.rows.filter((x) => !SKIP.has(x.tbl)).map((x) => ({ tbl: x.tbl, pk: x.pk || [] }));
}

// Minden elsődleges kulcsos táblára (az újakra is) feltelepíti a követést.
async function ensureTriggers(db) {
  db = db || _db();
  await db.query(`CREATE OR REPLACE FUNCTION sys_tc_truncate() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN INSERT INTO sys_change_log (tbl, pk, op) VALUES (TG_TABLE_NAME, NULL, 'T'); RETURN NULL; END $f$`);
  const info = await tableInfo(db);
  const ex = await db.query(
    `SELECT c.relname AS tbl, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE t.tgname IN ('sys_tc_row', 'sys_tc_trunc')`);
  const has = new Set(ex.rows.map((x) => x.tbl + '|' + x.tgname));
  let added = 0;
  const noPk = [];
  for (const t of info) {
    if (!t.pk.length) { noPk.push(t.tbl); continue; }
    await db.query(triggerFunctionSql(t.tbl, t.pk));
    if (!has.has(t.tbl + '|sys_tc_row')) {
      await db.query(`CREATE TRIGGER sys_tc_row AFTER INSERT OR UPDATE OR DELETE ON ${qi(t.tbl)} FOR EACH ROW EXECUTE FUNCTION ${qi(fnName(t.tbl))}()`);
      added++;
    }
    if (!has.has(t.tbl + '|sys_tc_trunc')) {
      await db.query(`CREATE TRIGGER sys_tc_trunc AFTER TRUNCATE ON ${qi(t.tbl)} FOR EACH STATEMENT EXECUTE FUNCTION sys_tc_truncate()`);
    }
  }
  if (added) log.info('system-backup: változás-követés telepítve', { tables: added });
  return { tables: info.length, added, noPk };
}

// A követés eltávolítása (tesztekhez / kikapcsoláshoz).
async function removeTriggers(db) {
  db = db || _db();
  const r = await db.query(
    `SELECT c.relname AS tbl, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE t.tgname IN ('sys_tc_row', 'sys_tc_trunc')`);
  for (const x of r.rows) await db.query(`DROP TRIGGER IF EXISTS ${qi(x.tgname)} ON ${qi(x.tbl)}`);
  return r.rows.length;
}

// ── Segédek ─────────────────────────────────────────────────
// …T173842123Z-a1b2c3 — ezredmásodperc + véletlen tag: két mentés sosem írja felül egymást.
function stamp(d) { return d.toISOString().replace(/[-:.]/g, '') + '-' + crypto.randomBytes(3).toString('hex'); }
function keyFor(kind, d) {
  const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return 'system/' + y + '/' + m + '/' + kind + '-' + stamp(d) + (kind === 'full' ? '.vsdb' : '.vsbk');
}
// A Neon „-pooler" végpontja nem jó a pg_dump-nak → a közvetlen végpont.
function directUrl(url) {
  try {
    const u = new URL(url);
    if (/-pooler\./.test(u.hostname)) u.hostname = u.hostname.replace('-pooler.', '.');
    return u.toString();
  } catch (_) { return url; }
}
function dumpUrl() { return directUrl(process.env.SYSTEM_BACKUP_DATABASE_URL || process.env.DATABASE_URL || ''); }

async function putManifest(objKey, m) {
  await r2.putObject(objKey + '.json', Buffer.from(JSON.stringify(m, null, 2)), 'application/json');
}

async function alertDev(subject, html) {
  try {
    const { sendDeveloperEmail } = require('./email');
    await sendDeveloperEmail(process.env.DEV_NOTIFY_EMAIL || 'vallorsoft@gmail.com', 'VallorSoft System', subject, html);
  } catch (e) { log.warn('system-backup: értesítés hiba', { err: e.message }); }
}

// ── Teljes mentés (pg_dump) ─────────────────────────────────
function pgDumpVersion() {
  return new Promise((ok) => {
    const p = spawn(process.env.PG_DUMP_BIN || 'pg_dump', ['--version']);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => ok(null));
    p.on('close', () => ok(out.trim() || null));
  });
}

async function runFull(opts) {
  const db = _db();
  const started = new Date();
  const key = keyFor('full', started);
  await ensureTriggers(db);
  // A napló-pillanatkép a pg_dump ELŐTT nyílik: amit itt látunk, az biztosan benne
  // van a dumpban; a végén CSAK ezeket töröljük (REPEATABLE READ), a később
  // véglegesedő bejegyzések a következő változás-mentésbe kerülnek.
  const snap = await db.connect();
  await snap.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const w = await snap.query('SELECT COALESCE(MAX(id), 0)::bigint AS w FROM sys_change_log');
  const watermark = Number(w.rows[0].w);
  const run = await db.query(
    `INSERT INTO system_backup_runs (kind, status, trigger, watermark, started_at) VALUES ('full','running',$1,$2,$3) RETURNING id`,
    [(opts && opts.trigger) || 'schedule', watermark, started]);
  const runId = run.rows[0].id;
  const ver = await pgDumpVersion();
  try {
    if (!ver) throw new Error('pg_dump nem található a szerveren');
    const env = pgEnvFromUrl(dumpUrl(), process.env);
    const args = ['-Fc', '--no-owner', '--no-privileges', '--exclude-table-data=session', '--exclude-table-data=sys_change_log'];
    const child = spawn(process.env.PG_DUMP_BIN || 'pg_dump', args, { env });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    const exited = new Promise((ok) => child.on('close', (code) => ok(code)));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', systemKey(), iv);
    const up = r2.createUploadStream(key, 'application/octet-stream');
    const done = finished(up);
    up.write(Buffer.concat([DB_MAGIC, Buffer.from([DB_VERSION]), iv]));
    cipher.on('data', (c) => { if (!up.write(c)) { cipher.pause(); up.once('drain', () => cipher.resume()); } });
    const cipherEnd = new Promise((ok, ko) => { cipher.on('end', ok); cipher.on('error', ko); });
    child.stdout.pipe(cipher);
    const code = await exited;
    await cipherEnd;
    if (code !== 0) { up.destroy(new Error('pg_dump')); throw new Error('pg_dump hiba (' + code + '): ' + stderr.trim().slice(-600)); }
    up.end(cipher.getAuthTag());
    await done;
    const h = await r2.headObject(key);
    if (!h || h.size < 100) throw new Error('A feltöltött mentés hiányzik vagy üres');
    await putManifest(key, { kind: 'full', key, created_at: started.toISOString(), watermark, pg_dump: ver, bytes: h.size, format: 'VSDB1 (AES-256-GCM, pg_dump -Fc)' });
    await db.query(`UPDATE system_backup_runs SET status='ok', finished_at=NOW(), r2_key=$2, base_key=$2, bytes=$3, pg_version=$4 WHERE id=$1`,
      [runId, key, h.size, ver]);
    await snap.query('DELETE FROM sys_change_log WHERE id <= $1', [watermark]);
    await snap.query('COMMIT');
    log.info('system-backup: teljes mentés kész', { key, bytes: h.size });
    return { ok: true, kind: 'full', key, bytes: h.size, runId };
  } catch (e) {
    await snap.query('ROLLBACK').catch(() => {});
    await db.query(`UPDATE system_backup_runs SET status='error', finished_at=NOW(), error=$2, pg_version=$3 WHERE id=$1`,
      [runId, String(e.message).slice(0, 1000), ver]).catch(() => {});
    r2.deleteObject(key).catch(() => {});
    throw e;
  } finally {
    snap.release();
  }
}

// ── Változás-mentés ─────────────────────────────────────────
async function lastFull(db) {
  const r = await db.query(`SELECT * FROM system_backup_runs WHERE kind='full' AND status='ok' ORDER BY started_at DESC LIMIT 1`);
  return r.rows[0] || null;
}

async function fetchRows(db, tbl, pk, keys) {
  const found = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH);
    let r;
    if (pk.length === 1) {
      r = await db.query(`SELECT * FROM ${qi(tbl)} WHERE ${qi(pk[0])}::text = ANY($1::text[])`,
        [chunk.map((k) => (k[pk[0]] == null ? null : String(k[pk[0]])))]);
    } else {
      const params = [];
      const tuples = chunk.map((k) => '(' + pk.map((c) => { params.push(k[c] == null ? null : String(k[c])); return '$' + params.length; }).join(',') + ')');
      r = await db.query(`SELECT * FROM ${qi(tbl)} WHERE (${pk.map((c) => qi(c) + '::text').join(',')}) IN (${tuples.join(',')})`, params);
    }
    found.push(...r.rows);
  }
  return found;
}
const keyStr = (pk, o) => pk.map((c) => (o[c] == null ? '' : String(o[c]))).join('\u0001');

async function runDelta(opts) {
  const db = _db();
  const base = await lastFull(db);
  if (!base || Date.now() - new Date(base.started_at).getTime() > FULL_EVERY_DAYS * 86400000 || (opts && opts.forceFull)) {
    return runFull(opts);
  }
  const started = new Date();
  const key = keyFor('delta', started);
  const info = await ensureTriggers(db);
  const tables = await tableInfo(db);
  const pkOf = {};
  tables.forEach((t) => { pkOf[t.tbl] = t.pk; });
  // Egy pillanatképben olvassuk a naplót ÉS a sorokat (konzisztens), és a végén
  // csak a látott bejegyzéseket töröljük.
  const snap = await db.connect();
  await snap.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const w = await snap.query('SELECT COALESCE(MAX(id), 0)::bigint AS w FROM sys_change_log');
  const watermark = Number(w.rows[0].w);
  const run = await db.query(
    `INSERT INTO system_backup_runs (kind, status, trigger, base_key, watermark, started_at) VALUES ('delta','running',$1,$2,$3,$4) RETURNING id`,
    [(opts && opts.trigger) || 'schedule', base.r2_key, watermark, started]);
  const runId = run.rows[0].id;
  const tmp = path.join(os.tmpdir(), 'vs-sysdelta-' + Date.now() + '.vsbk');
  try {
    const tr = await snap.query(`SELECT tbl, MAX(id)::bigint AS tid FROM sys_change_log WHERE id <= $1 AND op = 'T' GROUP BY tbl`, [watermark]);
    const truncAt = {};
    tr.rows.forEach((x) => { truncAt[x.tbl] = Number(x.tid); });
    const kr = await snap.query(
      `SELECT tbl, pk, MAX(id)::bigint AS last FROM sys_change_log WHERE id <= $1 AND op <> 'T' GROUP BY tbl, pk`, [watermark]);
    const byTbl = {};
    kr.rows.forEach((x) => {
      if (truncAt[x.tbl] && Number(x.last) < truncAt[x.tbl]) return;   // a csonkolás előtti változás érdektelen
      (byTbl[x.tbl] = byTbl[x.tbl] || []).push(x.pk || {});
    });
    const wr = createWriter(tmp, systemKey());
    const counts = {};
    let rows = 0;
    await wr.writeLine({ type: 'meta', kind: 'delta', created_at: started.toISOString(), base_key: base.r2_key, watermark,
      prev_watermark: null, tables: tables.map((t) => ({ table: t.tbl, pk: t.pk })) });
    for (const t of Object.keys(truncAt)) await wr.writeLine({ trunc: t });
    for (const t of Object.keys(byTbl)) {
      const pk = pkOf[t];
      if (!pk || !pk.length) continue;   // időközben megszűnt / kulcs nélküli tábla
      const keys = byTbl[t];
      const live = await fetchRows(snap, t, pk, keys);
      const seen = new Set();
      for (const row of live) { seen.add(keyStr(pk, row)); await wr.writeLine({ t, r: row }); rows++; }
      for (const k of keys) if (!seen.has(keyStr(pk, k))) { await wr.writeLine({ t, d: k }); rows++; }
      counts[t] = keys.length;
    }
    // Elsődleges kulcs nélküli táblák: teljes tartalom (kicsik, ritkák).
    for (const t of info.noPk) {
      await wr.writeLine({ repl: t });
      const r = await snap.query(`SELECT * FROM ${qi(t)}`);
      for (const row of r.rows) { await wr.writeLine({ t, r: row }); rows++; }
      counts[t] = (counts[t] || 0) + r.rows.length;
    }
    await wr.writeLine({ type: 'end', counts, rows });
    const { size } = await wr.close();
    const up = r2.createUploadStream(key, 'application/octet-stream');
    const done = finished(up);
    fs.createReadStream(tmp).pipe(up);
    await done;
    await putManifest(key, { kind: 'delta', key, base_key: base.r2_key, created_at: started.toISOString(), watermark, rows, bytes: size, format: 'VSBK1 (NDJSON, gzip, AES-256-GCM)' });
    await db.query(`UPDATE system_backup_runs SET status='ok', finished_at=NOW(), r2_key=$2, bytes=$3, row_count=$4, table_count=$5 WHERE id=$1`,
      [runId, key, size, rows, Object.keys(counts).length]);
    await snap.query('DELETE FROM sys_change_log WHERE id <= $1', [watermark]);
    await snap.query('COMMIT');
    log.info('system-backup: változás-mentés kész', { key, rows, bytes: size });
    return { ok: true, kind: 'delta', key, rows, bytes: size, runId };
  } catch (e) {
    await snap.query('ROLLBACK').catch(() => {});
    await db.query(`UPDATE system_backup_runs SET status='error', finished_at=NOW(), error=$2 WHERE id=$1`, [runId, String(e.message).slice(0, 1000)]).catch(() => {});
    r2.deleteObject(key).catch(() => {});
    throw e;
  } finally {
    snap.release();
    fs.unlink(tmp, () => {});
  }
}

// ── Megőrzés: változás-mentések 35 napig, teljes mentések 1 évig ──
async function applyRetention() {
  const db = _db();
  const old = await db.query(
    `SELECT id, r2_key FROM system_backup_runs WHERE r2_key IS NOT NULL AND status='ok'
       AND ((kind='delta' AND started_at < NOW() - INTERVAL '${DELTA_KEEP_DAYS} days')
         OR (kind='full'  AND started_at < NOW() - INTERVAL '${FULL_KEEP_DAYS} days'))`);
  for (const r of old.rows) {
    try {
      await r2.deleteObject(r.r2_key);
      await r2.deleteObject(r.r2_key + '.json');
      await db.query(`UPDATE system_backup_runs SET r2_key=NULL, status='deleted' WHERE id=$1`, [r.id]);
    } catch (e) { log.warn('system-backup: törlés hiba', { id: r.id, err: e.message }); }
  }
  return old.rows.length;
}

// ── Futtatás + ütemező ──────────────────────────────────────
let _busy = false;
function isBusy() { return _busy; }
async function run(opts) {
  if (_busy) return { ok: false, err: 'Mentés már fut' };
  if (!r2.configured()) return { ok: false, err: 'A Cloudflare R2 nincs beállítva' };
  _busy = true;
  try {
    const r = await runDelta(opts);
    await applyRetention().catch((e) => log.warn('system-backup: megőrzés hiba', { err: e.message }));
    return r;
  } catch (e) {
    log.error('system-backup: hiba', { err: e.message });
    await alertDev('⚠️ A teljes rendszer-mentés NEM sikerült',
      '<p>A VallorSoft éjszakai rendszer-mentése hibával leállt:</p><pre style="white-space:pre-wrap;">' +
      String(e.message).replace(/</g, '&lt;').slice(0, 1500) + '</pre><p>Developer felület → 🛡️ Biztonsági mentés → „Teljes rendszer-mentés".</p>');
    return { ok: false, err: e.message };
  } finally { _busy = false; }
}

function hourNow() {
  const { bucharestParts } = require('./companyBackup');
  return bucharestParts(new Date());
}
async function due() {
  const h = parseInt(process.env.SYSTEM_BACKUP_HOUR, 10);
  const hour = Number.isInteger(h) && h >= 0 && h < 24 ? h : 3;
  const n = hourNow();
  if (n.hour < hour) return false;
  const r = await _db().query(`SELECT started_at FROM system_backup_runs WHERE trigger='schedule' ORDER BY started_at DESC LIMIT 1`);
  if (!r.rows.length) return true;
  const { bucharestParts } = require('./companyBackup');
  return bucharestParts(new Date(r.rows[0].started_at)).date !== n.date;
}

function startSystemBackupScheduler() {
  if (String(process.env.SYSTEM_BACKUP_ENABLED || 'true').toLowerCase() === 'false') return false;
  let first = true;
  const tick = async () => {
    try {
      // induláskor (új táblák is) feltelepítjük a követést — akkor is, ha még nincs R2;
      // utána minden mentés előtt újra ellenőrzi (runFull / runDelta).
      if (first) { first = false; await ensureTriggers().catch((e) => log.warn('system-backup: trigger-telepítés hiba', { err: e.message })); }
      if (!r2.configured() || _busy) return;
      if (await due()) await run({ trigger: 'schedule' });
    } catch (e) { log.warn('system-backup: ütemező hiba', { err: e.message }); }
  };
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, 10 * 60 * 1000);
  log.info('Teljes rendszer-mentés ütemező elindítva (Cloudflare R2)');
  return true;
}

module.exports = {
  FULL_EVERY_DAYS, DELTA_KEEP_DAYS, FULL_KEEP_DAYS, DB_MAGIC, DB_VERSION, SKIP,
  fnName, triggerFunctionSql, tableInfo, ensureTriggers, removeTriggers, keyFor, directUrl,
  runFull, runDelta, run, applyRetention, isBusy, startSystemBackupScheduler, pgDumpVersion,
};
