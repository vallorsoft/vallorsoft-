// handlers/waybillDocs.js — Menetlevélhez csatolt dokumentumok.
// Egy menetlevél jellemzően egy hét 2-3 fuvarja; ide tölthetők fel csoportosan a
// fuvar-dokumentumok (opcionálisan a menetlevél egyik fuvarjához kötve), a számla,
// a GPS útvonal, a megbízás és egyéb iratok. Letöltés egyenként (waybillDocGet),
// a csoportos PDF-et a kliens fűzi össze (pdf-lib) a waybillDocGet válaszaiból.
// Migráció: db/waybill-documents.sql.
//
// Kapuk: Admin/Manager, a menetlevél a saját cégé (company_id, fallback a cég
// felhasználóinak e-mailje — mint a getFuvarlevelek), paraméteres SQL, audit.

const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio);
const DOC_TYPES = ['order_doc', 'invoice', 'gps_route', 'assignment', 'other'];
const MAX_B64 = 20 * 1024 * 1024;   // ~15 MB fájl base64-ben
const MAX_FILES = 20;               // egy feltöltési körben
const MIME_RE = /^data:(application\/pdf|image\/(png|jpe?g|webp|heic|heif)|text\/plain|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|zip|xml)|text\/xml);base64,/i;

function _clip(v, max) { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; }
function _type(v) { const s = String(v || '').trim(); return DOC_TYPES.includes(s) ? s : 'other'; }
function _orderIds(v) {
  let a = v;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = []; } }
  return Array.isArray(a) ? a.map(String).filter(Boolean) : [];
}

// A menetlevél a saját cégé-e → { id, numar_fisa, order_ids } vagy null.
async function _ownWaybill(cid, id) {
  const wid = _clip(id, 20);
  if (!wid || !cid) return null;
  const r = await pool.query(
    `SELECT id, numar_fisa, file_name, order_ids FROM fuvarlevelek
      WHERE id = $1 AND (company_id = $2
            OR email_sofer IN (SELECT email FROM users WHERE company_id = $2))`, [wid, cid]);
  return r.rows[0] || null;
}

// A menetlevél fuvarjai (választáshoz a feltöltő ablakban).
async function _waybillOrders(cid, ids) {
  if (!ids.length) return [];
  const r = await pool.query(
    `SELECT id, fuvar_no, client, loc_incarcare, loc_descarcare,
            to_char(data_incarcare, 'YYYY-MM-DD') AS data_incarcare
       FROM orders WHERE company_id = $1 AND id = ANY($2::varchar[])`, [cid, ids]);
  const byId = {};
  r.rows.forEach((o) => { byId[o.id] = o; });
  return ids.map((id) => byId[id]).filter(Boolean);
}

// waybillDocList({ waybill_id }) → { waybill, orders, docs, types }
handlers.waybillDocList = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const wb = await _ownWaybill(u.company_id, a.waybill_id);
    if (!wb) return res.json({ result: { ok: false, err: 'Foaia de parcurs nu a fost găsită.' } });
    const orders = await _waybillOrders(u.company_id, _orderIds(wb.order_ids));
    const d = await pool.query(
      `SELECT wd.id, wd.order_id, wd.doc_type, wd.file_name, wd.mime, wd.file_size, wd.note,
              wd.uploaded_by, wd.created_at, o.fuvar_no
         FROM waybill_documents wd LEFT JOIN orders o ON o.id = wd.order_id
        WHERE wd.company_id = $1 AND wd.waybill_id = $2
        ORDER BY wd.created_at ASC, wd.id ASC`, [u.company_id, wb.id]);
    return res.json({ result: { ok: true, types: DOC_TYPES, orders, docs: d.rows,
      waybill: { id: wb.id, numar_fisa: wb.numar_fisa, file_name: wb.file_name } } });
  } catch (err) {
    console.error('waybillDocList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocUpload({ waybill_id, files: [{ file_name, data, doc_type, order_id?, note? }] })
handlers.waybillDocUpload = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const wb = await _ownWaybill(u.company_id, a.waybill_id);
    if (!wb) return res.json({ result: { ok: false, err: 'Foaia de parcurs nu a fost găsită.' } });
    const files = Array.isArray(a.files) ? a.files : [];
    if (!files.length) return res.json({ result: { ok: false, err: 'Nu ați selectat niciun fișier.' } });
    if (files.length > MAX_FILES) return res.json({ result: { ok: false, err: 'Maxim ' + MAX_FILES + ' fișiere odată.' } });
    const allowed = new Set(_orderIds(wb.order_ids));
    // Előbb mindent ellenőrzünk, csak utána írunk (vagy mind, vagy semmi).
    const rows = [];
    for (const f of files) {
      const name = _clip(f && f.file_name, 255);
      const data = f && typeof f.data === 'string' ? f.data : '';
      if (!name || !data) return res.json({ result: { ok: false, err: 'Fișier incomplet.' } });
      if (data.length > MAX_B64) return res.json({ result: { ok: false, err: 'Fișierul „' + name + '" este prea mare (max. 15 MB).' } });
      if (!MIME_RE.test(data)) return res.json({ result: { ok: false, err: 'Format neacceptat: ' + name } });
      const type = _type(f.doc_type);
      let orderId = _clip(f.order_id, 20);
      // Fuvar csak a menetlevél saját fuvarjai közül, és csak fuvar-dokumentumnál.
      if (type !== 'order_doc' || !orderId || !allowed.has(orderId)) orderId = null;
      const mime = data.slice(5, data.indexOf(';'));
      const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75);
      rows.push({ name, data, type, orderId, mime, size, note: _clip(f.note, 500) });
    }
    const client = await pool.connect();
    const ids = [];
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        const ins = await client.query(
          `INSERT INTO waybill_documents (company_id, waybill_id, order_id, doc_type, file_name, mime,
                                          file_size, data, note, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [u.company_id, wb.id, r.orderId, r.type, r.name, r.mime, r.size, r.data, r.note, u.nume || u.email]);
        ids.push(ins.rows[0].id);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
    audit.fromReq(req, 'waybill_doc.upload', 'waybill', wb.id, { count: ids.length, types: rows.map((r) => r.type) });
    return res.json({ result: { ok: true, ids } });
  } catch (err) {
    console.error('waybillDocUpload hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocUpdate({ id, doc_type, order_id?, note? }) — típus / fuvar utólag is állítható.
handlers.waybillDocUpdate = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    const cur = await pool.query(
      `SELECT wd.waybill_id, f.order_ids FROM waybill_documents wd
         JOIN fuvarlevelek f ON f.id = wd.waybill_id
        WHERE wd.id = $1 AND wd.company_id = $2`, [id, u.company_id]);
    if (!cur.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
    const type = _type(a.doc_type);
    let orderId = _clip(a.order_id, 20);
    if (type !== 'order_doc' || !orderId || !_orderIds(cur.rows[0].order_ids).includes(orderId)) orderId = null;
    await pool.query(
      `UPDATE waybill_documents SET doc_type = $3, order_id = $4, note = $5
        WHERE id = $1 AND company_id = $2`,
      [id, u.company_id, type, orderId, _clip(a.note, 500)]);
    audit.fromReq(req, 'waybill_doc.update', 'waybill', cur.rows[0].waybill_id, { doc_id: id, doc_type: type });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('waybillDocUpdate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocGet({ id }) → { file_name, mime, data } — letöltéshez / PDF-összefűzéshez.
handlers.waybillDocGet = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const id = parseInt(((args && args[0]) || {}).id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    const r = await pool.query(
      `SELECT id, file_name, mime, doc_type, data FROM waybill_documents
        WHERE id = $1 AND company_id = $2`, [id, u.company_id]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
    return res.json({ result: { ok: true, doc: r.rows[0] } });
  } catch (err) {
    console.error('waybillDocGet hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocDelete({ id })
handlers.waybillDocDelete = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const id = parseInt(((args && args[0]) || {}).id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    const r = await pool.query(
      `DELETE FROM waybill_documents WHERE id = $1 AND company_id = $2
        RETURNING waybill_id, file_name`, [id, u.company_id]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
    audit.fromReq(req, 'waybill_doc.delete', 'waybill', r.rows[0].waybill_id, { doc_id: id, file_name: r.rows[0].file_name });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('waybillDocDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
