// ============================================================
//  VallorSoft — handlers/backup.js
//  Cégenkénti Google Drive biztonsági mentés — beállítások + napló.
//  Cég-oldal: csak Admin (a saját cégére). Developer-oldal: is_dev.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');
const drive = require('../lib/googleDrive');
const backup = require('../services/companyBackup');
const { featureEnabled } = require('../lib/featureEnabled');
const restore = require('../services/companyRestore');

const handlers = {};
const MANUAL_COOLDOWN_MIN = 15;

function deny(res, err) { return res.json({ result: { ok: false, err: err || 'Acces interzis' } }); }
function isAdmin(req) { return !!(req.session.user && req.session.user.pozicio === 'Admin'); }

function runRow(r) {
  return {
    id: r.id, trigger: r.trigger, kind: r.kind, status: r.status,
    started_at: r.started_at, finished_at: r.finished_at, size_bytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    row_count: r.row_count, drive_status: r.drive_status, vs_status: r.vs_status,
    error: r.error ? String(r.error).slice(0, 300) : null,
    has_drive_copy: !!r.drive_file_id, has_vs_copy: !!r.vs_file_id,
  };
}

handlers.backupGetStatus = async function (req, res) {
  try {
    if (!isAdmin(req)) return deny(res);
    const cid = req.session.user.company_id;
    const feature = await featureEnabled(cid, 'drive-backup');
    const integ = await pool.query(
      `SELECT status, status_message, meta, credentials_enc IS NOT NULL AS connected
         FROM company_integrations WHERE company_id=$1 AND provider='gdrive_backup'`, [cid]);
    const settings = await backup.getSettings(cid);
    const runs = await pool.query(
      `SELECT * FROM company_backup_runs WHERE company_id=$1 ORDER BY started_at DESC LIMIT 15`, [cid]).catch(() => ({ rows: [] }));
    const vs = await backup.getVsDrive().catch(() => null);
    const i = integ.rows[0];
    return res.json({ result: {
      ok: true, feature, configured: drive.isConfigured(),
      connected: !!(i && i.connected), email: i && i.meta ? i.meta.email || null : null,
      status: i ? i.status : null, status_message: i ? i.status_message : null,
      enabled: settings.enabled !== false, run_hour: Number(settings.run_hour), drive_retention: settings.drive_retention,
      retention_options: backup.RETENTION_OPTIONS, vs_copy: !!vs, vs_retention_days: backup.VS_RETENTION_DAYS,
      running: backup.isRunning(cid), folder_name: backup.COMPANY_FOLDER,
      runs: runs.rows.map(runRow),
    } });
  } catch (e) {
    console.error('backupGetStatus hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

handlers.backupSaveSettings = async function (req, res, args) {
  try {
    if (!isAdmin(req)) return deny(res);
    const cid = req.session.user.company_id;
    if (!(await featureEnabled(cid, 'drive-backup'))) return deny(res, 'Funcție indisponibilă');
    const f = (args && args[0]) || {};
    const hour = parseInt(f.run_hour, 10);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return deny(res, 'Ora invalidă');
    const ret = String(f.drive_retention || 'forever');
    if (backup.RETENTION_OPTIONS.indexOf(ret) === -1) return deny(res, 'Perioadă de păstrare invalidă');
    const enabled = f.enabled !== false;
    await pool.query(
      `INSERT INTO company_backup_settings (company_id, enabled, run_hour, drive_retention, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (company_id) DO UPDATE SET enabled=EXCLUDED.enabled, run_hour=EXCLUDED.run_hour,
         drive_retention=EXCLUDED.drive_retention, updated_at=now()`, [cid, enabled, hour, ret]);
    audit.fromReq(req, 'backup.settings_save', 'company_backup_settings', cid, { enabled, run_hour: hour, drive_retention: ret });
    return res.json({ result: { ok: true } });
  } catch (e) {
    console.error('backupSaveSettings hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

// Kapcsolat bontása: a token visszavonva + törölve. A Drive-on lévő mentések MEGMARADNAK.
handlers.backupDisconnect = async function (req, res) {
  try {
    if (!isAdmin(req)) return deny(res);
    const cid = req.session.user.company_id;
    const cur = await backup.getCompanyDrive(cid).catch(() => null);
    if (cur) await drive.revoke(cur.refreshToken);
    await pool.query(`DELETE FROM company_integrations WHERE company_id=$1 AND provider='gdrive_backup'`, [cid]);
    audit.fromReq(req, 'backup.drive_disconnect', 'company_integration', 'gdrive_backup', {});
    return res.json({ result: { ok: true } });
  } catch (e) {
    console.error('backupDisconnect hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

// Azonnali mentés (háttérben fut, a kérés nem várja meg).
handlers.backupRunNow = async function (req, res) {
  try {
    if (!isAdmin(req)) return deny(res);
    const cid = req.session.user.company_id;
    if (!(await featureEnabled(cid, 'drive-backup'))) return deny(res, 'Funcție indisponibilă');
    if (!drive.isConfigured()) return deny(res, 'Integrarea Google Drive nu este configurată');
    if (backup.isRunning(cid)) return deny(res, 'Un backup este deja în curs');
    const conn = await backup.getCompanyDrive(cid).catch(() => null);
    if (!conn) return deny(res, 'Conectați mai întâi Google Drive');
    const recent = await pool.query(
      `SELECT 1 FROM company_backup_runs WHERE company_id=$1 AND trigger='manual'
         AND started_at > now() - ($2 || ' minutes')::interval LIMIT 1`, [cid, String(MANUAL_COOLDOWN_MIN)]);
    if (recent.rows.length) return deny(res, 'Ultimul backup manual a fost recent — încercați peste ' + MANUAL_COOLDOWN_MIN + ' minute');
    audit.fromReq(req, 'backup.run_manual', 'company', cid, {});
    backup.runCompanyBackup(cid, { trigger: 'manual' }).catch(() => {});
    return res.json({ result: { ok: true, started: true } });
  } catch (e) {
    console.error('backupRunNow hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

// ---- Visszaállítás (csak hiányzó/törölt sorok; nem töröl, nem ír felül) ----
const RESTORE_CONFIRM_WORD = 'RESTAURARE';

function jobRow(j) {
  return j ? { id: j.id, run_id: j.run_id, source: j.source, status: j.status, preview: j.preview || null,
    result: j.result || null, error: j.error || null, created_at: j.created_at, updated_at: j.updated_at } : null;
}

handlers.backupRestorePreview = async function (req, res, args) {
  try {
    if (!isAdmin(req)) return deny(res);
    const cid = req.session.user.company_id;
    if (!(await featureEnabled(cid, 'drive-backup'))) return deny(res, 'Funcție indisponibilă');
    const f = (args && args[0]) || {};
    const source = f.source === 'vs' ? 'vs' : 'company';
    const run = await restore.loadRun(cid, parseInt(f.run_id, 10));
    if (!run || run.status === 'running' || run.status === 'error') return deny(res, 'Backup inexistent sau incomplet');
    if (source === 'vs' ? !run.vs_file_id : !run.drive_file_id) return deny(res, 'Copia nu mai există pe această sursă');
    if (await restore.activeJob(cid)) return deny(res, 'O restaurare este deja în curs');
    const ins = await pool.query(
      `INSERT INTO company_backup_restores (company_id, run_id, source, status, requested_by)
       VALUES ($1,$2,$3,'analyzing',$4) RETURNING *`, [cid, run.id, source, req.session.user.id || null]);
    const job = ins.rows[0];
    audit.fromReq(req, 'backup.restore_preview', 'company_backup_runs', run.id, { source, job: job.id });
    restore.runAnalyze(job.id, cid, run, source).catch(() => {});
    return res.json({ result: { ok: true, job: jobRow(job) } });
  } catch (e) {
    console.error('backupRestorePreview hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

handlers.backupRestoreStatus = async function (req, res, args) {
  try {
    if (!isAdmin(req)) return deny(res);
    const cid = req.session.user.company_id;
    const f = (args && args[0]) || {};
    const jobId = parseInt(f.job_id, 10);
    const r = Number.isInteger(jobId)
      ? await pool.query('SELECT * FROM company_backup_restores WHERE id=$1 AND company_id=$2', [jobId, cid])
      : await pool.query('SELECT * FROM company_backup_restores WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1', [cid]);
    return res.json({ result: { ok: true, job: jobRow(r.rows[0]), confirm_word: RESTORE_CONFIRM_WORD } });
  } catch (e) {
    console.error('backupRestoreStatus hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

handlers.backupRestoreConfirm = async function (req, res, args) {
  try {
    if (!isAdmin(req)) return deny(res);
    const cid = req.session.user.company_id;
    if (!(await featureEnabled(cid, 'drive-backup'))) return deny(res, 'Funcție indisponibilă');
    const f = (args && args[0]) || {};
    if (String(f.confirm || '').trim().toUpperCase() !== RESTORE_CONFIRM_WORD) {
      return deny(res, 'Scrieți ' + RESTORE_CONFIRM_WORD + ' pentru confirmare');
    }
    const jobId = parseInt(f.job_id, 10);
    // Atomikus állapotváltás: csak a kész előnézetből indulhat, egyszer.
    const up = await pool.query(
      `UPDATE company_backup_restores SET status='restoring', updated_at=now()
        WHERE id=$1 AND company_id=$2 AND status='preview_ready' RETURNING *`, [jobId, cid]);
    if (!up.rows.length) return deny(res, 'Previzualizarea nu este gata sau a fost deja folosită');
    const job = up.rows[0];
    const run = await restore.loadRun(cid, job.run_id);
    if (!run) { await pool.query(`UPDATE company_backup_restores SET status='error', error='Backup inexistent' WHERE id=$1`, [job.id]); return deny(res, 'Backup inexistent'); }
    audit.fromReq(req, 'backup.restore_run', 'company_backup_runs', run.id,
      { source: job.source, job: job.id, expected: job.preview && job.preview.total_missing });
    restore.runRestore(job.id, cid, run, job.source).catch(() => {});
    return res.json({ result: { ok: true, job: jobRow(job) } });
  } catch (e) {
    console.error('backupRestoreConfirm hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

// ---- Developer: a VallorSoft saját Drive-ja + áttekintés ----
handlers.devBackupStatus = async function (req, res) {
  try {
    if (!req.session.user || !req.session.user.is_dev) return deny(res);
    const vs = await backup.getVsDrive().catch(() => null);
    const runs = await pool.query(
      `SELECT b.*, c.nev AS company_name FROM company_backup_runs b
         JOIN companies c ON c.id = b.company_id
        ORDER BY b.started_at DESC LIMIT 60`).catch(() => ({ rows: [] }));
    const connected = await pool.query(
      `SELECT COUNT(*)::int AS n FROM company_integrations WHERE provider='gdrive_backup' AND credentials_enc IS NOT NULL`)
      .catch(() => ({ rows: [{ n: 0 }] }));
    return res.json({ result: {
      ok: true, configured: drive.isConfigured(), redirect_uri: drive.redirectUri(),
      vs_connected: !!vs, vs_email: vs ? vs.value.email || null : null, vs_retention_days: backup.VS_RETENTION_DAYS,
      companies_connected: connected.rows[0].n,
      runs: runs.rows.map((r) => Object.assign(runRow(r), { company_id: r.company_id, company_name: r.company_name })),
    } });
  } catch (e) {
    console.error('devBackupStatus hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

handlers.devBackupVsDisconnect = async function (req, res) {
  try {
    if (!req.session.user || !req.session.user.is_dev) return deny(res);
    const vs = await backup.getVsDrive().catch(() => null);
    if (vs) await drive.revoke(vs.refreshToken);
    await pool.query(`DELETE FROM developer_settings WHERE key='backup_vs_drive'`);
    audit.fromReq(req, 'backup.vs_drive_disconnect', 'developer_settings', 'backup_vs_drive', {});
    return res.json({ result: { ok: true } });
  } catch (e) {
    console.error('devBackupVsDisconnect hiba:', e);
    return deny(res, 'Eroare de server');
  }
};

module.exports = handlers;
