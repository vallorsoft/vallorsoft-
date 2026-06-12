// ============================================================
//  VallorSoft — handlers/mapsProvider.js
//  A cég térkép-szolgáltatójának beállítása (geokódolás + autocomplete):
//  free (ingyenes) | here | google. A kulcs AES-titkosítva tárolódik a
//  company_integrations (provider='maps') táblában; nyíltan sosem jön vissza.
// ============================================================
const pool = require('../db');
const { encrypt } = require('../lib/crypto');
const { clearConfigCache, testProvider, getUsage } = require('../lib/mapsProvider');

// Tájékoztató ingyenes havi keret szolgáltatónként (a pontosat a szolgáltatónál nézd)
const FREE_TIER = { here: 30000, google: 10000 };

const handlers = {};
function _admin(req) { return req.session.user && (req.session.user.pozicio === 'Admin'); }
const VENDORS = ['free', 'here', 'google'];

handlers.mapsGetProvider = async function (req, res, args) {
  try {
    if (!_admin(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const r = await pool.query("SELECT enabled, meta, (credentials_enc IS NOT NULL) AS has_key FROM company_integrations WHERE company_id=$1 AND provider='maps'", [cid]);
    if (!r.rows.length) return res.json({ result: { ok: true, vendor: 'free', has_key: false, usage: { month: 0, prev: 0 }, free_tier: 0 } });
    const meta = r.rows[0].meta || {};
    const vendor = r.rows[0].enabled && VENDORS.includes(meta.vendor) ? meta.vendor : 'free';
    const usage = vendor === 'free' ? { month: 0, prev: 0 } : await getUsage(cid, vendor);
    return res.json({ result: { ok: true, vendor, has_key: !!r.rows[0].has_key, usage, free_tier: FREE_TIER[vendor] || 0 } });
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

module.exports = handlers;
