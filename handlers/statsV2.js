// ============================================================
//  VallorSoft — handlers/statsV2.js
//  Statisztika 2.0 alap-handlerek — Mentett nézetek + KPI cél-értékek.
//
//  Az új Statisztika-váz (public/stats-v2/) ezekre a handlerekre épít.
//  A régi stats.js + statisticsHandlers.js érintetlen, párhuzamosan él.
//
//  Multi-tenant: minden lekérdezés company_id-szűrt, paraméteres SQL.
//  Írás/olvasás: csak Admin/Manager (a Statisztika alapszabálya).
//  A saját nézet mindig szerkeszthető; a megosztott nézetet csak a létrehozó
//  vagy az Admin írhatja/törölheti.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

// ── Segédek ─────────────────────────────────────────────────
function _am(req) { return !!(req.session.user && ['Admin', 'Manager'].includes(req.session.user.pozicio)); }
function _isAdmin(req) { return !!(req.session.user && (req.session.user.pozicio === 'Admin' || req.session.user.is_dev)); }
function _deny(res) { return res.json({ result: { ok: false, err: 'Acces interzis' } }); }
function _err(res, msg) { return res.json({ result: { ok: false, err: msg || 'Eroare de server' } }); }
function _ok(res, extra) { return res.json({ result: Object.assign({ ok: true }, extra || {}) }); }
function _str(x, n) { const s = x == null ? null : String(x).trim().slice(0, n); return s || null; }
function _num(x) { if (x === '' || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }
function _bool(x) { return x === true || x === 'true' || x === 1 || x === '1'; }

// Cég-szintű engedélyezett fülök (feature-catalog + company_features).
// A Statisztika 2.0 vázon belüli fő tabok (Áttekintés/Pénzügy/Flotta/Emberek/Op)
// mindegyike egy külön kulcs — így a developer cégenként be/ki tudja kapcsolni.
const V2_TABS = [
  { key: 'overview', label_ro: 'Prezentare generală', label_hu: 'Áttekintés' },
  { key: 'finance',  label_ro: 'Financiar',           label_hu: 'Pénzügy' },
  { key: 'fleet',    label_ro: 'Flotă',               label_hu: 'Flotta' },
  { key: 'people',   label_ro: 'Persoane',            label_hu: 'Emberek' },
  { key: 'ops',      label_ro: 'Operațiuni',          label_hu: 'Operáció' },
];

// KPI metric_key katalógus — a cél-értékek ehhez kötődnek.
const METRICS = new Set([
  'revenue',        // EUR/időszak — bevétel
  'profit',         // EUR/időszak — eredmény (bevétel − költség)
  'closed_orders',  // db/időszak — Finalizat fuvarok
  'active_orders',  // db (pillanatnyi) — aktív fuvarok
  'consum_l100',    // L/100km — cég-átlag fogyasztás
  'km_month',       // km/hó — teljes megtett km
  'utilization',    // % — jármű-kihasználtság
  'on_time_pct',    // % — időben teljesített fuvarok
]);
const PERIODS = new Set(['month', 'quarter', 'year']);

// ── statsV2Init — kezdeti csomag a kliensnek ───────────────
// Egy fetch → minden induló info (szerep, jog, engedélyezett fülök, cél-értékek).
handlers.statsV2Init = async function (req, res) {
  try {
    if (!_am(req)) return _deny(res);
    const me = req.session.user;
    // Pénzügy-jog (a régi statisticsHandlers._canSeeFinance-szel azonos szabály)
    let canFinance = (me.pozicio === 'Admin' || me.is_dev);
    if (!canFinance && me.pozicio === 'Manager') {
      const p = await pool.query(
        `SELECT up.enabled FROM user_permissions up
         JOIN users u ON u.id = up.user_id
         WHERE LOWER(u.email) = LOWER($1) AND u.company_id = $2 AND up.perm_key = 'stats_finance'`,
        [me.email, me.company_id]);
      canFinance = !!(p.rows.length && p.rows[0].enabled);
    }
    // Alap cél-értékek listája (a cél-vonalakhoz a KPI-tornyokon)
    const goals = await pool.query(
      `SELECT metric_key, period, target_value, currency, note, updated_at
       FROM stats_goals WHERE company_id=$1`, [me.company_id]);
    return _ok(res, {
      role: me.pozicio,
      is_admin: me.pozicio === 'Admin' || !!me.is_dev,
      can_finance: canFinance,
      tabs: V2_TABS,
      goals: goals.rows,
    });
  } catch (err) { console.error('statsV2Init hiba:', err); return _err(res); }
};

// ═══════════════════ MENTETT NÉZETEK ═══════════════════════

// Lista — a saját cég saját nézetei + a saját cégen belüli megosztottak
handlers.statsViewList = async function (req, res) {
  try {
    if (!_am(req)) return _deny(res);
    const me = req.session.user;
    const r = await pool.query(
      `SELECT sv.id, sv.name, sv.config, sv.is_shared, sv.user_id, sv.created_at, sv.updated_at,
              u.nume AS owner_name
       FROM stats_views sv
       LEFT JOIN users u ON u.id = sv.user_id
       WHERE sv.company_id = $1
         AND (sv.user_id = $2 OR sv.is_shared = TRUE)
       ORDER BY sv.updated_at DESC`,
      [me.company_id, me.id]);
    return _ok(res, { views: r.rows });
  } catch (err) { console.error('statsViewList hiba:', err); return _err(res); }
};

// Létrehozás vagy frissítés — args: [{ id?, name, config, is_shared }]
handlers.statsViewSave = async function (req, res, args) {
  try {
    if (!_am(req)) return _deny(res);
    const me = req.session.user;
    const a = (args && args[0]) || {};
    const name = _str(a.name, 120);
    if (!name) return _err(res, 'Numele este obligatoriu.');
    // A config-ot csak validáljuk, hogy objektum legyen — a részletet a kliens formátuma dönti
    let config = a.config;
    if (config == null) config = {};
    if (typeof config !== 'object' || Array.isArray(config)) return _err(res, 'Configurație invalidă.');
    // Méret-korlát: 32 KB (bőven elég egy szűrő-készletnek)
    const cfgStr = JSON.stringify(config);
    if (cfgStr.length > 32 * 1024) return _err(res, 'Configurația este prea mare.');
    const isShared = _bool(a.is_shared);

    if (a.id) {
      const id = parseInt(a.id, 10);
      // Csak a saját nézetet módosíthatja; megosztottnál Admin is
      const own = await pool.query(
        `SELECT user_id, is_shared FROM stats_views WHERE id=$1 AND company_id=$2`,
        [id, me.company_id]);
      if (!own.rowCount) return _err(res, 'Vederea nu a fost găsită.');
      const row = own.rows[0];
      if (row.user_id !== me.id && !_isAdmin(req)) return _deny(res);
      await pool.query(
        `UPDATE stats_views SET name=$1, config=$2::jsonb, is_shared=$3, updated_at=NOW()
         WHERE id=$4 AND company_id=$5`,
        [name, cfgStr, isShared, id, me.company_id]);
      audit.fromReq(req, 'stats.view.update', 'stats_view', id, { name, is_shared: isShared });
      return _ok(res, { id });
    }
    const ins = await pool.query(
      `INSERT INTO stats_views (company_id, user_id, name, config, is_shared)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
      [me.company_id, me.id, name, cfgStr, isShared]);
    audit.fromReq(req, 'stats.view.create', 'stats_view', ins.rows[0].id, { name, is_shared: isShared });
    return _ok(res, { id: ins.rows[0].id });
  } catch (err) { console.error('statsViewSave hiba:', err); return _err(res); }
};

// Törlés — args: [id]
handlers.statsViewDelete = async function (req, res, args) {
  try {
    if (!_am(req)) return _deny(res);
    const me = req.session.user;
    const id = parseInt((args && (args[0] || args.id)) || 0, 10);
    if (!id) return _err(res, 'ID lipsă.');
    const own = await pool.query(
      `SELECT user_id FROM stats_views WHERE id=$1 AND company_id=$2`,
      [id, me.company_id]);
    if (!own.rowCount) return _err(res, 'Vederea nu a fost găsită.');
    if (own.rows[0].user_id !== me.id && !_isAdmin(req)) return _deny(res);
    await pool.query(`DELETE FROM stats_views WHERE id=$1 AND company_id=$2`, [id, me.company_id]);
    audit.fromReq(req, 'stats.view.delete', 'stats_view', id, {});
    return _ok(res);
  } catch (err) { console.error('statsViewDelete hiba:', err); return _err(res); }
};

// ═══════════════════ KPI CÉL-ÉRTÉKEK ═══════════════════════

// Lista — a cég ÖSSZES cél-értéke (kliens szűri megjelenítéshez)
handlers.statsGoalList = async function (req, res) {
  try {
    if (!_am(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const r = await pool.query(
      `SELECT id, metric_key, period, target_value, currency, note, updated_at
       FROM stats_goals WHERE company_id=$1 ORDER BY metric_key, period`, [cid]);
    return _ok(res, { goals: r.rows });
  } catch (err) { console.error('statsGoalList hiba:', err); return _err(res); }
};

// Felvétel/frissítés (Admin only) — args: [{ metric_key, period, target_value, currency?, note? }]
// UNIQUE (company_id, metric_key, period) → ON CONFLICT
handlers.statsGoalSet = async function (req, res, args) {
  try {
    if (!_isAdmin(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const a = (args && args[0]) || {};
    const metric = _str(a.metric_key, 60);
    const period = _str(a.period, 20) || 'month';
    const target = _num(a.target_value);
    if (!metric || !METRICS.has(metric)) return _err(res, 'Indicator invalid.');
    if (!PERIODS.has(period)) return _err(res, 'Perioadă invalidă.');
    if (target == null || target < 0) return _err(res, 'Valoarea țintă este obligatorie.');
    const currency = _str(a.currency, 8);
    const note = _str(a.note, 500);
    const up = await pool.query(
      `INSERT INTO stats_goals (company_id, metric_key, period, target_value, currency, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id, metric_key, period)
       DO UPDATE SET target_value=EXCLUDED.target_value, currency=EXCLUDED.currency,
                     note=EXCLUDED.note, updated_at=NOW()
       RETURNING id`,
      [cid, metric, period, target, currency, note]);
    audit.fromReq(req, 'stats.goal.set', 'stats_goal', up.rows[0].id, { metric, period, target });
    return _ok(res, { id: up.rows[0].id });
  } catch (err) { console.error('statsGoalSet hiba:', err); return _err(res); }
};

// Törlés (Admin) — args: [id]
handlers.statsGoalDelete = async function (req, res, args) {
  try {
    if (!_isAdmin(req)) return _deny(res);
    const cid = req.session.user.company_id;
    const id = parseInt((args && (args[0] || args.id)) || 0, 10);
    if (!id) return _err(res, 'ID lipsă.');
    const r = await pool.query(`DELETE FROM stats_goals WHERE id=$1 AND company_id=$2`, [id, cid]);
    if (!r.rowCount) return _err(res, 'Ținta nu a fost găsită.');
    audit.fromReq(req, 'stats.goal.delete', 'stats_goal', id, {});
    return _ok(res);
  } catch (err) { console.error('statsGoalDelete hiba:', err); return _err(res); }
};

module.exports = handlers;
