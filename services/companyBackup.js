// ============================================================
//  VallorSoft — services/companyBackup.js
//  Cégenkénti automatikus biztonsági mentés Google Drive-ba.
//
//  - Minden éjjel (a cég által megadott órában, Europe/Bucharest) egy
//    teljes, titkosított pillanatkép készül a cég ÖSSZES adatáról
//    (minden company_id-s tábla + a fuvarokhoz kötött gyerek-táblák +
//    a sofőr-e-mailhez kötött naplók + maga a cég-sor), benne a
//    dokumentumokkal, fotókkal, GPS-útvonalakkal.
//  - A fájl a cég SAJÁT Drive-jára kerül (ha összekötötte) — onnan mi nem
//    törlünk, csak ha a cég megőrzési korlátot állított be —, és a VallorSoft
//    saját Drive-jára is (biztonsági háló), ahol 30 napig őrizzük.
//  - Csak az ütemező-vezető fut (lib/schedulerLeader), egyszerre egy mentés.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../db');
const log = require('../lib/logger');
const { encrypt, decrypt } = require('../lib/crypto');
const drive = require('../lib/googleDrive');
const { createWriter, companyKey } = require('../lib/backupFile');

const VS_RETENTION_DAYS = 30;
const PAGE = 1000;
const COMPANY_FOLDER = 'VallorSoft – Backup';
const VS_ROOT_FOLDER = 'VallorSoft – Backup cegek';
const RETENTION_OPTIONS = ['forever', '365', '180', '90'];
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

// ---- Drive-kapcsolatok ----
async function getCompanyDrive(cid) {
  const r = await pool.query(
    `SELECT credentials_enc, meta, status FROM company_integrations WHERE company_id = $1 AND provider = 'gdrive_backup'`, [cid]);
  if (!r.rows.length || !r.rows[0].credentials_enc) return null;
  return { refreshToken: decrypt(r.rows[0].credentials_enc), meta: r.rows[0].meta || {}, status: r.rows[0].status };
}
async function setCompanyDriveMeta(cid, patch, status, message) {
  await pool.query(
    `UPDATE company_integrations
        SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
            status = COALESCE($3, status), status_message = $4, last_check = now(), updated_at = now()
      WHERE company_id = $1 AND provider = 'gdrive_backup'`,
    [cid, JSON.stringify(patch || {}), status || null, message || null]);
}
async function getVsDrive() {
  const r = await pool.query(`SELECT value FROM developer_settings WHERE key = 'backup_vs_drive'`).catch(() => ({ rows: [] }));
  const v = r.rows[0] && r.rows[0].value;
  if (!v || !v.refresh_enc) return null;
  return { refreshToken: decrypt(v.refresh_enc), value: v };
}
async function patchVsDrive(patch) {
  await pool.query(
    `UPDATE developer_settings SET value = value || $1::jsonb, updated_at = now() WHERE key = 'backup_vs_drive'`,
    [JSON.stringify(patch)]);
}

async function saveCompanyDrive(cid, refreshToken, email) {
  await pool.query(
    `INSERT INTO company_integrations (company_id, provider, category, enabled, credentials_enc, status, meta, updated_at)
     VALUES ($1, 'gdrive_backup', 'backup', true, $2, 'connected', $3::jsonb, now())
     ON CONFLICT (company_id, provider) DO UPDATE
       SET credentials_enc = EXCLUDED.credentials_enc, enabled = true, status = 'connected',
           status_message = NULL, meta = EXCLUDED.meta, updated_at = now()`,
    [cid, encrypt(refreshToken), JSON.stringify({ email: email || null, connected_at: new Date().toISOString() })]);
}
async function saveVsDrive(refreshToken, email) {
  await pool.query(
    `INSERT INTO developer_settings (key, value, updated_at) VALUES ('backup_vs_drive', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ refresh_enc: encrypt(refreshToken), email: email || null, connected_at: new Date().toISOString() })]);
}

async function getSettings(cid) {
  const r = await pool.query('SELECT enabled, run_hour, drive_retention FROM company_backup_settings WHERE company_id = $1', [cid])
    .catch(() => ({ rows: [] }));
  return r.rows[0] || { enabled: true, run_hour: 2, drive_retention: 'forever' };
}

// ---- Egy cég mentése ----
const _running = new Set();
function isRunning(cid) { return _running.has(Number(cid)); }

async function runCompanyBackup(cid, opts) {
  cid = Number(cid);
  const trigger = (opts && opts.trigger) || 'schedule';
  if (_running.has(cid)) return { ok: false, err: 'Backup deja în curs' };
  _running.add(cid);
  const started = new Date();
  const fileName = backupFileName(cid, started);
  const tmp = path.join(os.tmpdir(), 'vsbk-' + cid + '-' + Date.now() + '.vsbk');
  let runId = null;
  try {
    const settings = await getSettings(cid);
    const companyDrive = settings.enabled !== false ? await getCompanyDrive(cid).catch(() => null) : null;
    const vsDrive = await getVsDrive().catch(() => null);
    if (!companyDrive && !vsDrive) return { ok: false, err: 'Google Drive neconectat' };

    const ins = await pool.query(
      `INSERT INTO company_backup_runs (company_id, trigger, kind, status, started_at, file_name)
       VALUES ($1, $2, 'full', 'running', $3, $4) RETURNING id`, [cid, trigger, started, fileName]);
    runId = ins.rows[0].id;

    const snap = await buildSnapshot(pool, cid, tmp);
    const res = { drive_file_id: null, drive_status: 'skipped', vs_file_id: null, vs_status: 'skipped', errors: [] };

    if (companyDrive) {
      try {
        const token = await drive.accessToken(companyDrive.refreshToken);
        const folderId = await drive.ensureFolder(token, COMPANY_FOLDER, null, companyDrive.meta.folder_id);
        res.drive_file_id = await drive.uploadFile(token, folderId, fileName, tmp);
        res.drive_status = 'ok';
        await setCompanyDriveMeta(cid, { folder_id: folderId }, 'connected', null);
      } catch (e) {
        res.drive_status = 'error'; res.errors.push('Drive firmă: ' + e.message);
        const revoked = e.code === 'invalid_grant';
        await setCompanyDriveMeta(cid, {}, revoked ? 'error' : null,
          revoked ? 'Accesul la Google Drive a fost revocat — reconectați.' : e.message).catch(() => {});
      }
    }
    if (vsDrive) {
      try {
        const token = await drive.accessToken(vsDrive.refreshToken);
        const rootId = await drive.ensureFolder(token, VS_ROOT_FOLDER, null, vsDrive.value.root_folder_id);
        if (rootId !== vsDrive.value.root_folder_id) await patchVsDrive({ root_folder_id: rootId });
        const sub = await drive.ensureFolder(token, 'firma-' + cid, rootId, null);
        res.vs_file_id = await drive.uploadFile(token, sub, fileName, tmp);
        res.vs_status = 'ok';
      } catch (e) {
        res.vs_status = 'error'; res.errors.push('Drive VallorSoft: ' + e.message);
      }
    }
    const okCount = [res.drive_status, res.vs_status].filter((s) => s === 'ok').length;
    const tried = [res.drive_status, res.vs_status].filter((s) => s !== 'skipped').length;
    const status = okCount === 0 ? 'error' : (okCount < tried ? 'partial' : 'ok');
    await pool.query(
      `UPDATE company_backup_runs SET status=$2, finished_at=now(), size_bytes=$3, row_count=$4, table_counts=$5::jsonb,
              drive_file_id=$6, drive_status=$7, vs_file_id=$8, vs_status=$9, error=$10 WHERE id=$1`,
      [runId, status, snap.size, snap.rows, JSON.stringify(snap.counts), res.drive_file_id, res.drive_status,
        res.vs_file_id, res.vs_status, res.errors.join(' | ').slice(0, 1000) || null]);
    log.info('backup: kész', { company_id: cid, status, size: snap.size, rows: snap.rows });
    await applyRetention(cid, settings, companyDrive, vsDrive).catch((e) => log.warn('backup: retenció hiba', { company_id: cid, err: e.message }));
    return { ok: status !== 'error', status, runId };
  } catch (e) {
    log.error('backup: hiba', { company_id: cid, err: e.message });
    if (runId) {
      await pool.query(`UPDATE company_backup_runs SET status='error', finished_at=now(), error=$2 WHERE id=$1`,
        [runId, String(e.message).slice(0, 1000)]).catch(() => {});
    }
    return { ok: false, err: 'Backup eșuat' };
  } finally {
    _running.delete(cid);
    fs.unlink(tmp, () => {});
  }
}

// ---- Megőrzés ----
// VallorSoft Drive: 30 nap után törlés. A cég Drive-ja: csak ha a cég korlátot kért.
async function applyRetention(cid, settings, companyDrive, vsDrive) {
  if (vsDrive) {
    const old = await pool.query(
      `SELECT id, vs_file_id FROM company_backup_runs
        WHERE company_id=$1 AND vs_file_id IS NOT NULL AND started_at < now() - ($2 || ' days')::interval`,
      [cid, String(VS_RETENTION_DAYS)]);
    if (old.rows.length) {
      const token = await drive.accessToken(vsDrive.refreshToken);
      for (const r of old.rows) {
        try { await drive.deleteFile(token, r.vs_file_id); await pool.query(`UPDATE company_backup_runs SET vs_file_id=NULL, vs_status='deleted' WHERE id=$1`, [r.id]); }
        catch (e) { log.warn('backup: VS-törlés hiba', { run: r.id, err: e.message }); }
      }
    }
  }
  const days = parseInt(settings && settings.drive_retention, 10);
  if (companyDrive && Number.isFinite(days) && days > 0) {
    const old = await pool.query(
      `SELECT id, drive_file_id FROM company_backup_runs
        WHERE company_id=$1 AND drive_file_id IS NOT NULL AND started_at < now() - ($2 || ' days')::interval`,
      [cid, String(days)]);
    if (old.rows.length) {
      const token = await drive.accessToken(companyDrive.refreshToken);
      for (const r of old.rows) {
        try { await drive.deleteFile(token, r.drive_file_id); await pool.query(`UPDATE company_backup_runs SET drive_file_id=NULL, drive_status='deleted' WHERE id=$1`, [r.id]); }
        catch (e) { log.warn('backup: cég-Drive törlés hiba', { run: r.id, err: e.message }); }
      }
    }
  }
  // A napló sorai 400 nap után törlődnek (a Drive-fájlok sorsától függetlenül).
  await pool.query(`DELETE FROM company_backup_runs WHERE company_id=$1 AND started_at < now() - interval '400 days'
                      AND drive_file_id IS NULL AND vs_file_id IS NULL`, [cid]);
}

// ---- Ütemező ----
async function dueCompanies(now) {
  const vs = await getVsDrive().catch(() => null);
  // Jelöltek: aktív cégek, ahol van cél (saját Drive bekapcsolva, vagy a VallorSoft Drive él).
  const r = await pool.query(
    `SELECT c.id,
            COALESCE(s.run_hour, 2) AS run_hour,
            COALESCE(s.enabled, true) AS enabled,
            (ci.credentials_enc IS NOT NULL) AS has_drive,
            (SELECT MAX(started_at) FROM company_backup_runs b WHERE b.company_id = c.id AND b.trigger = 'schedule') AS last_run
       FROM companies c
       LEFT JOIN company_backup_settings s ON s.company_id = c.id
       LEFT JOIN company_integrations ci ON ci.company_id = c.id AND ci.provider = 'gdrive_backup'
      WHERE COALESCE(c.subscription_status, 'active') <> 'cancelled'`);
  return r.rows.filter((x) => (vs || (x.enabled && x.has_drive)) && isDue(Number(x.run_hour), x.last_run, now)).map((x) => x.id);
}

let _tickBusy = false;
async function tick() {
  if (_tickBusy || !drive.isConfigured()) return;
  _tickBusy = true;
  try {
    const ids = await dueCompanies(new Date());
    for (const cid of ids) await runCompanyBackup(cid, { trigger: 'schedule' });
  } catch (e) {
    log.warn('backup: ütemező hiba', { err: e.message });
  } finally { _tickBusy = false; }
}

function startCompanyBackupScheduler() {
  setTimeout(tick, 90 * 1000);
  setInterval(tick, 10 * 60 * 1000);
  log.info('Cégenkénti Drive-mentés ütemező elindítva (10 perces ellenőrzés)');
}

module.exports = {
  VS_RETENTION_DAYS, RETENTION_OPTIONS, COMPANY_FOLDER,
  bucharestParts, isDue, backupFileName, discoverTables, scopeWhere, buildSnapshot,
  saveCompanyDrive, saveVsDrive, getCompanyDrive, getVsDrive, getSettings,
  runCompanyBackup, isRunning, startCompanyBackupScheduler, dueCompanies, _tick: tick,
};
