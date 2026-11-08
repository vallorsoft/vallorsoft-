// ============================================================
//  VallorSoft — Menetlevél határátlépések
// ------------------------------------------------------------
//  2026-11 óta ELSŐDLEGES forrás a GPS-geozóna (lib/roBorder.js +
//  lib/borderAuto.js): a vontató pontsorából automatikusan felismert
//  ki-/belépések (source='auto'). A sofőr gombja megmaradt, de csak ott
//  számít, ahol nincs GPS-adat (kézi mód). Lásd fetchTripCrossings.
//
//  A sofőr a főoldali KÉT gombbal ("🇷🇴 ROMÁNIA BE" / "🇷🇴 ROMÁNIA KI")
//  rögzíti a határátlépést — GPS-koordinátával, egyetlen koppintással.
//  A menetlevélen NINCS kézi bevitel: a diurna KIZÁRÓLAG ezekből a
//  rögzítésekből számolódik, a menetlevél Plecare (indulás) és Sosire
//  (érkezés) dátuma közötti ablakban.
//
//  Ez a modul EGY helyen tartja a lekérdezést, hogy a mentés (fuvarlevel-save)
//  és az előnézet (previewTripDiurna) SOSE térhessen el egymástól.
// ============================================================

// Az ablak a menetlevél NAPJAIT fedi le (nem a pontos órát): a diurna
// naptári napokban számol, és a sofőr a határon gyakran a menetlevélbe
// írt óra ELŐTT/UTÁN koppint. Ezért az indulás napjának 00:00-jától az
// érkezés napjának 23:59:59-éig gyűjtünk.
//
// A `naive` parse (időzóna-jelölés nélküli 'YYYY-MM-DDTHH:MM') szándékosan
// azonos a `fuvarlevelek.indulas_dt` mentésekor használttal — így az ablak
// és a tárolt időpont ugyanazt jelenti.
function _dayStart(dtStr) {
  const d = new Date(String(dtStr).slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}
function _dayEnd(dtStr) {
  const d = new Date(String(dtStr).slice(0, 10) + 'T23:59:59.999');
  return isNaN(d.getTime()) ? null : d;
}

// A `border_crossings.tip` a sofőr-gomb értéke ('Intrare' | 'Iesire').
// A diurna-motor 'IN' | 'OUT' irányt vár.
function _dir(tip) {
  if (tip === 'Intrare' || tip === 'IN') return 'IN';
  return 'OUT';                       // 'Iesire' és minden más → kilépés
}

function _row(r) {
  const src = r.source === 'auto' ? 'auto' : (r.added_by ? 'office' : 'gps');
  const o = {
    datetime: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    direction: _dir(r.tip),
    tara: r.tara || null,
    locatie: r.locatie || null,
    source: src                       // 'auto' = GPS-geozóna, 'gps' = sofőr-gomb, 'office' = iroda
  };
  if (r.id != null) o.id = r.id;
  if (src === 'auto') {
    if (r.gps_lat != null) o.lat = Number(r.gps_lat);
    if (r.gps_lng != null) o.lng = Number(r.gps_lng);
    if (r.rendszam) o.rendszam = r.rendszam;
  }
  return o;
}

const PLATE_SQL = (col) => `UPPER(regexp_replace(COALESCE(${col},''), '[^A-Za-z0-9]', '', 'g'))`;
const _normPlate = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const _isoDay = (d) => new Date(d.getTime()).toISOString().slice(0, 10);

// A sofőr-gombos (és irodai) sorok — a régi, kézi út.
async function _manual(pool, email, from, to) {
  const win = await pool.query(
    `SELECT tip, tara, locatie, created_at, to_jsonb(border_crossings) ->> 'added_by' AS added_by
       FROM border_crossings
      WHERE LOWER(email_sofer) = LOWER($1)
        AND created_at >= $2 AND created_at <= $3
        AND COALESCE((to_jsonb(border_crossings) ->> 'source'), '') <> 'auto'
        AND COALESCE((to_jsonb(border_crossings) ->> 'ignored')::boolean, false) = false
      ORDER BY created_at ASC
      LIMIT 200`,
    [email, from, to]
  );
  const seed = await pool.query(
    `SELECT tip, tara, locatie, created_at, to_jsonb(border_crossings) ->> 'added_by' AS added_by
       FROM border_crossings
      WHERE LOWER(email_sofer) = LOWER($1)
        AND created_at < $2
        AND COALESCE((to_jsonb(border_crossings) ->> 'source'), '') <> 'auto'
        AND COALESCE((to_jsonb(border_crossings) ->> 'ignored')::boolean, false) = false
      ORDER BY created_at DESC
      LIMIT 1`,
    [email, from]
  );
  return { win: win.rows, seed: seed.rows[0] || null };
}

// A sofőr kiosztott vontatója (ha a hívó nem adott rendszámot).
async function _driverPlate(pool, cid, email) {
  try {
    const r = await pool.query(
      `SELECT rendszam FROM vehicles WHERE company_id = $1 AND LOWER(assigned_driver_email) = LOWER($2)
        ORDER BY (tip = 'Vontato') DESC, id ASC LIMIT 1`, [cid, email]);
    return r.rows[0] ? _normPlate(r.rows[0].rendszam) : '';
  } catch (_) { return ''; }
}

/**
 * Van-e a menetlevél ablakára elég GPS-adat (gps_track_days) az adott
 * vontatóhoz? Ha igen, az AUTOMATIKUS (GPS-geozóna) átlépések számítanak.
 */
async function _coverage(pool, cid, plate, from, to) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM gps_track_days
        WHERE company_id = $1 AND ${PLATE_SQL('rendszam')} = $2
          AND day BETWEEN $3::date AND $4::date AND point_count > 0`,
      [cid, plate, _isoDay(from), _isoDay(to)]);
    return r.rows[0] ? r.rows[0].n : 0;
  } catch (_) { return 0; }
}

// Ha nincs korábbi automatikus átlépés: a GPS első pontja az ablakban dönti
// el, honnan indul a kamion (pl. már külföldön van az út elején).
async function _gpsStartState(pool, cid, plate, from, until) {
  try {
    const r = await pool.query(
      `SELECT points_json FROM gps_track_days
        WHERE company_id = $1 AND ${PLATE_SQL('rendszam')} = $2 AND day >= $3::date AND point_count > 0
        ORDER BY day ASC LIMIT 1`, [cid, plate, _isoDay(from)]);
    if (!r.rows[0]) return null;
    const pts = JSON.parse(r.rows[0].points_json || '[]');
    const geo = require('./roBorder');
    const t0 = Math.floor(from.getTime() / 1000);
    for (const p of pts) {
      if (!Array.isArray(p) || p[0] < t0) continue;
      if (until && p[0] * 1000 >= until) break;   // csak az első automata átlépés ELŐTT
      if (geo.distToBorderM(p[1], p[2]) < geo.CONFIRM_M) continue;
      return geo.isInRomania(p[1], p[2]);
    }
  } catch (_) {}
  return null;
}

/**
 * A menetlevél időszakára eső határátlépések.
 *
 * AUTOMATIKUS mód (ha a cég GPS-e lefedi az ablakot): a vontató GPS-pontsorából
 * a Románia-geozónán felismert ki-/belépések (`source='auto'`) számítanak, plusz
 * az iroda által utólag felvett sorok (ha nincs mellettük azonos irányú automata).
 * A sofőr gombnyomása ilyenkor NEM számít a diurnába (de a naplóban megmarad).
 * KÉZI mód (nincs GPS): a sofőr gombjai + az irodai sorok, mint eddig.
 *
 * @param {Object} [opts] { companyId, plate } — nélkülük mindig kézi mód
 * @returns {Promise<{ inWindow, forCalc, mode: 'auto'|'manual', plate }>}
 *   `inWindow` — az időszakban rögzített átlépések (menetlevél-napló, előnézet).
 *   `forCalc`  — ugyanez + az ablak ELŐTTI utolsó átlépés (seed): a diurna-motor
 *                „Romániában van" állapotból indul, e nélkül a már kint lévő
 *                sofőrnek tévesen INTERN napokat számolnánk.
 */
async function fetchTripCrossings(pool, email, indulasDt, erkezesDt, opts) {
  const empty = { inWindow: [], forCalc: [], mode: 'manual', plate: '' };
  if (!pool || !email || !indulasDt || !erkezesDt) return empty;
  const from = _dayStart(indulasDt);
  const to = _dayEnd(erkezesDt);
  if (!from || !to || from > to) return empty;
  const o = opts || {};
  const cid = o.companyId;

  // Multi-tenant: a kézi sorok a sofőr e-mailjéhez kötöttek (mindig a
  // hívó által ellenőrzött sofőr e-mailjével hívjuk); az automata sorok
  // company_id + rendszám szerint szűrtek.
  const man = await _manual(pool, email, from, to);
  const manualResult = () => {
    const inWindow = man.win.map(_row);
    const forCalc = man.seed ? [_row(man.seed)].concat(inWindow) : inWindow.slice();
    return { inWindow, forCalc, mode: 'manual', plate: '' };
  };
  if (!cid) return manualResult();

  let plate = _normPlate(o.plate);
  if (!plate) plate = await _driverPlate(pool, cid, email);
  if (!plate) return manualResult();

  let autoWin = [], autoSeed = null;
  try {
    const w = await pool.query(
      `SELECT id, tip, tara, locatie, created_at, gps_lat, gps_lng, rendszam, source
         FROM border_crossings
        WHERE company_id = $1 AND source = 'auto' AND ignored = false
          AND ${PLATE_SQL('rendszam')} = $2
          AND created_at >= $3 AND created_at <= $4
        ORDER BY created_at ASC LIMIT 200`, [cid, plate, from, to]);
    autoWin = w.rows;
    const s = await pool.query(
      `SELECT id, tip, tara, locatie, created_at, gps_lat, gps_lng, rendszam, source
         FROM border_crossings
        WHERE company_id = $1 AND source = 'auto' AND ignored = false
          AND ${PLATE_SQL('rendszam')} = $2 AND created_at < $3
        ORDER BY created_at DESC LIMIT 1`, [cid, plate, from]);
    autoSeed = s.rows[0] || null;
  } catch (_) { return manualResult(); }   // migráció előtt

  const winDays = Math.max(1, Math.round((to - from) / 86400000));
  const covered = await _coverage(pool, cid, plate, from, to);
  if (!autoWin.length && covered < Math.ceil(winDays / 2)) return manualResult();

  // AUTOMATIKUS mód: automata sorok + irodai pótlások (a sofőr-gomb nem számít)
  const autoRows = autoWin.map(_row);
  const office = man.win.filter((r) => r.added_by).map(_row).filter((x) => {
    const tx = Date.parse(x.datetime);
    return !autoRows.some((a) => a.direction === x.direction && Math.abs(Date.parse(a.datetime) - tx) < 3 * 3600 * 1000);
  });
  const inWindow = autoRows.concat(office).sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));

  // Kiinduló állapot: elsőként a GPS saját megfigyelése az ablak elején (a
  // kamion ténylegesen hol volt) — ez megbízhatóbb, mint egy régi átlépés,
  // ami után hézag lehetett. Ha nincs ilyen pont, az utolsó korábbi sor.
  let seedRow = null;
  const st = await _gpsStartState(pool, cid, plate, from, autoRows.length ? Date.parse(autoRows[0].datetime) : null);
  if (st === false) {
    seedRow = { datetime: new Date(from.getTime() - 1000).toISOString(), direction: 'OUT', tara: null, locatie: null, source: 'auto' };
  } else if (st === null) {
    if (autoSeed) seedRow = _row(autoSeed);
    else if (man.seed && man.seed.added_by) seedRow = _row(man.seed);
  }
  const forCalc = seedRow ? [seedRow].concat(inWindow) : inWindow.slice();
  return { inWindow, forCalc, mode: 'auto', plate };
}

module.exports = { fetchTripCrossings, PLATE_SQL };
