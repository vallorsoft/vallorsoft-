// ============================================================
//  VallorSoft — services/companyRestore.js
//  Biztonsági mentés visszaállítása gombnyomásra.
//
//  Elv (biztonságos alap): a visszaállítás NEM töröl és NEM ír felül
//  semmit. Csak azokat a sorokat hozza vissza, amelyek a mentésben
//  megvannak, de az adatbázisból hiányoznak (pl. támadás / véletlen
//  törlés után). Ezért többször is lefuttatható, és a mentés óta
//  keletkezett új adatot nem érinti.
//
//  Folyamat: 1) a mentés-fájl letöltése a Drive-ról → 2) teljes
//  visszafejtés + hitelesség-ellenőrzés (GCM-tag) ÍRÁS NÉLKÜL, közben
//  táblánként a hiányzó sorok kigyűjtése helyi átmeneti fájlokba →
//  3) előnézet → 4) megerősítés után beszúrás a külső kulcsok szerinti
//  sorrendben (szülő tábla előbb), ON CONFLICT DO NOTHING.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const pool = require('../db');
const log = require('../lib/logger');
const drive = require('../lib/googleDrive');
const { readFile, companyKey } = require('../lib/backupFile');
const backup = require('./companyBackup');

// Ezeket sosem állítjuk vissza: a cég-sor (ha az admin bent van, létezik),
// a rendszer-könyvelés és a mentés saját naplói.
const NO_RESTORE = new Set(['companies', 'session', 'schema_migrations', 'scheduler_leader',
  'company_backup_runs', 'company_backup_restores']);
const ID_CHUNK = 5000;
const INSERT_BATCH = 100;
const STALE_MIN = 120;

function qi(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }

// ---- Tiszta segédek (tesztelhetők) ----

// Külső kulcsok szerinti sorrend: a szülő tábla a gyerek elé kerül.
// Körkörös függőségnél a maradékot eredeti sorrendben a végére tesszük.
function topoOrder(tables, edges) {
  const set = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  (edges || []).forEach((e) => {
    if (set.has(e.child) && set.has(e.parent) && e.child !== e.parent) deps.get(e.child).add(e.parent);
  });
  const out = [];
  const done = new Set();
  let progress = true;
  while (out.length < tables.length && progress) {
    progress = false;
    for (const t of tables) {
      if (done.has(t)) continue;
      if ([...deps.get(t)].every((p) => done.has(p))) { out.push(t); done.add(t); progress = true; }
    }
  }
  tables.forEach((t) => { if (!done.has(t)) out.push(t); });
  return out;
}

// Mentésből jövő érték → beszúrható paraméter a cél-oszlop típusa szerint.
function toParam(value, dataType) {
  if (value === null || value === undefined) return null;
  if (value && typeof value === 'object' && typeof value.$b64 === 'string') {
    return dataType === 'bytea' ? Buffer.from(value.$b64, 'base64') : value.$b64;
  }
  if (dataType === 'json' || dataType === 'jsonb') return JSON.stringify(value);
  return value;
}

// Egy sor visszaállítható-e ehhez a céghez (védőháló a fájl hitelessége mellett).
function rowBelongs(row, scope, cid) {
  if (scope === 'company') return row && String(row.company_id) === String(cid);
  return true; // 'order' / 'driver' hatókör: a fájl a cég saját kulcsával hitelesített
}

// ---- Adatbázis-segédek ----
async function columnTypes(table) {
  const r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`, [table]);
  const m = {};
  r.rows.forEach((x) => { m[x.column_name] = x.data_type; });
  return m;
}

async function fkEdges() {
  const r = await pool.query(
    `SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
  return r.rows;
}

async function existingIds(table, ids) {
  const have = new Set();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const r = await pool.query(`SELECT id::text AS id FROM ${qi(table)} WHERE id::text = ANY($1::text[])`, [chunk]);
    r.rows.forEach((x) => have.add(x.id));
  }
  return have;
}

// ---- Fájl beszerzése ----
async function fetchRunFile(cid, run, source, destPath) {
  let conn, fileId;
  if (source === 'vs') {
    conn = await backup.getVsDrive();
    fileId = run.vs_file_id;
  } else {
    conn = await backup.getCompanyDrive(cid);
    fileId = run.drive_file_id;
  }
  if (!conn) throw new Error(source === 'vs' ? 'Drive-ul VallorSoft nu este conectat' : 'Google Drive-ul firmei nu este conectat');
  if (!fileId) throw new Error('Copia de backup nu mai există pe această sursă');
  const token = await drive.accessToken(conn.refreshToken);
  await drive.downloadFile(token, fileId, destPath);
}

// ---- 1. kör: ellenőrzés + előnézet (írás nélkül) ----
// Visszaad: { meta, preview, specs } ; a hiányzó sorokat táblánként NDJSON-ba írja a workDir-be.
async function analyze(cid, filePath, workDir) {
  let meta = null, endSeen = false;
  const scopes = {};
  const ids = {};       // tábla → [id…] a mentésből
  const counts = {};
  await readFile(filePath, companyKey(cid), (line) => {
    if (line.type === 'meta') { meta = line; (line.tables || []).forEach((t) => { scopes[t.table] = t.scope; }); return; }
    if (line.type === 'end') { endSeen = true; return; }
    if (!line.t || NO_RESTORE.has(line.t) || !line.r) return;
    counts[line.t] = (counts[line.t] || 0) + 1;
    if (line.r.id === undefined || line.r.id === null) return;
    if (!rowBelongs(line.r, scopes[line.t], cid)) return;
    (ids[line.t] = ids[line.t] || []).push(String(line.r.id));
  });
  if (!meta || Number(meta.company_id) !== Number(cid)) throw new Error('Backup-ul nu aparține acestei firme');
  if (!endSeen) throw new Error('Fișierul de backup este incomplet');

  const tables = [];
  const missing = {};
  let totalMissing = 0;
  for (const table of Object.keys(counts).sort()) {
    const entry = { table, backup_rows: counts[table], missing: 0, skipped: false };
    if (!ids[table]) { entry.skipped = true; tables.push(entry); continue; } // nincs id → nem összevethető
    let have;
    try { have = await existingIds(table, ids[table]); }
    catch (e) { entry.skipped = true; entry.error = 'tabel inexistent'; tables.push(entry); continue; }
    const miss = new Set(ids[table].filter((id) => !have.has(id)));
    entry.missing = miss.size;
    if (miss.size) { missing[table] = miss; totalMissing += miss.size; }
    tables.push(entry);
  }

  // A hiányzó sorok kiírása táblánkénti átmeneti fájlokba (a 2. körhöz).
  if (totalMissing) {
    const streams = {};
    await readFile(filePath, companyKey(cid), (line) => {
      if (!line.t || !missing[line.t] || !line.r || line.r.id === undefined) return;
      if (!missing[line.t].has(String(line.r.id))) return;
      if (!streams[line.t]) streams[line.t] = fs.createWriteStream(path.join(workDir, line.t + '.ndjson'));
      streams[line.t].write(JSON.stringify(line.r) + '\n');
    });
    await Promise.all(Object.values(streams).map((s) => new Promise((res) => s.end(res))));
  }

  return {
    meta,
    preview: {
      backup_created_at: meta.created_at, total_missing: totalMissing,
      tables: tables.filter((t) => t.missing > 0 || t.skipped).sort((a, b) => b.missing - a.missing),
      tables_checked: tables.length,
    },
    missingTables: Object.keys(missing),
  };
}

// ---- 2. kör: beszúrás ----
async function insertBatch(table, cols, types, rows) {
  const params = [];
  const values = rows.map((row) => '(' + cols.map((c) => { params.push(toParam(row[c], types[c])); return '$' + params.length; }).join(',') + ')');
  const sql = `INSERT INTO ${qi(table)} (${cols.map(qi).join(',')}) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`;
  const r = await pool.query(sql, params);
  return r.rowCount || 0;
}

async function restoreTable(table, filePath) {
  const types = await columnTypes(table);
  let inserted = 0, failed = 0;
  const flush = async (rows) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]).filter((c) => types[c]);
    try { inserted += await insertBatch(table, cols, types, rows); }
    catch (e) {
      // A köteg hibás (pl. hiányzó szülő) → soronként, hogy a többi bekerüljön.
      for (const row of rows) {
        const rc = Object.keys(row).filter((c) => types[c]);
        try { inserted += await insertBatch(table, rc, types, [row]); } catch (_) { failed++; }
      }
    }
  };
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let batch = [];
  for await (const line of rl) {
    if (!line) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= INSERT_BATCH) { await flush(batch); batch = []; }
  }
  await flush(batch);
  return { inserted, failed };
}

async function restoreMissing(workDir, tables) {
  const order = topoOrder(tables, await fkEdges().catch(() => []));
  const result = { tables: {}, inserted: 0, failed: 0 };
  for (const t of order) {
    const r = await restoreTable(t, path.join(workDir, t + '.ndjson'));
    result.tables[t] = r;
  }
  // Második menet a hibás táblákra (a szülő azóta bekerülhetett).
  for (const t of order) {
    if (result.tables[t].failed > 0) {
      const r2 = await restoreTable(t, path.join(workDir, t + '.ndjson'));
      result.tables[t] = { inserted: result.tables[t].inserted + r2.inserted, failed: r2.failed };
    }
  }
  Object.values(result.tables).forEach((r) => { result.inserted += r.inserted; result.failed += r.failed; });
  return result;
}

// ---- Feladatok (aszinkron, a kérés nem várja meg) ----
async function setJob(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE company_backup_restores SET ${sets}, updated_at = now() WHERE id = $1`,
    [id].concat(keys.map((k) => (k === 'preview' || k === 'result') ? JSON.stringify(fields[k]) : fields[k])));
}

function workDirFor(jobId) { return fs.mkdtempSync(path.join(os.tmpdir(), 'vsrestore-' + jobId + '-')); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }

async function loadRun(cid, runId) {
  const r = await pool.query('SELECT * FROM company_backup_runs WHERE id=$1 AND company_id=$2', [runId, cid]);
  return r.rows[0] || null;
}

// Van-e folyamatban lévő feladat (az elakadtakat lezárjuk).
async function activeJob(cid) {
  await pool.query(
    `UPDATE company_backup_restores SET status='error', error='Întrerupt (timeout)', updated_at=now()
      WHERE company_id=$1 AND status IN ('analyzing','restoring') AND updated_at < now() - ($2 || ' minutes')::interval`,
    [cid, String(STALE_MIN)]);
  const r = await pool.query(
    `SELECT id FROM company_backup_restores WHERE company_id=$1 AND status IN ('analyzing','restoring') LIMIT 1`, [cid]);
  return r.rows[0] || null;
}

async function runAnalyze(jobId, cid, run, source) {
  const dir = workDirFor(jobId);
  try {
    const file = path.join(dir, 'backup.vsbk');
    await fetchRunFile(cid, run, source, file);
    const { preview } = await analyze(cid, file, dir);
    await setJob(jobId, { status: 'preview_ready', preview });
  } catch (e) {
    log.warn('restore: előnézet hiba', { company_id: cid, job: jobId, err: e.message });
    await setJob(jobId, { status: 'error', error: String(e.message).slice(0, 500) }).catch(() => {});
  } finally { cleanup(dir); }
}

async function runRestore(jobId, cid, run, source) {
  const dir = workDirFor(jobId);
  try {
    const file = path.join(dir, 'backup.vsbk');
    await fetchRunFile(cid, run, source, file);
    const { preview, missingTables } = await analyze(cid, file, dir); // újra-ellenőrzés a friss állapotra
    const result = missingTables.length ? await restoreMissing(dir, missingTables) : { tables: {}, inserted: 0, failed: 0 };
    result.expected = preview.total_missing;
    await setJob(jobId, { status: 'done', result });
    log.info('restore: kész', { company_id: cid, job: jobId, inserted: result.inserted, failed: result.failed });
  } catch (e) {
    log.warn('restore: hiba', { company_id: cid, job: jobId, err: e.message });
    await setJob(jobId, { status: 'error', error: String(e.message).slice(0, 500) }).catch(() => {});
  } finally { cleanup(dir); }
}

module.exports = {
  NO_RESTORE, topoOrder, toParam, rowBelongs, analyze, restoreMissing,
  loadRun, activeJob, runAnalyze, runRestore,
};
