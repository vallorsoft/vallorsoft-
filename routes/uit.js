// routes/uit.js — RO e-Transport UIT-kódok fuvaronként.
// Mount: app.use(require('./routes/uit'));
//
// UIT tárolási szabály (2026-08-20): a bemenetet normalizáljuk (uppercase,
// csak A-Z0-9, max 16 karakter) — így a felület akár kötőjelekkel írja
// (XXXX-XXXX-XXXX-XXXX), akár kis-nagybetű keveréssel, ugyanaz a kód lesz.
// Duplikátum-szűrés: (company_id, order_id, uit_code) UNIQUE, normalizált
// forma alatt. A UI a formázást (kötőjelek) magától rakja fel megjelenéskor.
//
// A sofőr TÖBB UIT-ot is felvihet a fuvarhoz (2026-08-20-tól). Fotó (papírra
// írt UIT) az AI-scan-nel (/api/execute → scanUitFromImage) jön, ez a route
// pedig a beszúrásnál elfogadja a `photo_b64`/`photo_mime`/`source` mezőket.
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { decrypt } = require('../lib/crypto');
const { normalizeUit, isValidUit } = require('../lib/uitFormat');

const router = express.Router();

// Max 8 MB fotó a UIT-hoz (mint az AI-scan-nél). A base64 payload ~4/3-a a
// nyers bájt-méretnek.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// A cég AKTÍV GPS-szolgáltatója (category='gps') — provider + kulcs + e-Transport beállítás.
// Ha több is van, a cargotrack-et preferáljuk, de bármelyik GPS-provider ugyanígy működik.
async function getGpsCfg(companyId) {
  const { rows } = await pool.query(
    `SELECT provider, credentials_enc, meta FROM company_integrations
       WHERE company_id=$1 AND category='gps' AND enabled=true AND credentials_enc IS NOT NULL
       ORDER BY (provider='cargotrack') DESC, updated_at DESC LIMIT 1`, [companyId]);
  if (!rows.length) return null;
  const meta = rows[0].meta || {};
  return { provider: rows[0].provider, apiKey: decrypt(rows[0].credentials_enc), etransport: meta.etransport || { enabled: false } };
}
async function objectIdForRendszam(companyId, provider, rendszam) {
  if (!rendszam || !provider) return null;
  const { rows } = await pool.query(
    `SELECT object_id FROM vehicle_gps_map WHERE company_id=$1 AND provider=$2 AND rendszam=$3`,
    [companyId, provider, rendszam]);
  return rows.length ? rows[0].object_id : null;
}
const own = (req) => req.session.user.company_id;

// Bemenet-validáció: fotó base64 (opcionális). Rossz MIME / túl nagy → null.
function _sanitizePhoto(body) {
  const mime = body && body.photo_mime ? String(body.photo_mime).toLowerCase() : '';
  const b64 = body && body.photo_b64 ? String(body.photo_b64) : '';
  if (!mime.startsWith('image/')) return { photo_b64: null, photo_mime: null };
  if (!b64) return { photo_b64: null, photo_mime: null };
  const approxBytes = Math.floor(b64.length * 0.75);
  if (approxBytes > MAX_PHOTO_BYTES) return { photo_b64: null, photo_mime: null };
  return { photo_b64: b64, photo_mime: mime };
}
function _sanitizeSource(v) {
  const s = String(v || 'manual').toLowerCase();
  return (s === 'ai-scan' || s === 'manual') ? s : 'manual';
}

// ---- LISTA egy fuvarhoz ----
router.get('/api/orders/:id/uit', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, uit_code, rendszam, object_id, status, valid_until, last_message, sent_at, stopped_at,
              source, (photo_b64 IS NOT NULL) AS has_photo, photo_mime, created_at
         FROM order_uit_codes WHERE company_id=$1 AND order_id=$2 ORDER BY created_at`,
      [own(req), req.params.id]);
    res.json({ items: rows });
  } catch (e) { console.error('GET /api/orders/:id/uit hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- ÖSSZESÍTŐ a fuvarlista gombjaihoz (1 kérés több fuvarra) ----
router.get('/api/uit/summary', requireLogin, async (req, res) => {
  const ids = String(req.query.order_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return res.json({ summary: {} });
  try {
    const { rows } = await pool.query(
      `SELECT order_id, status, COUNT(*)::int AS n FROM order_uit_codes
         WHERE company_id=$1 AND order_id = ANY($2) GROUP BY order_id, status`,
      [own(req), ids]);
    const summary = {};
    rows.forEach(r => {
      const s = summary[r.order_id] || (summary[r.order_id] = { total: 0, active: 0, error: 0, new: 0, stopped: 0 });
      s.total += r.n; if (s[r.status] != null) s[r.status] += r.n;
    });
    res.json({ summary });
  } catch (e) { console.error('GET /api/uit/summary hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- FOTÓ letöltése/megnyitása ----
// A UIT-hoz csatolt kép data-URL-ként (image/jpeg vagy image/png) → új tab-on
// megnyitható, letölthető. Auth-védett (a saját cég sorát adja csak).
router.get('/api/uit/:uid/photo', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT photo_b64, photo_mime FROM order_uit_codes WHERE id=$1 AND company_id=$2`,
      [req.params.uid, own(req)]);
    if (!rows.length || !rows[0].photo_b64) return res.status(404).send('Nu s-a găsit.');
    const mime = rows[0].photo_mime || 'image/jpeg';
    const buf = Buffer.from(rows[0].photo_b64, 'base64');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="uit-' + req.params.uid + '.' + (mime.split('/')[1] || 'jpg') + '"');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    return res.end(buf);
  } catch (e) { console.error('GET /api/uit/:uid/photo hiba:', e); res.status(500).send('Eroare de server'); }
});

// ---- HOZZÁADÁS (Admin/Manager) ----
router.post('/api/orders/:id/uit', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  const uit = normalizeUit(req.body && req.body.uit_code);
  if (!isValidUit(uit)) return res.status(400).json({ error: 'Codul UIT este obligatoriu (max 16 caractere alfanumerice).' });
  try {
    // rendszám: a kérésből, vagy a fuvar vontatójából
    let rendszam = (req.body.rendszam || '').trim();
    if (!rendszam) {
      const o = await pool.query(`SELECT rendszam_camion FROM orders WHERE id=$1 AND company_id=$2`, [req.params.id, own(req)]);
      rendszam = o.rows.length ? (o.rows[0].rendszam_camion || '') : '';
    }
    const gpsCfg = await getGpsCfg(own(req));
    const objectId = await objectIdForRendszam(own(req), gpsCfg ? gpsCfg.provider : null, rendszam);
    const provider = gpsCfg ? gpsCfg.provider : 'cargotrack';
    const validUntil = req.body.valid_until || null;
    const { photo_b64, photo_mime } = _sanitizePhoto(req.body);
    const source = _sanitizeSource(req.body && req.body.source);
    const { rows } = await pool.query(
      `INSERT INTO order_uit_codes (company_id, order_id, uit_code, rendszam, object_id, provider, valid_until,
                                    created_by, photo_b64, photo_mime, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (company_id, order_id, uit_code) DO NOTHING
       RETURNING id, uit_code, rendszam, object_id, status, valid_until, last_message, sent_at, stopped_at,
                 source, (photo_b64 IS NOT NULL) AS has_photo, photo_mime, created_at`,
      [own(req), req.params.id, uit, rendszam || null, objectId, provider, validUntil,
       req.session.user.id, photo_b64, photo_mime, source]);
    if (!rows.length) return res.status(409).json({ error: 'Acest UIT este deja inregistrat la aceasta cursa.' });
    res.json({ item: rows[0] });
  } catch (e) { console.error('POST /api/orders/:id/uit hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ---- TÖRLÉS (Admin/Manager) ----
router.delete('/api/uit/:uid', requireLogin, requireRole('Admin', 'Manager'), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM order_uit_codes WHERE id=$1 AND company_id=$2`, [req.params.uid, own(req)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Nu a fost gasit.' });
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /api/uit/:uid hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// ============================================================
// SOFŐR-HATÓKÖR — a sofőr CSAK a neki kiosztott fuvar UIT-jait látja/kezeli.
// Kötés: orders.email_sofer = a belépett sofőr e-mailje (+ company_id).
// A sofőr TÖBB UIT-ot is felvihet (papírról több kód is jöhet — a diszpécser
// által előzőleg beírt kódok maradnak, csak hozzáad).
// ============================================================
async function soferOwnsOrder(req) {
  const { rows } = await pool.query(
    `SELECT rendszam_camion FROM orders
       WHERE id=$1 AND company_id=$2 AND LOWER(email_sofer)=LOWER($3)`,
    [req.params.id, own(req), req.session.user.email]);
  return rows.length ? rows[0] : null;
}

// LISTA — a sofőr a saját fuvarja UIT-jait látja.
router.get('/api/sofer/orders/:id/uit', requireLogin, requireRole('Sofer'), async (req, res) => {
  try {
    if (!(await soferOwnsOrder(req))) return res.status(403).json({ error: 'Nu aveti permisiune pentru aceasta cursa.' });
    const { rows } = await pool.query(
      `SELECT id, uit_code, status, anaf_confirmed, anaf_confirmed_at, last_message, sent_at,
              source, (photo_b64 IS NOT NULL) AS has_photo, photo_mime, created_at
         FROM order_uit_codes WHERE company_id=$1 AND order_id=$2 ORDER BY created_at`,
      [own(req), req.params.id]);
    // canAdd: mindig TRUE — a sofőr több UIT-ot is felvihet (a UI is így néz ki).
    res.json({ items: rows, canAdd: true });
  } catch (e) { console.error('GET /api/sofer/orders/:id/uit hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

// HOZZÁADÁS — a sofőr új UIT-ot ad hozzá (megőrizve a meglévőket).
router.post('/api/sofer/orders/:id/uit', requireLogin, requireRole('Sofer'), async (req, res) => {
  const uit = normalizeUit(req.body && req.body.uit_code);
  if (!isValidUit(uit)) return res.status(400).json({ error: 'Codul UIT este obligatoriu (max 16 caractere alfanumerice).' });
  try {
    const order = await soferOwnsOrder(req);
    if (!order) return res.status(403).json({ error: 'Nu aveti permisiune pentru aceasta cursa.' });
    const rendszam = order.rendszam_camion || '';
    const gpsCfg = await getGpsCfg(own(req));
    const objectId = await objectIdForRendszam(own(req), gpsCfg ? gpsCfg.provider : null, rendszam);
    const provider = gpsCfg ? gpsCfg.provider : 'cargotrack';
    const { photo_b64, photo_mime } = _sanitizePhoto(req.body);
    const source = _sanitizeSource(req.body && req.body.source);
    const { rows } = await pool.query(
      `INSERT INTO order_uit_codes (company_id, order_id, uit_code, rendszam, object_id, provider,
                                    created_by, photo_b64, photo_mime, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (company_id, order_id, uit_code) DO NOTHING
       RETURNING id, uit_code, status, anaf_confirmed, anaf_confirmed_at, last_message, sent_at,
                 source, (photo_b64 IS NOT NULL) AS has_photo, photo_mime, created_at`,
      [own(req), req.params.id, uit, rendszam || null, objectId, provider,
       req.session.user.id, photo_b64, photo_mime, source]);
    if (!rows.length) return res.status(409).json({ error: 'Acest UIT este deja inregistrat.' });
    res.json({ item: rows[0] });
  } catch (e) { console.error('POST /api/sofer/orders/:id/uit hiba:', e); res.status(500).json({ error: 'Eroare de server' }); }
});

module.exports = router;
