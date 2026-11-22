// ============================================================
//  VallorSoft — services/companyBackup.js
//  Cégenkénti automatikus biztonsági mentés a saját Cloudflare R2 tárhelyünkre.
//
//  - Minden éjjel (a cég által megadott órában, Europe/Bucharest) egy
//    teljes, titkosított pillanatkép készül a cég ÖSSZES adatáról
//    (minden company_id-s tábla + a fuvarokhoz kötött gyerek-táblák +
//    a sofőr-e-mailhez kötött naplók + maga a cég-sor), benne a
//    dokumentumokkal, fotókkal, GPS-útvonalakkal.
//  - A fájl cégenkénti kulccsal titkosított (lib/backupFile), és a Cloudflare
//    R2-re kerül (lib/r2): backups/c<cégId>/<fájl>.vsbk.
//  - Megőrzés: 30 napig minden napi mentés megmarad, utána havonta egy
//    (a hónap első sikeres mentése) a cég által választott ideig (30/90/180/365 nap).
//  - Csak az ütemező-vezető fut (lib/schedulerLeader), egyszerre egy mentés.
//  - A korábbi Google Drive-os mentés kivezetve (a tárolt tokeneket egyszer visszavonjuk).
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { finished } = require('stream/promises');
const pool = require('../db');
const log = require('../lib/logger');
const { decrypt } = require('../lib/crypto');
const r2 = require('../lib/r2');
const { createWriter, companyKey } = require('../lib/backupFile');

const DAILY_KEEP_DAYS = 30;
const PAGE = 1000;
const RETENTION_OPTIONS = ['30', '90', '180', '365'];
const DEFAULT_RETENTION = '365';
// Ezeket nem mentjük: munkamenet / rendszer-könyvelés / maga a mentés-napló.
const SKIP_TABLES = new Set(['session', 'schema_migrations', 'scheduler_leader', 'company_backup_runs', 'company_backup_restores']);

function qi(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }

// ---- Időzítés (tiszta, tesztelhető) ----
function bucharestParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const p = {}; fmt.formatToParts(date || new Date()).forEach((x) => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, hour: parseInt(p.hour, 10) };
}

// Esedékes-e ma: elérte a beállított órát, és ma (bukaresti napon) még nem futott.
// A ">=" miatt egy kiesett éjszakai futás (újraindítás) később aznap pótlódik.
function isDue(runHour, lastStartedAt, now) {
  const n = bucharestParts(now);
  const h = Number.isInteger(runHour) ? runHour : 2;
  if (n.hour < h) return false;
  if (!lastStartedAt) return true;
  return bucharestParts(new Date(lastStartedAt)).date !== n.date;
}

function backupFileName(companyId, date) {
  const d = date || new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return 'vallorsoft-backup-c' + companyId + '-' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
    + '-' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '.vsbk';
}

// ---- Mit mentünk: táblák felderítése ----
// Visszaad: [{ table, scope:'company'|'order'|'driver'|'self', hasId }]
async function discoverTables(db) {
  const r = await db.query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.column_name IN ('company_id','order_id','email_sofer','id')`);
  const cols = {};
  r.rows.forEach((x) => { (cols[x.table_name] = cols[x.table_name] || new Set()).add(x.column_name); });
  const out = [{ table: 'companies', scope: 'self', hasId: true }];
  Object.keys(cols).sort().forEach((t) => {
    if (SKIP_TABLES.has(t) || t === 'companies') return;
    const c = cols[t];
    let scope = null;
    if (c.has('company_id')) scope = 'company';
    else if (c.has('order_id')) scope = 'order';
    else if (c.has('email_sofer')) scope = 'driver';
    if (scope) out.push({ table: t, scope, hasId: c.has('id') });
  });
  return out;
}

function scopeWhere(scope) {
  if (scope === 'self') return 'id = $1';
  if (scope === 'company') return 'company_id = $1';
  if (scope === 'order') return 'order_id::text IN (SELECT id::text FROM orders WHERE company_id = $1)';
  if (scope === 'driver') return 'LOWER(email_sofer) IN (SELECT LOWER(email) FROM users WHERE company_id = $1)';
  throw new Error('scope?');
}

// Egy tábla sorai lapozva (id szerinti keyset, ha van id) → onRow.
async function streamTable(db, spec, cid, onRow) {
  const where = scopeWhere(spec.scope);
  let n = 0;
  if (!spec.hasId) {
    const r = await db.query(`SELECT * FROM ${qi(spec.table)} WHERE ${where}`, [cid]);
    for (const row of r.rows) { await onRow(row); n++; }
    return n;
  }
  let last = null;
  for (;;) {
    const r = last === null
      ? await db.query(`SELECT * FROM ${qi(spec.table)} WHERE ${where} ORDER BY id LIMIT ${PAGE}`, [cid])
      : await db.query(`SELECT * FROM ${qi(spec.table)} WHERE ${where} AND id > $2 ORDER BY id LIMIT ${PAGE}`, [cid, last]);
    for (const row of r.rows) { await onRow(row); n++; }
    if (r.rows.length < PAGE) return n;
    last = r.rows[r.rows.length - 1].id;
  }
}

// A teljes pillanatkép egy titkosított fájlba. → { counts, rows, size }
async function buildSnapshot(db, cid, filePath) {
  const comp = await db.query('SELECT id, nev FROM companies WHERE id = $1', [cid]);
  if (!comp.rows.length) throw new Error('Firma inexistentă');
  const specs = await discoverTables(db);
  const w = createWriter(filePath, companyKey(cid));
  const counts = {};
  let rows = 0;
  let err = null;
  try {
    await w.writeLine({
      type: 'meta', version: 1, kind: 'full', company_id: cid, company_name: comp.rows[0].nev,
      created_at: new Date().toISOString(), tables: specs.map((s) => ({ table: s.table, scope: s.scope })),
    });
    for (const spec of specs) {
      try {
        counts[spec.table] = await streamTable(db, spec, cid, (row) => w.writeLine({ t: spec.table, r: row }));
        rows += counts[spec.table];
      } catch (e) {
        // Egy hibás tábla ne buktassa az egész mentést — de a naplóban látsszon.
        counts[spec.table] = -1;
        log.warn('backup: tábla kihagyva', { company_id: cid, table: spec.table, err: e.message });
      }
    }
    await w.writeLine({ type: 'end', counts, rows });
  } catch (e) { err = e; }
  const res = await w.close().catch((e) => { if (!err) err = e; return { size: 0 }; });
  if (err) throw err;
  return { counts, rows, size: res.size };
}

function r2KeyFor(cid, fileName) { return 'backups/c' + Number(cid) + '/' + fileName; }

async function getSettings(cid) {
  const r = await pool.query('SELECT enabled, run_hour, drive_retention FROM company_backup_settings WHERE company_id = $1', [cid])
    .catch(() => ({ rows: [] }));
  const s = r.rows[0] || { enabled: true, run_hour: 2, drive_retention: DEFAULT_RETENTION };
  if (RETENTION_OPTIONS.indexOf(String(s.drive_retention)) === -1) s.drive_retention = DEFAULT_RETENTION;
  return s;
}

// ---- Egy cég mentése ----
const _running = new Set();
function isRunning(cid) { return _running.has(Number(cid)); }

async function uploadToR2(filePath, key) {
  const up = r2.createUploadStream(key, 'application/octet-stream');
  const done = finished(up);
  fs.createReadStream(filePath).pipe(up);
  await done;
  const h = await r2.headObject(key);
  if (!h) throw new Error('R2: a feltöltött fájl nem található');
  return h.size;
}

async function runCompanyBackup(cid, opts) {
  cid = Number(cid);
  const trigger = (opts && opts.trigger) || 'schedule';
  if (_running.has(cid)) return { ok: false, err: 'Backup deja în curs' };
  if (!r2.configured()) return { ok: false, err: 'Stocarea pentru backup nu este configurată' };
  _running.add(cid);
  const started = new Date();
  const fileName = backupFileName(cid, started);
  const key = r2KeyFor(cid, fileName);
  const tmp = path.join(os.tmpdir(), 'vsbk-' + cid + '-' + Date.now() + '.vsbk');
  let runId = null;
  try {
    const settings = await getSettings(cid);
    const ins = await pool.query(
      `INSERT INTO company_backup_runs (company_id, trigger, kind, status, started_at, file_name)
       VALUES ($1, $2, 'full', 'running', $3, $4) RETURNING id`, [cid, trigger, started, fileName]);
    runId = ins.rows[0].id;

    const snap = await buildSnapshot(pool, cid, tmp);
    let status = 'ok', error = null, stored = null;
    try { stored = await uploadToR2(tmp, key); }
    catch (e) { status = 'error'; error = 'Cloudflare R2: ' + e.message; r2.deleteObject(key).catch(() => {}); }
    await pool.query(
      `UPDATE company_backup_runs SET status=$2, finished_at=now(), size_bytes=$3, row_count=$4, table_counts=$5::jsonb,
              r2_key=$6, r2_status=$7, error=$8 WHERE id=$1`,
      [runId, status, stored != null ? stored : snap.size, snap.rows, JSON.stringify(snap.counts),
        status === 'ok' ? key : null, status, error ? error.slice(0, 1000) : null]);
    log.info('backup: kész', { company_id: cid, status, size: snap.size, rows: snap.rows });
    if (status === 'ok') await applyRetention(cid, settings).catch((e) => log.warn('backup: retenció hiba', { company_id: cid, err: e.message }));
    return { ok: status === 'ok', status, runId };
  } catch (e) {
    log.error('backup: hiba', { company_id: cid, err: e.message });
    if (runId) {
      await pool.query(`UPDATE company_backup_runs SET status='error', finished_at=now(), error=$2 WHERE id=$1`,
        [runId, String(e.message).slice(0, 1000)]).catch(() => {});
    }
    r2.deleteObject(key).catch(() => {});
    return { ok: false, err: 'Backup eșuat' };
  } finally {
    _running.delete(cid);
    fs.unlink(tmp, () => {});
  }
}

// ---- Megőrzés ----
// 30 napig minden napi mentés; utána havonta a hónap első sikeres mentése marad,
// a cég által választott ideig; minden más törlődik az R2-ről.
async function applyRetention(cid, settings) {
  const days = Math.max(DAILY_KEEP_DAYS, parseInt(settings && settings.drive_retention, 10) || parseInt(DEFAULT_RETENTION, 10));
  const old = await pool.query(
    `WITH monthly AS (
       SELECT DISTINCT ON (date_trunc('month', started_at)) id
         FROM company_backup_runs
        WHERE company_id = $1 AND r2_key IS NOT NULL AND status = 'ok'
        ORDER BY date_trunc('month', started_at), started_at)
     SELECT id, r2_key FROM company_backup_runs
      WHERE company_id = $1 AND r2_key IS NOT NULL
        AND (started_at < now() - ($2 || ' days')::interval
             OR (started_at < now() - ($3 || ' days')::interval AND id NOT IN (SELECT id FROM monthly)))`,
    [cid, String(days), String(DAILY_KEEP_DAYS)]);
  for (const r of old.rows) {
    try {
      await r2.deleteObject(r.r2_key);
      await pool.query(`UPDATE company_backup_runs SET r2_key=NULL, r2_status='deleted' WHERE id=$1 AND company_id=$2`, [r.id, cid]);
    } catch (e) { log.warn('backup: R2-törlés hiba', { run: r.id, err: e.message }); }
  }
  // A napló sorai 400 nap után törlődnek, ha már nincs hozzájuk fájl.
  await pool.query(`DELETE FROM company_backup_runs WHERE company_id=$1 AND started_at < now() - interval '400 days'
                      AND r2_key IS NULL`, [cid]);
  return old.rows.length;
}

// ---- A korábbi Google Drive-kapcsolatok kivezetése (egyszer) ----
// A tárolt frissítő-tokeneket visszavonjuk a Google-nél, majd töröljük.
async function revokeLegacyDriveTokens() {
  const tokens = [];
  try {
    const c = await pool.query(`SELECT company_id, credentials_enc FROM company_integrations WHERE provider='gdrive_backup' AND credentials_enc IS NOT NULL`);
    c.rows.forEach((r) => { try { tokens.push(decrypt(r.credentials_enc)); } catch (_) {} });
    const v = await pool.query(`SELECT value FROM developer_settings WHERE key='backup_vs_drive'`);
    const vv = v.rows[0] && v.rows[0].value;
    if (vv && vv.refresh_enc) { try { tokens.push(decrypt(vv.refresh_enc)); } catch (_) {} }
  } catch (e) { return 0; }
  for (const t of tokens) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(t) });
    } catch (_) { /* best-effort */ }
  }
  await pool.query(`DELETE FROM company_integrations WHERE provider='gdrive_backup'`).catch(() => {});
  await pool.query(`DELETE FROM developer_settings WHERE key='backup_vs_drive'`).catch(() => {});
  if (tokens.length) log.info('backup: Google Drive-tokenek visszavonva', { n: tokens.length });
  return tokens.length;
}

// ---- Ütemező ----
async function dueCompanies(now) {
  const r = await pool.query(
    `SELECT c.id,
            COALESCE(s.run_hour, 2) AS run_hour,
            COALESCE(s.enabled, true) AS enabled,
            (SELECT MAX(started_at) FROM company_backup_runs b WHERE b.company_id = c.id AND b.trigger = 'schedule') AS last_run
       FROM companies c
       LEFT JOIN company_backup_settings s ON s.company_id = c.id
      WHERE COALESCE(c.subscription_status, 'active') <> 'cancelled'`);
  return r.rows.filter((x) => x.enabled && isDue(Number(x.run_hour), x.last_run, now)).map((x) => x.id);
}

let _tickBusy = false, _legacyDone = false;
async function tick() {
  if (_tickBusy) return;
  _tickBusy = true;
  try {
    if (!_legacyDone) { _legacyDone = true; await revokeLegacyDriveTokens().catch(() => {}); }
    if (!r2.configured()) return;
    const ids = await dueCompanies(new Date());
    for (const cid of ids) await runCompanyBackup(cid, { trigger: 'schedule' });
  } catch (e) {
    log.warn('backup: ütemező hiba', { err: e.message });
  } finally { _tickBusy = false; }
}

function startCompanyBackupScheduler() {
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 10 * 60 * 1000);
  log.info('Cégenkénti biztonsági mentés ütemező elindítva (Cloudflare R2, 10 perces ellenőrzés)');
}

module.exports = {
  DAILY_KEEP_DAYS, RETENTION_OPTIONS, DEFAULT_RETENTION,
  bucharestParts, isDue, backupFileName, discoverTables, scopeWhere, buildSnapshot, r2KeyFor,
  getSettings, runCompanyBackup, isRunning, startCompanyBackupScheduler, dueCompanies, applyRetention,
  revokeLegacyDriveTokens, _tick: tick,
};
