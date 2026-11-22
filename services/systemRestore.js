// ============================================================
//  VallorSoft — services/systemRestore.js
//  A teljes rendszer visszaállítása a Cloudflare R2-n lévő mentésekből
//  (services/systemBackup): a legutóbbi (vagy egy adott időpont előtti) teljes
//  mentés pg_restore-ral, majd az utána következő változás-mentések sorban.
//  Az adatbázis teljes elvesztése után is működik: a láncot az R2-n lévő
//  .json leírókból rakja össze. Parancssor: scripts/system-restore.js
// ============================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const { Pool } = require('pg');
const r2 = require('../lib/r2');
const { readFile, systemKey } = require('../lib/backupFile');
const { pgEnvFromUrl } = require('./backup');
const { DB_MAGIC, DB_VERSION, directUrl, tableInfo } = require('./systemBackup');
const { topoOrder, toParam } = require('./companyRestore');

function qi(n) { return '"' + String(n).replace(/"/g, '""') + '"'; }

// ── A mentés-lánc az R2-ről ─────────────────────────────────
async function listBackups() {
  const objs = await r2.listObjects('system/');
  const out = [];
  for (const o of objs.filter((x) => x.key.endsWith('.json'))) {
    try {
      const res = await r2.getObject(o.key);
      const m = JSON.parse(await res.text());
      if (m && m.key && (m.kind === 'full' || m.kind === 'delta')) out.push(m);
    } catch (_) { /* sérült leíró → kihagyjuk */ }
  }
  out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return out;
}

// Mi kell egy adott időponthoz: a legutóbbi teljes + az arra épülő változások.
function planRestore(list, at) {
  const limit = at ? new Date(at).toISOString() : '9999';
  const fulls = list.filter((m) => m.kind === 'full' && m.created_at <= limit);
  const full = fulls[fulls.length - 1];
  if (!full) return null;
  const deltas = list.filter((m) => m.kind === 'delta' && m.base_key === full.key && m.created_at <= limit);
  return { full, deltas };
}

async function download(key, dest) {
  const res = await r2.getObject(key);
  const out = fs.createWriteStream(dest);
  Readable.fromWeb(res.body).pipe(out);
  await finished(out);
  return fs.statSync(dest).size;
}

// VSDB (titkosított pg_dump) → nyers .dump fájl. A GCM-tag hitelesít.
async function decryptDump(src, dest) {
  const st = fs.statSync(src);
  const head = Buffer.alloc(17), tag = Buffer.alloc(16);
  const fd = fs.openSync(src, 'r');
  try { fs.readSync(fd, head, 0, 17, 0); fs.readSync(fd, tag, 0, 16, st.size - 16); } finally { fs.closeSync(fd); }
  if (!head.subarray(0, 4).equals(DB_MAGIC) || head[4] !== DB_VERSION) throw new Error('Nem VallorSoft rendszer-mentés (VSDB)');
  const dec = crypto.createDecipheriv('aes-256-gcm', systemKey(), head.subarray(5, 17));
  dec.setAuthTag(tag);
  const out = fs.createWriteStream(dest);
  fs.createReadStream(src, { start: 17, end: st.size - 17 }).pipe(dec).pipe(out);
  await finished(out);
}

function runPgRestore(dumpFile, targetUrl, log) {
  return new Promise((ok, ko) => {
    const env = pgEnvFromUrl(directUrl(targetUrl), process.env);
    const args = ['--no-owner', '--no-privileges', '--clean', '--if-exists', '-d', env.PGDATABASE || 'postgres', dumpFile];
    const p = spawn(process.env.PG_RESTORE_BIN || 'pg_restore', args, { env });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-6000); });
    p.on('error', ko);
    p.on('close', (code) => {
      // a pg_restore figyelmeztetései (pl. hiányzó kiterjesztés-komment) nem végzetesek
      if (code !== 0 && !/warning: errors ignored on restore/i.test(err)) return ko(new Error('pg_restore hiba: ' + err.slice(-1500)));
      if (err && log) log('pg_restore üzenetek: ' + err.slice(-800));
      ok();
    });
  });
}

// ── Egy változás-mentés alkalmazása ─────────────────────────
async function columnsOf(db) {
  const r = await db.query(
    `SELECT table_name, column_name, data_type, is_generated, is_identity, identity_generation
       FROM information_schema.columns WHERE table_schema = 'public'`);
  const out = {};
  r.rows.forEach((c) => {
    if (c.is_generated === 'ALWAYS') return;
    (out[c.table_name] = out[c.table_name] || {})[c.column_name] = c.data_type;
  });
  return out;
}
async function fkEdgesOf(db) {
  const r = await db.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
  return r.rows;
}

async function applyDelta(db, file, log) {
  // 1) hitelesség-ellenőrzés írás nélkül (a GCM-tag a fájl végén van)
  let meta = null, end = null;
  await readFile(file, systemKey(), (l) => { if (l.type === 'meta') meta = l; if (l.type === 'end') end = l; });
  if (!meta || !end) throw new Error('Hiányos változás-mentés');
  // 2) táblánként átmeneti fájlokba (a külső kulcsok miatti sorrendhez)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-sysrestore-'));
  const ups = {}, dels = {}, truncs = [], repls = [];
  const streams = {};
  const ws = (name) => streams[name] || (streams[name] = fs.createWriteStream(path.join(dir, name)));
  await readFile(file, systemKey(), (l) => {
    if (l.trunc) { truncs.push(l.trunc); return; }
    if (l.repl) { repls.push(l.repl); return; }
    if (l.t && l.r) { ups[l.t] = (ups[l.t] || 0) + 1; ws('u_' + l.t).write(JSON.stringify(l.r) + '\n'); }
    else if (l.t && l.d) { dels[l.t] = (dels[l.t] || 0) + 1; ws('d_' + l.t).write(JSON.stringify(l.d) + '\n'); }
  });
  await Promise.all(Object.values(streams).map((s) => new Promise((ok) => s.end(ok))));
  const cols = await columnsOf(db);
  const pkOf = {};
  (await tableInfo(db)).forEach((t) => { pkOf[t.tbl] = t.pk; });
  const order = topoOrder([...new Set([...Object.keys(ups), ...Object.keys(dels), ...repls])], await fkEdgesOf(db));
  const lines = async function* (name) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) return;
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) if (line) yield JSON.parse(line);
  };
  let n = 0;
  try {
    await db.query('BEGIN');
    const tr = truncs.filter((t) => cols[t]);
    if (tr.length) {
      // ahogy az eredeti: CASCADE nélkül; ha más tábla hivatkozik rá, akkor CASCADE-del
      await db.query('SAVEPOINT trunc');
      try { await db.query('TRUNCATE ' + tr.map(qi).join(', ')); }
      catch (_) { await db.query('ROLLBACK TO SAVEPOINT trunc'); await db.query('TRUNCATE ' + tr.map(qi).join(', ') + ' CASCADE'); }
    }
    for (const t of repls) if (cols[t]) await db.query('DELETE FROM ' + qi(t));
    for (const t of order) {
      const tc = cols[t];
      if (!tc) { if (log) log('kihagyva (nincs ilyen tábla): ' + t); continue; }
      const pk = pkOf[t] || [];
      for await (const row of lines('u_' + t)) {
        const c = Object.keys(row).filter((k) => tc[k] !== undefined);
        const vals = c.map((k) => toParam(row[k], tc[k]));
        const set = c.filter((k) => !pk.includes(k));
        const conflict = pk.length && !repls.includes(t)
          ? ' ON CONFLICT (' + pk.map(qi).join(',') + ') DO ' + (set.length ? 'UPDATE SET ' + set.map((k) => qi(k) + '=EXCLUDED.' + qi(k)).join(',') : 'NOTHING')
          : '';
        await db.query('INSERT INTO ' + qi(t) + ' (' + c.map(qi).join(',') + ') OVERRIDING SYSTEM VALUE VALUES (' +
          c.map((_, i) => '$' + (i + 1)).join(',') + ')' + conflict, vals);
        n++;
      }
    }
    for (const t of order.slice().reverse()) {
      const pk = pkOf[t] || [];
      if (!cols[t] || !pk.length) continue;
      for await (const k of lines('d_' + t)) {
        await db.query('DELETE FROM ' + qi(t) + ' WHERE ' + pk.map((c, i) => qi(c) + '::text = $' + (i + 1)).join(' AND '),
          pk.map((c) => (k[c] == null ? null : String(k[c]))));
        n++;
      }
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { rows: n, created_at: meta.created_at };
}

// A sorozatok (SERIAL) a visszaállított legnagyobb értékre.
async function resetSequences(db) {
  const r = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`);
  for (const c of r.rows) {
    await db.query(
      `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${qi(c.column_name)}) FROM ${qi(c.table_name)}), 1),
              (SELECT MAX(${qi(c.column_name)}) FROM ${qi(c.table_name)}) IS NOT NULL)`,
      ['public.' + c.table_name, c.column_name]).catch(() => {});
  }
  return r.rows.length;
}

// A teljes visszaállítás. opts: { targetUrl, at?, log? }
async function restore(opts) {
  const log = opts.log || (() => {});
  if (!r2.configured()) throw new Error('Cloudflare R2 nincs beállítva');
  const list = await listBackups();
  const plan = planRestore(list, opts.at);
  if (!plan) throw new Error('Nincs teljes mentés' + (opts.at ? ' ' + opts.at + ' előtt' : ''));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-sysrestore-'));
  try {
    log('Teljes mentés: ' + plan.full.key + ' (' + plan.full.created_at + ')');
    const enc = path.join(dir, 'full.vsdb'), dump = path.join(dir, 'full.dump');
    await download(plan.full.key, enc);
    await decryptDump(enc, dump);
    fs.unlinkSync(enc);
    await runPgRestore(dump, opts.targetUrl, log);
    fs.unlinkSync(dump);
    const db = new Pool({ connectionString: opts.targetUrl, ssl: /sslmode=require|neon\.tech/.test(opts.targetUrl) ? { rejectUnauthorized: false } : undefined, max: 1 });
    const client = await db.connect();
    let applied = 0, rows = 0;
    try {
      for (const d of plan.deltas) {
        const f = path.join(dir, 'delta.vsbk');
        await download(d.key, f);
        const r = await applyDelta(client, f, log);
        fs.unlinkSync(f);
        applied++; rows += r.rows;
        log('Változás-mentés alkalmazva: ' + d.created_at + ' (' + r.rows + ' sor)');
      }
      await resetSequences(client);
      await client.query('TRUNCATE sys_change_log').catch(() => {});
    } finally { client.release(); await db.end(); }
    return { full: plan.full.created_at, deltas: applied, rows, restored_to: (plan.deltas[plan.deltas.length - 1] || plan.full).created_at };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { listBackups, planRestore, decryptDump, applyDelta, resetSequences, restore };
