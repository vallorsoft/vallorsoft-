// ============================================================
//  VallorSoft — handlers/mapsProvider.js
//  A cég térkép-szolgáltatójának beállítása (geokódolás + autocomplete):
//  free (ingyenes) | here | google. A kulcs AES-titkosítva tárolódik a
//  company_integrations (provider='maps') táblában; nyíltan sosem jön vissza.
// ============================================================
const pool = require('../db');
const { encrypt } = require('../lib/crypto');
const { clearConfigCache, testProvider, getUsage } = require('../lib/mapsProvider');

const VENDOR_PAID = ['here', 'google'];

// A cég fizetendője egy szolgáltatóra: hívásszám × hivatalos egységár × (1+árrés%).
async function _priceFor(vendor) {
  try {
    const r = await pool.query('SELECT eur_per_unit, margin_pct FROM maps_pricing WHERE vendor=$1', [vendor]);
    if (!r.rows.length) return { unit: 0, margin: 25 };
    return { unit: Number(r.rows[0].eur_per_unit) || 0, margin: Number(r.rows[0].margin_pct) || 0 };
  } catch (_) { return { unit: 0, margin: 25 }; }
}
function _cost(cnt, p) { return Math.round((Number(cnt) || 0) * p.unit * (1 + p.margin / 100) * 100) / 100; }

const handlers = {};
function _admin(req) { return req.session.user && (req.session.user.pozicio === 'Admin'); }
const VENDORS = ['free', 'here', 'google'];

handlers.mapsGetProvider = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const r = await pool.query("SELECT enabled, meta, (credentials_enc IS NOT NULL) AS has_key FROM company_integrations WHERE company_id=$1 AND provider='maps'", [cid]);
    if (!r.rows.length) return res.json({ result: { ok: true, vendor: 'free', has_key: false, usage: { month: 0, prev: 0 }, cost_month: 0, cost_prev: 0 } });
    const meta = r.rows[0].meta || {};
    const vendor = r.rows[0].enabled && VENDORS.includes(meta.vendor) ? meta.vendor : 'free';
    const usage = vendor === 'free' ? { month: 0, prev: 0 } : await getUsage(cid, vendor);
    // A cégnek 0 ingyenes — az első hívástól fizet: hivatalos ár + árrés%
    const p = VENDOR_PAID.includes(vendor) ? await _priceFor(vendor) : { unit: 0, margin: 0 };
    return res.json({ result: { ok: true, vendor, has_key: !!r.rows[0].has_key, usage,
      cost_month: _cost(usage.month, p), cost_prev: _cost(usage.prev, p), margin_pct: p.margin } });
  } catch (err) { console.error('mapsGetProvider hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// args: [{ vendor, key? }] — üres kulcs = a tárolt kulcs megőrzése
handlers.mapsSaveProvider = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const vendor = VENDORS.includes(a.vendor) ? a.vendor : 'free';
    const key = (a.key == null) ? '' : String(a.key).trim();

    if (vendor === 'free') {
      await pool.query(
        `INSERT INTO company_integrations (company_id, provider, enabled, meta)
         VALUES ($1,'maps',false,$2)
         ON CONFLICT (company_id, provider) DO UPDATE SET enabled=false, meta=$2`,
        [cid, JSON.stringify({ vendor: 'free' })]);
      clearConfigCache(cid);
      return res.json({ result: { ok: true } });
    }

    // here/google: kulcs kell (vagy már van tárolt)
    const existing = await pool.query("SELECT credentials_enc FROM company_integrations WHERE company_id=$1 AND provider='maps'", [cid]);
    const hasStored = existing.rows.length && existing.rows[0].credentials_enc;
    if (!key && !hasStored) return res.json({ result: { ok: false, err: 'Add meg az API-kulcsot.' } });

    const enc = key ? encrypt(key) : existing.rows[0].credentials_enc;
    await pool.query(
      `INSERT INTO company_integrations (company_id, provider, enabled, credentials_enc, meta)
       VALUES ($1,'maps',true,$2,$3)
       ON CONFLICT (company_id, provider) DO UPDATE SET enabled=true, credentials_enc=$2, meta=$3`,
      [cid, enc, JSON.stringify({ vendor })]);
    clearConfigCache(cid);
    return res.json({ result: { ok: true } });
  } catch (err) { console.error('mapsSaveProvider hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// args: [{ vendor, key? }] — gyors kulcs-teszt (a megadott VAGY a tárolt kulccsal)
handlers.mapsTestProvider = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const vendor = VENDORS.includes(a.vendor) ? a.vendor : 'free';
    if (vendor === 'free') return res.json({ result: { ok: true, valid: true } });
    let key = (a.key == null) ? '' : String(a.key).trim();
    if (!key) {
      const r = await pool.query("SELECT credentials_enc FROM company_integrations WHERE company_id=$1 AND provider='maps'", [cid]);
      if (r.rows.length && r.rows[0].credentials_enc) { try { key = require('../lib/crypto').decrypt(r.rows[0].credentials_enc); } catch (_) { key = ''; } }
    }
    if (!key) return res.json({ result: { ok: false, err: 'Nincs kulcs a teszthez.' } });
    const valid = await testProvider(vendor, key);
    return res.json({ result: { ok: true, valid } });
  } catch (err) { console.error('mapsTestProvider hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// ─── Developer: hivatalos árazás (cégeknek továbbszámlázva) ──
function _dev(req) { return req.session.user && req.session.user.is_dev; }

handlers.devGetMapsPricing = async function (req, res, args) {
  try {
    if (!_dev(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const r = await pool.query('SELECT vendor, eur_per_unit, margin_pct FROM maps_pricing ORDER BY vendor');
    const have = {}; r.rows.forEach((x) => { have[x.vendor] = x; });
    const rows = VENDOR_PAID.map((v) => have[v] || { vendor: v, eur_per_unit: 0, margin_pct: 25 });
    return res.json({ result: { ok: true, rows } });
  } catch (err) { console.error('devGetMapsPricing hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// args: [{ vendor, eur_per_unit, margin_pct }]
handlers.devSaveMapsPricing = async function (req, res, args) {
  try {
    if (!_dev(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const a = (args && args[0]) || {};
    const vendor = VENDOR_PAID.includes(a.vendor) ? a.vendor : null;
    if (!vendor) return res.json({ result: { ok: false, err: 'Érvénytelen szolgáltató.' } });
    const unit = Math.max(0, Number(a.eur_per_unit) || 0);
    const margin = Math.max(0, Number(a.margin_pct) || 0);
    await pool.query(
      `INSERT INTO maps_pricing (vendor, eur_per_unit, margin_pct, updated_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (vendor) DO UPDATE SET eur_per_unit=$2, margin_pct=$3, updated_at=NOW()`,
      [vendor, unit, margin]);
    return res.json({ result: { ok: true } });
  } catch (err) { console.error('devSaveMapsPricing hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

// Cégenkénti térkép-használat és fizetendő (aktuális hónap)
handlers.devMapsUsageOverview = async function (req, res, args) {
  try {
    if (!_dev(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const ym = new Date().getFullYear() + '-' + ('0' + (new Date().getMonth() + 1)).slice(-2);
    const pr = await pool.query('SELECT vendor, eur_per_unit, margin_pct FROM maps_pricing');
    const price = {}; pr.rows.forEach((x) => { price[x.vendor] = { unit: Number(x.eur_per_unit) || 0, margin: Number(x.margin_pct) || 0 }; });
    const r = await pool.query(
      `SELECT m.company_id, m.vendor, m.cnt, c.nev AS ceg_nev
       FROM maps_usage m LEFT JOIN companies c ON c.id = m.company_id
       WHERE m.ym = $1 AND m.cnt > 0 ORDER BY m.cnt DESC`, [ym]);
    const rows = r.rows.map((x) => {
      const p = price[x.vendor] || { unit: 0, margin: 0 };
      return { company_id: x.company_id, ceg_nev: x.ceg_nev, vendor: x.vendor, cnt: x.cnt,
        cost: Math.round((x.cnt * p.unit * (1 + p.margin / 100)) * 100) / 100 };
    });
    return res.json({ result: { ok: true, rows } });
  } catch (err) { console.error('devMapsUsageOverview hiba:', err); return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
};

module.exports = handlers;
