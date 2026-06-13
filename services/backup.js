// ============================================================
//  VallorSoft — services/backup.js
//  OPCIONÁLIS automatikus DB-mentés (pg_dump | gzip), retencióval.
//  Alapból KI — csak ha BACKUP_ENABLED=true ÉS BACKUP_DIR meg van adva.
//  Env:
//    BACKUP_ENABLED=true           — bekapcsolás
//    BACKUP_DIR=/var/backups/vs    — cél-könyvtár
//    BACKUP_INTERVAL_HOURS=24      — gyakoriság (alap 24)
//    BACKUP_RETENTION_DAYS=14      — ennél régebbi mentések törlése
//  Megjegyzés: a jelszó NEM kerül a parancssorba (PG* env-en megy a
//  pg_dump-nak), így nem látszik a `ps`-ben. Külső cron is használható
//  helyette — ez csak kényelmi, beépített ütemező.
// ============================================================
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('../lib/logger');

function pad(n) { return String(n).padStart(2, '0'); }

// vallorsoft-YYYYMMDD-HHmmss.sql.gz (UTC)
function backupFileName(date) {
  const d = date || new Date();
  return 'vallorsoft-' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
    + '-' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + '.sql.gz';
}

// A fájlnévbe ágyazott időbélyeg (ms) vagy null — tesztelhető, oldal-hatás nélkül.
function fileTimestamp(name) {
  const m = /vallorsoft-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sql\.gz$/.exec(name || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function isExpired(name, now, retentionDays) {
  const ts = fileTimestamp(name);
  if (ts == null) return false;
  return (now - ts) > retentionDays * 86400000;
}

// A DATABASE_URL-t PG* env-re bontja (a jelszó nem megy a parancssorba).
function pgEnvFromUrl(databaseUrl, baseEnv) {
  const env = Object.assign({}, baseEnv || {});
  try {
    const u = new URL(databaseUrl);
    env.PGHOST = u.hostname;
    env.PGPORT = u.port || '5432';
    if (u.username) env.PGUSER = decodeURIComponent(u.username);
    if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
    const db = u.pathname.replace(/^\//, '');
    if (db) env.PGDATABASE = db;
    const ssl = u.searchParams.get('sslmode');
    if (ssl) env.PGSSLMODE = ssl;
  } catch (e) { /* hibás URL → pg_dump úgyis hibázik, naplózzuk lentebb */ }
  return env;
}

function pruneOldBackups(dir) {
  const days = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 14;
  const now = Date.now();
  let files;
  try { files = fs.readdirSync(dir); } catch (e) { return 0; }
  let removed = 0;
  files.forEach((f) => {
    if (isExpired(f, now, days)) {
      try { fs.unlinkSync(path.join(dir, f)); removed++; } catch (e) { /* másik futás törölhette */ }
    }
  });
  return removed;
}

function runBackupOnce() {
  return new Promise((resolve) => {
    const dir = process.env.BACKUP_DIR;
    if (!dir || !process.env.DATABASE_URL) { resolve({ ok: false, err: 'no-config' }); return; }
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* lehet hogy már létezik */ }
    const file = path.join(dir, backupFileName());
    const env = pgEnvFromUrl(process.env.DATABASE_URL, process.env);
    // A pg_dump a PG* env-ből kapja a kapcsolatot; a kimenet gzip-elve a fájlba.
    exec('pg_dump | gzip > "' + file + '"', { shell: '/bin/bash', env: env, maxBuffer: 4 * 1024 * 1024 }, (err) => {
      if (err) { log.error('backup-failed', { err: err.message }); resolve({ ok: false, err: err.message }); return; }
      log.info('backup-done', { file: file });
      const removed = pruneOldBackups(dir);
      resolve({ ok: true, file: file, pruned: removed });
    });
  });
}

function startBackupScheduler() {
  if (String(process.env.BACKUP_ENABLED).toLowerCase() !== 'true' || !process.env.BACKUP_DIR) {
    return false; // alapból KI
  }
  const hours = parseInt(process.env.BACKUP_INTERVAL_HOURS, 10) || 24;
  log.info('backup-scheduler-start', { dir: process.env.BACKUP_DIR, intervalHours: hours });
  runBackupOnce();
  const timer = setInterval(runBackupOnce, hours * 3600 * 1000);
  if (timer.unref) timer.unref();
  return true;
}

module.exports = {
  backupFileName, fileTimestamp, isExpired, pgEnvFromUrl,
  pruneOldBackups, runBackupOnce, startBackupScheduler,
};
