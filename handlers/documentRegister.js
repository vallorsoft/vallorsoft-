// ============================================================
//  VallorSoft — handlers/documentRegister.js
//  Dokumentum-nyilvántartás (Registru documente) — RPC handlerek.
//
//  Általános célú dokumentum-sorszám nyilvántartás: a cég CSOPORTOKBA
//  (mappákba) szervezi a dokumentum-fajtáit, minden csoportnak saját
//  automatikus sorszámozása van (pl. FCT-2026-0001). Egy bejegyzés lehet
//  feltöltött dokumentummal VAGY dokumentum nélkül (foglalt sorszám).
//
//  Multi-tenant: MINDEN lekérdezés company_id-szűrt (session), paraméteres
//  SQL. Szerep-kapu: Admin | Manager (a Sofer NEM éri el). Minden írás
//  auditált. A sorszám-kiadás tranzakcióban, atomi számláló-növeléssel.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

const STATUSES = ['with_doc', 'reserved', 'void'];
const MAX_FILE_BYTES = 15 * 1024 * 1024; // ~15 MB base64 / fájl
const MAX_FILES_PER_CALL = 10;

function _user(req) { return (req && req.session && req.session.user) || null; }
function _am(req) { const u = _user(req); return !!(u && ['Admin', 'Manager'].includes(u.pozicio)); }
function _str(x, n) { const s = x == null ? '' : String(x).trim(); return s ? s.slice(0, n) : null; }
function _num(x) { if (x === '' || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }
function _int(x, def) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : (def == null ? null : def); }

// Fájlnév-tisztítás (control-karakterek kizárva; csak megjelenítés + letöltés).
function _sanitizeName(s) {
  const raw = String(s || '').trim().replace(/[\x00-\x1F\x7F]/g, '');
  return raw ? raw.slice(0, 300) : 'document';
}

// A csatolmány data URL-jéből kiszedi a MIME-típust (fallback octet-stream).
function _mimeOf(dataUrl) {
  const m = /^data:([^;,]+)[;,]/.exec(String(dataUrl || ''));
  return m ? m[1].slice(0, 100) : 'application/octet-stream';
}

// A csoport által meghatározott következő sorszám (atomi növelés).
// dbc = tranzakciós kliens. Visszaad: { reg_no, seq, year }.
async function _nextRegNo(dbc, cid, group) {
  const useYear = !!group.year_reset;
  const nowYear = new Date().getFullYear();
  const counterYear = useYear ? nowYear : 0;
  const r = await dbc.query(
    `INSERT INTO doc_register_counters (company_id, group_id, year, current_seq)
       VALUES ($1, $2, $3, 1)
     ON CONFLICT (company_id, group_id, year)
       DO UPDATE SET current_seq = doc_register_counters.current_seq + 1, updated_at = NOW()
     RETURNING current_seq`,
    [cid, group.id, counterYear]
  );
  const seq = r.rows[0].current_seq;
  const pad = Math.min(Math.max(_int(group.pad, 4), 1), 9);
  const parts = [];
  if (group.prefix) parts.push(String(group.prefix));
  if (useYear) parts.push(String(nowYear));
  parts.push(String(seq).padStart(pad, '0'));
  return { reg_no: parts.join('-'), seq, year: useYear ? nowYear : null };
}

// ─── Csoportok listája + statisztika ────────────────────────
handlers.docRegGroupList = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const r = await pool.query(
      `SELECT g.id, g.name, g.prefix, g.year_reset, g.pad, g.color, g.notes,
              COALESCE(e.cnt, 0)       AS entry_count,
              COALESCE(e.with_doc, 0)  AS with_doc_count,
              COALESCE(e.reserved, 0)  AS reserved_count,
              e.last_no, e.last_date
         FROM doc_register_groups g
         LEFT JOIN (
           SELECT group_id,
                  COUNT(*) AS cnt,
                  COUNT(*) FILTER (WHERE status = 'with_doc') AS with_doc,
                  COUNT(*) FILTER (WHERE status = 'reserved') AS reserved,
                  (ARRAY_AGG(reg_no ORDER BY id DESC))[1]     AS last_no,
                  MAX(entry_date)                              AS last_date
             FROM doc_register_entries
            WHERE company_id = $1
            GROUP BY group_id
         ) e ON e.group_id = g.id
        WHERE g.company_id = $1
        ORDER BY g.name ASC`,
      [cid]
    );
    return res.json({ result: { ok: true, groups: r.rows } });
  } catch (err) {
    console.error('docRegGroupList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Csoport létrehozás / módosítás ─────────────────────────
// args: [{ id?, name, prefix?, year_reset?, pad?, color?, notes? }]
handlers.docRegGroupSave = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = a.id != null && a.id !== '' ? _int(a.id) : null;
    const name = _str(a.name, 120);
    if (!name) return res.json({ result: { ok: false, err: 'Numele dosarului este obligatoriu.' } });
    const prefix = a.prefix == null ? '' : String(a.prefix).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    const yearReset = a.year_reset == null ? true : !!a.year_reset;
    const pad = Math.min(Math.max(_int(a.pad, 4), 1), 9);
    const color = _str(a.color, 9);
    const notes = _str(a.notes, 2000);

    // Egyediség a cégen belül (átnevezésnél a saját sort kihagyva).
    const dup = await pool.query(
      `SELECT 1 FROM doc_register_groups WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND ($3::int IS NULL OR id <> $3)`,
      [cid, name, id]
    );
    if (dup.rows.length) return res.json({ result: { ok: false, err: 'Există deja un dosar cu acest nume.' } });

    let outId = id;
    if (id) {
      const upd = await pool.query(
        `UPDATE doc_register_groups
            SET name = $1, prefix = $2, year_reset = $3, pad = $4, color = $5, notes = $6, updated_at = NOW()
          WHERE id = $7 AND company_id = $8`,
        [name, prefix, yearReset, pad, color, notes, id, cid]
      );
      if (!upd.rowCount) return res.json({ result: { ok: false, err: 'Dosarul nu a fost găsit.' } });
    } else {
      const ins = await pool.query(
        `INSERT INTO doc_register_groups (company_id, name, prefix, year_reset, pad, color, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [cid, name, prefix, yearReset, pad, color, notes, (_user(req).email || null)]
      );
      outId = ins.rows[0].id;
    }
    try { await audit.fromReq(req, id ? 'doc_register.group_update' : 'doc_register.group_create', 'doc_register_groups', outId, { name, prefix }); } catch (_) {}
    return res.json({ result: { ok: true, id: outId } });
  } catch (err) {
    console.error('docRegGroupSave hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Csoport törlés (a bejegyzések + fájlok CASCADE) ────────
// args: [{ id }] vagy [id]
handlers.docRegGroupDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = _int(a.id != null ? a.id : a);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    const del = await pool.query('DELETE FROM doc_register_groups WHERE id = $1 AND company_id = $2', [id, cid]);
    if (!del.rowCount) return res.json({ result: { ok: false, err: 'Dosarul nu a fost găsit.' } });
    try { await audit.fromReq(req, 'doc_register.group_delete', 'doc_register_groups', id, {}); } catch (_) {}
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('docRegGroupDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Bejegyzések listája egy csoportban (szűrők) ────────────
// args: [{ group_id, q?, from?, to?, status? }]
handlers.docRegEntryList = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const gid = _int(a.group_id);
    if (!Number.isFinite(gid)) return res.json({ result: { ok: false, err: 'Dosar invalid.' } });

    const params = [cid, gid];
    let sql =
      `SELECT e.id, e.reg_no, e.seq, e.year, e.entry_date, e.title, e.partner,
              e.amount, e.currency, e.notes, e.status, e.created_by, e.created_at,
              COALESCE(f.cnt, 0) AS file_count
         FROM doc_register_entries e
         LEFT JOIN (
           SELECT entry_id, COUNT(*) AS cnt FROM doc_register_files GROUP BY entry_id
         ) f ON f.entry_id = e.id
        WHERE e.company_id = $1 AND e.group_id = $2`;
    if (a.status && STATUSES.includes(a.status)) { params.push(a.status); sql += ` AND e.status = $${params.length}`; }
    if (a.from) { params.push(a.from); sql += ` AND e.entry_date >= $${params.length}`; }
    if (a.to)   { params.push(a.to);   sql += ` AND e.entry_date <= $${params.length}`; }
    if (a.q) {
      params.push('%' + String(a.q).trim() + '%');
      sql += ` AND (e.reg_no ILIKE $${params.length} OR COALESCE(e.title,'') ILIKE $${params.length} OR COALESCE(e.partner,'') ILIKE $${params.length} OR COALESCE(e.notes,'') ILIKE $${params.length})`;
    }
    sql += ' ORDER BY e.id DESC LIMIT 1000';
    const r = await pool.query(sql, params);
    return res.json({ result: { ok: true, entries: r.rows } });
  } catch (err) {
    console.error('docRegEntryList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Belső: fájlok beszúrása egy bejegyzéshez (tranzakciós kliensen).
async function _insertFiles(dbc, cid, entryId, files, uploader) {
  let n = 0;
  const arr = Array.isArray(files) ? files.slice(0, MAX_FILES_PER_CALL) : [];
  for (const f of arr) {
    let b64 = String((f && f.base64) || '');
    if (!b64) continue;
    if (b64.indexOf('data:') !== 0) b64 = 'data:application/octet-stream;base64,' + b64;
    if (b64.length > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    const name = _sanitizeName(f.file_name);
    await dbc.query(
      `INSERT INTO doc_register_files (company_id, entry_id, file_name, mime, data_base64, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [cid, entryId, name, _mimeOf(b64), b64, b64.length, uploader]
    );
    n++;
  }
  return n;
}

// ─── Bejegyzés létrehozása (sorszám kiadása) ────────────────
// args: [{ group_id, entry_date?, title?, partner?, amount?, currency?, notes?,
//          manual_no?, files?:[{file_name, base64}] }]
//  - manual_no megadva → azt használjuk (kézi/külső szám), a számláló NEM nő.
//  - files megadva → status='with_doc', különben 'reserved' (foglalt szám).
handlers.docRegEntryCreate = async function (req, res, args) {
  let dbc = null;
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const email = _user(req).email || null;
    const a = (args && args[0]) || {};
    const gid = _int(a.group_id);
    if (!Number.isFinite(gid)) return res.json({ result: { ok: false, err: 'Dosar invalid.' } });

    // Csoport-tulajdon ellenőrzés (cross-tenant védelem) — a pooled kliens
    // csak ez után kell, hogy érvénytelen csoportnál ne foglaljunk kapcsolatot.
    const g = await pool.query(
      'SELECT id, prefix, year_reset, pad FROM doc_register_groups WHERE id = $1 AND company_id = $2',
      [gid, cid]
    );
    if (!g.rows.length) return res.json({ result: { ok: false, err: 'Dosarul nu a fost găsit.' } });
    const group = g.rows[0];

    const manual = a.manual_no ? String(a.manual_no).trim().slice(0, 60) : '';
    const entryDate = _str(a.entry_date, 10) || null; // YYYY-MM-DD (a DB DEFAULT CURRENT_DATE, ha üres)
    const title = _str(a.title, 255);
    const partner = _str(a.partner, 255);
    const amount = _num(a.amount);
    const currency = _str(a.currency, 8);
    const notes = _str(a.notes, 4000);
    const files = Array.isArray(a.files) ? a.files : [];
    const status = files.length ? 'with_doc' : 'reserved';

    dbc = await pool.connect();
    await dbc.query('BEGIN');
    try {
      let regNo, seq = null, year = null;
      if (manual) {
        // Kézi/külső szám — egyediség-ellenőrzés a csoportban.
        const dup = await dbc.query(
          'SELECT 1 FROM doc_register_entries WHERE company_id = $1 AND group_id = $2 AND reg_no = $3',
          [cid, gid, manual]
        );
        if (dup.rows.length) { await dbc.query('ROLLBACK'); return res.json({ result: { ok: false, err: 'Există deja o înregistrare cu acest număr.' } }); }
        regNo = manual;
      } else {
        const nx = await _nextRegNo(dbc, cid, group);
        regNo = nx.reg_no; seq = nx.seq; year = nx.year;
      }
      const ins = await dbc.query(
        `INSERT INTO doc_register_entries
           (company_id, group_id, reg_no, seq, year, entry_date, title, partner, amount, currency, notes, status, created_by)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, reg_no, entry_date`,
        [cid, gid, regNo, seq, year, entryDate, title, partner, amount, currency, notes, status, email]
      );
      const entryId = ins.rows[0].id;
      let fileCount = 0;
      try { fileCount = await _insertFiles(dbc, cid, entryId, files, email); }
      catch (e) { if (e && e.message === 'FILE_TOO_LARGE') { await dbc.query('ROLLBACK'); return res.json({ result: { ok: false, err: 'Fișier prea mare (max 15 MB).' } }); } throw e; }
      await dbc.query('COMMIT');
      try { await audit.fromReq(req, 'doc_register.entry_create', 'doc_register_entries', entryId, { group_id: gid, reg_no: regNo, files: fileCount }); } catch (_) {}
      return res.json({ result: { ok: true, id: entryId, reg_no: ins.rows[0].reg_no, file_count: fileCount } });
    } catch (e) {
      await dbc.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } catch (err) {
    console.error('docRegEntryCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  } finally {
    if (dbc) { try { dbc.release(); } catch (_) {} }
  }
};

// ─── Bejegyzés módosítása (a sorszám NEM változik) ──────────
// args: [{ id, entry_date?, title?, partner?, amount?, currency?, notes?, status? }]
handlers.docRegEntryUpdate = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = _int(a.id);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    const status = a.status && STATUSES.includes(a.status) ? a.status : null;
    const r = await pool.query(
      `UPDATE doc_register_entries
          SET entry_date = COALESCE($1::date, entry_date),
              title = $2, partner = $3, amount = $4, currency = $5, notes = $6,
              status = COALESCE($7, status), updated_at = NOW()
        WHERE id = $8 AND company_id = $9`,
      [_str(a.entry_date, 10), _str(a.title, 255), _str(a.partner, 255), _num(a.amount), _str(a.currency, 8), _str(a.notes, 4000), status, id, cid]
    );
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Înregistrarea nu a fost găsită.' } });
    try { await audit.fromReq(req, 'doc_register.entry_update', 'doc_register_entries', id, {}); } catch (_) {}
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('docRegEntryUpdate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Fájl(ok) hozzáadása egy meglévő bejegyzéshez ───────────
// args: [{ entry_id, files:[{file_name, base64}] }]
handlers.docRegEntryAddFiles = async function (req, res, args) {
  let dbc = null;
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const email = _user(req).email || null;
    const a = (args && args[0]) || {};
    const id = _int(a.entry_id);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    const own = await pool.query('SELECT id FROM doc_register_entries WHERE id = $1 AND company_id = $2', [id, cid]);
    if (!own.rows.length) return res.json({ result: { ok: false, err: 'Înregistrarea nu a fost găsită.' } });

    dbc = await pool.connect();
    await dbc.query('BEGIN');
    try {
      let n = 0;
      try { n = await _insertFiles(dbc, cid, id, a.files, email); }
      catch (e) { if (e && e.message === 'FILE_TOO_LARGE') { await dbc.query('ROLLBACK'); return res.json({ result: { ok: false, err: 'Fișier prea mare (max 15 MB).' } }); } throw e; }
      if (n > 0) {
        await dbc.query(`UPDATE doc_register_entries SET status = 'with_doc', updated_at = NOW() WHERE id = $1 AND company_id = $2 AND status <> 'void'`, [id, cid]);
      }
      await dbc.query('COMMIT');
      try { await audit.fromReq(req, 'doc_register.entry_add_files', 'doc_register_entries', id, { files: n }); } catch (_) {}
      return res.json({ result: { ok: true, added: n } });
    } catch (e) {
      await dbc.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } catch (err) {
    console.error('docRegEntryAddFiles hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  } finally {
    if (dbc) { try { dbc.release(); } catch (_) {} }
  }
};

// ─── Bejegyzés fájljainak listája (metaadat, base64 NÉLKÜL) ──
// args: [{ entry_id }]
handlers.docRegEntryFiles = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = _int(a.entry_id);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    const r = await pool.query(
      `SELECT id, file_name, mime, file_size, uploaded_by, created_at
         FROM doc_register_files WHERE company_id = $1 AND entry_id = $2 ORDER BY id ASC`,
      [cid, id]
    );
    return res.json({ result: { ok: true, files: r.rows } });
  } catch (err) {
    console.error('docRegEntryFiles hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Egy fájl letöltése (base64-gyel) ───────────────────────
// args: [{ file_id }]
handlers.docRegFileGet = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = _int(a.file_id);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    const r = await pool.query(
      'SELECT file_name, mime, data_base64 FROM doc_register_files WHERE id = $1 AND company_id = $2',
      [id, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Fișierul nu a fost găsit.' } });
    return res.json({ result: { ok: true, file_name: r.rows[0].file_name, mime: r.rows[0].mime, base64: r.rows[0].data_base64 } });
  } catch (err) {
    console.error('docRegFileGet hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Egy fájl törlése (ha marad 0 → a bejegyzés vissza foglaltra) ──
// args: [{ file_id }]
handlers.docRegFileDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = _int(a.file_id);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    const f = await pool.query('SELECT entry_id FROM doc_register_files WHERE id = $1 AND company_id = $2', [id, cid]);
    if (!f.rows.length) return res.json({ result: { ok: false, err: 'Fișierul nu a fost găsit.' } });
    const entryId = f.rows[0].entry_id;
    await pool.query('DELETE FROM doc_register_files WHERE id = $1 AND company_id = $2', [id, cid]);
    // Ha nem maradt fájl → a bejegyzés visszaáll foglaltra (ha nem volt void).
    const rem = await pool.query('SELECT COUNT(*)::int AS n FROM doc_register_files WHERE entry_id = $1 AND company_id = $2', [entryId, cid]);
    if (rem.rows[0].n === 0) {
      await pool.query(`UPDATE doc_register_entries SET status = 'reserved', updated_at = NOW() WHERE id = $1 AND company_id = $2 AND status = 'with_doc'`, [entryId, cid]);
    }
    try { await audit.fromReq(req, 'doc_register.file_delete', 'doc_register_files', id, { entry_id: entryId }); } catch (_) {}
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('docRegFileDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Bejegyzés törlése (a sorszám „elhasználódik" — nincs újraosztás) ──
// args: [{ id }]
handlers.docRegEntryDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const id = _int(a.id != null ? a.id : a);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    const del = await pool.query('DELETE FROM doc_register_entries WHERE id = $1 AND company_id = $2', [id, cid]);
    if (!del.rowCount) return res.json({ result: { ok: false, err: 'Înregistrarea nu a fost găsită.' } });
    try { await audit.fromReq(req, 'doc_register.entry_delete', 'doc_register_entries', id, {}); } catch (_) {}
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('docRegEntryDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ─── Globális keresés a csoportok között ────────────────────
// args: [{ q }] → egyező bejegyzések a csoport nevével együtt.
handlers.docRegSearch = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    const a = (args && args[0]) || {};
    const q = _str(a.q, 120);
    if (!q) return res.json({ result: { ok: true, entries: [] } });
    const like = '%' + q + '%';
    const r = await pool.query(
      `SELECT e.id, e.group_id, g.name AS group_name, e.reg_no, e.entry_date,
              e.title, e.partner, e.status,
              COALESCE(f.cnt, 0) AS file_count
         FROM doc_register_entries e
         JOIN doc_register_groups g ON g.id = e.group_id AND g.company_id = $1
         LEFT JOIN (SELECT entry_id, COUNT(*) AS cnt FROM doc_register_files GROUP BY entry_id) f ON f.entry_id = e.id
        WHERE e.company_id = $1
          AND (e.reg_no ILIKE $2 OR COALESCE(e.title,'') ILIKE $2 OR COALESCE(e.partner,'') ILIKE $2 OR COALESCE(e.notes,'') ILIKE $2)
        ORDER BY e.id DESC LIMIT 100`,
      [cid, like]
    );
    return res.json({ result: { ok: true, entries: r.rows } });
  } catch (err) {
    console.error('docRegSearch hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
