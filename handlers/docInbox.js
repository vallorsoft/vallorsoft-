// handlers/docInbox.js — csoportos irat-feltöltés a menetlevelekhez (lib/docInbox).
// Kapuk: Admin/Manager, minden lekérdezés company_id-szűrt, paraméteres SQL, audit.
// Az iratok csak helyben (PDF-szöveg / helyi OCR) olvasódnak — semmi nem megy ki.

const pool = require('../db');
const audit = require('../lib/audit');
const inbox = require('../lib/docInbox');

const handlers = {};
const _am = (u) => u && ['Admin', 'Manager'].includes(u.pozicio);
const _clip = (v, n) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : ''; };
const MAX_B64 = 20 * 1024 * 1024;   // ~15 MB fájl
const MAX_PENDING = 300;            // cégenként egyszerre függő iratok
const MIME_RE = /^data:(application\/pdf|image\/(png|jpe?g|webp));base64,/i;
const SLOTS = ['client_order', 'client_invoice', 'carrier_order', 'carrier_invoice'];
const ERR = (res, msg) => res.json({ result: { ok: false, err: msg } });

function _bg(cid, ids) {
  setImmediate(() => {
    inbox.processCompany(cid, { ids, force: true })
      .catch((e) => console.warn('[DocInbox] háttér-feldolgozás hiba', e.message));
  });
}

// docInboxUpload({ file_name, data }) — egy fájl / hívás (a kliens sorban küldi).
handlers.docInboxUpload = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return ERR(res, 'Acces interzis');
    const a = (args && args[0]) || {};
    const name = _clip(a.file_name, 255);
    const data = typeof a.data === 'string' ? a.data : '';
    if (!name || !data) return ERR(res, 'Fișier incomplet.');
    if (data.length > MAX_B64) return ERR(res, 'Fișierul „' + name + '" este prea mare (max. 15 MB).');
    if (!MIME_RE.test(data)) return ERR(res, 'Doar PDF sau imagini: ' + name);
    const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM waybill_doc_inbox WHERE company_id=$1 AND status<>'matched'`, [u.company_id]);
    if ((cnt.rows[0] && cnt.rows[0].n) >= MAX_PENDING) return ERR(res, 'Prea multe documente în așteptare (max. ' + MAX_PENDING + '). Rezolvă-le întâi pe cele nepotrivite.');
    const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75);
    const r = await pool.query(
      `INSERT INTO waybill_doc_inbox (company_id, file_name, data, file_size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`, [u.company_id, name, data, size, u.nume || u.email]);
    return res.json({ result: { ok: true, id: r.rows[0].id } });
  } catch (err) {
    console.error('docInboxUpload hiba:', err);
    return ERR(res, 'Eroare de server');
  }
};

// docInboxProcess({ ids }) — a feltöltött köteg első köre a háttérben (azonnal válaszol).
handlers.docInboxProcess = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return ERR(res, 'Acces interzis');
    const ids = (((args && args[0]) || {}).ids || []).map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 100);
    if (!ids.length) return ERR(res, 'Nimic de procesat.');
    const own = await pool.query(`SELECT id FROM waybill_doc_inbox WHERE company_id=$1 AND id = ANY($2::int[])`, [u.company_id, ids]);
    const okIds = own.rows.map((x) => x.id);
    audit.fromReq(req, 'waybill_doc.bulk_upload', 'company', String(u.company_id), { count: okIds.length });
    _bg(u.company_id, okIds);
    return res.json({ result: { ok: true, queued: okIds.length } });
  } catch (err) {
    console.error('docInboxProcess hiba:', err);
    return ERR(res, 'Eroare de server');
  }
};

// docInboxList() → { items, counts, targets } — targets: a hiányos menetlevelek hiányzó helyei
handlers.docInboxList = async function (req, res) {
  try {
    const u = req.session.user;
    if (!_am(u)) return ERR(res, 'Acces interzis');
    const cid = u.company_id;
    let items = [];
    try {
      const r = await pool.query(
        `SELECT i.id, i.file_name, i.file_size, i.status, i.attempts, i.text_status, i.best_guess,
                i.matched_order_id, i.matched_waybill_id, i.matched_conf, i.matched_by, i.created_at, i.last_try_at,
                o.fuvar_no AS matched_fuvar_no, f.numar_fisa AS matched_numar_fisa
           FROM waybill_doc_inbox i
           LEFT JOIN orders o ON o.id = i.matched_order_id AND o.company_id = i.company_id
           LEFT JOIN fuvarlevelek f ON f.id = i.matched_waybill_id
          WHERE i.company_id=$1 AND (i.status <> 'matched' OR i.last_try_at > NOW() - INTERVAL '7 days')
          ORDER BY CASE i.status WHEN 'unmatched' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, i.id DESC
          LIMIT 300`, [cid]);
      items = r.rows;
    } catch (e) { if (!(e && (e.code === '42P01' || e.code === '42703'))) throw e; }
    const counts = { pending: 0, unmatched: 0, matched: 0 };
    items.forEach((x) => { if (counts[x.status] != null) counts[x.status]++; });
    // A kézi párosításhoz: a hiányos menetlevelek hiányzó helyei.
    let targets = [];
    try {
      const c = await pool.query(
        `SELECT c.waybill_id, c.detail, f.numar_fisa FROM waybill_doc_checks c
           LEFT JOIN fuvarlevelek f ON f.id = c.waybill_id
          WHERE c.company_id=$1 AND c.status='incomplete' AND c.missing_cnt > 0
          ORDER BY c.checked_at DESC LIMIT 200`, [cid]);
      c.rows.forEach((w) => {
        ((w.detail && w.detail.orders) || []).forEach((o) => {
          (o.slots || []).forEach((s) => {
            if (o.state === 'unloaded' && s.level === 'missing') {
              targets.push({ waybill_id: w.waybill_id, numar_fisa: w.numar_fisa, order_id: o.id, fuvar_no: o.fuvar_no,
                client: o.client, carrier: o.carrier, slot: s.slot });
            }
          });
        });
      });
    } catch (e) { if (!(e && (e.code === '42P01' || e.code === '42703'))) throw e; }
    return res.json({ result: { ok: true, items, counts, targets, max_attempts: inbox.MAX_ATTEMPTS } });
  } catch (err) {
    console.error('docInboxList hiba:', err);
    return ERR(res, 'Eroare de server');
  }
};

// docInboxAssign({ id, waybill_id, order_id, slot }) — kézi párosítás.
handlers.docInboxAssign = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return ERR(res, 'Acces interzis');
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    const id = parseInt(a.id, 10);
    const wid = _clip(a.waybill_id, 20), oid = _clip(a.order_id, 20), slot = _clip(a.slot, 20);
    if (!id || !wid || !oid || !SLOTS.includes(slot)) return ERR(res, 'Date incomplete');
    const r = await pool.query(
      `SELECT * FROM waybill_doc_inbox WHERE id=$1 AND company_id=$2 AND status IN ('pending','unmatched') AND data IS NOT NULL`, [id, cid]);
    if (!r.rows.length) return ERR(res, 'Documentul nu a fost găsit.');
    const w = await pool.query(
      `SELECT id FROM fuvarlevelek WHERE id=$1 AND (company_id=$2 OR email_sofer IN (SELECT email FROM users WHERE company_id=$2))
          AND (order_ids @> jsonb_build_array($3::text) OR puncte @> jsonb_build_array(jsonb_build_object('orderId', $3::text)))`,
      [wid, cid, oid]);
    if (!w.rows.length) return ERR(res, 'Cursa nu este pe această foaie de parcurs.');
    const o = await pool.query('SELECT carrier_id FROM orders WHERE id=$1 AND company_id=$2', [oid, cid]);
    if (!o.rows.length) return ERR(res, 'Comanda nu a fost găsită.');
    if (slot.startsWith('carrier') && !o.rows[0].carrier_id) return ERR(res, 'Cursa nu are subcontractor.');
    const row = r.rows[0];
    row.uploaded_by = u.email || u.nume || row.uploaded_by;
    const docId = await inbox.attach(pool, cid, row, { waybill_id: wid, order_id: oid, slot }, 'manual', null);
    audit.fromReq(req, 'waybill_doc.bulk_assign', 'waybill', wid, { inbox_id: id, doc_id: docId, order_id: oid, slot });
    return res.json({ result: { ok: true, doc_id: docId } });
  } catch (err) {
    console.error('docInboxAssign hiba:', err);
    return ERR(res, 'Eroare de server');
  }
};

// docInboxDelete({ id } | { scope:'unmatched'|'matched' }) — VÉGLEGES törlés (a fájl is).
// A már párosított irat a fuvarnál / menetlevélnél marad — innen csak a napló-sor törlődik.
handlers.docInboxDelete = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return ERR(res, 'Acces interzis');
    const a = (args && args[0]) || {};
    const cid = u.company_id;
    let r;
    if (a.id) {
      r = await pool.query('DELETE FROM waybill_doc_inbox WHERE id=$1 AND company_id=$2', [parseInt(a.id, 10) || 0, cid]);
    } else if (a.scope === 'unmatched' || a.scope === 'matched') {
      r = await pool.query('DELETE FROM waybill_doc_inbox WHERE company_id=$1 AND status=$2', [cid, a.scope]);
    } else return ERR(res, 'Parametri invalizi');
    audit.fromReq(req, 'waybill_doc.bulk_delete', 'company', String(cid), { id: a.id || null, scope: a.scope || null, count: r.rowCount });
    return res.json({ result: { ok: true, deleted: r.rowCount } });
  } catch (err) {
    console.error('docInboxDelete hiba:', err);
    return ERR(res, 'Eroare de server');
  }
};

// docInboxRetry({ id }) — a nem párosított irat újabb 3 próbálkozást kap.
handlers.docInboxRetry = async function (req, res, args) {
  try {
    const u = req.session.user;
    if (!_am(u)) return ERR(res, 'Acces interzis');
    const id = parseInt(((args && args[0]) || {}).id, 10);
    const r = await pool.query(
      `UPDATE waybill_doc_inbox SET status='pending', attempts=0, last_try_at=NULL
        WHERE id=$1 AND company_id=$2 AND status='unmatched' AND data IS NOT NULL`, [id || 0, u.company_id]);
    if (!r.rowCount) return ERR(res, 'Documentul nu a fost găsit.');
    _bg(u.company_id, [id]);
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('docInboxRetry hiba:', err);
    return ERR(res, 'Eroare de server');
  }
};

module.exports = handlers;
