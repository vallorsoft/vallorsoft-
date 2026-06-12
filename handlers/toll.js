// ============================================================
//  VallorSoft — handlers/toll.js
//  Útdíj-becslés a fuvar útvonalából + cégenkénti ráta-kezelés.
//  RPC: estimateToll / getTollRates / saveTollRates.
// ============================================================
const pool = require('../db');
const { estimateFromPolyline, getRates, DEFAULT_RATES, COUNTRY_NAME } = require('../lib/tollEstimate');
const { estimateRoute } = require('../lib/routeEstimate');

const handlers = {};

function _am(req) { return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio); }

// args: [orderId] — a fuvar útvonalából becsli az útdíjat és elmenti.
handlers.estimateToll = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const orderId = String(args && args[0] || '').trim();
    const r = await pool.query(
      'SELECT id, loc_incarcare, loc_descarcare, route_geo FROM orders WHERE id = $1 AND company_id = $2',
      [orderId, cid]);
    if (!r.rows.length) return res.json({ result: { ok: false, err: 'Fuvar nem található' } });
    const o = r.rows[0];

    // útvonal: a mentett route_geo waypointjaiból (ha van), különben felrakó→lerakó
    let rg = o.route_geo;
    if (typeof rg === 'string') { try { rg = JSON.parse(rg); } catch (_) { rg = null; } }
    let waypoints;
    if (rg && Array.isArray(rg.waypoints) && rg.waypoints.length >= 2) {
      waypoints = rg.waypoints.map((w) => ({ type: w.type, address: w.address, lat: w.lat, lng: w.lng }));
    } else {
      if (!o.loc_incarcare || !o.loc_descarcare) {
        return res.json({ result: { ok: false, err: 'Add meg a felrakó és lerakó címet (vagy számolj térképes km-et) az útdíj-becsléshez.' } });
      }
      waypoints = [{ type: 'loading', address: o.loc_incarcare }, { type: 'unloading', address: o.loc_descarcare }];
    }

    let est;
    try { est = await estimateRoute(waypoints, cid); }
    catch (e) { return res.json({ result: { ok: false, err: 'Az útvonal nem számolható: ' + (e.message || '') } }); }

    const toll = await estimateFromPolyline(cid, est.polyline);
    await pool.query('UPDATE orders SET toll_cost = $1, toll_geo = $2, updated_at = NOW() WHERE id = $3 AND company_id = $4',
      [toll.total, JSON.stringify(toll), orderId, cid]).catch((e) => console.error('toll mentés hiba:', e));

    return res.json({ result: { ok: true, toll, km: est.km } });
  } catch (err) {
    console.error('estimateToll hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// A cég effektív rátái (alapértékek + felülírások) — a szerkesztő UI-hoz.
handlers.getTollRates = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const rates = await getRates(cid);
    // jelöljük, mely országoknak van kézi felülírása
    const ovr = await pool.query('SELECT country_code FROM toll_rates WHERE company_id = $1', [cid]);
    const custom = {}; ovr.rows.forEach((r) => { custom[String(r.country_code).toUpperCase()] = true; });
    const list = Object.keys(rates).map((cc) => ({
      cc, name: COUNTRY_NAME[cc] || cc, mode: rates[cc].mode,
      eur_per_km: rates[cc].eur_per_km != null ? rates[cc].eur_per_km : 0,
      vignette_eur: rates[cc].vignette_eur != null ? rates[cc].vignette_eur : 0,
      custom: !!custom[cc],
    })).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
    return res.json({ result: { ok: true, rates: list } });
  } catch (err) {
    console.error('getTollRates hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

// args: [[{cc, mode, eur_per_km, vignette_eur}]] — ráták mentése (upsert).
handlers.saveTollRates = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    const cid = req.session.user.company_id;
    const rows = Array.isArray(args && args[0]) ? args[0] : [];
    if (!rows.length) return res.json({ result: { ok: false, err: 'Nincs mentendő ráta.' } });
    for (const row of rows) {
      const cc = String(row.cc || '').toUpperCase().slice(0, 2);
      if (!/^[A-Z]{2}$/.test(cc)) continue;
      const mode = row.mode === 'vignette' ? 'vignette' : 'perkm';
      const perkm = row.eur_per_km != null && row.eur_per_km !== '' ? Number(row.eur_per_km) : null;
      const vig = row.vignette_eur != null && row.vignette_eur !== '' ? Number(row.vignette_eur) : null;
      await pool.query(
        `INSERT INTO toll_rates (company_id, country_code, mode, eur_per_km, vignette_eur, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (company_id, country_code)
         DO UPDATE SET mode = EXCLUDED.mode, eur_per_km = EXCLUDED.eur_per_km,
                       vignette_eur = EXCLUDED.vignette_eur, updated_at = NOW()`,
        [cid, cc, mode, perkm, vig]);
    }
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('saveTollRates hiba:', err);
    return res.json({ result: { ok: false, err: 'Szerver hiba' } });
  }
};

module.exports = handlers;
