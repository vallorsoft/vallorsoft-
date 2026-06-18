// ============================================================
//  VallorSoft — routes/track.js  (ÜGYFÉL TRACKING — PUBLIKUS)
//  A megrendelő bejelentkezés NÉLKÜL, tokenes linken követi a fuvart:
//    GET /t/:token          -> public/track.html
//    GET /api/track/:token  -> minimális fuvar-adat + élő GPS pozíció
//  Biztonság: a token crypto-random (32 hex), az adat minimális
//  (útvonal + státusz + rendszám) — ár, sofőr-elérhetőség NINCS kiadva.
// ============================================================
const express = require('express');
const path = require('path');
const router = express.Router();
const pool = require('../db');
const ctSvc = require('../services/cargotrack');
const { decrypt } = require('../lib/crypto');
const { geocodeCached } = require('../lib/routeEstimate');

// Útvonal-végpont geokódolás cache tokenenként (a geo_cache tábla mögött is
// cache-elt, de így a két címet egyszer oldjuk fel tokenenként).
const _routeCache = new Map();
const ROUTE_CACHE_MS = 60 * 60 * 1000; // 1 óra

const TOKEN_RE = /^[a-f0-9]{32}$/;

// Pozíció-cache tokenenként (60s) — a megrendelő frissítgetése ne
// terhelje a GPS-szolgáltatót.
const _posCache = new Map();
const POS_CACHE_MS = 60 * 1000;

router.get('/t/:token', (req, res) => {
  if (!TOKEN_RE.test(req.params.token || '')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, '..', 'public', 'track.html'));
});

router.get('/api/track/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!TOKEN_RE.test(token)) return res.json({ ok: false });

    const r = await pool.query(
      `SELECT o.id, o.loc_incarcare, o.loc_descarcare, o.data_incarcare, o.data_descarcare,
              o.status, o.rendszam_camion, o.company_id, c.nev AS ceg_nev
       FROM orders o JOIN companies c ON c.id = o.company_id
       WHERE o.tracking_token = $1`,
      [token]
    );
    if (!r.rows.length) return res.json({ ok: false });
    const o = r.rows[0];

    // Élő GPS pozíció — minden AKTÍV fuvarnál és párosított járműnél.
    // (A lezárt/törölt fuvarnál — Finalizat/Anulat — nincs élő követés: a jármű
    //  már más fuvaron lehet, a pozíció félrevezető lenne.)
    const ACTIVE_STATUSES = ['Disponibil', 'Alocat', 'Extern', 'In Curs', 'Parkolt', 'Raktarban'];
    let position = null;
    if (ACTIVE_STATUSES.includes(o.status) && o.rendszam_camion) {
      const cached = _posCache.get(token);
      if (cached && Date.now() - cached.ts < POS_CACHE_MS) {
        position = cached.pos;
      } else {
        try {
          const keyR = await pool.query(
            `SELECT credentials_enc, enabled FROM company_integrations
             WHERE company_id = $1 AND provider = 'cargotrack'`, [o.company_id]);
          if (keyR.rows.length && keyR.rows[0].enabled && keyR.rows[0].credentials_enc) {
            const apiKey = decrypt(keyR.rows[0].credentials_enc);
            const mapR = await pool.query(
              `SELECT object_id FROM vehicle_gps_map
               WHERE company_id = $1 AND provider = 'cargotrack' AND rendszam = $2`,
              [o.company_id, o.rendszam_camion]);
            if (mapR.rows.length) {
              const st = await ctSvc.getLatestStatus(apiKey, mapR.rows[0].object_id);
              if (st && st.latitude != null && st.longitude != null) {
                position = { lat: st.latitude, lng: st.longitude, speed: st.speed, datetime: st.datetime };
              }
            }
          }
        } catch (e) { /* GPS-hiba ne döntse el a tracking-oldalt */ }
        _posCache.set(token, { ts: Date.now(), pos: position });
      }
    }

    // Útvonal-végpontok (felrakó/lerakó) geokódolása — így élő GPS nélkül is
    // térkép jelenik meg a tervezett útvonallal (best-effort, geo_cache mögött).
    let route = null;
    try {
      const cached = _routeCache.get(token);
      if (cached && Date.now() - cached.ts < ROUTE_CACHE_MS) {
        route = cached.route;
      } else {
        const [from, to] = await Promise.all([
          o.loc_incarcare ? geocodeCached(o.loc_incarcare).catch(() => null) : Promise.resolve(null),
          o.loc_descarcare ? geocodeCached(o.loc_descarcare).catch(() => null) : Promise.resolve(null),
        ]);
        route = (from || to) ? { from, to } : null;
        _routeCache.set(token, { ts: Date.now(), route });
      }
    } catch (_) { /* a geokódolás hibája ne döntse el a tracking-oldalt */ }

    return res.json({
      ok: true,
      transport: {
        ref: o.id,
        loc_incarcare: o.loc_incarcare,
        loc_descarcare: o.loc_descarcare,
        data_incarcare: o.data_incarcare,
        data_descarcare: o.data_descarcare,
        status: o.status,
        rendszam: o.rendszam_camion,
        ceg: o.ceg_nev,
      },
      position,
      route,
    });
  } catch (err) {
    console.error('track hiba:', err);
    return res.json({ ok: false });
  }
});

module.exports = router;
