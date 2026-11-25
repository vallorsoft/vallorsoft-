// ============================================================
//  VallorSoft — lib/waybillTimeFix.js
//  A beküldött menetlevél fel-/lerakási pontjainak idő-ellenőrzése a
//  GPS-útvonalból. A sofőr gyakran utólag tölti ki a menetlevelet, és
//  rossz órát / napot ír. Ha a GPS-ből felismert állomás-idő legalább
//  MIN_CONFIDENCE (85%) megbízhatóságú és a beírt idő ettől érdemben
//  eltér, a TÁROLT menetlevél-pont idejét átírjuk a GPS-időre.
//
//  - Csak a fuvar-állomáshoz kötött pont (Încărcare / Descărcare) javul;
//    a Plecare / Sosire a sofőr saját adata (km-óra, diurna-ablak) — azt
//    nem írjuk.
//  - A sofőr eredeti értéke megmarad: `time_driver` / `data_driver`;
//    `time_source='gps'`, `time_gps` (amit a rendszer írt), `time_conf` (%).
//  - Ha az iroda később kézzel átírja (time ≠ time_gps), ahhoz többé nem
//    nyúlunk — azt ember döntötte el.
//  - A megbízhatóság (%) a meglévő állomás-felismerés eredményéből
//    (order_stops.match_status / match_score / match_detail.votes+margin).
//  Minden lekérdezés company_id-szűrt, paraméteres.
// ============================================================
const { roDateTime } = require('./waybillRows');
const audit = require('./audit');

const MIN_CONFIDENCE = 85;          // ennél kisebb megbízhatóságnál nem írunk felül
const TOLERANCE_MIN = 15;           // ennyi percen belüli eltérés nem hiba
const AUTO_MARGIN = 12;             // = lib/stopMatch AUTO_MARGIN
const SCORE_FULL = 120;             // ennél a pontszámnál a pontszám-rész teljes
const KIND = { loading: 'pickup', unloading: 'delivery' };

const _isoDate = (s) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || '').trim()); return m ? m[1] : ''; };
const _hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim()); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : ''; };
const _tip = (p, re) => re.test(String((p && p.tip) || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());

/**
 * A GPS-ből felismert állomás-idő megbízhatósága, 0–100 %.
 *  - jóváhagyott (iroda vagy a sofőr a „pótolt gomb" ablakban): 100
 *  - biztos (auto): pontszám (50%) + független ellenőrzések egyezése (30%) + előny a 2. jelölthöz (20%)
 *  - javaslat / kézi ellenőrzésre váró / bukott újraellenőrzés: legfeljebb 80 → sosem ír felül
 */
function confidencePct(s) {
  if (!s) return 0;
  const st = s.match_status;
  const det = s.match_detail && typeof s.match_detail === 'object' ? s.match_detail : {};
  if (s.auto_filled && s.done_at && s.auto_ack_at && st !== 'rejected') return 100;
  if (!s.gps_arrived_at && !s.gps_left_at) return 0;
  if (st === 'confirmed') return 100;
  if (st !== 'auto' && st !== 'suggested') return 0;
  if (det.verify_fail) return 0;
  const score = Math.max(0, Number(s.match_score) || 0);
  const votes = det.votes == null ? 2 : Math.max(0, Number(det.votes) || 0);
  const margin = det.margin == null ? AUTO_MARGIN * 2 : Math.max(0, Number(det.margin) || 0);
  let pct = 50 * Math.min(1, score / SCORE_FULL) + 30 * Math.min(1, votes / 3) + 20 * Math.min(1, margin / (AUTO_MARGIN * 2));
  if (st === 'suggested' || s.needs_manual === true || s.needs_manual === 'true') pct = Math.min(pct, 80);
  return Math.round(pct);
}

/** Az állomás valós ideje (EGY időpont, mint a nyomtatványon: a fel-/lerakás vége, különben az érkezés). */
function stopTime(s) {
  if (!s) return null;
  if (s.auto_filled && s.done_at) return s.done_at;
  return s.gps_left_at || s.gps_arrived_at || null;
}

function _minutesApart(d1, t1, d2, t2) {
  const a = Date.parse(d1 + 'T' + t1 + ':00Z'), b = Date.parse(d2 + 'T' + t2 + ':00Z');
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 60000 : Infinity;
}

/**
 * Tiszta függvény: a pontok átírása.
 * @param {Array} puncte  a menetlevél pontjai
 * @param {Array} stops   a menetlevél fuvarjainak állomásai (order_stops sorok)
 * @returns {{puncte:Array, changes:Array<{i,from,to,conf}>}}
 */
function planTimeFix(puncte, stops) {
  const list = Array.isArray(puncte) ? puncte : [];
  const all = Array.isArray(stops) ? stops : [];
  const byId = new Map(all.map((s) => [String(s.id), s]));
  const changes = [];
  const out = list.map((p, i) => {
    if (!p || typeof p !== 'object') return p;
    if (_tip(p, /^(plecare|sosire)/)) return p;          // a sofőr saját indulása / érkezése
    let s = null;
    if (p.stopId != null && p.stopId !== '') s = byId.get(String(p.stopId)) || null;
    else if (p.orderId && KIND[p.role]) {
      const m = all.filter((x) => String(x.order_id) === String(p.orderId) && x.kind === KIND[p.role]);
      if (m.length === 1) s = m[0];                       // csak egyértelmű esetben
    }
    if (!s) return p;
    // kézzel (az irodában) átírt GPS-időhöz nem nyúlunk
    if (p.time_source === 'manual') return p;
    if (p.time_source === 'gps' && p.time_gps && _hhmm(p.time) + ' ' + _isoDate(p.data) !== p.time_gps) return p;
    const conf = confidencePct(s);
    if (conf < MIN_CONFIDENCE) return p;
    const g = roDateTime(stopTime(s));
    if (!g) return p;
    const curD = _isoDate(p.data), curT = _hhmm(p.time);
    if (curD && curT && _minutesApart(curD, curT, g.date, g.time) <= TOLERANCE_MIN) return p;
    const q = { ...p };
    if (q.time_source !== 'gps') { q.time_driver = curT; q.data_driver = curD || String(p.data || ''); }
    q.data = g.date; q.time = g.time;
    q.time_source = 'gps'; q.time_gps = g.time + ' ' + g.date; q.time_conf = conf;
    changes.push({ i, stopId: s.id, from: (curD + ' ' + curT).trim(), to: g.date + ' ' + g.time, conf });
    return q;
  });
  return { puncte: out, changes };
}

/** Egy menetlevél ellenőrzése + (ha kell) javítása. */
async function checkWaybill(pool, cid, id) {
  const r = await pool.query('SELECT id, puncte, order_ids FROM fuvarlevelek WHERE id = $1 AND company_id = $2', [id, cid]);
  if (!r.rows.length) return null;
  const f = r.rows[0];
  const puncte = Array.isArray(f.puncte) ? f.puncte : [];
  const ids = [...new Set(puncte.map((p) => (p && p.stopId != null ? String(p.stopId) : '')).filter((x) => /^\d+$/.test(x)))];
  const oids = [...new Set(puncte.filter((p) => p && p.orderId).map((p) => String(p.orderId)))];
  let changes = [];
  if (ids.length || oids.length) {
    const sR = await pool.query(
      `SELECT id, order_id, kind, gps_arrived_at, gps_left_at, done_at, match_status, match_score, match_detail,
              (to_jsonb(order_stops) ->> 'auto_filled') AS auto_filled,
              (to_jsonb(order_stops) ->> 'auto_ack_at') AS auto_ack_at,
              (to_jsonb(order_stops) ->> 'needs_manual') AS needs_manual
         FROM order_stops WHERE company_id = $1 AND (id = ANY($2::bigint[]) OR order_id::text = ANY($3::text[]))`, [cid, ids, oids]);
    const plan = planTimeFix(puncte, sR.rows);
    changes = plan.changes;
    if (changes.length) {
      // az idő változott → a pontok GPS km-óra állását is újra kell számolni
      await pool.query(
        `UPDATE fuvarlevelek SET puncte = $3::jsonb, time_check_at = NOW(), time_check = $4::jsonb, route_odo_at = NULL
          WHERE id = $1 AND company_id = $2`,
        [id, cid, JSON.stringify(plan.puncte), JSON.stringify({ v: 1, fixed: changes.length, changes, at: new Date().toISOString() })]);
      await audit.record({ company_id: cid, user_email: 'system', action: 'waybill.gps_time_fix', entity_type: 'fuvarlevel',
        entity_id: id, detail: { changes } });
      return { fixed: changes.length, changes };
    }
  }
  await pool.query('UPDATE fuvarlevelek SET time_check_at = NOW() WHERE id = $1 AND company_id = $2', [id, cid]);
  return { fixed: 0, changes };
}

// Sorba: minden még nem ellenőrzött menetlevél (visszamenőleg is), és a 60 napon belüli,
// amelynek valamelyik állomását az ellenőrzés óta újra felismerte a rendszer.
async function pickQueue(pool, limit) {
  const r = await pool.query(
    `SELECT f.id, f.company_id FROM fuvarlevelek f
      WHERE f.company_id IS NOT NULL AND jsonb_typeof(COALESCE(f.puncte,'[]'::jsonb)) = 'array'
        AND ( f.time_check_at IS NULL
              OR ( COALESCE(f.erkezes_dt, f.indulas_dt, f.data_completare) > NOW() - INTERVAL '60 days'
                   AND EXISTS (SELECT 1 FROM order_stops s
                                WHERE s.company_id = f.company_id
                                  AND f.order_ids @> jsonb_build_array(s.order_id::text)
                                  AND s.matched_at > f.time_check_at) ) )
      ORDER BY (f.time_check_at IS NULL) DESC, f.id DESC
      LIMIT $1`, [limit]);
  return r.rows;
}

async function markDone(pool, id) {
  try { await pool.query('UPDATE fuvarlevelek SET time_check_at = NOW() WHERE id = $1', [id]); } catch (_) {}
}

module.exports = { MIN_CONFIDENCE, TOLERANCE_MIN, confidencePct, stopTime, planTimeFix, checkWaybill, pickQueue, markDone };
