// ============================================================
//  VallorSoft — lib/borderAuto.js
//  Automatikus határátlépés-rögzítés a GPS útvonal-előzményből.
//
//  A gps_track_days (CargoTrack pontsor, napi bontás) minden új / frissült
//  napját átnézi, és a Románia-geozónán (lib/roBorder.js) felismert ki-/
//  belépéseket a border_crossings táblába írja `source='auto'` jelöléssel:
//  pontos idő (interpolálva), koordináta, rendszám, cég.
//
//  Sofőr-hozzárendelés: a vontató azon menetleveléből, ami az időpontot
//  lefedi; ha nincs, a járműhöz rendelt sofőr (Belső sofőrök fül).
//  A diurna a menetlevélen rendszám szerint keresi az automata sorokat,
//  így a hozzárendelés csak a naplóhoz kell.
//
//  Az iroda által elvetett (ignored) vagy módosított automata sort a rendszer
//  nem hozza vissza (±15 perces duplikátum-őr, az eredeti időre/irányra is).
// ============================================================
const pool = require('../db');
const geo = require('./roBorder');
const { PLATE_SQL } = require('./tripCrossings');

const SPAN_DAYS = 31;            // egy körben járművenként ennyi napot dolgoz fel
const DUP_MIN = 15;              // ugyanaz az irány ±15 percen belül = ugyanaz az átlépés
// Csak a friss (még valószínűleg el nem számolt) menetlevelek diurnája frissül
// magától; a régi, lezárt hónapokhoz a rendszer nem nyúl.
const RECALC_DAYS = 45;

const norm = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
function addDays(day, n) {
  const [y, m, d] = String(day).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Ismert közúti határátkelők (közelítő koordináta) — csak a napló felirata.
const CROSSING_POINTS = [
  ['Nădlac II', 46.150, 20.735], ['Nădlac', 46.167, 20.748], ['Cenad', 46.133, 20.590],
  ['Turnu', 46.265, 21.090], ['Vărșand', 46.630, 21.330], ['Borș', 47.115, 21.810],
  ['Valea lui Mihai', 47.520, 22.150], ['Urziceni', 47.730, 22.400], ['Petea', 47.860, 22.880],
  ['Halmeu', 47.980, 23.020], ['Siret', 47.975, 26.065], ['Stânca-Costești', 47.880, 27.250],
  ['Sculeni', 47.330, 27.620], ['Albița', 46.700, 28.170], ['Oancea', 45.920, 28.110],
  ['Galați', 45.470, 28.190], ['Vama Veche', 43.745, 28.575], ['Negru Vodă', 43.810, 28.210],
  ['Ostrov', 44.110, 27.380], ['Giurgiu', 43.880, 25.970], ['Calafat', 43.975, 22.935],
  ['Porțile de Fier I', 44.670, 22.530], ['Moravița', 45.255, 21.270], ['Naidăș', 44.880, 21.390],
  ['Jimbolia', 45.785, 20.720],
];
function nearestCrossingName(lat, lng) {
  let best = null, bd = Infinity;
  for (const [n, la, ln] of CROSSING_POINTS) {
    const d = Math.hypot((la - lat) * 111, (ln - lng) * 111 * Math.cos(lat * Math.PI / 180));
    if (d < bd) { bd = d; best = n; }
  }
  return bd <= 8 ? best : null;
}
function locLabel(c) {
  const n = nearestCrossingName(c.lat, c.lng);
  return ((n ? n + ' · ' : '') + 'GPS ' + c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) + (c.approx ? ' (≈)' : '')).slice(0, 255);
}

/** Melyik sofőr vezette a vontatót az adott pillanatban? */
async function attributeDriver(cid, plate, at) {
  try {
    const w = await pool.query(
      `SELECT email_sofer, nume_sofer FROM fuvarlevelek
        WHERE company_id = $1 AND ${PLATE_SQL('numar_camion')} = $2
          AND email_sofer IS NOT NULL AND indulas_dt IS NOT NULL AND erkezes_dt IS NOT NULL
          AND indulas_dt <= $3::timestamptz + INTERVAL '12 hours'
          AND erkezes_dt >= $3::timestamptz - INTERVAL '12 hours'
        ORDER BY indulas_dt DESC LIMIT 1`, [cid, plate, at.toISOString()]);
    if (w.rows[0]) return { email: w.rows[0].email_sofer, nume: w.rows[0].nume_sofer || null };
  } catch (_) {}
  try {
    const v = await pool.query(
      `SELECT v.assigned_driver_email AS email, u.nume
         FROM vehicles v LEFT JOIN users u ON LOWER(u.email) = LOWER(v.assigned_driver_email) AND u.company_id = v.company_id
        WHERE v.company_id = $1 AND ${PLATE_SQL('v.rendszam')} = $2 AND v.assigned_driver_email IS NOT NULL
        LIMIT 1`, [cid, plate]);
    if (v.rows[0]) return { email: v.rows[0].email, nume: v.rows[0].nume || null };
  } catch (_) {}
  return { email: null, nume: null };
}

// Az átlépés-időpontot lefedő menetlevelek (diurna-újraszámoláshoz).
async function _waybillsAround(cid, plate, at) {
  const r = await pool.query(
    `SELECT id, email_sofer, numar_camion, indulas_dt, erkezes_dt, diurna_externa, diurna_interna
       FROM fuvarlevelek
      WHERE company_id = $1 AND ${PLATE_SQL('numar_camion')} = $2
        AND indulas_dt IS NOT NULL AND erkezes_dt IS NOT NULL AND email_sofer IS NOT NULL
        AND indulas_dt <= $3::timestamptz + INTERVAL '1 day'
        AND erkezes_dt >= $3::timestamptz - INTERVAL '1 day'
        AND erkezes_dt >= NOW() - INTERVAL '${RECALC_DAYS} days'
      LIMIT 20`, [cid, plate, at.toISOString()]);
  return r.rows;
}
const _iso = (d) => (d instanceof Date ? d.toISOString() : String(d));

/**
 * Egy jármű következő feldolgozatlan szakasza (max. SPAN_DAYS nap).
 * @returns {Promise<{inserted:number, recalc:number}>}
 */
async function scanVehicle(cid, plate, fromDay) {
  const toDay = addDays(fromDay, SPAN_DAYS - 1);
  const { rows } = await pool.query(
    `SELECT day::text AS day, points_json FROM gps_track_days
      WHERE company_id = $1 AND rendszam = $2 AND day BETWEEN $3::date AND $4::date AND point_count > 0
      ORDER BY day ASC`, [cid, plate, addDays(fromDay, -1), toDay]);
  let pts = [];
  for (const r of rows) {
    try { const a = JSON.parse(r.points_json || '[]'); if (Array.isArray(a)) pts = pts.concat(a); } catch (_) {}
  }
  pts.sort((a, b) => a[0] - b[0]);
  const det = geo.detectCrossings(pts);
  const np = norm(plate);
  const { calculateDiurna } = require('./diurna');
  const { fetchTripCrossings } = require('./tripCrossings');
  let inserted = 0, recalc = 0;

  for (const c of det.crossings) {
    const at = new Date(c.t * 1000);
    const tip = c.dir === 'OUT' ? 'Iesire' : 'Intrare';
    const dup = await pool.query(
      `SELECT id FROM border_crossings
        WHERE company_id = $1 AND source = 'auto' AND ${PLATE_SQL('rendszam')} = $2
          AND (tip = $3 OR orig_tip = $3)
          AND (created_at BETWEEN $4::timestamptz - INTERVAL '${DUP_MIN} minutes'
                              AND $4::timestamptz + INTERVAL '${DUP_MIN} minutes'
               OR orig_created_at BETWEEN $4::timestamptz - INTERVAL '${DUP_MIN} minutes'
                                      AND $4::timestamptz + INTERVAL '${DUP_MIN} minutes')
        LIMIT 1`, [cid, np, tip, at.toISOString()]);
    if (dup.rows[0]) continue;

    // Diurna: a nem kézzel felülírt menetlevelek frissüljenek (előtte-utána összevetés)
    let before = [];
    try {
      const ws = await _waybillsAround(cid, np, at);
      for (const w of ws) {
        const tc = await fetchTripCrossings(pool, w.email_sofer, _iso(w.indulas_dt), _iso(w.erkezes_dt), { companyId: cid, plate: np });
        const c0 = calculateDiurna(_iso(w.indulas_dt), _iso(w.erkezes_dt), tc.forCalc);
        if (Number(w.diurna_externa || 0) === c0.externDays && Number(w.diurna_interna || 0) === c0.internDays) before.push(w);
      }
    } catch (_) { before = []; }

    const drv = await attributeDriver(cid, np, at);
    await pool.query(
      `INSERT INTO border_crossings
         (email_sofer, nume_sofer, tip, tara, locatie, gps_lat, gps_lng, created_at, company_id, rendszam, source, gap_sec)
       VALUES ($1, $2, $3, 'RO', $4, $5, $6, $7::timestamptz, $8, $9, 'auto', $10)`,
      [drv.email, drv.nume, tip, locLabel(c), c.lat, c.lng, at.toISOString(), cid, String(plate).slice(0, 20),
        Number.isFinite(c.gapSec) ? Math.min(c.gapSec, 2147483647) : null]);
    inserted++;

    for (const w of before) {
      try {
        const tc = await fetchTripCrossings(pool, w.email_sofer, _iso(w.indulas_dt), _iso(w.erkezes_dt), { companyId: cid, plate: np });
        const c1 = calculateDiurna(_iso(w.indulas_dt), _iso(w.erkezes_dt), tc.forCalc);
        const u = await pool.query(
          `UPDATE fuvarlevelek SET diurna_externa = $2, diurna_interna = $3, hataratok = $4::jsonb
            WHERE id = $1 AND company_id = $5
              AND (diurna_externa IS DISTINCT FROM $2 OR diurna_interna IS DISTINCT FROM $3
                   OR hataratok::text IS DISTINCT FROM $4::jsonb::text)`,
          [w.id, c1.externDays, c1.internDays, JSON.stringify(tc.inWindow), cid]);
        recalc += u.rowCount || 0;
      } catch (e) { console.warn('[BorderAuto] diurna újraszámolás hiba', w.id, e.message); }
    }
  }

  // A feldolgozott napok jelölése (az utolsó napot, ha a sor végén még nyitott
  // irányváltás van, szándékosan NEM — a következő pontokkal újra átnézzük).
  const lastDay = rows.length ? rows[rows.length - 1].day : toDay;
  await pool.query(
    `UPDATE gps_track_days SET border_scanned_at = NOW()
      WHERE company_id = $1 AND rendszam = $2 AND day BETWEEN $3::date AND $4::date
        AND NOT ($5::boolean AND day = $6::date)`,
    [cid, plate, fromDay, toDay, det.pending, lastDay]);
  return { inserted, recalc };
}

/** Egy ütemezett kör: a legrégebbi feldolgozatlan napoktól járművenként. */
async function scanRound(opts) {
  const o = opts || {};
  const limit = Math.max(1, Math.min(200, o.vehicles || 30));
  const budget = o.budgetMs || 3 * 60 * 1000;
  const allowed = o.allowed || (async () => true);
  const t0 = Date.now();
  let q;
  try {
    q = await pool.query(
      `SELECT company_id, rendszam, MIN(day)::text AS from_day
         FROM gps_track_days
        WHERE point_count > 0 AND (border_scanned_at IS NULL OR border_scanned_at < updated_at)
        GROUP BY company_id, rendszam
        ORDER BY MIN(day) ASC
        LIMIT $1`, [limit]);
  } catch (e) {
    if (e && (e.code === '42703' || e.code === '42P01')) return { vehicles: 0, inserted: 0, recalc: 0 };
    throw e;
  }
  let inserted = 0, recalc = 0, n = 0;
  for (const r of q.rows) {
    if (Date.now() - t0 > budget) break;
    if (!(await allowed(r.company_id))) continue;
    try {
      const x = await scanVehicle(r.company_id, r.rendszam, r.from_day);
      inserted += x.inserted; recalc += x.recalc; n++;
    } catch (e) { console.warn('[BorderAuto] jármű hiba', r.company_id, r.rendszam, e.message); }
  }
  return { vehicles: n, inserted, recalc };
}

module.exports = { scanRound, scanVehicle, attributeDriver, nearestCrossingName, locLabel };
