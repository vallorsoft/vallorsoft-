// ============================================================
//  VallorSoft — lib/stopWaybill.js
//  A GPS szerinti tényleges fel-/lerakási cím rátétele a menetlevélre.
//
//  - A menetlevél pontja (fuvarlevelek.puncte[i]) a fuvar állomásához
//    `stopId` alapján kötődik; régebbi pontnál `orderId` + `role`
//    (loading/unloading) alapján, de csak ha a fuvarnak abból a fajtából
//    egyetlen állomása van (különben nem tippelünk).
//  - Az eredeti cím a `loc_planned` kulcsba kerül (visszaállítható), a
//    `loc_source='gps'` + `loc_gps` jelzi, hogy a rendszer írta át.
//  - order_stops.waybill_apply=true: a később beküldött menetlevélre is
//    rákerül (az ütemező `applyPending` köre).
//  - Cégenkénti beállítás: stop_match_settings (auto_apply + min_score).
//  Minden lekérdezés company_id-szűrt, paraméteres.
// ============================================================
const pool = require('../db');

const DEFAULTS = { auto_apply: false, min_score: 80, auto_events: true };
const MIN_SCORE_FLOOR = 30, MIN_SCORE_CEIL = 200;

async function getSettings(cid) {
  try {
    const r = await pool.query('SELECT * FROM stop_match_settings WHERE company_id=$1', [cid]);
    if (r.rows.length) return { auto_apply: r.rows[0].auto_apply === true, min_score: Number(r.rows[0].min_score) || DEFAULTS.min_score,
      auto_events: r.rows[0].auto_events !== false };
  } catch (_) {}
  return { ...DEFAULTS };
}

async function saveSettings(cid, s, by) {
  const auto = s.auto_apply === true;
  let min = parseInt(s.min_score, 10);
  if (!isFinite(min)) min = DEFAULTS.min_score;
  min = Math.max(MIN_SCORE_FLOOR, Math.min(MIN_SCORE_CEIL, min));
  // auto_events: ha nincs megadva, a tárolt érték marad (alap: be)
  const ev = typeof s.auto_events === 'boolean' ? s.auto_events : null;
  const r = await pool.query(
    `INSERT INTO stop_match_settings (company_id, auto_apply, min_score, updated_by, updated_at, auto_events)
     VALUES ($1,$2,$3,$4,NOW(),COALESCE($5,true))
     ON CONFLICT (company_id) DO UPDATE SET auto_apply=EXCLUDED.auto_apply, min_score=EXCLUDED.min_score,
       updated_by=EXCLUDED.updated_by, updated_at=NOW(),
       auto_events=COALESCE($5, stop_match_settings.auto_events)
     RETURNING auto_events`, [cid, auto, min, by ? String(by).slice(0, 255) : null, ev]);
  const evOut = r && r.rows && r.rows[0] ? r.rows[0].auto_events !== false : (ev !== false);
  return { auto_apply: auto, min_score: min, auto_events: evOut };
}

// Megfelel-e az automatikus rátétel feltételének?
function qualifies(settings, status, score) {
  return !!(settings && settings.auto_apply && (status === 'auto' || status === 'suggested' || status === 'confirmed')
    && score != null && Number(score) >= settings.min_score);
}

const ROLE = { pickup: 'loading', delivery: 'unloading' };
const TIP = { pickup: /^inc/i, delivery: /^desc/i };
function _norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// Egy menetlevél-pont ehhez az állomáshoz tartozik-e?
function punctMatches(p, stop, singleOfKind) {
  if (!p || typeof p !== 'object') return false;
  if (p.stopId != null && p.stopId !== '') return String(p.stopId) === String(stop.id);
  if (!singleOfKind) return false;
  if (String(p.orderId || '') !== String(stop.order_id)) return false;
  if (p.role) return p.role === ROLE[stop.kind];
  return TIP[stop.kind] ? TIP[stop.kind].test(_norm(p.tip)) : false;
}

// Tiszta függvény: a pontok átírása (vagy visszaállítása). Visszaad: { puncte, changed }
function rewritePuncte(puncte, stop, singleOfKind, revert) {
  let changed = 0;
  const out = (Array.isArray(puncte) ? puncte : []).map((p) => {
    if (!punctMatches(p, stop, singleOfKind)) return p;
    const q = { ...p };
    if (revert) {
      if (q.loc_source !== 'gps') return p;
      if (q.loc_planned != null) q.loc = q.loc_planned;
      delete q.loc_planned; delete q.loc_source; delete q.loc_gps;
      changed++;
      return q;
    }
    const addr = String(stop.actual_address || '').trim();
    if (!addr) return p;
    if (q.loc === addr && q.loc_source === 'gps') return p;
    // kézzel (az irodában) átírt GPS-címhez nem nyúlunk — azt ember döntötte el
    if (q.loc_source !== 'gps' && q.loc_planned != null) return p;
    if (q.loc_planned == null) q.loc_planned = q.loc != null ? q.loc : '';
    q.loc = addr.slice(0, 500); q.loc_source = 'gps'; q.loc_gps = q.loc;
    changed++;
    return q;
  });
  return { puncte: out, changed };
}

// Egy állomás tényleges címe → az összes menetlevélre, amelyen a fuvar szerepel.
async function applyStop(cid, stopId, opts) {
  opts = opts || {};
  const db = opts.db || pool;
  const st = (await db.query(
    `SELECT id, order_id, kind, actual_address, match_status FROM order_stops WHERE id=$1 AND company_id=$2`, [stopId, cid])).rows[0];
  if (!st) return { ok: false, err: 'not_found' };
  if (!opts.revert && !st.actual_address) return { ok: false, err: 'no_address' };
  const same = (await db.query(
    `SELECT COUNT(*)::int AS n FROM order_stops WHERE order_id=$1 AND company_id=$2 AND kind=$3`, [st.order_id, cid, st.kind])).rows[0].n;
  const { rows: wbs } = await db.query(
    `SELECT id, puncte FROM fuvarlevelek WHERE company_id=$1 AND order_ids @> jsonb_build_array($2::text)`, [cid, st.order_id]);
  let points = 0, waybills = 0;
  for (const w of wbs) {
    const r = rewritePuncte(w.puncte, st, same === 1, !!opts.revert);
    if (!r.changed) continue;
    await db.query('UPDATE fuvarlevelek SET puncte=$3::jsonb WHERE id=$1 AND company_id=$2', [w.id, cid, JSON.stringify(r.puncte)]);
    points += r.changed; waybills++;
  }
  if (opts.revert) {
    await db.query('UPDATE order_stops SET waybill_apply=false, waybill_applied_at=NULL WHERE id=$1 AND company_id=$2', [stopId, cid]);
  } else {
    // akkor is jelöljük, ha még nincs menetlevél: a később beküldöttre az ütemező teszi rá
    await db.query(`UPDATE order_stops SET waybill_apply=true, waybill_applied_at=CASE WHEN $3::int > 0 THEN NOW() ELSE waybill_applied_at END
                     WHERE id=$1 AND company_id=$2`, [stopId, cid, wbs.length]);
  }
  return { ok: true, waybills, points, total_waybills: wbs.length };
}

// Ütemező: a rátételt kért állomások, ahol azóta új (vagy még nem kezelt) menetlevél van.
async function applyPending(limit) {
  const { rows } = await pool.query(
    `SELECT s.id, s.company_id FROM order_stops s
      WHERE s.waybill_apply = true AND s.actual_address IS NOT NULL AND COALESCE(s.match_status,'') <> 'rejected'
        AND EXISTS (SELECT 1 FROM fuvarlevelek f WHERE f.company_id = s.company_id
                     AND f.order_ids @> jsonb_build_array(s.order_id)
                     AND (s.waybill_applied_at IS NULL OR f.data_completare > s.waybill_applied_at))
      LIMIT $1`, [limit || 50]);
  let n = 0;
  for (const r of rows) {
    try { const x = await applyStop(r.company_id, r.id); if (x.ok) n += x.points; }
    catch (e) { console.warn('[StopMatch] menetlevél-rátétel hiba', r.id, e.message); }
  }
  return { stops: rows.length, points: n };
}

module.exports = { DEFAULTS, getSettings, saveSettings, qualifies, punctMatches, rewritePuncte, applyStop, applyPending };
