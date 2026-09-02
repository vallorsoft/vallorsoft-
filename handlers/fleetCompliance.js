// ============================================================
//  VallorSoft — handlers/fleetCompliance.js
//  Flotta-megfelelés modulok (3. fázis):
//   1) Lejárat-figyelés (document_expiries) — ITP/RCA/rovinietă/tahográf...
//   2) Szerviz & karbantartás napló (vehicle_service_log)
//   3) Sofőr-elszámolás / decont (driver_advances + fuvarlevél-költések + diurna)
//  Minden lekérdezés company_id-re szűr (multi-tenant).
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

// ────────────────────────────────────────────────────────────
//  Szerviz-tétel fehérlista (checklist a "elvégezve" gombhoz).
//  A gyakori kamion-szerviz elemek — az UI ezeket pipálhatja.
//  Az 'other' mindig szabad-szöveggel jár (label a JSONB-ben).
//  A szerver CSAK ezeket a kulcsokat fogadja el; ismeretlen dobva.
// ────────────────────────────────────────────────────────────
const SERVICE_ITEM_KEYS = [
  'oil', 'oil_filter', 'fuel_filter', 'air_filter', 'pollen_filter',
  'adblue_filter', 'air_dryer_filter', 'brake_pads', 'brake_disc',
  'coolant', 'transmission_oil', 'differential_oil', 'tires',
  'wipers', 'battery', 'timing_belt', 'other'
];
const SERVICE_ITEM_SET = new Set(SERVICE_ITEM_KEYS);

// A kliens által küldött tétel-tömböt validálja + normalizálja.
// Beérkezés: [{key:'oil'}, {key:'other', note:'egyeb...'}].
// Kimenet: ugyanez, de csak a fehérlistán levő kulcsokkal, note<=120 char.
function _normalizeServiceItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const k = String(it.key || '').trim().toLowerCase();
    if (!SERVICE_ITEM_SET.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    const row = { key: k };
    if (it.note != null) {
      const n = String(it.note).trim().slice(0, 120);
      if (n) row.note = n;
    }
    out.push(row);
    if (out.length >= 32) break;
  }
  return out;
}

// Szerviz-esedékesség riasztási küszöbök (km- és dátum-alapú emlékeztető):
//  - SERVICE_WARN_KM: ennyi km-rel a `next_due_km` előtt (vagy ha már túllépte) jelez
//  - SERVICE_WARN_DAYS: ennyi nappal a `next_due_date` előtt (vagy ha már lejárt) jelez
const SERVICE_WARN_KM = 2000;
const SERVICE_WARN_DAYS = 30;

function _isAdminOrManager(req) {
  return req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio);
}
function _deny(res) {
  return res.json({ result: { ok: false, err: 'Acces interzis' } });
}
function _arg(args) {
  return Array.isArray(args) ? (args[0] || {}) : (args || {});
}

// ════════════════════════════════════════════════════════════
//  1) LEJÁRAT-FIGYELÉS
// ════════════════════════════════════════════════════════════

handlers.expiryList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const r = await pool.query(
      `SELECT id, entity_type, entity_label, doc_type, expiry_date, alert_days, note,
              (expiry_date - CURRENT_DATE)::int AS days_left
       FROM document_expiries
       WHERE company_id = $1
       ORDER BY expiry_date ASC`,
      [req.session.user.company_id]
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('expiryList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// args: [id|null, {entity_type, entity_label, doc_type, expiry_date, alert_days, note}]
handlers.expirySave = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const id = args[0] ? parseInt(args[0], 10) : null;
    const f = args[1] || {};
    const entityType = ['vehicle', 'driver', 'company'].includes(f.entity_type) ? f.entity_type : 'vehicle';
    const label = String(f.entity_label || '').trim();
    const docType = String(f.doc_type || '').trim();
    const expiry = f.expiry_date;
    let alertDays = parseInt(f.alert_days, 10);
    if (!Number.isFinite(alertDays) || alertDays < 0 || alertDays > 365) alertDays = 30;
    if (!docType || !expiry) return res.json({ result: { ok: false, err: 'Tipul documentului si data expirarii sunt obligatorii.' } });

    if (id) {
      const r = await pool.query(
        `UPDATE document_expiries
         SET entity_type=$3, entity_label=$4, doc_type=$5, expiry_date=$6, alert_days=$7,
             note=$8, last_alert_at=NULL, updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [id, cid, entityType, label || null, docType, expiry, alertDays, f.note || null]
      );
      if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost gasit.' } });
    } else {
      await pool.query(
        `INSERT INTO document_expiries (company_id, entity_type, entity_label, doc_type, expiry_date, alert_days, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [cid, entityType, label || null, docType, expiry, alertDays, f.note || null]
      );
    }
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('expirySave hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.expiryDelete = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const id = parseInt(args[0], 10);
    const r = await pool.query(
      'DELETE FROM document_expiries WHERE id = $1 AND company_id = $2',
      [id, req.session.user.company_id]
    );
    return res.json({ result: { ok: !!r.rowCount, err: r.rowCount ? undefined : 'Nu a fost gasit.' } });
  } catch (err) {
    console.error('expiryDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// Vezérlőpult-kártya: lejárt + hamarosan lejáró tételek
handlers.getExpiryAlerts = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT id, entity_type, entity_label, doc_type, expiry_date,
              (expiry_date - CURRENT_DATE)::int AS days_left
       FROM document_expiries
       WHERE company_id = $1 AND expiry_date <= CURRENT_DATE + alert_days * INTERVAL '1 day'
       ORDER BY expiry_date ASC LIMIT 20`,
      [cid]
    );
    let items = r.rows;
    // UIT (RO e-Transport) lejáró kódok beolvasztása — a 5/15 napos érvényesség
    // végéhez közeledő AKTÍV kódok (még nem leállított), max 2 nappal lejárat előtt
    // vagy már lejárt, de még nem leállítva. Best-effort (ha nincs tábla, kihagyjuk).
    try {
      const u = await pool.query(
        `SELECT order_id, uit_code, valid_until AS expiry_date,
                (valid_until - CURRENT_DATE)::int AS days_left
         FROM order_uit_codes
         WHERE company_id = $1 AND valid_until IS NOT NULL
           AND status <> 'stopped'
           AND valid_until <= CURRENT_DATE + 2
         ORDER BY valid_until ASC LIMIT 20`,
        [cid]
      );
      const uitItems = u.rows.map(function (x) {
        return {
          id: 'uit-' + x.order_id,
          entity_type: 'uit',
          entity_label: x.order_id,
          doc_type: 'Cod UIT ' + String(x.uit_code || '').slice(0, 10),
          expiry_date: x.expiry_date,
          days_left: x.days_left,
        };
      });
      items = items.concat(uitItems).sort(function (a, b) { return a.days_left - b.days_left; });
    } catch (e) { /* order_uit_codes hiányában csendben kihagyjuk */ }
    return res.json({ result: { ok: true, items: items } });
  } catch (err) {
    console.error('getExpiryAlerts hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  2) SZERVIZ & KARBANTARTÁS
// ════════════════════════════════════════════════════════════

handlers.serviceList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const params = [cid];
    let where = 's.company_id = $1';
    const vehicleId = parseInt(a.vehicleId, 10);
    if (Number.isFinite(vehicleId)) { params.push(vehicleId); where += ' AND s.vehicle_id = $2'; }
    const r = await pool.query(
      `SELECT s.id, s.vehicle_id, v.rendszam, s.service_date, s.km, s.category,
              s.description, s.cost_ron, s.next_due_date, s.next_due_km,
              COALESCE(s.items, '[]'::jsonb) AS items,
              COALESCE(s.postpone_count, 0) AS postpone_count,
              s.last_postponed_at, s.closed_at, s.closed_by_service_id
       FROM vehicle_service_log s
       JOIN vehicles v ON v.id = s.vehicle_id
       WHERE ${where}
       ORDER BY s.service_date DESC, s.id DESC LIMIT 300`,
      params
    );
    return res.json({ result: { ok: true, items: r.rows, item_keys: SERVICE_ITEM_KEYS } });
  } catch (err) {
    console.error('serviceList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// args: [{vehicle_id, service_date, km, category, description, cost_ron, next_due_date, next_due_km}]
handlers.serviceCreate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const vehicleId = parseInt(f.vehicle_id, 10);
    if (!Number.isFinite(vehicleId)) return res.json({ result: { ok: false, err: 'Selecteaza un vehicul!' } });
    // multi-tenant: a jármű a saját cégé legyen
    const vr = await pool.query('SELECT id FROM vehicles WHERE id=$1 AND company_id=$2', [vehicleId, cid]);
    if (!vr.rows.length) return res.json({ result: { ok: false, err: 'Vehiculul nu a fost gasit.' } });
    const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
    const items = _normalizeServiceItems(f.items);
    const ins = await pool.query(
      `INSERT INTO vehicle_service_log
         (company_id, vehicle_id, service_date, km, category, description, cost_ron, next_due_date, next_due_km, items)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
      [cid, vehicleId, f.service_date || new Date(), num(f.km), f.category || 'javitas',
       String(f.description || '').trim() || null, num(f.cost_ron), f.next_due_date || null, num(f.next_due_km),
       JSON.stringify(items)]
    );
    audit.fromReq(req, 'service.create', 'vehicle_service_log', ins.rows[0].id,
      { vehicle_id: vehicleId, item_count: items.length });
    return res.json({ result: { ok: true, id: ins.rows[0].id } });
  } catch (err) {
    console.error('serviceCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.serviceDelete = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const id = parseInt(args[0], 10);
    const r = await pool.query(
      'DELETE FROM vehicle_service_log WHERE id = $1 AND company_id = $2',
      [id, req.session.user.company_id]
    );
    return res.json({ result: { ok: !!r.rowCount, err: r.rowCount ? undefined : 'Nu a fost gasit.' } });
  } catch (err) {
    console.error('serviceDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  „🕐 Halasztás" — a szerviz esedékességét arrébb tolja.
//  args: [id, { next_due_date?, next_due_km?, note? }]
//  Legalább egyik új mező (dátum vagy km) kötelező; a régi sor
//  megmarad (folytonos rekord), a next_due_* mezők felülíródnak,
//  postpone_count++, last_postponed_at=NOW(), last_alert_at=NULL
//  (hogy a scheduler újra tudja jelezni a KÖVETKEZŐ esedékességnél).
//  Multi-tenant: WHERE id=$1 AND company_id=$2.
// ────────────────────────────────────────────────────────────
handlers.servicePostpone = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const id = parseInt(args[0], 10);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
    const f = _arg([args[1]]);
    const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
    const nextKm = num(f.next_due_km);
    const nextDate = (f.next_due_date && String(f.next_due_date).trim()) || null;
    if (nextKm == null && !nextDate) {
      return res.json({ result: { ok: false, err: 'Este necesar cel puțin km sau dată nouă.' } });
    }
    // A régi note-ot megőrizzük, a halasztás okát opcionálisan hozzáfűzzük.
    const noteAdd = String(f.note || '').trim().slice(0, 200);
    const r = await pool.query(
      `UPDATE vehicle_service_log
       SET next_due_date = COALESCE($3, next_due_date),
           next_due_km   = COALESCE($4, next_due_km),
           postpone_count = COALESCE(postpone_count, 0) + 1,
           last_postponed_at = NOW(),
           last_alert_at = NULL,
           description = CASE
             WHEN $5 = '' THEN description
             WHEN description IS NULL OR description = '' THEN 'Amânat: ' || $5
             ELSE description || E'\n[Amânat] ' || $5
           END
       WHERE id = $1 AND company_id = $2 AND closed_at IS NULL
       RETURNING id, vehicle_id, next_due_date, next_due_km, postpone_count`,
      [id, cid, nextDate, nextKm, noteAdd]
    );
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost găsit sau este deja închis.' } });
    audit.fromReq(req, 'service.postpone', 'vehicle_service_log', id,
      { next_due_date: nextDate, next_due_km: nextKm, postpone_count: r.rows[0].postpone_count });
    return res.json({ result: { ok: true, item: r.rows[0] } });
  } catch (err) {
    console.error('servicePostpone hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  „✅ Elvégezve" — a régi esedékességet lezárja + új szerviz-sort ír.
//  args: [id, {
//    service_date?, km?, cost_ron?, description?, category?,
//    items:[{key,note?}],           // fehérlistás pipa-lista
//    next_due_date?, next_due_km?   // KÖVETKEZŐ esedékesség (mikor jelezzen újra)
//  }]
//  A tranzakcióban: (a) a régi sor `closed_at=NOW()`+`closed_by_service_id`,
//  a next_due_* nullázódik (nem jelez tovább); (b) INSERT új
//  vehicle_service_log a most elvégzett munkával; az új sor kapja a friss
//  next_due_date / next_due_km értéket → a scheduler ettől figyeli tovább.
//  Multi-tenant + tulajdon-ellenőrzés. Audit a régi ÉS az új id-vel.
// ────────────────────────────────────────────────────────────
handlers.serviceComplete = async function (req, res, args) {
  // ELŐBB szerep-/bemenet-ellenőrzés, hogy fölöslegesen ne foglaljunk DB-kapcsolatot.
  if (!_isAdminOrManager(req)) return _deny(res);
  const cid = req.session.user.company_id;
  const id = parseInt(args[0], 10);
  if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid.' } });
  const f = _arg([args[1]]);
  const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A régi sor ellenőrzése + jármű átvétele (tulajdon + még nyitva)
    const old = await client.query(
      `SELECT id, vehicle_id FROM vehicle_service_log
       WHERE id = $1 AND company_id = $2 AND closed_at IS NULL FOR UPDATE`,
      [id, cid]
    );
    if (!old.rowCount) {
      await client.query('ROLLBACK'); client.release();
      return res.json({ result: { ok: false, err: 'Nu a fost găsit sau este deja închis.' } });
    }
    const vehicleId = old.rows[0].vehicle_id;

    const items = _normalizeServiceItems(f.items);
    const svDate = f.service_date || new Date();
    const svKm = num(f.km);
    const svCost = num(f.cost_ron);
    const svCat = f.category || 'karbantartas';
    const svDesc = String(f.description || '').trim() || null;
    const nextDate = (f.next_due_date && String(f.next_due_date).trim()) || null;
    const nextKm = num(f.next_due_km);

    // (b) Új szerviz-sor
    const ins = await client.query(
      `INSERT INTO vehicle_service_log
         (company_id, vehicle_id, service_date, km, category, description, cost_ron,
          next_due_date, next_due_km, items)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       RETURNING id`,
      [cid, vehicleId, svDate, svKm, svCat, svDesc, svCost,
       nextDate, nextKm, JSON.stringify(items)]
    );
    const newId = ins.rows[0].id;

    // (a) Régi sor lezárása — next_due_* nullázódik, hogy ne jelezzen tovább
    await client.query(
      `UPDATE vehicle_service_log
       SET closed_at = NOW(),
           closed_by_service_id = $3,
           next_due_km = NULL,
           next_due_date = NULL,
           last_alert_at = NULL
       WHERE id = $1 AND company_id = $2`,
      [id, cid, newId]
    );

    await client.query('COMMIT');
    client.release();

    audit.fromReq(req, 'service.complete', 'vehicle_service_log', id,
      { closed_by: newId, vehicle_id: vehicleId, item_count: items.length,
        next_due_date: nextDate, next_due_km: nextKm });
    return res.json({ result: { ok: true, closed_id: id, new_id: newId } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    try { client.release(); } catch (_) {}
    console.error('serviceComplete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ────────────────────────────────────────────────────────────
//  Szerviz-esedékesség (km- és dátum-alapú) — közös segéd.
//  Járművenként a LEGUTÓBBI szerviz-bejegyzés `next_due_km`/`next_due_date`
//  mezőjét veti össze az aktuális kilométerórával és a mai dátummal.
//  Az aktuális km forrása (a nagyobbat veszi, ha több is van):
//    (a) ÉLŐ GPS km-óra (gps_mileage_log legutóbbi snapshotja), HA a
//        GPS-feed ad kilométeróra-állást;
//    (b) BECSLÉS a menetlevelekből: utolsó szerviz km + az azóta megtett
//        km (fuvarlevelek.total_km, rendszámra szűrve) — így GPS-kilométeróra
//        nélkül is működik, ha a sofőrök kitöltik a menetlevél-km-et.
//  Best-effort: ha a tábla/oszlop hiányzik → üres.
//  opts.onlyStale=true → csak a hetente-egyszer logika szerint esedékes
//  (utoljára 7+ napja riasztott) tételek — a schedulernek.
// ────────────────────────────────────────────────────────────
async function computeServiceDueAlerts(cid, opts) {
  const onlyStale = !!(opts && opts.onlyStale);
  let rows;
  try {
    ({ rows } = await pool.query(
      `WITH last_srv AS (
         SELECT DISTINCT ON (s.vehicle_id)
                s.id, s.vehicle_id, v.rendszam, v.marca, v.tip, s.km AS base_km,
                s.next_due_km, s.next_due_date, s.description, s.cost_ron,
                s.category, s.service_date, s.last_alert_at
         FROM vehicle_service_log s
         JOIN vehicles v ON v.id = s.vehicle_id
         WHERE s.company_id = $1
           AND s.closed_at IS NULL
           AND (s.next_due_km IS NOT NULL OR s.next_due_date IS NOT NULL)
         ORDER BY s.vehicle_id, s.service_date DESC NULLS LAST, s.id DESC
       ),
       last_km AS (
         SELECT DISTINCT ON (norm) norm, mileage FROM (
           SELECT UPPER(REGEXP_REPLACE(rendszam,'[^A-Za-z0-9]','','g')) AS norm, mileage, logged_on
           FROM gps_mileage_log WHERE company_id = $1
         ) z ORDER BY norm, logged_on DESC
       )
       SELECT ls.id, ls.vehicle_id, ls.rendszam, ls.marca, ls.tip, ls.base_km,
              ls.next_due_km, ls.next_due_date, ls.description, ls.cost_ron,
              ls.category, ls.service_date, ls.last_alert_at,
              (ls.next_due_date - CURRENT_DATE)::int AS days_left,
              lk.mileage AS gps_km,
              (SELECT COALESCE(SUM(f.total_km),0)
                 FROM fuvarlevelek f
                 JOIN users u ON LOWER(u.email)=LOWER(f.email_sofer) AND u.company_id=$1
                WHERE COALESCE(f.numar_camion,'') <> ''
                  AND UPPER(REGEXP_REPLACE(f.numar_camion,'[^A-Za-z0-9]','','g'))
                      = UPPER(REGEXP_REPLACE(ls.rendszam,'[^A-Za-z0-9]','','g'))
                  AND (ls.service_date IS NULL OR COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) >= ls.service_date)
              ) AS driven_since
       FROM last_srv ls
       LEFT JOIN last_km lk
         ON lk.norm = UPPER(REGEXP_REPLACE(ls.rendszam,'[^A-Za-z0-9]','','g'))`,
      [cid]));
  } catch (e) {
    return []; // migráció előtt / tábla hiányában csendben üres
  }

  const items = [];
  for (const r of rows) {
    const nextKm = r.next_due_km != null ? parseInt(r.next_due_km, 10) : null;
    // Aktuális km: az élő GPS km-óra ÉS a menetlevél-becslés közül a nagyobb.
    const gpsKm = r.gps_km != null ? Math.round(parseFloat(r.gps_km)) : null;
    const baseKm = r.base_km != null ? parseInt(r.base_km, 10) : null;
    const driven = r.driven_since != null ? Math.round(parseFloat(r.driven_since)) : 0;
    const estKm = baseKm != null ? baseKm + driven : null;
    let curKm = null;
    if (gpsKm != null && estKm != null) curKm = Math.max(gpsKm, estKm);
    else if (gpsKm != null) curKm = gpsKm;
    else if (estKm != null) curKm = estKm;
    const kmLeft = (nextKm != null && curKm != null) ? (nextKm - curKm) : null;
    const daysLeft = r.days_left != null ? parseInt(r.days_left, 10) : null;

    const kmDue = kmLeft != null && kmLeft <= SERVICE_WARN_KM;
    const dateDue = daysLeft != null && daysLeft <= SERVICE_WARN_DAYS;
    if (!kmDue && !dateDue) continue;

    // hetente-egyszer duplikáció-őr (csak a schedulernek)
    if (onlyStale && r.last_alert_at) {
      const last = new Date(r.last_alert_at);
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      if (last > weekAgo) continue;
    }

    items.push({
      id: r.id,
      vehicle_id: r.vehicle_id,
      rendszam: r.rendszam,
      marca: r.marca || null,
      tip: r.tip || null,
      category: r.category || null,
      description: r.description || null,       // szerviz megjegyzés
      cost_ron: r.cost_ron != null ? parseFloat(r.cost_ron) : null,  // utolsó szerviz költsége
      service_date: r.service_date || null,    // utolsó szerviz dátuma
      current_km: curKm,                        // aktuális (becsült/GPS) km-óra
      next_due_km: kmDue ? nextKm : null,
      km_left: kmDue ? kmLeft : null,
      next_due_date: dateDue ? r.next_due_date : null,
      days_left: dateDue ? daysLeft : null,
    });
  }

  // Sürgősség szerint: a túllépett/lejárt elöl, majd a legkevesebb hátralévő
  items.sort(function (a, b) {
    const sa = Math.min(a.km_left != null ? a.km_left : 9e9, a.days_left != null ? a.days_left : 9e9);
    const sb = Math.min(b.km_left != null ? b.km_left : 9e9, b.days_left != null ? b.days_left : 9e9);
    return sa - sb;
  });
  return items;
}

// Vezérlőpult-kártya: km-/dátum-alapú esedékes szervizek (read-only).
handlers.getServiceDueAlerts = async function (req, res) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const items = await computeServiceDueAlerts(req.session.user.company_id, { onlyStale: false });
    return res.json({ result: { ok: true, items: items.slice(0, 30) } });
  } catch (err) {
    console.error('getServiceDueAlerts hiba:', err);
    return res.json({ result: { ok: true, items: [] } }); // migráció előtt: üres
  }
};

// ════════════════════════════════════════════════════════════
//  3) SOFŐR-ELSZÁMOLÁS (DECONT)
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
//  3b) SOFŐR-JÁRANDÓSÁG (earnings) + KIFIZETÉS (payments)
//  amivel a cég TARTOZIK a sofőrnek + amit ténylegesen KIFIZETETT
//  EUR/RON választható; kifizetéskor BNR-árfolyam mentve
//  Multi-tenant: minden SQL company_id-szűrt, paraméteres.
// ════════════════════════════════════════════════════════════
const { fetchBnrEurRon } = require('../services/bnr');

const EARNING_KINDS = new Set(['bonus', 'diurna', 'per_diem', 'salary', 'premium', 'holiday', 'other']);
const PAYMENT_METHODS = new Set(['cash', 'bank', 'card', 'other']);
const CURRENCIES = new Set(['RON', 'EUR']);

function _cur(x) {
  const c = String(x || 'RON').toUpperCase();
  return CURRENCIES.has(c) ? c : 'RON';
}
function _num(x) { const n = parseFloat(x); return Number.isFinite(n) ? n : null; }
function _round2(n) { return Math.round(n * 100) / 100; }
function _round4(n) { return Math.round(n * 10000) / 10000; }

// GET — cégre + időszakra + sofőrre szűrt járandóság-lista
handlers.earningList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const params = [cid];
    let where = 'company_id = $1';
    if (a.email) { params.push(String(a.email).toLowerCase()); where += ` AND LOWER(email_sofer) = $${params.length}`; }
    if (a.from)  { params.push(a.from); where += ` AND earning_date >= $${params.length}`; }
    if (a.to)    { params.push(a.to);   where += ` AND earning_date <= $${params.length}`; }
    const r = await pool.query(
      `SELECT id, email_sofer, earning_date, kind, label, quantity, unit_amount,
              total_amount, currency, note, created_by, created_at
         FROM driver_earnings
        WHERE ${where}
        ORDER BY earning_date DESC, id DESC
        LIMIT 500`,
      params
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('earningList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// POST — új járandóság: kind + label + quantity × unit_amount + currency
handlers.earningCreate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const email = String(f.email_sofer || '').trim().toLowerCase();
    if (!email) return res.json({ result: { ok: false, err: 'Selecteaza un sofer!' } });

    // Sofőr a saját céghez tartozik-e (cross-tenant védelem)
    const ur = await pool.query(
      'SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) AND company_id=$2', [email, cid]);
    if (!ur.rows.length) return res.json({ result: { ok: false, err: 'Soferul nu a fost gasit.' } });

    // Kind fehérlista: a beépített 7 + a cég egyéni típusai
    // (driver_earning_kinds tábla). A kliens-küldte kulcsot lowercase-eljük,
    // és fehérlistázzuk a KETTŐBŐL egyesített halmaz alapján. Ismeretlen → 'other'.
    let allowedKinds = new Set(EARNING_KINDS);
    try {
      const kR = await pool.query(
        'SELECT key FROM driver_earning_kinds WHERE company_id = $1', [cid]);
      for (const row of kR.rows) allowedKinds.add(String(row.key).toLowerCase());
    } catch (_e) { /* migráció még nem futott — csak a beépítettek maradnak */ }
    const kindRaw = String(f.kind || '').toLowerCase();
    const kind = allowedKinds.has(kindRaw) ? kindRaw : 'other';
    const label = String(f.label || '').trim().slice(0, 120) || null;
    const currency = _cur(f.currency);

    const qty = _num(f.quantity);
    const unit = _num(f.unit_amount);
    if (qty == null || qty <= 0) return res.json({ result: { ok: false, err: 'Cantitate invalida.' } });
    if (unit == null || unit <= 0) return res.json({ result: { ok: false, err: 'Suma unitara invalida.' } });
    const total = _round2(qty * unit);

    const date = f.earning_date || new Date().toISOString().slice(0, 10);
    const note = String(f.note || '').trim().slice(0, 500) || null;

    const ins = await pool.query(
      `INSERT INTO driver_earnings
         (company_id, email_sofer, earning_date, kind, label, quantity,
          unit_amount, total_amount, currency, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [cid, email, date, kind, label, qty, unit, total, currency, note, req.session.user.email]
    );
    try { audit.fromReq(req, 'earning.create', 'driver_earnings', ins.rows[0].id,
      { email_sofer: email, kind, total, currency }); } catch (_e) {}
    return res.json({ result: { ok: true, id: ins.rows[0].id, total, currency } });
  } catch (err) {
    console.error('earningCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.earningDelete = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const id = parseInt(_arg(args).id || (Array.isArray(args) ? args[0] : args), 10);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid' } });
    const r = await pool.query(
      'DELETE FROM driver_earnings WHERE id=$1 AND company_id=$2',
      [id, req.session.user.company_id]
    );
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost gasit.' } });
    try { audit.fromReq(req, 'earning.delete', 'driver_earnings', id, {}); } catch (_e) {}
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('earningDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ═════════════════════════════════════════════
//  Járandóság-típusok (egyéni + beépített)
// ═════════════════════════════════════════════
// GET — a cég egyéni típusai + a 7 beépített
handlers.earningKindList = async function (req, res) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    let items = [];
    try {
      const r = await pool.query(
        `SELECT id, key, label_ro, label_hu, created_by, created_at
           FROM driver_earning_kinds
          WHERE company_id = $1
          ORDER BY label_ro`,
        [cid]
      );
      items = r.rows;
    } catch (_e) { /* migráció még nem futott */ }
    return res.json({ result: { ok: true, items,
      builtin: Array.from(EARNING_KINDS) } });
  } catch (err) {
    console.error('earningKindList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// POST — új egyéni típus (Admin/Manager, cégre szűrt)
// A key kisbetűs slug (a-z0-9_-), max 30 char; nem ütközhet a beépített 7-tel.
handlers.earningKindCreate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const key = String(f.key || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 30);
    if (!key || key.length < 2) return res.json({ result: { ok: false, err: 'Cheia (key) invalidă. Minim 2 caractere, doar a-z, 0-9, _ sau -.' } });
    if (EARNING_KINDS.has(key)) return res.json({ result: { ok: false, err: 'Cheia coincide cu un tip predefinit.' } });
    const labelRo = String(f.label_ro || '').trim().slice(0, 120);
    const labelHu = String(f.label_hu || '').trim().slice(0, 120) || null;
    if (!labelRo) return res.json({ result: { ok: false, err: 'Eticheta RO obligatorie.' } });
    try {
      const ins = await pool.query(
        `INSERT INTO driver_earning_kinds
           (company_id, key, label_ro, label_hu, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, key) DO UPDATE
            SET label_ro = EXCLUDED.label_ro,
                label_hu = EXCLUDED.label_hu
         RETURNING id`,
        [cid, key, labelRo, labelHu, req.session.user.email]
      );
      try { audit.fromReq(req, 'earning.kind.save', 'driver_earning_kinds', ins.rows[0].id,
        { key, label_ro: labelRo }); } catch (_e) {}
      return res.json({ result: { ok: true, id: ins.rows[0].id, key, label_ro: labelRo, label_hu: labelHu } });
    } catch (dbErr) {
      console.warn('earningKindCreate DB hiba:', dbErr.message);
      return res.json({ result: { ok: false, err: 'Eroare la salvare (migrația poate lipsi).' } });
    }
  } catch (err) {
    console.error('earningKindCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.earningKindDelete = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const f = _arg(args);
    const key = String(f.key || '').toLowerCase();
    if (!key) return res.json({ result: { ok: false, err: 'Cheia lipsă.' } });
    if (EARNING_KINDS.has(key)) return res.json({ result: { ok: false, err: 'Tipul predefinit nu poate fi șters.' } });
    try {
      const r = await pool.query(
        'DELETE FROM driver_earning_kinds WHERE company_id=$1 AND key=$2 RETURNING id',
        [req.session.user.company_id, key]
      );
      if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost găsit.' } });
      try { audit.fromReq(req, 'earning.kind.delete', 'driver_earning_kinds', r.rows[0].id, { key }); } catch (_e) {}
      return res.json({ result: { ok: true } });
    } catch (dbErr) {
      console.warn('earningKindDelete DB hiba:', dbErr.message);
      return res.json({ result: { ok: false, err: 'Eroare la ștergere' } });
    }
  } catch (err) {
    console.error('earningKindDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// GET — kifizetések listája sofőrre + időszakra
handlers.paymentList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const params = [cid];
    let where = 'company_id = $1';
    if (a.email) { params.push(String(a.email).toLowerCase()); where += ` AND LOWER(email_sofer) = $${params.length}`; }
    if (a.from)  { params.push(a.from); where += ` AND paid_at >= $${params.length}`; }
    if (a.to)    { params.push(a.to);   where += ` AND paid_at <= $${params.length}`; }
    const r = await pool.query(
      `SELECT id, email_sofer, paid_at, amount, currency, bnr_rate, amount_ron,
              method, note, created_by, created_at
         FROM driver_payments
        WHERE ${where}
        ORDER BY paid_at DESC, id DESC
        LIMIT 500`,
      params
    );
    return res.json({ result: { ok: true, items: r.rows } });
  } catch (err) {
    console.error('paymentList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// POST — kifizetés rögzítése; BNR-árfolyam a KIFIZETÉS pillanatában
handlers.paymentCreate = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const email = String(f.email_sofer || '').trim().toLowerCase();
    if (!email) return res.json({ result: { ok: false, err: 'Selecteaza un sofer!' } });

    const ur = await pool.query(
      'SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) AND company_id=$2', [email, cid]);
    if (!ur.rows.length) return res.json({ result: { ok: false, err: 'Soferul nu a fost gasit.' } });

    const amount = _num(f.amount);
    if (amount == null || amount <= 0) return res.json({ result: { ok: false, err: 'Suma invalida.' } });
    const currency = _cur(f.currency);
    const method = PAYMENT_METHODS.has(String(f.method || '').toLowerCase())
      ? String(f.method).toLowerCase() : 'cash';
    const date = f.paid_at || new Date().toISOString().slice(0, 10);
    const note = String(f.note || '').trim().slice(0, 500) || null;

    // BNR-árfolyam a kifizetés pillanatában; hiba/lekérés-hiány = null
    let bnrRate = _num(f.bnr_rate_override);
    if (bnrRate == null) {
      try { bnrRate = await fetchBnrEurRon(); } catch (_e) { bnrRate = null; }
    }
    bnrRate = bnrRate != null ? _round4(bnrRate) : null;

    // RON-ban is elmentjük az összeget könnyű összesítéshez
    let amountRon = null;
    if (currency === 'RON') amountRon = _round2(amount);
    else if (currency === 'EUR' && bnrRate) amountRon = _round2(amount * bnrRate);

    const ins = await pool.query(
      `INSERT INTO driver_payments
         (company_id, email_sofer, paid_at, amount, currency, bnr_rate,
          amount_ron, method, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [cid, email, date, amount, currency, bnrRate, amountRon, method, note, req.session.user.email]
    );
    try { audit.fromReq(req, 'payment.create', 'driver_payments', ins.rows[0].id,
      { email_sofer: email, amount, currency, bnr_rate: bnrRate, method }); } catch (_e) {}
    return res.json({ result: {
      ok: true, id: ins.rows[0].id, amount, currency, bnr_rate: bnrRate, amount_ron: amountRon
    } });
  } catch (err) {
    console.error('paymentCreate hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

handlers.paymentDelete = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const id = parseInt(_arg(args).id || (Array.isArray(args) ? args[0] : args), 10);
    if (!Number.isFinite(id)) return res.json({ result: { ok: false, err: 'ID invalid' } });
    const r = await pool.query(
      'DELETE FROM driver_payments WHERE id=$1 AND company_id=$2',
      [id, req.session.user.company_id]
    );
    if (!r.rowCount) return res.json({ result: { ok: false, err: 'Nu a fost gasit.' } });
    try { audit.fromReq(req, 'payment.delete', 'driver_payments', id, {}); } catch (_e) {}
    return res.json({ result: { ok: true } });
  } catch (err) {
    console.error('paymentDelete hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// GET — sofőr egyenlege: járandóság - kifizetés (EUR + RON külön + RON-ban egyesítve)
// A járandóság saját valutában marad; a kifizetés a kifizetéskori BNR-en RON-ra váltva.
// A "kombinált RON" a hivatalos jelenlegi BNR-en számol az EUR-járandóságokra
// (illusztratív egyenleg — a valós tartozás valutában marad).
handlers.getDriverBalance = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const email = String(a.email || '').trim().toLowerCase();
    if (!email) return res.json({ result: { ok: false, err: 'Selecteaza un sofer!' } });
    const from = a.from || '1970-01-01';
    const to   = a.to   || '2999-12-31';

    // Sofőr a saját céghez tartozik-e
    const ur = await pool.query(
      'SELECT nume FROM users WHERE LOWER(email)=LOWER($1) AND company_id=$2', [email, cid]);
    if (!ur.rows.length) return res.json({ result: { ok: false, err: 'Soferul nu a fost gasit.' } });

    // Járandóság valuta szerint
    const eR = await pool.query(
      `SELECT COALESCE(currency,'RON') AS currency,
              COALESCE(SUM(total_amount),0)::numeric AS total,
              COUNT(*)::int AS db
         FROM driver_earnings
        WHERE company_id=$1 AND LOWER(email_sofer)=$2
          AND earning_date >= $3 AND earning_date <= $4
        GROUP BY 1`,
      [cid, email, from, to]
    );
    // Kifizetés valuta szerint + RON-egyesítve (a kifizetéskori BNR alapján)
    const pR = await pool.query(
      `SELECT COALESCE(currency,'RON') AS currency,
              COALESCE(SUM(amount),0)::numeric AS total,
              COALESCE(SUM(amount_ron),0)::numeric AS total_ron,
              COUNT(*)::int AS db
         FROM driver_payments
        WHERE company_id=$1 AND LOWER(email_sofer)=$2
          AND paid_at >= $3 AND paid_at <= $4
        GROUP BY 1`,
      [cid, email, from, to]
    );

    const earned = { EUR: 0, RON: 0, count: 0 };
    for (const row of eR.rows) {
      const c = _cur(row.currency);
      earned[c] = (earned[c] || 0) + parseFloat(row.total || 0);
      earned.count += parseInt(row.db, 10) || 0;
    }
    const paid = { EUR: 0, RON: 0, count: 0, ron_total: 0 };
    for (const row of pR.rows) {
      const c = _cur(row.currency);
      paid[c] = (paid[c] || 0) + parseFloat(row.total || 0);
      paid.count += parseInt(row.db, 10) || 0;
      paid.ron_total += parseFloat(row.total_ron || 0);
    }

    // Aktuális BNR — a fennmaradó EUR-tartozás informatív RON-értékéhez
    let bnrRate = null;
    try { bnrRate = await fetchBnrEurRon(); } catch (_e) { bnrRate = null; }
    bnrRate = bnrRate != null ? _round4(bnrRate) : null;

    const balEur = _round2((earned.EUR || 0) - (paid.EUR || 0));
    const balRon = _round2((earned.RON || 0) - (paid.RON || 0));
    // "Illusztratív" RON-egyenleg: EUR-tartozás mai BNR-en + RON-tartozás
    const balRonAll = bnrRate != null
      ? _round2(balEur * bnrRate + balRon)
      : null;

    return res.json({ result: {
      ok: true,
      sofer: { email, nume: ur.rows[0].nume },
      earned: { eur: _round2(earned.EUR), ron: _round2(earned.RON), count: earned.count },
      paid:   { eur: _round2(paid.EUR),   ron: _round2(paid.RON),   count: paid.count,
                paid_ron_total: _round2(paid.ron_total) },
      balance: { eur: balEur, ron: balRon, ron_all: balRonAll },
      bnr_rate: bnrRate
    } });
  } catch (err) {
    console.error('getDriverBalance hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ═════════════════════════════════════════════════════════════
//  Havi elszámolás-lap (settlement sheet) — PDF/nyomtatható +
//  e-mail. Admin/Manager csak; company_id-szűrt; a driver sofőr
//  a saját céghez kell tartozzon (cross-tenant védelem).
//  Két RPC: adat-lekérés (kliens rendereli) + e-mail küldés.
// ═════════════════════════════════════════════════════════════
handlers.getMonthlySettlementSheet = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const email = String(a.email || '').trim().toLowerCase();
    if (!email) return res.json({ result: { ok: false, err: 'Selecteaza un sofer!' } });

    // Időszak: két elfogadott formátum, visszafelé kompatibilisen —
    //   (a) from+to (YYYY-MM-DD) — TETSZŐLEGES időszak, max 2 év
    //   (b) year+month — az adott hónap 1. és utolsó napja (legacy)
    // Ha mindkettő megvan, a from+to nyer (a felhasználó explicit kérése).
    const pad = n => (n < 10 ? '0' : '') + n;
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    let from, to, year = null, month = null;
    if (typeof a.from === 'string' && typeof a.to === 'string' && ISO.test(a.from) && ISO.test(a.to)) {
      from = a.from; to = a.to;
      const dF = new Date(from + 'T00:00:00Z');
      const dT = new Date(to   + 'T00:00:00Z');
      if (isNaN(dF) || isNaN(dT)) return res.json({ result: { ok: false, err: 'Interval invalid.' } });
      if (dF > dT) return res.json({ result: { ok: false, err: 'Data de început este după data de sfârșit.' } });
      const daysDiff = Math.round((dT - dF) / 86400000);
      if (daysDiff > 366 * 2)  return res.json({ result: { ok: false, err: 'Interval prea mare (max 2 ani).' } });
      const yF = dF.getUTCFullYear();
      if (yF < 2000 || yF > 2100) return res.json({ result: { ok: false, err: 'An invalid.' } });
      // Ha az intervallum PONTOSAN egy naptári hónapot fed, kitöltjük year/month-ot
      // (a fejléc hónapnév-badge használja).
      if (dF.getUTCDate() === 1) {
        const lastOfMonth = new Date(Date.UTC(dF.getUTCFullYear(), dF.getUTCMonth() + 1, 0));
        if (dT.getUTCFullYear() === lastOfMonth.getUTCFullYear()
            && dT.getUTCMonth() === lastOfMonth.getUTCMonth()
            && dT.getUTCDate() === lastOfMonth.getUTCDate()) {
          year  = dF.getUTCFullYear();
          month = dF.getUTCMonth() + 1;
        }
      }
    } else {
      year  = parseInt(a.year, 10);
      month = parseInt(a.month, 10);
      if (!Number.isFinite(year)  || year  < 2000 || year  > 2100) return res.json({ result: { ok: false, err: 'An invalid.' } });
      if (!Number.isFinite(month) || month < 1    || month > 12  ) return res.json({ result: { ok: false, err: 'Lună invalidă.' } });
      from = year + '-' + pad(month) + '-01';
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      to = year + '-' + pad(month) + '-' + pad(lastDay);
    }

    // Sofőr a saját céghez tartozik-e (cross-tenant védelem)
    const ur = await pool.query(
      'SELECT email, nume, tel FROM users WHERE LOWER(email)=LOWER($1) AND company_id=$2',
      [email, cid]);
    if (!ur.rows.length) return res.json({ result: { ok: false, err: 'Soferul nu a fost gasit.' } });
    const driver = ur.rows[0];

    // Cég adatai — fejlécbe (best-effort)
    let company = { nev: '', cui: null, adresa: null, telefon: null, email_contact: null };
    try {
      const cR = await pool.query(
        'SELECT nev, cui, adresa, telefon, email_contact FROM companies WHERE id=$1', [cid]);
      if (cR.rows.length) company = Object.assign(company, cR.rows[0]);
    } catch (_e) { /* opc. oszlopok — mindenképp legyen nev */ }

    // Cég branding — logó + pecsét inline data URI-ként (a print-ablak és az
    // e-mail is így biztonságos: nincs cross-origin függés, Outlook is látja).
    // Best-effort: hiányos migráció / üres branding esetén NULL marad.
    let branding = { logo: null, stamp: null };
    try {
      const bR = await pool.query(
        `SELECT logo_base64, logo_mime, stamp_base64, stamp_mime
           FROM company_branding WHERE company_id=$1`, [cid]);
      if (bR.rows.length) {
        const b = bR.rows[0];
        if (b.logo_base64)  branding.logo  = 'data:' + (b.logo_mime  || 'image/png') + ';base64,' + b.logo_base64;
        if (b.stamp_base64) branding.stamp = 'data:' + (b.stamp_mime || 'image/png') + ';base64,' + b.stamp_base64;
      }
    } catch (_e) { /* company_branding tábla hiányozhat régi cégeknél */ }
    company.logo_data_uri  = branding.logo;
    company.stamp_data_uri = branding.stamp;

    // Járandóság-sorok az időszakra
    const eR = await pool.query(
      `SELECT id, earning_date, kind, label, quantity, unit_amount, total_amount, currency, note
         FROM driver_earnings
        WHERE company_id=$1 AND LOWER(email_sofer)=$2
          AND earning_date >= $3 AND earning_date <= $4
        ORDER BY earning_date ASC, id ASC`,
      [cid, email, from, to]);
    // Kifizetés-sorok az időszakra
    const pR = await pool.query(
      `SELECT id, paid_at, method, amount, currency, bnr_rate, amount_ron, note
         FROM driver_payments
        WHERE company_id=$1 AND LOWER(email_sofer)=$2
          AND paid_at >= $3 AND paid_at <= $4
        ORDER BY paid_at ASC, id ASC`,
      [cid, email, from, to]);

    // Összegzés valuta szerint (a szerver-oldali igazságforrás)
    const earned = { EUR: 0, RON: 0 };
    for (const r of eR.rows) {
      const c = _cur(r.currency);
      earned[c] = (earned[c] || 0) + parseFloat(r.total_amount || 0);
    }
    const paid = { EUR: 0, RON: 0 };
    for (const r of pR.rows) {
      const c = _cur(r.currency);
      paid[c] = (paid[c] || 0) + parseFloat(r.amount || 0);
    }
    // Mai BNR — a kombinált RON-egyenleg informatív számításához
    let bnrRate = null;
    try { bnrRate = await fetchBnrEurRon(); } catch (_e) { bnrRate = null; }
    bnrRate = bnrRate != null ? _round4(bnrRate) : null;

    const balEur = _round2((earned.EUR || 0) - (paid.EUR || 0));
    const balRon = _round2((earned.RON || 0) - (paid.RON || 0));
    const balRonAll = bnrRate != null ? _round2(balEur * bnrRate + balRon) : null;

    return res.json({ result: {
      ok: true,
      driver: { email: driver.email, nume: driver.nume || driver.email, tel: driver.tel || null },
      period: { year, month, from, to },
      company,
      earnings: eR.rows,
      payments: pR.rows,
      totals: {
        earned: { eur: _round2(earned.EUR), ron: _round2(earned.RON), count: eR.rows.length },
        paid:   { eur: _round2(paid.EUR),   ron: _round2(paid.RON),   count: pR.rows.length },
        balance:{ eur: balEur, ron: balRon, ron_all: balRonAll },
        bnr_rate: bnrRate,
      },
    } });
  } catch (err) {
    console.error('getMonthlySettlementSheet hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// E-mail küldés a KÖZÖS VallorSoft feladóról (a cég Brevo-konfigurációja
// NEM kell — ez rendszer-értesítés). A HTML törzset a kliens építi a
// getMonthlySettlementSheet válaszából (egy forrás, csak megjelenítés).
handlers.sendSettlementSheetEmail = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = _arg(args);
    const to = String(a.to || '').trim().toLowerCase();
    const html = String(a.html || '');
    const subject = String(a.subject || '').trim().slice(0, 200) || 'Decont lunar';

    if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(to)) {
      return res.json({ result: { ok: false, err: 'Adresă e-mail invalidă.' } });
    }
    if (html.length < 20 || html.length > 200000) {
      return res.json({ result: { ok: false, err: 'Corpul e-mailului lipsește sau este prea mare.' } });
    }
    // A címzett a saját céghez tartozó sofőr KELL hogy legyen (cross-tenant
    // védelem — az admin nem küldhet külsős címre a rendszer feladójával).
    const ur = await pool.query(
      'SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) AND company_id=$2', [to, cid]);
    if (!ur.rows.length) {
      return res.json({ result: { ok: false, err: 'Destinatarul nu este șofer al firmei.' } });
    }

    const email = require('../services/email');
    const r = await email.sendClientEmail({
      to,
      subject,
      html,
      companyId: cid,
      mailType: 'settlement',
    });
    if (!r || !r.ok) return res.json({ result: { ok: false, err: r && r.error ? r.error : 'Eroare la trimitere' } });
    try { audit.fromReq(req, 'settlement.email', 'driver_settlement', 0, { to, subject }); } catch (_e) {}
    return res.json({ result: { ok: true, messageId: r.messageId } });
  } catch (err) {
    console.error('sendSettlementSheetEmail hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  4) ÜZEMANYAGKÁRTYA-IMPORT (OMV/MOL/DKV/Eurowag CSV)
// ════════════════════════════════════════════════════════════
const _fcCrypto = require('crypto');

// args: [{source, rows:[{rendszam, tx_date, product, qty_l, amount_ron}]}]
// Dedup: hash(forrás|rendszám|dátum|liter|összeg) — kétszeri import nem duplikál.
handlers.fuelImportRows = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const f = _arg(args);
    const source = String(f.source || 'egyeb').toLowerCase().slice(0, 30);
    const rows = Array.isArray(f.rows) ? f.rows.slice(0, 2000) : [];
    if (!rows.length) return res.json({ result: { ok: false, err: 'Nu exista randuri de importat.' } });

    let inserted = 0, skipped = 0;
    for (const r of rows) {
      const rendszam = String(r.rendszam || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 50);
      const qty = parseFloat(r.qty_l);
      const amount = parseFloat(r.amount_ron);
      const date = r.tx_date;
      if (!date || !Number.isFinite(qty) || !Number.isFinite(amount)) { skipped++; continue; }
      const hash = _fcCrypto.createHash('sha256')
        .update([source, rendszam, date, qty.toFixed(2), amount.toFixed(2)].join('|'))
        .digest('hex');
      const ins = await pool.query(
        `INSERT INTO fuel_card_transactions (company_id, source, rendszam, tx_date, product, qty_l, amount_ron, dedup_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (company_id, dedup_hash) DO NOTHING`,
        [cid, source, rendszam || null, date, String(r.product || '').slice(0, 100) || null, qty, amount, hash]
      );
      if (ins.rowCount) inserted++; else skipped++;
    }
    return res.json({ result: { ok: true, inserted, skipped } });
  } catch (err) {
    console.error('fuelImportRows hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server (a rulat migrarea phase4?)' } });
  }
};

handlers.fuelCardList = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const params = [cid];
    let where = 'company_id = $1';
    if (a.from) { params.push(a.from); where += ` AND tx_date >= $${params.length}`; }
    if (a.to)   { params.push(a.to);   where += ` AND tx_date <= $${params.length}`; }
    const r = await pool.query(
      `SELECT id, source, rendszam, tx_date, product, qty_l, amount_ron
       FROM fuel_card_transactions WHERE ${where}
       ORDER BY tx_date DESC, id DESC LIMIT 200`, params);
    const sumR = await pool.query(
      `SELECT COUNT(*)::int AS db, COALESCE(SUM(qty_l),0)::numeric AS litru, COALESCE(SUM(amount_ron),0)::numeric AS suma
       FROM fuel_card_transactions WHERE ${where}`, params);
    return res.json({ result: { ok: true, items: r.rows, total: sumR.rows[0] } });
  } catch (err) {
    console.error('fuelCardList hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server (a rulat migrarea phase4?)' } });
  }
};

// Kártya-tranzakciók vs. a sofőr által beírt tankolások (Motorină),
// rendszámonként — a >10% eltérés gyanús (elírás vagy visszaélés).
handlers.fuelCompare = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const from = a.from || '1970-01-01';
    const to = a.to || '2999-12-31';

    const cardR = await pool.query(
      `SELECT rendszam, COALESCE(SUM(qty_l),0)::numeric AS litru, COALESCE(SUM(amount_ron),0)::numeric AS suma
       FROM fuel_card_transactions
       WHERE company_id=$1 AND tx_date >= $2 AND tx_date <= $3 AND rendszam IS NOT NULL
       GROUP BY rendszam`, [cid, from, to]);

    const drvR = await pool.query(
      `SELECT UPPER(REGEXP_REPLACE(f.numar_camion,'[^A-Za-z0-9]','','g')) AS rendszam,
              COALESCE(SUM((a.elem->>'litru')::numeric),0) AS litru,
              COALESCE(SUM((a.elem->>'suma')::numeric),0) AS suma
       FROM fuvarlevelek f
       JOIN users u ON LOWER(u.email)=LOWER(f.email_sofer) AND u.company_id=$1,
            jsonb_array_elements(f.alimentari) a(elem)
       WHERE COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) >= $2::date AND COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) < ($3::date + 1)
         AND COALESCE(a.elem->>'tip','Motorină') <> 'AdBlue'
         AND COALESCE(f.numar_camion,'') <> ''
       GROUP BY 1`, [cid, from, to]);

    const map = new Map();
    cardR.rows.forEach((r) => map.set(r.rendszam, { rendszam: r.rendszam, card_l: parseFloat(r.litru), card_ron: parseFloat(r.suma), drv_l: 0, drv_ron: 0 }));
    drvR.rows.forEach((r) => {
      const cur = map.get(r.rendszam) || { rendszam: r.rendszam, card_l: 0, card_ron: 0 };
      cur.drv_l = parseFloat(r.litru); cur.drv_ron = parseFloat(r.suma);
      map.set(r.rendszam, cur);
    });
    const rows = [...map.values()].map((x) => {
      x.diff_l = Math.round((x.drv_l - x.card_l) * 10) / 10;
      x.diff_pct = x.card_l > 0 ? Math.round(((x.drv_l - x.card_l) / x.card_l) * 1000) / 10 : null;
      return x;
    }).sort((a2, b2) => Math.abs(b2.diff_l) - Math.abs(a2.diff_l));

    return res.json({ result: { ok: true, rows } });
  } catch (err) {
    console.error('fuelCompare hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ════════════════════════════════════════════════════════════
//  5) GPS-KM vs. MENETLEVÉL-KM (a napi gps_mileage_log snapshotból)
// ════════════════════════════════════════════════════════════
handlers.getGpsKmComparison = async function (req, res, args) {
  try {
    if (!_isAdminOrManager(req)) return _deny(res);
    const a = _arg(args);
    const cid = req.session.user.company_id;
    const from = a.from || '1970-01-01';
    const to = a.to || '2999-12-31';

    const gpsR = await pool.query(
      `SELECT rendszam,
              (MAX(mileage) - MIN(mileage))::numeric AS gps_km,
              COUNT(*)::int AS napok
       FROM gps_mileage_log
       WHERE company_id=$1 AND logged_on >= $2::date AND logged_on <= $3::date
       GROUP BY rendszam HAVING COUNT(*) >= 2`, [cid, from, to]);
    if (!gpsR.rows.length) return res.json({ result: { ok: true, rows: [] } });

    const drvR = await pool.query(
      `SELECT UPPER(REGEXP_REPLACE(f.numar_camion,'[^A-Za-z0-9]','','g')) AS rendszam,
              COALESCE(SUM(f.total_km),0)::numeric AS drv_km
       FROM fuvarlevelek f
       JOIN users u ON LOWER(u.email)=LOWER(f.email_sofer) AND u.company_id=$1
       WHERE COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) >= $2::date AND COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) < ($3::date + 1)
         AND COALESCE(f.numar_camion,'') <> ''
       GROUP BY 1`, [cid, from, to]);
    const drvMap = new Map();
    drvR.rows.forEach((r) => drvMap.set(r.rendszam, parseFloat(r.drv_km) || 0));

    const rows = gpsR.rows.map((g) => {
      const norm = String(g.rendszam || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const drvKm = drvMap.get(norm) || 0;
      const gpsKm = parseFloat(g.gps_km) || 0;
      return {
        rendszam: g.rendszam, gps_km: Math.round(gpsKm), drv_km: Math.round(drvKm),
        diff_km: Math.round(drvKm - gpsKm),
        diff_pct: gpsKm > 0 ? Math.round(((drvKm - gpsKm) / gpsKm) * 1000) / 10 : null,
        napok: g.napok,
      };
    }).sort((a2, b2) => Math.abs(b2.diff_km) - Math.abs(a2.diff_km));
    return res.json({ result: { ok: true, rows } });
  } catch (err) {
    console.error('getGpsKmComparison hiba:', err);
    return res.json({ result: { ok: true, rows: [] } }); // migráció előtt: üres
  }
};

// A `computeServiceDueAlerts` belső segéd NEM-enumerable → NEM hívható
// /api/execute-on át (a registry csak az enumerálható handlereket másolja),
// de require-rel a scheduler eléri (services/scheduler.js).
module.exports = handlers;
Object.defineProperty(module.exports, 'computeServiceDueAlerts', { enumerable: false, value: computeServiceDueAlerts });
