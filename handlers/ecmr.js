// ============================================================
//  VallorSoft — handlers/ecmr.js
//  e-CMR (digitális CMR fuvarlevél) — egy fuvarhoz tartozó, legfeljebb
//  3 fél (feladó/fuvarozó/címzett) által aláírható elektronikus CMR.
//
//  Biztonsági alapelvek (NEM alku tárgya):
//   - Multi-tenant: minden lekérdezés a session company_id-jére szűr,
//     paraméteres SQL-lel ($1,$2…); soha string-összefűzés.
//   - Cross-tenant write védelem: ecmrCreate ELŐSZÖR ellenőrzi, hogy a
//     kliens-megadta order_id a hívó cégéhez tartozik-e — különben NINCS
//     INSERT (mint a documents.js orderDocUpload fix-nél, lásd AUDIT.md).
//   - Szerepvédelem: az írások (create/sign) Admin/Manager (MVP).
//   - Audit-napló: minden írásra best-effort audit.fromReq(...).
//
//  GDPR / megőrzés: az aláírások (név + IP + időbélyeg) jogi
//  fuvar-dokumentum személyes adatai — a CMR/számla mintájára a
//  számviteli/fuvarozási jog szerint őrizendők (Legea 82/1991 → 5 év).
//  A személyes adat (név/IP) része a céges developer-exportnak és a
//  GDPR-körnek; itt csak rögzítjük, nem törlünk önállóan.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

// A három fél fix whitelistje — bármi más elutasítva.
const PARTIES = ['sender', 'carrier', 'consignee'];

// Bemenet-korlátok
const NAME_MAX = 200;
const SIG_MAX = 200 * 1024; // ~200 KB rajzolt aláírás data URL

function isAdminManager(u) {
  return u && (u.pozicio === 'Admin' || u.pozicio === 'Manager');
}

// status újraszámolása az aláírások alapján
function computeStatus(row) {
  if (row.status === 'cancelled') return 'cancelled';
  const signed = ['sender_signed_at', 'carrier_signed_at', 'consignee_signed_at']
    .filter((k) => row[k]).length;
  if (signed >= 3) return 'completed';
  if (signed > 0) return 'partial';
  return 'draft';
}

// Az e-CMR-ek listája (cégre szűrve), a fuvar útvonal/ügyfél címkéivel.
handlers.ecmrList = async function (req, res) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT oe.id, oe.order_id, oe.status, oe.created_at, oe.created_by,
              oe.sender_name, oe.sender_signed_at,
              oe.carrier_name, oe.carrier_signed_at,
              oe.consignee_name, oe.consignee_signed_at,
              o.client, o.ref, o.loc_incarcare, o.loc_descarcare
       FROM order_ecmr oe
       JOIN orders o ON o.id = oe.order_id AND o.company_id = oe.company_id
       WHERE oe.company_id = $1
       ORDER BY oe.created_at DESC
       LIMIT 500`,
      [cid]
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('ecmrList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Egy e-CMR teljes adata (cégre szűrve).
handlers.ecmrGet = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
    const cid = req.session.user.company_id;
    const id = parseInt(Array.isArray(args) ? args[0] : (args && args.ecmr_id), 10);
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsa' } });
    const r = await pool.query(
      `SELECT oe.*, o.client, o.ref, o.loc_incarcare, o.loc_descarcare
       FROM order_ecmr oe
       JOIN orders o ON o.id = oe.order_id AND o.company_id = oe.company_id
       WHERE oe.id = $1 AND oe.company_id = $2`,
      [id, cid]
    );
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit' } });
    return res.json({ result: { ok: true, ecmr: r.rows[0] } });
  } catch (err) {
    console.error('ecmrGet hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// e-CMR létrehozása egy fuvarhoz. ELŐSZÖR a fuvar tulajdonjogát ellenőrzi
// (cross-tenant write védelem), és csak utána szúr be.
handlers.ecmrCreate = async function (req, res, args) {
  try {
    const me = req.session.user;
    if (!isAdminManager(me)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = me.company_id;
    const orderId = parseInt(Array.isArray(args) ? args[0] : (args && args.order_id), 10);
    if (!orderId) return res.json({ result: { ok: false, err: 'Comanda lipsa' } });

    // Tenant-ellenőrzés: a fuvar a hívó cégéhez tartozik-e? Különben „A" cég
    // e-CMR-t fűzhetne „B" cég fuvarához a fuvar-id megadásával.
    const own = await pool.query(
      'SELECT 1 FROM orders WHERE id = $1 AND company_id = $2',
      [orderId, cid]
    );
    if (!own.rows.length) {
      return res.json({ result: { ok: false, err: 'Comanda nu a fost gasita.' } });
    }

    const r = await pool.query(
      `INSERT INTO order_ecmr (company_id, order_id, status, created_by)
       VALUES ($1, $2, 'draft', $3) RETURNING id`,
      [cid, orderId, me.email || me.nume || null]
    );
    const id = r.rows[0].id;
    audit.fromReq(req, 'ecmr.create', 'ecmr', id, { order_id: orderId });
    return res.json({ result: { ok: true, id } });
  } catch (err) {
    console.error('ecmrCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Egy fél aláírása. A `party` fix whitelistje ellen validál; a sor mindig
// cégre szűrve frissül; az IP a kérés IP-je.
handlers.ecmrSign = async function (req, res, args) {
  try {
    const me = req.session.user;
    if (!isAdminManager(me)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = me.company_id;
    const a = Array.isArray(args) ? (args[0] || {}) : (args || {});
    const id = parseInt(a.ecmr_id, 10);
    const party = String(a.party || '').trim();
    if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsa' } });
    if (!PARTIES.includes(party)) return res.json({ result: { ok: false, err: 'Parte invalida' } });

    const name = String(a.name || '').trim().slice(0, NAME_MAX);
    if (!name) return res.json({ result: { ok: false, err: 'Numele semnatarului este obligatoriu.' } });
    let sig = a.sig != null ? String(a.sig) : null;
    if (sig && sig.length > SIG_MAX) return res.json({ result: { ok: false, err: 'Semnatura este prea mare.' } });
    if (sig === '') sig = null;

    // A kérés IP-je (a jogi bizonyíték része).
    const ip = String(req.ip || (req.headers && req.headers['x-forwarded-for']) ||
      (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim().slice(0, 64) || null;

    // A party whitelistelt → biztonságos az oszlopnév-interpoláció (NEM kliens-string).
    const nameCol = party + '_name';
    const atCol = party + '_signed_at';
    const ipCol = party + '_ip';
    const sigCol = party + '_sig';

    const upd = await pool.query(
      `UPDATE order_ecmr
       SET ${nameCol} = $1, ${atCol} = NOW(), ${ipCol} = $2, ${sigCol} = $3
       WHERE id = $4 AND company_id = $5
       RETURNING *`,
      [name, ip, sig, id, cid]
    );
    if (!upd.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit' } });

    const newStatus = computeStatus(upd.rows[0]);
    if (newStatus !== upd.rows[0].status) {
      await pool.query('UPDATE order_ecmr SET status = $1 WHERE id = $2 AND company_id = $3',
        [newStatus, id, cid]);
    }
    audit.fromReq(req, 'ecmr.sign', 'ecmr', id, { party, status: newStatus });
    return res.json({ result: { ok: true, status: newStatus } });
  } catch (err) {
    console.error('ecmrSign hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
