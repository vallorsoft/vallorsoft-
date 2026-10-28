// handlers/waybillDocs.js — Menetlevélhez tartozó dokumentumok.
// EGY tároló a fuvar-dokumentumokkal (order_documents, db/zz-waybill-docs-unify.sql):
//   • a menetlevélnél feltöltött irat `waybill_id`-t kap, és ha fuvart választottak
//     hozzá, `order_id`-t is → a fuvar dokumentumai közt is megjelenik;
//   • a fuvarhoz (bárhonnan) feltöltött irat a fuvart tartalmazó menetlevélnél is látszik;
//   • a sofőr fuvarhoz feltöltött fotója/irata (documents.order_id) mindkét helyen
//     megjelenik, csak olvasható.
// Így semmi sincs duplán tárolva. A csoportos PDF-et a kliens fűzi össze (pdf-lib).
//
// Kapuk: Admin/Manager, a menetlevél a saját cégé (company_id, fallback a cég
// felhasználóinak e-mailje — mint a getFuvarlevelek), paraméteres SQL, audit.

const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio);
// A menetlevél-feltöltő típusai + a fuvar-oldali típusok (ugyanaz a tároló).
const DOC_TYPES = ['order_doc', 'invoice', 'gps_route', 'assignment', 'other',
  'cmr', 'pod', 'order', 'contract', 'customs', 'receipt'];
const MAX_B64 = 20 * 1024 * 1024;   // ~15 MB fájl base64-ben
const MAX_FILES = 20;               // egy feltöltési körben
const MIME_RE = /^data:(application\/pdf|image\/(png|jpe?g|webp|heic|heif)|text\/plain|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|zip|xml)|text\/xml);base64,/i;
const EXT_MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic' };

function _clip(v, max) { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; }
function _type(v) { const s = String(v || '').trim(); return DOC_TYPES.includes(s) ? s : 'other'; }
function _orderIds(v) {
  let a = v;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = []; } }
  return Array.isArray(a) ? a.map(String).filter(Boolean) : [];
}
// A régi sorok base64-e prefix nélkül is lehet → data URL a fájlnév kiterjesztéséből.
function _dataUrl(b64, fileName) {
  const s = String(b64 || '');
  if (!s) return '';
  if (s.startsWith('data:')) return s;
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return 'data:' + (EXT_MIME[ext] || 'application/octet-stream') + ';base64,' + s;
}
function _mimeOf(dataUrl) { const m = /^data:([^;]+);/.exec(dataUrl || ''); return m ? m[1] : ''; }

// A menetlevél a saját cégé-e → { id, numar_fisa, file_name, order_ids } vagy null.
async function _ownWaybill(cid, id) {
  const wid = _clip(id, 20);
  if (!wid || !cid) return null;
  const r = await pool.query(
    `SELECT id, numar_fisa, file_name, order_ids FROM fuvarlevelek
      WHERE id = $1 AND (company_id = $2
            OR email_sofer IN (SELECT email FROM users WHERE company_id = $2))`, [wid, cid]);
  return r.rows[0] || null;
}

// A menetlevél fuvarjai (választáshoz) — csak a saját cég fuvarjai.
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

// Egy order_documents sor a menetlevélhez tartozik-e (saját cég + waybill_id vagy a fuvarja).
async function _docOfWaybill(cid, docId, wb, oids) {
  const r = await pool.query(
    `SELECT od.id, od.order_id, od.waybill_id, od.file_name, od.note
       FROM order_documents od LEFT JOIN orders o ON o.id = od.order_id
      WHERE od.id = $1 AND (od.company_id = $2 OR o.company_id = $2)
        AND (od.waybill_id = $3 OR od.order_id = ANY($4::varchar[]))`,
    [docId, cid, wb.id, oids]);
  return r.rows[0] || null;
}

// waybillDocList({ waybill_id }) → { waybill, orders, docs, types }
// docs: { id, src:'od'|'drv', order_id, fuvar_no, doc_type, file_name, file_size,
//         uploaded_by, created_at, has_signed, editable }
handlers.waybillDocList = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    const wb = await _ownWaybill(cid, a.waybill_id);
    if (!wb) return res.json({ result: { ok: false, err: 'Foaia de parcurs nu a fost găsită.' } });
    const oids = _orderIds(wb.order_ids);
    const orders = await _waybillOrders(cid, oids);
    const ownOids = orders.map((o) => o.id);
    const d = await pool.query(
      `SELECT od.id, od.order_id, COALESCE(od.doc_type, 'other') AS doc_type, od.file_name,
              od.file_size, od.note, od.uploaded_by, od.created_at,
              (od.signed_base64 IS NOT NULL) AS has_signed, o.fuvar_no
         FROM order_documents od LEFT JOIN orders o ON o.id = od.order_id
        WHERE (od.company_id = $1 OR o.company_id = $1)
          AND (od.waybill_id = $2 OR od.order_id = ANY($3::varchar[]))
        ORDER BY od.created_at ASC, od.id ASC`, [cid, wb.id, ownOids]);
    const docs = d.rows.map((x) => Object.assign(x, { src: 'od', editable: true }));
    // A sofőr fuvarhoz feltöltött iratai (csak olvasható).
    try {
      const dr = await pool.query(
        `SELECT d.id, d.order_id, d.file_name, d.tip, d.nume_sofer, d.email_sofer, d.created_at, o.fuvar_no
           FROM documents d JOIN orders o ON o.id = d.order_id AND o.company_id = $1
          WHERE d.order_id = ANY($2::varchar[])
          ORDER BY d.created_at ASC, d.id ASC`, [cid, ownOids]);
      dr.rows.forEach((x) => docs.push({
        id: x.id, src: 'drv', order_id: x.order_id, fuvar_no: x.fuvar_no, doc_type: 'pod',
        file_name: x.file_name || ('foto-' + x.id), file_size: null, note: x.tip || null,
        uploaded_by: x.nume_sofer || x.email_sofer, created_at: x.created_at, has_signed: false, editable: false,
      }));
    } catch (e) { console.error('waybillDocList sofőr-dokumentumok (folytatjuk):', e.message); }
    return res.json({ result: { ok: true, types: DOC_TYPES, orders, docs,
      waybill: { id: wb.id, numar_fisa: wb.numar_fisa, file_name: wb.file_name } } });
  } catch (err) {
    console.error('waybillDocList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocUpload({ waybill_id, files: [{ file_name, data, doc_type, order_id?, note? }] })
// Bármely típus köthető a menetlevél egyik fuvarjához (→ a fuvarnál is látszik).
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
    const allowed = new Set((await _waybillOrders(u.company_id, _orderIds(wb.order_ids))).map((o) => o.id));
    // Előbb mindent ellenőrzünk, csak utána írunk (vagy mind, vagy semmi).
    const rows = [];
    for (const f of files) {
      const name = _clip(f && f.file_name, 255);
      const data = f && typeof f.data === 'string' ? f.data : '';
      if (!name || !data) return res.json({ result: { ok: false, err: 'Fișier incomplet.' } });
      if (data.length > MAX_B64) return res.json({ result: { ok: false, err: 'Fișierul „' + name + '" este prea mare (max. 15 MB).' } });
      if (!MIME_RE.test(data)) return res.json({ result: { ok: false, err: 'Format neacceptat: ' + name } });
      let orderId = _clip(f.order_id, 20);
      if (!orderId || !allowed.has(orderId)) orderId = null;   // csak a menetlevél saját fuvarja
      const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75);
      rows.push({ name, data, type: _type(f.doc_type), orderId, size, note: _clip(f.note, 500) });
    }
    const client = await pool.connect();
    const ids = [];
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        const ins = await client.query(
          `INSERT INTO order_documents (order_id, waybill_id, file_name, original_base64, uploaded_by,
                                        company_id, doc_type, doc_date, note, file_size)
           VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,$8,$9) RETURNING id`,
          [r.orderId, wb.id, r.name, r.data, u.nume || u.email, u.company_id, r.type, r.note, r.size]);
        ids.push(ins.rows[0].id);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
    audit.fromReq(req, 'waybill_doc.upload', 'waybill', wb.id,
      { count: ids.length, types: rows.map((r) => r.type), orders: rows.map((r) => r.orderId).filter(Boolean) });
    return res.json({ result: { ok: true, ids } });
  } catch (err) {
    console.error('waybillDocUpload hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocUpdate({ waybill_id, id, doc_type, order_id?, note? }) — típus / fuvar utólag.
// A dokumentum a menetlevélhez kötve marad (waybill_id), akkor is, ha a fuvart levették róla.
handlers.waybillDocUpdate = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    const wb = await _ownWaybill(u.company_id, a.waybill_id);
    if (!wb) return res.json({ result: { ok: false, err: 'Foaia de parcurs nu a fost găsită.' } });
    const own = (await _waybillOrders(u.company_id, _orderIds(wb.order_ids))).map((o) => o.id);
    const doc = await _docOfWaybill(u.company_id, id, wb, own);
    if (!doc) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
    let orderId = _clip(a.order_id, 20);
    if (!orderId || !own.includes(orderId)) orderId = null;
    const type = _type(a.doc_type);
    await pool.query(
      `UPDATE order_documents SET doc_type = $2, order_id = $3, waybill_id = $4, note = $5,
              company_id = $6, updated_at = NOW()
        WHERE id = $1`,
      [id, type, orderId, wb.id, a.note !== undefined ? _clip(a.note, 500) : doc.note, u.company_id]);
    audit.fromReq(req, 'waybill_doc.update', 'waybill', wb.id, { doc_id: id, doc_type: type, order_id: orderId });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('waybillDocUpdate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocGet({ id, src:'od'|'drv' }) → { file_name, mime, data (data URL) }
// Fuvar-dokumentumnál az aláírt/pecsételt változat elsőbbséget élvez.
handlers.waybillDocGet = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    let name, data;
    if (a.src === 'drv') {
      const r = await pool.query(
        `SELECT d.file_name, d.storage_url FROM documents d
           JOIN orders o ON o.id = d.order_id AND o.company_id = $2
          WHERE d.id = $1`, [id, u.company_id]);
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
      name = r.rows[0].file_name || ('foto-' + id + '.jpg');
      data = _dataUrl(r.rows[0].storage_url, name);
    } else {
      const r = await pool.query(
        `SELECT od.file_name, od.original_base64, od.signed_base64
           FROM order_documents od LEFT JOIN orders o ON o.id = od.order_id
          WHERE od.id = $1 AND (od.company_id = $2 OR o.company_id = $2)`, [id, u.company_id]);
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
      name = r.rows[0].file_name || ('document-' + id);
      data = _dataUrl(r.rows[0].signed_base64 || r.rows[0].original_base64, name);
    }
    if (!data) return res.json({ result: { ok: false, err: 'Fără conținut' } });
    return res.json({ result: { ok: true, doc: { id, file_name: name, mime: _mimeOf(data), data } } });
  } catch (err) {
    console.error('waybillDocGet hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// waybillDocDelete({ waybill_id, id }) — a dokumentum végleg törlődik (a fuvarnál is).
handlers.waybillDocDelete = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const a = (args && args[0]) || {};
    const id = parseInt(a.id, 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsă' } });
    const wb = await _ownWaybill(u.company_id, a.waybill_id);
    if (!wb) return res.json({ result: { ok: false, err: 'Foaia de parcurs nu a fost găsită.' } });
    const own = (await _waybillOrders(u.company_id, _orderIds(wb.order_ids))).map((o) => o.id);
    const doc = await _docOfWaybill(u.company_id, id, wb, own);
    if (!doc) return res.json({ result: { ok: false, err: 'Nu a fost găsit' } });
    await pool.query('DELETE FROM order_documents WHERE id = $1', [id]);
    audit.fromReq(req, 'waybill_doc.delete', 'waybill', wb.id, { doc_id: id, file_name: doc.file_name, order_id: doc.order_id });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('waybillDocDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
