// ============================================================
//  VallorSoft — handlers/orderTemplates.js
//  Ismétlődő fuvar-sablonok — gyakori útvonal egy kattintással újra kiírva.
//
//  A sablon tartalmát (`fields`) MINDIG a szerver állítja össze egy meglévő,
//  a hívó cégéhez tartozó fuvarból (_buildFromOrder) — a kliens csak a fuvar
//  azonosítóját és a sablon nevét küldi, így nem kerülhet be tetszőleges /
//  idegen adat. Dátum, referencia, UIT szándékosan NEM része a sablonnak.
//
//  Jogosultság: Admin/Manager. Multi-tenant: minden lekérdezés company_id-
//  szűrt, paraméteres SQL. Írásokon audit-napló (best-effort).
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

const NAME_MAX = 120;
const MAX_TEMPLATES = 300;   // cégenkénti felső korlát (a lista ne nőjön végtelenre)
const MAX_STOPS = 20;

function _am(req) {
  return !!(req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio));
}
function _deny(res) { return res.json({ result: { ok: false, err: 'Acces interzis' } }); }
function _arg0(args) { return Array.isArray(args) ? args[0] : args; }
function _str(x, n) { const s = x == null ? '' : String(x).trim().slice(0, n); return s || null; }
function _num(x) { if (x === '' || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }

// A sablon mezőinek összeállítása egy fuvarból. null, ha a fuvar nem a cégé.
async function _buildFromOrder(cid, orderId) {
  const r = await pool.query(
    `SELECT id, client, client_id, load_type, suly_kg, hossz_cm, szel_cm, mag_cm,
            pret, km, rendszam_camion, rendszam_remorca,
            loc_incarcare, loc_descarcare, firma_incarcare, firma_descarcare
       FROM orders WHERE id = $1 AND company_id = $2`, [orderId, cid]);
  if (!r.rows.length) return null;
  const o = r.rows[0];

  // Állomások a diszpécser bevitel-sorrendjében (seq_index), dátum NÉLKÜL.
  let stops = [];
  try {
    const s = await pool.query(
      `SELECT kind, loc, firma FROM order_stops
        WHERE order_id = $1 AND company_id = $2
        ORDER BY COALESCE(seq_index, 999999), CASE WHEN kind = 'pickup' THEN 0 ELSE 1 END, stop_index`,
      [orderId, cid]);
    stops = s.rows
      .filter((x) => x.loc || x.firma)
      .slice(0, MAX_STOPS)
      .map((x) => ({ kind: x.kind === 'delivery' ? 'delivery' : 'pickup',
                     loc: _str(x.loc, 255) || '', firma: _str(x.firma, 255) || '' }));
  } catch (e) { stops = []; }            // order_stops migráció nélkül → top-mezők
  if (!stops.length) {
    if (o.loc_incarcare || o.firma_incarcare) stops.push({ kind: 'pickup', loc: o.loc_incarcare || '', firma: o.firma_incarcare || '' });
    if (o.loc_descarcare || o.firma_descarcare) stops.push({ kind: 'delivery', loc: o.loc_descarcare || '', firma: o.firma_descarcare || '' });
  }

  return {
    client: o.client || '',
    client_id: o.client_id || null,
    load_type: (o.load_type === 'FTL' || o.load_type === 'LTL') ? o.load_type : null,
    suly_kg: _num(o.suly_kg),
    hossz_cm: _num(o.hossz_cm), szel_cm: _num(o.szel_cm), mag_cm: _num(o.mag_cm),
    pret: _num(o.pret),
    km: _num(o.km),
    rendszam_camion: o.rendszam_camion || null,
    rendszam_remorca: o.rendszam_remorca || null,
    stops
  };
}

function _routeLabel(stops) {
  if (!Array.isArray(stops) || !stops.length) return '';
  const first = stops[0].loc || stops[0].firma || '';
  const last = stops[stops.length - 1].loc || stops[stops.length - 1].firma || '';
  return stops.length > 1 ? (first + ' → ' + last) : first;
}

// Lista — a leggyakrabban használt elöl.
handlers.orderTemplateList = async function (req, res) {
  try {
    if (!_am(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT id, name, fields, use_count, last_used_at, created_at, updated_at
         FROM order_templates WHERE company_id = $1
        ORDER BY use_count DESC, updated_at DESC LIMIT $2`, [cid, MAX_TEMPLATES]);
    const items = r.rows.map((x) => {
      const f = x.fields || {};
      return { id: x.id, name: x.name, client: f.client || '', route: _routeLabel(f.stops),
               stops_count: Array.isArray(f.stops) ? f.stops.length : 0, load_type: f.load_type || null,
               pret: f.pret, use_count: x.use_count, last_used_at: x.last_used_at };
    });
    return res.json({ result: { ok: true, items } });
  } catch (err) {
    console.error('orderTemplateList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// „🔁 Újra kiírás" — a fuvarból azonnal (mentés nélkül) előállított mezők.
// args: [orderId]
handlers.orderTemplateBuild = async function (req, res, args) {
  try {
    if (!_am(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const orderId = _str(_arg0(args), 50);
    if (!orderId) return res.json({ result: { ok: false, err: 'Cursa lipsește.' } });
    const fields = await _buildFromOrder(cid, orderId);
    if (!fields) return res.json({ result: { ok: false, err: 'Cursa nu a fost găsită.' } });
    return res.json({ result: { ok: true, fields } });
  } catch (err) {
    console.error('orderTemplateBuild hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// „💾 Mentés sablonként" — args: [{ order_id, name }]
handlers.orderTemplateSaveFromOrder = async function (req, res, args) {
  try {
    if (!_am(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg0(args) || {};
    const orderId = _str(a.order_id, 50);
    const name = _str(a.name, NAME_MAX);
    if (!orderId) return res.json({ result: { ok: false, err: 'Cursa lipsește.' } });
    if (!name) return res.json({ result: { ok: false, err: 'Numele șablonului este obligatoriu.' } });

    const fields = await _buildFromOrder(cid, orderId);
    if (!fields) return res.json({ result: { ok: false, err: 'Cursa nu a fost găsită.' } });

    const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM order_templates WHERE company_id = $1', [cid]);
    if ((cnt.rows[0] && cnt.rows[0].n) >= MAX_TEMPLATES) {
      return res.json({ result: { ok: false, err: 'Ați atins numărul maxim de șabloane (' + MAX_TEMPLATES + ').' } });
    }
    const dup = await pool.query(
      'SELECT id FROM order_templates WHERE company_id = $1 AND LOWER(name) = LOWER($2)', [cid, name]);
    if (dup.rows.length) return res.json({ result: { ok: false, err: 'Există deja un șablon cu acest nume.' } });

    const me = req.session.user;
    const ins = await pool.query(
      `INSERT INTO order_templates (company_id, name, fields, source_order_id, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING id`,
      [cid, name, JSON.stringify(fields), orderId, me.email || me.nume || null]);
    const id = ins.rows[0].id;
    audit.fromReq(req, 'order_template.create', 'order_template', id, { name, order_id: orderId });
    return res.json({ result: { ok: true, id } });
  } catch (err) {
    console.error('orderTemplateSaveFromOrder hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Sablon felhasználása a fuvar-kiíráshoz — a mezőket adja + számláló növelés.
// args: [id]
handlers.orderTemplateUse = async function (req, res, args) {
  try {
    if (!_am(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const id = parseInt(_arg0(args), 10);
    if (!id) return res.json({ result: { ok: false, err: 'Șablonul lipsește.' } });
    const r = await pool.query(
      `UPDATE order_templates SET use_count = use_count + 1, last_used_at = NOW()
        WHERE id = $1 AND company_id = $2 RETURNING name, fields`, [id, cid]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Șablonul nu a fost găsit.' } });
    return res.json({ result: { ok: true, name: r.rows[0].name, fields: r.rows[0].fields || {} } });
  } catch (err) {
    console.error('orderTemplateUse hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Átnevezés — args: [{ id, name }]
handlers.orderTemplateRename = async function (req, res, args) {
  try {
    if (!_am(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg0(args) || {};
    const id = parseInt(a.id, 10);
    const name = _str(a.name, NAME_MAX);
    if (!id || !name) return res.json({ result: { ok: false, err: 'Date lipsă.' } });
    const dup = await pool.query(
      'SELECT id FROM order_templates WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3', [cid, name, id]);
    if (dup.rows.length) return res.json({ result: { ok: false, err: 'Există deja un șablon cu acest nume.' } });
    const r = await pool.query(
      'UPDATE order_templates SET name = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3', [name, id, cid]);
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Șablonul nu a fost găsit.' } });
    audit.fromReq(req, 'order_template.rename', 'order_template', id, { name });
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('orderTemplateRename hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Törlés — args: [id]
handlers.orderTemplateDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const id = parseInt(_arg0(args), 10);
    if (!id) return res.json({ result: { ok: false, err: 'Șablonul lipsește.' } });
    const r = await pool.query('DELETE FROM order_templates WHERE id = $1 AND company_id = $2', [id, cid]);
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Șablonul nu a fost găsit.' } });
    audit.fromReq(req, 'order_template.delete', 'order_template', id, {});
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('orderTemplateDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
