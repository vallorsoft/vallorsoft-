// ============================================================
//  VallorSoft — handlers/uitDeeplink.js
//  UIT (e-Transport) megoldás ANAF-integráció nélkül: cégenkénti
//  CargoTrack deep-link URL-sablon. RPC a /api/execute-on:
//    getUitDeeplinkConfig  — Admin: a cég sablonja
//    setUitDeeplinkConfig  — Admin: a sablon mentése
//    getUitDeeplink        — Admin/Manager/Sofer: a fuvarhoz épített URL
// ============================================================
const pool = require('../db');
const { buildUrl } = require('../lib/uitDeeplink');

const handlers = {};

handlers.getUitDeeplinkConfig = async function (req, res) {
  if (!req.session.user || req.session.user.pozicio !== 'Admin') {
    return res.json({ result: { ok: false, err: 'Acces interzis' } });
  }
  const r = await pool.query('SELECT uit_deeplink_template FROM companies WHERE id = $1', [req.session.user.company_id]);
  return res.json({ result: { ok: true, template: r.rows.length ? r.rows[0].uit_deeplink_template : null } });
};

handlers.setUitDeeplinkConfig = async function (req, res, args) {
  if (!req.session.user || req.session.user.pozicio !== 'Admin') {
    return res.json({ result: { ok: false, err: 'Acces interzis' } });
  }
  const a = (args && args[0]) || {};
  let tpl = a.template != null ? String(a.template).trim().slice(0, 1000) : null;
  if (tpl === '') tpl = null;
  if (tpl && !/^https?:\/\//i.test(tpl)) {
    return res.json({ result: { ok: false, err: 'Șablonul trebuie să înceapă cu http(s)://' } });
  }
  await pool.query('UPDATE companies SET uit_deeplink_template = $1 WHERE id = $2', [tpl, req.session.user.company_id]);
  return res.json({ result: { ok: true } });
};

handlers.getUitDeeplink = async function (req, res, args) {
  try {
    if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
    const cid = req.session.user.company_id;
    const orderId = String(args && args[0] || '').trim();
    const uitCode = args && args[1] != null ? String(args[1]).trim() : '';

    // A cég AKTÍV GPS-providere (ugyanaz a logika, mint a routes/uit.js getGpsCfg-ben).
    // Ha nincs aktív GPS-integráció, a cargotrack a default provider.
    const gp = await pool.query(
      `SELECT provider FROM company_integrations
         WHERE company_id=$1 AND category='gps' AND enabled=true
         ORDER BY (provider='cargotrack') DESC, updated_at DESC LIMIT 1`, [cid]);
    const provider = gp.rows.length ? gp.rows[0].provider : 'cargotrack';

    // Provider-szintű sablon, fallback a régi egy-sablonos oszlopra.
    const cr = await pool.query('SELECT uit_deeplink_templates, uit_deeplink_template FROM companies WHERE id = $1', [cid]);
    const row = cr.rows.length ? cr.rows[0] : {};
    const map = row.uit_deeplink_templates || {};
    const tpl = (map && map[provider]) || row.uit_deeplink_template || null;
    if (!tpl) return res.json({ result: { ok: false, reason: 'not-configured' } });

    const r = await pool.query(
      'SELECT id, rendszam_camion, rendszam_remorca, loc_incarcare, loc_descarcare, client, km, suly_kg, email_sofer FROM orders WHERE id = $1 AND company_id = $2',
      [orderId, cid]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Transportul nu a fost gasit' } });
    const o = r.rows[0];
    // Sofőr csak a SAJÁT fuvarjához kérhet linket
    if (req.session.user.pozicio === 'Sofer'
      && String(o.email_sofer || '').toLowerCase() !== String(req.session.user.email || '').toLowerCase()) {
      return res.json({ result: { ok: false, err: 'Acces interzis' } });
    }
    return res.json({ result: { ok: true, url: buildUrl(tpl, o, uitCode) } });
  } catch (err) {
    console.error('getUitDeeplink hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;
